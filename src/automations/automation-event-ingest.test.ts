// src/automations/automation-event-ingest.test.ts — phase-1 Task 8.
// MQTT ingestion of the reserved namespace never creates a device, and the
// AutomationEngine triggers topic-matching rules on AUTOMATION_EVENT without the
// device-scope admission gate.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { MqttService } from "../mqtt/mqtt-service.js";
import { AutomationEngine } from "./automation-engine.js";
import { AUTOMATION_EVENT, DEVICE_STATE_CHANGE, MQTT_RAW_MESSAGE } from "../core/event-bus.js";
import { AUTOMATION_EVENT_SCHEMA, type AutomationEventEnvelopeV1 } from "./automation-event-service.js";
import { newEventMetadata } from "../core/event-metadata.js";
import type { Rule, EventContext } from "../core/types.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function envelope(name = "tank.low", payload: unknown = { level: 18 }): AutomationEventEnvelopeV1 {
  return { schema: AUTOMATION_EVENT_SCHEMA, name, payload, meta: newEventMetadata({ kind: "automation", id: "rule-A" }) };
}

describe("MQTT ingestion of the reserved automation-event namespace (Req 6.7, 6.9)", () => {
  let eventBus: EventEmitter;
  let deviceRegistry: { getById: ReturnType<typeof vi.fn>; resolveMqttDeviceId: ReturnType<typeof vi.fn> };
  let svc: MqttService;

  beforeEach(() => {
    eventBus = new EventEmitter();
    deviceRegistry = { getById: vi.fn(), resolveMqttDeviceId: vi.fn() };
    svc = new MqttService(
      { brokerUrl: "mqtt://localhost:1883", topics: [], automationEventTopicFilter: "aeolus/events/#" },
      eventBus,
      { deviceRegistry: deviceRegistry as never },
    );
  });

  it("emits AUTOMATION_EVENT, keeps the raw message visible, and creates no device", () => {
    const onAutomationEvent = vi.fn();
    const onDeviceState = vi.fn();
    const onRaw = vi.fn();
    eventBus.on(AUTOMATION_EVENT, onAutomationEvent);
    eventBus.on(DEVICE_STATE_CHANGE, onDeviceState);
    eventBus.on(MQTT_RAW_MESSAGE, onRaw);

    const topic = "aeolus/events/rule-A/tank.low";
    (svc as unknown as { handleMessage: (t: string, p: Buffer) => void }).handleMessage(
      topic,
      Buffer.from(JSON.stringify(envelope())),
    );

    expect(onRaw).toHaveBeenCalledTimes(1); // still visible in the inspector
    expect(onAutomationEvent).toHaveBeenCalledTimes(1);
    expect(onAutomationEvent.mock.calls[0][0]).toMatchObject({ topic, envelope: { name: "tank.low" } });
    // Never treated as device state, never resolved to a device id.
    expect(onDeviceState).not.toHaveBeenCalled();
    expect(deviceRegistry.resolveMqttDeviceId).not.toHaveBeenCalled();
  });

  it("drops a malformed envelope without emitting AUTOMATION_EVENT or a device event", () => {
    const onAutomationEvent = vi.fn();
    const onDeviceState = vi.fn();
    eventBus.on(AUTOMATION_EVENT, onAutomationEvent);
    eventBus.on(DEVICE_STATE_CHANGE, onDeviceState);

    (svc as unknown as { handleMessage: (t: string, p: Buffer) => void }).handleMessage(
      "aeolus/events/rule-A/tank.low",
      Buffer.from("{not json"),
    );

    expect(onAutomationEvent).not.toHaveBeenCalled();
    expect(onDeviceState).not.toHaveBeenCalled();
    expect(deviceRegistry.resolveMqttDeviceId).not.toHaveBeenCalled();
  });
});

describe("AutomationEngine triggers rules on AUTOMATION_EVENT without the device-scope gate (Req 6.10, 6.11)", () => {
  let eventBus: EventEmitter;
  let engine: AutomationEngine;

  beforeEach(() => {
    eventBus = new EventEmitter();
    // A scoped resolver with an EMPTY device set would block any device event;
    // automation events must still be delivered (no device-scope admission).
    engine = new AutomationEngine(eventBus, {
      scopeResolver: { resolve: () => ({ kind: "scoped", tabId: "t1", deviceIds: new Set<string>(), collections: new Set<string>() }) },
    });
  });

  afterEach(() => engine.dispose());

  it("delivers the payload and metadata to a matching rule, with no device id", async () => {
    let captured: EventContext | undefined;
    const rule: Rule = {
      id: "rule-B",
      topic: "aeolus/events/rule-A/tank.low",
      action: (ctx) => { captured = ctx; },
    };
    engine.register(rule);

    const env = envelope("tank.low", { level: 18 });
    eventBus.emit(AUTOMATION_EVENT, { topic: rule.topic, envelope: env });
    await new Promise((r) => setTimeout(r, 10));

    expect(captured).toBeDefined();
    expect(captured!.state).toEqual({ level: 18 });
    expect(captured!.deviceId).toBe("");
    expect(captured!.meta?.eventId).toBe(env.meta.eventId);
    expect(captured!.meta?.causationId).toBe(env.meta.causationId);
  });

  it("matches a wildcard subscription and normalizes a primitive payload", async () => {
    let captured: EventContext | undefined;
    engine.register({ id: "rule-C", topic: "aeolus/events/#", action: (ctx) => { captured = ctx; } });

    eventBus.emit(AUTOMATION_EVENT, { topic: "aeolus/events/rule-A/ping", envelope: envelope("ping", 42) });
    await new Promise((r) => setTimeout(r, 10));

    expect(captured?.state).toEqual({ value: 42 });
  });
});
