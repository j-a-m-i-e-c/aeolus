// showcase-cleanup §2.7 — reading a whole execution's worth of commands.
//
// The grouping itself is not the risky part; the scope is. `listForExecution` takes an
// execution id from the caller, so without the rule predicate an automation could
// enumerate another rule's commands by guessing one. These tests pin that boundary
// alongside the ordering and shape guarantees the presentation depends on.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import {
  CommandHistoryStore,
  MAX_COMMAND_LIST_LIMIT,
  type CommandRecord,
} from "./command-history-store.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let db: DatabaseType;
let store: CommandHistoryStore;

function record(overrides: Partial<CommandRecord> & { commandId: string }): CommandRecord {
  return {
    sourceKind: "automation",
    targetDeviceId: "dmx-1",
    actionType: "device_action",
    effectiveTier: "dispatch",
    lifecycleState: "REQUESTED",
    requestedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = new CommandHistoryStore(db);
});

afterEach(() => {
  db.close();
});

describe("CommandHistoryStore.listForExecution — grouping (§2.7)", () => {
  it("returns every command of one execution, oldest first", () => {
    // Inserted newest-first so a passing result cannot be insertion order by accident.
    store.create(record({ commandId: "cmd-fx", ruleId: "rule-A", executionId: "X1", requestedAt: 2000 }));
    store.create(record({ commandId: "cmd-dmx", ruleId: "rule-A", executionId: "X1", requestedAt: 1000 }));

    const group = store.listForExecution("X1", "rule-A");

    // ASC, unlike list(): a group is read as a sequence, and the order the commands
    // were issued in is part of what it explains.
    expect(group.map((entry) => entry.commandId)).toEqual(["cmd-dmx", "cmd-fx"]);
  });

  it("hydrates each command's transitions", () => {
    store.create(record({ commandId: "cmd-1", ruleId: "rule-A", executionId: "X1" }));
    store.create(record({ commandId: "cmd-2", ruleId: "rule-A", executionId: "X1", requestedAt: 1001 }));
    store.transition({ commandId: "cmd-1", toState: "DISPATCHED", timestamp: 1010, terminal: false });
    store.transition({ commandId: "cmd-1", toState: "ACKNOWLEDGED", timestamp: 1020, terminal: true, success: true });

    const [first, second] = store.listForExecution("X1", "rule-A");

    // Transitions must arrive with the group: commandProof() resolves stage statuses
    // from them, so a group without them renders four unreached stages.
    expect(first!.transitions.map((t) => t.toState)).toEqual([
      "REQUESTED",
      "DISPATCHED",
      "ACKNOWLEDGED",
    ]);
    // The batched transition query must not leak one command's rungs onto another.
    expect(second!.transitions.map((t) => t.toState)).toEqual(["REQUESTED"]);
  });

  it("excludes commands from other executions of the same rule", () => {
    store.create(record({ commandId: "cmd-1", ruleId: "rule-A", executionId: "X1" }));
    store.create(record({ commandId: "cmd-2", ruleId: "rule-A", executionId: "X2" }));

    expect(store.listForExecution("X1", "rule-A").map((e) => e.commandId)).toEqual(["cmd-1"]);
  });

  it("refuses another rule's execution even when the id is correct", () => {
    // The scope boundary. An automation that learns or guesses another rule's
    // execution id must still see nothing.
    store.create(record({ commandId: "cmd-1", ruleId: "rule-B", executionId: "X1" }));

    expect(store.listForExecution("X1", "rule-A")).toEqual([]);
  });

  it("refuses commands with no rule attribution", () => {
    // A REST or system command shares no rule with any automation, so it is not
    // readable through this accessor regardless of its execution id.
    store.create(record({ commandId: "cmd-rest", sourceKind: "rest", executionId: "X1" }));

    expect(store.listForExecution("X1", "rule-A")).toEqual([]);
  });

  it("returns an empty array for an unknown execution", () => {
    // Empty rather than undefined: "this execution proved nothing physical" is a real
    // answer, and a caller should not have to distinguish it from a lookup failure.
    expect(store.listForExecution("nope", "rule-A")).toEqual([]);
  });

  it("returns an empty array for a blank execution id or rule id", () => {
    store.create(record({ commandId: "cmd-1", ruleId: "rule-A", executionId: "X1" }));

    expect(store.listForExecution("", "rule-A")).toEqual([]);
    expect(store.listForExecution("X1", "")).toEqual([]);
  });

  it("clamps the result to the shared maximum", () => {
    for (let i = 0; i < 5; i += 1) {
      store.create(
        record({ commandId: `cmd-${i}`, ruleId: "rule-A", executionId: "X1", requestedAt: 1000 + i }),
      );
    }

    // Bounded like list(): a group is small in practice but must not be unbounded in
    // principle, since the result crosses into an isolate.
    expect(store.listForExecution("X1", "rule-A", 2)).toHaveLength(2);
    expect(store.listForExecution("X1", "rule-A", MAX_COMMAND_LIST_LIMIT + 100)).toHaveLength(5);
  });

  it("carries the trigger provenance recorded on each command", () => {
    store.create(
      record({
        commandId: "cmd-1",
        ruleId: "rule-A",
        executionId: "X1",
        triggerKind: "mqtt-device",
        triggerId: "gas-sensor-3",
        triggerTopic: "sensor/mine/gas",
      }),
    );

    const [entry] = store.listForExecution("X1", "rule-A");
    expect(entry!.triggerKind).toBe("mqtt-device");
    expect(entry!.triggerId).toBe("gas-sensor-3");
    expect(entry!.triggerTopic).toBe("sensor/mine/gas");
  });

  it("omits trigger fields entirely when nothing was recorded", () => {
    // Absent means "not recorded". An empty string would read as "no trigger", which
    // is never true of a command that exists.
    store.create(record({ commandId: "cmd-1", ruleId: "rule-A", executionId: "X1" }));

    const [entry] = store.listForExecution("X1", "rule-A");
    expect(entry).not.toHaveProperty("triggerKind");
    expect(entry).not.toHaveProperty("triggerId");
    expect(entry).not.toHaveProperty("triggerTopic");
  });
});
