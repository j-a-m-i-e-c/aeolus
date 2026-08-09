// src/automations/automation-event-service.test.ts — phase-1 Task 8.
import { describe, it, expect, vi } from "vitest";
import {
  AutomationEventService,
  isValidEventName,
  parseAutomationEventEnvelope,
  AUTOMATION_EVENT_SCHEMA,
  MAX_EVENT_DEPTH,
  type AutomationEventEnvelopeV1,
} from "./automation-event-service.js";
import { runInExecutionContext } from "./execution-context.js";
import { newEventMetadata } from "../core/event-metadata.js";
import type { MqttService } from "../mqtt/mqtt-service.js";

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never;

function buildService(publish = vi.fn()) {
  const mqttService = { isConnected: () => true, publish } as unknown as MqttService;
  return { service: new AutomationEventService({ mqttService, logger: silentLogger() }), publish };
}

describe("isValidEventName", () => {
  it.each(["tank.low", "tank/low", "a_b-c.d", "x"]) ("accepts %s", (n) => {
    expect(isValidEventName(n)).toBe(true);
  });
  it.each([
    ["wildcard +", "tank/+"],
    ["wildcard #", "tank/#"],
    ["leading slash", "/tank"],
    ["trailing slash", "tank/"],
    ["empty segment", "a//b"],
    ["traversal", "a/../b"],
    ["empty", ""],
    ["space", "tank low"],
  ])("rejects %s", (_l, n) => {
    expect(isValidEventName(n)).toBe(false);
  });
});

describe("AutomationEventService.emit", () => {
  it("publishes a versioned envelope to the reserved namespace with host-derived rule id", () => {
    const { service, publish } = buildService();
    const trigger = newEventMetadata({ kind: "mqtt-device", id: "tank" });
    const result = runInExecutionContext(
      { executionId: "X1", automationId: "rule-A", causationId: trigger.eventId, triggerMeta: trigger },
      () => service.emit("tank.low", { level: 18 }),
    );

    expect(result.published).toBe(true);
    expect(result.topic).toBe("aeolus/events/rule-A/tank.low");
    expect(publish).toHaveBeenCalledTimes(1);
    const [topic, payload] = publish.mock.calls[0];
    expect(topic).toBe("aeolus/events/rule-A/tank.low");
    const env = JSON.parse(payload) as AutomationEventEnvelopeV1;
    expect(env.schema).toBe(AUTOMATION_EVENT_SCHEMA);
    expect(env.name).toBe("tank.low");
    expect(env.payload).toEqual({ level: 18 });
    expect(env.meta.ruleId).toBe("rule-A");
    expect(env.meta.executionId).toBe("X1");
    expect(env.meta.causationId).toBe(trigger.eventId);
    expect(env.meta.traceId).toBe(trigger.traceId);
    expect(env.meta.depth).toBe(1); // trigger depth 0 + 1
  });

  it("refuses to emit outside an automation execution context", () => {
    const { service, publish } = buildService();
    const result = service.emit("tank.low", {});
    expect(result.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses an event name that tries to escape the reserved namespace", () => {
    const { service, publish } = buildService();
    const result = runInExecutionContext({ executionId: "X", automationId: "A" }, () =>
      service.emit("../../acks/evil", {}),
    );
    expect(result.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses emission at the maximum causal depth (A -> B -> A guard)", () => {
    const { service, publish } = buildService();
    const trigger = newEventMetadata({ kind: "automation", id: "A" }, { depth: MAX_EVENT_DEPTH });
    const result = runInExecutionContext(
      { executionId: "X", automationId: "B", triggerMeta: trigger },
      () => service.emit("loop", {}),
    );
    expect(result.published).toBe(false);
    expect(result.error).toMatch(/depth/i);
    expect(publish).not.toHaveBeenCalled();
  });

  it("normalizes the topic to the reserved namespace regardless of payload", () => {
    const { service, publish } = buildService();
    runInExecutionContext({ executionId: "X", automationId: "rule-Z" }, () => service.emit("a/b", 42));
    expect(publish.mock.calls[0][0]).toBe("aeolus/events/rule-Z/a/b");
  });
});

describe("parseAutomationEventEnvelope", () => {
  it("parses a well-formed envelope", () => {
    const env: AutomationEventEnvelopeV1 = {
      schema: AUTOMATION_EVENT_SCHEMA,
      name: "tank.low",
      payload: { level: 1 },
      meta: newEventMetadata({ kind: "automation", id: "A" }),
    };
    expect(parseAutomationEventEnvelope(JSON.stringify(env))?.name).toBe("tank.low");
  });

  it.each([
    ["not json", "{["],
    ["wrong schema", JSON.stringify({ schema: "other", name: "x", meta: {} })],
    ["bad name", JSON.stringify({ schema: AUTOMATION_EVENT_SCHEMA, name: "a/#", meta: { eventId: "e", timestamp: 1 } })],
    ["missing meta", JSON.stringify({ schema: AUTOMATION_EVENT_SCHEMA, name: "x" })],
  ])("rejects %s", (_l, raw) => {
    expect(parseAutomationEventEnvelope(raw)).toBeUndefined();
  });
});
