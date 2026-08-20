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

export interface DockerBroker {
  containerName: string;
  port: number;
  stop: () => void;
}

/**
 * Ceiling for any single `docker` CLI invocation.
 *
 * These calls are SYNCHRONOUS, so while one is blocked it starves the event loop and
 * vitest cannot fire its own hook timeout — an overrun surfaced only as an opaque
 * "Hook timed out in Nms" with no indication that Docker was the culprit. Bounding
 * each call turns that into a named, diagnosable failure.
 */
const DOCKER_CMD_TIMEOUT_MS = 60_000;

/** Run a `docker` CLI command with a hard timeout and a diagnosable failure. */
function dockerExec(args: string[], label: string): string {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      timeout: DOCKER_CMD_TIMEOUT_MS,
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { signal?: string; stderr?: Buffer | string };
    // execFileSync reports a timeout as SIGTERM (killed), not as a named code.
    const timedOut = e.signal === "SIGTERM" || e.code === "ETIMEDOUT";
    const stderr = e.stderr ? String(e.stderr).trim() : "";
    throw new Error(
      timedOut
        ? `${label}: 'docker ${args[0]}' exceeded ${DOCKER_CMD_TIMEOUT_MS}ms and was killed. ` +
          `The Docker daemon is unresponsive or the host is heavily loaded.`
        : `${label}: 'docker ${args[0]}' failed: ${e.message}${stderr ? ` — ${stderr}` : ""}`,
    );
  }
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

/**
 * Start a throwaway anonymous MQTT 5 mosquitto broker on a random host port.
 *
 * Container startup is by far the slowest and least reliable step in this harness, so
 * callers should start ONE broker per test file (`beforeAll`) and hand it to each
 * `createSimulatorE2E()` call, rather than paying for a container per test.
 */
export async function startDockerBroker(): Promise<DockerBroker> {
  // Random suffix as well as a timestamp: two files starting a broker in the same
  // millisecond would otherwise collide on the container name.
  const containerName = `aeolus-sim-itest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const command = "printf 'listener 1883\\nallow_anonymous true\\n' > /mosquitto/config/mosquitto.conf && exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf";
  dockerExec(
    ["run", "-d", "--name", containerName, "-p", "127.0.0.1::1883", "eclipse-mosquitto:2", "sh", "-c", command],
    "broker start",
  );

  let port: number;
  try {
    const portLine = dockerExec(["port", containerName, "1883"], "broker port lookup").trim();
    // e.g. "127.0.0.1:49173"
    port = Number.parseInt(portLine.split(":").pop() ?? "", 10);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Could not resolve mapped broker port from "${portLine}"`);
    }
    await waitForPort(port);
  } catch (err) {
    // Never leak a container when readiness fails — the next run would then hit a
    // name collision on top of the original problem.
    try {
      dockerExec(["rm", "-f", containerName], "broker cleanup");
    } catch {
      // best effort
    }
    throw err;
  }

  return {
    containerName,
    port,
    stop: () => {
      try {
        dockerExec(["rm", "-f", containerName], "broker cleanup");
      } catch {
        // best effort cleanup
      }
    },
  };
}

/** Connect an MQTT 5 client, bounded so a silent broker cannot hang a hook. */
async function connectMqttClient(
  brokerUrl: string,
  label: string,
  timeoutMs = 10_000,
): Promise<MqttClient> {
  return new Promise<MqttClient>((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, { protocolVersion: 5 });
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error(`${label}: MQTT connect did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
    client.once("connect", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once("error", (err) => {
      clearTimeout(timer);
      client.end(true);
      reject(err);
    });
  });
}

/**
 * Delete the scenario's retained state messages.
 *
 * Simulator state publications are RETAINED (`retainState` defaults to true), so a
 * shared broker replays the previous test's final state to the next test's fresh
 * MqttService the instant it subscribes. That arrives before the new simulator has
 * republished its initial state, and it is enough to satisfy the "pump discovered"
 * readiness wait — so setup can return with the registry holding the PREVIOUS test's
 * tank levels and flow rate. A test asserting an initial value (flow at zero, say)
 * would then fail depending on timing. A zero-length retained publish clears a topic.
 *
 * This is a reasoned race, not one observed failing: the suite also passes with this
 * step disabled, because the fresh simulator's initial-state publish usually lands
 * before any assertion runs. It is kept because sharing the broker is what introduced
 * the ordering coupling, and a narrow timing window is exactly what breaks on a
 * loaded CI runner.
 *
 * Done at setup rather than teardown so it also heals after a test that crashed
 * without tearing down.
 */
async function clearRetainedState(brokerUrl: string): Promise<void> {
  const client = await connectMqttClient(brokerUrl, "retained-state cleanup");
  try {
    await Promise.all(
      Object.values(STATE_TOPICS).map(
        (topic) =>
          new Promise<void>((resolve, reject) => {
            client.publish(topic, "", { retain: true, qos: 1 }, (err) =>
              err ? reject(err) : resolve(),
            );
          }),
      ),
    );
  } finally {
    // end(false) so the QoS 1 traffic above is flushed before the socket closes.
    await new Promise<void>((resolve) => client.end(false, {}, () => resolve()));
  }
}

/**
 * Create a fully wired simulator E2E environment.
 *
 * `broker` lets a test file start ONE container in `beforeAll` and reuse it for every
 * test, which is strongly preferred: container startup dominates setup cost and is
 * the step that intermittently overran the old per-test 60s hook budget. A supplied
 * broker is BORROWED — `stop()` leaves it running for the next test, and each setup
 * clears retained state so tests stay independent. When omitted, the environment
 * starts and owns its own container (kept for one-off use).
 *
 * `observationDelayMs` delays the pump's flow observation so it is published strictly
 * AFTER the ACK, making the observed-tier lifecycle (DISPATCHED → ACKNOWLEDGED →
 * OBSERVED) genuine rather than reached off an ack that carried the state. Defaults
 * to the scenario's own default when omitted.
 */
export async function createSimulatorE2E(
  options: { observationDelayMs?: number; broker?: DockerBroker } = {},
): Promise<SimulatorE2E> {
  const ownsBroker = options.broker === undefined;
  const broker = options.broker ?? (await startDockerBroker());
  const brokerUrl = `mqtt://127.0.0.1:${broker.port}`;
  const logger = createSimulatorLogger("silent");

  // A borrowed broker may still hold the previous test's retained state.
  if (!ownsBroker) {
    await clearRetainedState(brokerUrl);
  }

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
  simulator.loadScenario(
    createReferenceWaterScenario(
      options.observationDelayMs !== undefined ? { observationDelayMs: options.observationDelayMs } : {},
    ),
  );
  await simulator.start();

  const controlClient = await connectMqttClient(brokerUrl, "control client");

  // Wait for the simulator's initial state to reach the Aeolus registry, then
  // configure the pump's Phase 1 ACK profile through the registry store path
  // (the same path the PUT /mqtt-command-profile route uses).
  await waitFor(() => registry.getById(AEOLUS_DEVICE_IDS.pump) !== undefined, { label: "pump device discovered", timeoutMs: 10_000 });
  registry.setMqttCommandProfile(AEOLUS_DEVICE_IDS.pump, { acknowledgement: { supported: true }, qos: 1 });

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => controlClient.end(true, {}, () => resolve()));
    await simulator.stop();
    await mqttService.disconnect();
    // A borrowed broker outlives this environment; only tear down one we started.
    if (ownsBroker) {
      broker.stop();
    }
    db.close();
  };

  return { db, eventBus, registry, mqttService, tracker, store, commandService, simulator, brokerUrl, controlClient, stop };
}

export { AEOLUS_DEVICE_IDS, STATE_TOPICS };
