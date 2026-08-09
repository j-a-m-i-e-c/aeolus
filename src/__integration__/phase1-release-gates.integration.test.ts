// src/__integration__/phase1-release-gates.integration.test.ts
// phase-1-runtime-foundations Task 10 — the two "Definition of Phase 1 complete"
// end-to-end chains, exercising the REAL command path and event path.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import { initSchema } from "../db/database.js";
import { DeviceRegistry } from "../core/device-registry.js";
import { ActionRouter } from "../connectors/action-router.js";
import { CommandService, handleDeviceAction, restSource, type CommandServiceDeps } from "../automations/command-service.js";
import { PendingCommandTracker } from "../automations/pending-command-tracker.js";
import { CommandHistoryStore } from "../automations/command-history-store.js";
import { AutomationEngine } from "../automations/automation-engine.js";
import {
  AutomationEventService,
  parseAutomationEventEnvelope,
} from "../automations/automation-event-service.js";
import { runInExecutionContext } from "../automations/execution-context.js";
import { newEventMetadata } from "../core/event-metadata.js";
import { AUTOMATION_EVENT } from "../core/event-bus.js";
import type { EventContext, Rule } from "../core/types.js";
import type { ConnectorRegistry } from "../connectors/connector-registry.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe("Chain 1: generic MQTT device → CommandService → ACK → durable history", () => {
  let db: DatabaseType;
  let registry: DeviceRegistry;
  let store: CommandHistoryStore;
  let tracker: PendingCommandTracker;
  let svc: CommandService;
  let published: Array<{ topic: string; payload: string; options?: Record<string, unknown> }>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    registry = new DeviceRegistry(db, new EventEmitter());

    // A registered generic MQTT device, configured ACK-capable.
    registry.registerDevice({
      id: "esp32-relay",
      name: "ESP32 Relay",
      type: "switch",
      capabilities: ["on/off"],
      state: {},
      integration: "mqtt",
      lastSeen: Date.now(),
      topic: "esp32/relay/state",
      commandTopic: "esp32/relay/set",
      mqttCommandProfile: {
        acknowledgement: { supported: true, responseTopic: "aeolus/acks/esp32-relay" },
      },
    });

    published = [];
    const fakeMqtt = {
      isConnected: () => true,
      publish: (topic: string, payload: string, options?: Record<string, unknown>) => {
        published.push({ topic, payload, options });
      },
    };

    const router = new ActionRouter(
      new Map(),
      registry,
      { getModule: () => null } as unknown as ConnectorRegistry,
      () => {},
    );
    router.setMqttService(fakeMqtt as never);

    store = new CommandHistoryStore(db);
    tracker = new PendingCommandTracker({
      onTransition: (ev) => {
        if (!ev.commandId) return;
        if (store.currentState(ev.commandId) === "REQUESTED") {
          store.transition({ commandId: ev.commandId, toState: "DISPATCHED", timestamp: ev.timestamp, terminal: false });
        }
        store.transition({ commandId: ev.commandId, toState: ev.toState, timestamp: ev.timestamp, terminal: false });
      },
    });

    const connectorManager = {
      getAcknowledgementCapability: (id: string) => router.getAcknowledgementCapability(id),
      executeAction: (id: string, action: unknown, correlation?: unknown) =>
        router.executeAction(id, action as never, correlation as never),
    };

    svc = new CommandService({
      mqttService: fakeMqtt,
      connectorManager,
      logger: silentLogger(),
      deviceRegistry: registry,
      pendingCommandTracker: tracker,
      commandHistoryStore: store,
    } as unknown as CommandServiceDeps);
    svc.registerHandler("device_action", handleDeviceAction);
  });

  afterEach(() => db.close());

  it("reaches ACKNOWLEDGED with the correlation envelope and a durable timeline", async () => {
    const promise = svc.execute(
      { type: "device_action", target: "esp32-relay", params: { actionType: "on" } },
      restSource(),
    );

    // Let the register-before-dispatch publish happen.
    await new Promise((r) => setTimeout(r, 10));

    expect(published).toHaveLength(1);
    const sent = published[0];
    expect(sent.topic).toBe("esp32/relay/set");
    // Correlation mirrored into the JSON body...
    const body = JSON.parse(sent.payload) as { correlationId?: string; responseTopic?: string };
    expect(body.correlationId).toBeDefined();
    expect(body.responseTopic).toBe("aeolus/acks/esp32-relay");
    // ...and set as MQTT 5 properties.
    expect(sent.options?.correlationData).toBeInstanceOf(Buffer);
    expect(sent.options?.responseTopic).toBe("aeolus/acks/esp32-relay");

    // Simulated device ACK routed to the tracker (as MqttService.handleAckMessage would).
    tracker.route({ correlationId: body.correlationId as string, success: true });

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.lifecycleState).toBe("ACKNOWLEDGED");
    expect(result.commandId).toBeDefined();
    expect(result.correlationId).toBe(body.correlationId);

    const rec = store.get(result.commandId as string);
    expect(rec?.effectiveTier).toBe("acknowledged");
    expect(rec?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"]);
    expect(rec?.terminalAt).toBeGreaterThan(0);
  });

  it("records REQUESTED -> FAILED when the device reports failure, still ACK-capable", async () => {
    const promise = svc.execute(
      { type: "device_action", target: "esp32-relay", params: { actionType: "on" } },
      restSource(),
    );
    await new Promise((r) => setTimeout(r, 10));
    const body = JSON.parse(published[0].payload) as { correlationId: string };

    tracker.route({ correlationId: body.correlationId, success: false, error: "relay stuck" });

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.lifecycleState).toBe("FAILED");
    const rec = store.get(result.commandId as string);
    expect(rec?.lifecycleState).toBe("FAILED");
    expect(rec?.terminalAt).toBeGreaterThan(0);
  });
});

describe("Chain 2: Automation A emits an event → Automation B reacts with causal metadata", () => {
  it("preserves the causal chain and never creates a device", async () => {
    const eventBus = new EventEmitter();
    const published: Array<{ topic: string; payload: string }> = [];
    const fakeMqtt = {
      isConnected: () => true,
      publish: (topic: string, payload: string) => published.push({ topic, payload }),
    };
    const eventService = new AutomationEventService({ mqttService: fakeMqtt as never, logger: silentLogger() as never });

    // A device event (E1) triggered Automation A's execution X1; A emits an event.
    const triggering = newEventMetadata({ kind: "mqtt-device", id: "header-tank" });
    const emit = runInExecutionContext(
      { executionId: "X1", automationId: "rule-A", causationId: triggering.eventId, triggerMeta: triggering },
      () => eventService.emit("tank.low", { level: 18, tankId: "header-tank" }),
    );
    expect(emit.published).toBe(true);
    expect(published).toHaveLength(1);

    const envelope = parseAutomationEventEnvelope(published[0].payload)!;
    expect(envelope.meta.causationId).toBe(triggering.eventId);
    expect(envelope.meta.traceId).toBe(triggering.traceId);
    expect(envelope.meta.depth).toBe(1);

    // Automation B reacts to the reserved-namespace event.
    const engine = new AutomationEngine(eventBus, {});
    let bContext: EventContext | undefined;
    const ruleB: Rule = {
      id: "rule-B",
      topic: published[0].topic,
      action: (ctx) => { bContext = ctx; },
    };
    engine.register(ruleB);

    eventBus.emit(AUTOMATION_EVENT, { topic: published[0].topic, envelope });
    await new Promise((r) => setTimeout(r, 10));

    expect(bContext).toBeDefined();
    // Causal metadata preserved: triggering E1 -> A's emitted event -> B context.
    expect(bContext!.meta?.eventId).toBe(envelope.meta.eventId);
    expect(bContext!.meta?.causationId).toBe(triggering.eventId);
    expect(bContext!.state).toEqual({ level: 18, tankId: "header-tank" });
    // Not a device: the automation event never claims a device id.
    expect(bContext!.deviceId).toBe("");

    engine.dispose();
  });
});
