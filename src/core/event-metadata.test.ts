// src/core/event-metadata.test.ts — phase-1 Task 7 metadata factory.
import { describe, it, expect } from "vitest";
import { newEventMetadata } from "./event-metadata.js";

describe("newEventMetadata", () => {
  it("originates a chain: unique eventId, traceId = eventId, depth 0", () => {
    const m = newEventMetadata({ kind: "mqtt-device", id: "dev-1" });
    expect(m.eventId).toMatch(/[0-9a-f-]{36}/);
    expect(m.traceId).toBe(m.eventId);
    expect(m.depth).toBe(0);
    expect(m.source).toEqual({ kind: "mqtt-device", id: "dev-1" });
    expect(typeof m.timestamp).toBe("number");
  });

  it("carries causation and preserves a supplied traceId + depth for descendants", () => {
    const m = newEventMetadata(
      { kind: "automation", id: "rule-A" },
      { causationId: "E1", traceId: "T1", depth: 2, ruleId: "rule-A", executionId: "X1" },
    );
    expect(m.causationId).toBe("E1");
    expect(m.traceId).toBe("T1");
    expect(m.depth).toBe(2);
    expect(m.ruleId).toBe("rule-A");
    expect(m.executionId).toBe("X1");
    // A descendant still gets its own fresh identity.
    expect(m.eventId).not.toBe("T1");
  });
});
