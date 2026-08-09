// src/__integration__/simulator-harness.ts
// phase-2-mqtt-simulator Task 8/9 — end-to-end harness.
//
// Wires the REAL Aeolus command stack (MqttService, DeviceRegistry,
// CommandService, PendingCommandTracker, CommandHistoryStore, ActionRouter)
// against the REAL simulator runtime over a REAL MQTT 5 broker (a throwaway
// eclipse-mosquitto:2 Docker container, following the repo's existing broker
// integration-test convention). The simulator connects to Aeolus only through
// MQTT, exactly as the deployed separate process does, so the Phase 1 lifecycle
// is derived from the simulator's actual wire behaviour — never a mock.
//
// Requires Docker. The importing test skips when Docker is unavailable.

import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import net from "node:net";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import mqtt, { type MqttClient } from "mqtt";
import { initSchema } from "../db/database.js";
import { DEVICE_STATE_CHANGE } from "../core/event-bus.js";
import { DeviceRegistry } from "../core/device-registry.js";
import { MqttService } from "../mqtt/mqtt-service.js";
import { PendingCommandTracker } from "../automations/pending-command-tracker.js";
import { CommandHistoryStore } from "../automations/command-history-store.js";
import { CommandService, handleDeviceAction, type CommandServiceDeps } from "../automations/command-service.js";
import { currentExecutionContext } from "../automations/execution-context.js";
import { ActionRouter } from "../connectors/action-router.js";
import type { ConnectorRegistry } from "../connectors/connector-registry.js";
import type { ManagedInstance } from "../connectors/connector-manager.js";
import { AUTOMATION_EVENT_SCHEMA } from "../automations/automation-event-service.js";
import { SimulatorRuntime } from "../simulator/runtime.js";
import { loadSimulatorConfig } from "../simulator/config.js";
import { createSimulatorLogger } from "../simulator/logger.js";
import { createReferenceWaterScenario, AEOLUS_DEVICE_IDS, STATE_TOPICS } from "../simulator/scenarios/reference-water.js";

/** True when a Docker daemon is reachable (tests skip otherwise). */
export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "pipe", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export interface SimulatorE2E {
  db: DatabaseType;
  eventBus: EventEmitter;
  registry: DeviceRegistry;
  mqttService: MqttService;
  tracker: PendingCommandTracker;
  store: CommandHistoryStore;
  commandService: CommandService;
  simulator: SimulatorRuntime;
  brokerUrl: string;
  /** A raw control client for publishing Automation Events / duplicate commands. */
  controlClient: MqttClient;
  stop: () => Promise<void>;
}

/** Poll `predicate` until true or the timeout elapses. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitFor timed out: ${options.label ?? "condition"}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Build a Phase 1 Automation Event envelope. */
export function automationEvent(name: string, payload: unknown, ruleId = "reference-control"): string {
  return JSON.stringify({
    schema: AUTOMATION_EVENT_SCHEMA,
    name,
    payload,
    meta: {
      eventId: `evt-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      source: { kind: "automation", id: ruleId },
      ruleId,
      traceId: "trace-1",
      depth: 0,
    },
  });
}

interface DockerBroker {
  containerName: string;
  port: number;
  stop: () => void;
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (open) return;
    if (Date.now() > deadline) throw new Error(`Broker port ${port} not reachable`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Start a throwaway anonymous MQTT 5 mosquitto broker on a random host port. */
async function startDockerBroker(): Promise<DockerBroker> {
  const containerName = `aeolus-sim-itest-${Date.now()}`;
  const command = "printf 'listener 1883\\nallow_anonymous true\\n' > /mosquitto/config/mosquitto.conf && exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf";
  execFileSync(
    "docker",
    ["run", "-d", "--name", containerName, "-p", "127.0.0.1::1883", "eclipse-mosquitto:2", "sh", "-c", command],
    { stdio: "pipe" },
  );
  const portLine = execFileSync("docker", ["port", containerName, "1883"], { encoding: "utf8" }).trim();
  // e.g. "127.0.0.1:49173"
  const port = Number.parseInt(portLine.split(":").pop() ?? "", 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Could not resolve mapped broker port from "${portLine}"`);
  }
  await waitForPort(port);
  return {
    containerName,
    port,
    stop: () => {
      try {
        execFileSync("docker", ["rm", "-f", containerName], { stdio: "pipe" });
      } catch {
        // best effort cleanup
      }
    },
  };
}

/**
 * Create a fully wired simulator E2E environment. `ackDelayMs` delays the pump
 * ACK so the flow observation reliably precedes it for OBSERVED-tier tests.
 */
export async function createSimulatorE2E(options: { ackDelayMs?: number } = {}): Promise<SimulatorE2E> {
  const broker = await startDockerBroker();
  const brokerUrl = `mqtt://127.0.0.1:${broker.port}`;
  const logger = createSimulatorLogger("silent");

  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);

  const eventBus = new EventEmitter();
  const registry = new DeviceRegistry(db, eventBus);
  eventBus.on(DEVICE_STATE_CHANGE, (event) => {
    registry.upsert(event);
  });

  const store = new CommandHistoryStore(db);
  const tracker = new PendingCommandTracker({
    onTransition: (ev) => {
      if (!ev.commandId) return;
      if (store.currentState(ev.commandId) === "REQUESTED") {
        store.transition({ commandId: ev.commandId, toState: "DISPATCHED", timestamp: ev.timestamp, terminal: false });
      }
      store.transition({ commandId: ev.commandId, toState: ev.toState, timestamp: ev.timestamp, terminal: false });
    },
  });

  const mqttService = new MqttService(
    {
      brokerUrl,
      topics: ["#"],
      ackTopicFilter: "aeolus/acks/#",
      automationEventTopicFilter: "aeolus/events/#",
    },
    eventBus,
    { deviceRegistry: registry, ackRouter: tracker },
  );

  const actionRouter = new ActionRouter(
    new Map<string, ManagedInstance>(),
    registry,
    {} as unknown as ConnectorRegistry,
    () => undefined,
  );
  actionRouter.setMqttService(mqttService);

  const commandService = new CommandService({
    mqttService,
    connectorManager: actionRouter as unknown as CommandServiceDeps["connectorManager"],
    logger,
    deviceRegistry: registry,
    pendingCommandTracker: tracker,
    commandHistoryStore: store,
    ackResponseTopicBase: "aeolus/acks",
    // Read the active automation execution context (ALS) so automation-sourced
    // commands are stamped with executionId/causationId — the same provider
    // boundary the backend composition root uses.
    executionContext: { current: () => currentExecutionContext() },
  });
  commandService.registerHandler("device_action", handleDeviceAction, { physical: true });

  await mqttService.connect();

  const simConfig = loadSimulatorConfig({ AEOLUS_SIMULATOR_ENABLED: "true", MQTT_BROKER_URL: brokerUrl, AEOLUS_SIMULATOR_CLIENT_ID: "sim-e2e" });
  const simulator = new SimulatorRuntime(simConfig, logger);
  simulator.loadScenario(createReferenceWaterScenario({ ackDelayMs: options.ackDelayMs ?? 0 }));
  await simulator.start();

  const controlClient = await new Promise<MqttClient>((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, { protocolVersion: 5 });
    client.on("connect", () => resolve(client));
    client.on("error", reject);
  });

  // Wait for the simulator's initial state to reach the Aeolus registry, then
  // configure the pump's Phase 1 ACK profile through the registry store path
  // (the same path the PUT /mqtt-command-profile route uses).
  await waitFor(() => registry.getById(AEOLUS_DEVICE_IDS.pump) !== undefined, { label: "pump device discovered", timeoutMs: 10_000 });
  registry.setMqttCommandProfile(AEOLUS_DEVICE_IDS.pump, { acknowledgement: { supported: true }, qos: 1 });

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => controlClient.end(true, {}, () => resolve()));
    await simulator.stop();
    await mqttService.disconnect();
    broker.stop();
    db.close();
  };

  return { db, eventBus, registry, mqttService, tracker, store, commandService, simulator, brokerUrl, controlClient, stop };
}

export { AEOLUS_DEVICE_IDS, STATE_TOPICS };
