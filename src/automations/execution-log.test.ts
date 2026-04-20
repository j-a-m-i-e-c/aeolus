import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionLog, ExecutionLogEntry } from "./execution-log";

function makeEntry(overrides: Partial<ExecutionLogEntry> = {}): ExecutionLogEntry {
  return {
    id: overrides.id ?? "entry-1",
    ruleId: overrides.ruleId ?? "rule-1",
    ruleName: overrides.ruleName ?? "Test Rule",
    ruleType: overrides.ruleType ?? "form",
    triggerTopic: overrides.triggerTopic ?? "sensor/temp",
    actions: overrides.actions ?? [{ type: "log", target: "", success: true }],
    duration: overrides.duration ?? 10,
    timestamp: overrides.timestamp ?? Date.now(),
  };
}

describe("ExecutionLog", () => {
  let log: ExecutionLog;

  beforeEach(() => {
    log = new ExecutionLog();
  });

  it("starts empty", () => {
    expect(log.list()).toEqual([]);
  });

  it("stores and retrieves entries newest-first", () => {
    log.push(makeEntry({ id: "a", timestamp: 1 }));
    log.push(makeEntry({ id: "b", timestamp: 2 }));
    const entries = log.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("b");
    expect(entries[1].id).toBe("a");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      log.push(makeEntry({ id: `e-${i}` }));
    }
    expect(log.list(3)).toHaveLength(3);
    expect(log.list(0)).toHaveLength(0);
  });

  it("evicts oldest entries when buffer is full", () => {
    const small = new ExecutionLog(5);
    for (let i = 0; i < 8; i++) {
      small.push(makeEntry({ id: `e-${i}` }));
    }
    const entries = small.list();
    expect(entries).toHaveLength(5);
    // oldest 3 (e-0, e-1, e-2) should be evicted
    expect(entries.map((e) => e.id)).toEqual(["e-7", "e-6", "e-5", "e-4", "e-3"]);
  });

  it("filters by ruleId newest-first", () => {
    log.push(makeEntry({ id: "a", ruleId: "r1", timestamp: 1 }));
    log.push(makeEntry({ id: "b", ruleId: "r2", timestamp: 2 }));
    log.push(makeEntry({ id: "c", ruleId: "r1", timestamp: 3 }));

    const r1 = log.getByRuleId("r1");
    expect(r1).toHaveLength(2);
    expect(r1[0].id).toBe("c");
    expect(r1[1].id).toBe("a");

    expect(log.getByRuleId("r2")).toHaveLength(1);
    expect(log.getByRuleId("unknown")).toEqual([]);
  });

  it("returns all entries when limit is undefined", () => {
    for (let i = 0; i < 5; i++) {
      log.push(makeEntry({ id: `e-${i}` }));
    }
    expect(log.list()).toHaveLength(5);
  });
});
