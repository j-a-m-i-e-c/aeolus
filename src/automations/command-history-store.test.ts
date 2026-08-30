// src/automations/command-history-store.test.ts
// phase-1-runtime-foundations Task 2 — CommandHistoryStore unit tests.
// Represents every history shape (dispatch-only, ack, observed, failure,
// timeout, mismatch, interrupted) with no MQTT runtime (Checkpoint 2).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import {
  CommandHistoryStore,
  type CommandRecord,
  type CommandLifecycleTransitionEvent,
  DEFAULT_COMMAND_LIST_LIMIT,
  MAX_COMMAND_LIST_LIMIT,
} from "./command-history-store.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let db: DatabaseType;
let store: CommandHistoryStore;
let clock = 1000;

function nextTs(): number {
  clock += 1;
  return clock;
}

function baseRecord(overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    commandId: "cmd-1",
    sourceKind: "rest",
    targetDeviceId: "dev-1",
    actionType: "toggle",
    effectiveTier: "dispatch",
    lifecycleState: "REQUESTED",
    requestedAt: nextTs(),
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  store = new CommandHistoryStore(db);
  clock = 1000;
});

afterEach(() => db.close());

describe("CommandHistoryStore — create", () => {
  it("creates a REQUESTED record with an initial REQUESTED transition", () => {
    store.create(baseRecord({ commandId: "c1" }));
    const got = store.get("c1");
    expect(got?.lifecycleState).toBe("REQUESTED");
    expect(got?.transitions).toHaveLength(1);
    expect(got?.transitions[0]).toMatchObject({ toState: "REQUESTED" });
    expect(got?.transitions[0].fromState).toBeUndefined();
    expect(got?.terminalAt).toBeUndefined();
  });

  it("persists source/provenance and tier fields", () => {
    store.create(
      baseRecord({
        commandId: "c2",
        sourceKind: "automation",
        ruleId: "rule-A",
        executionId: "exec-1",
        causationId: "evt-1",
        requestedTier: "observed",
        effectiveTier: "acknowledged",
        correlationId: "K1",
      }),
    );
    const got = store.get("c2");
    expect(got).toMatchObject({
      sourceKind: "automation",
      ruleId: "rule-A",
      executionId: "exec-1",
      causationId: "evt-1",
      requestedTier: "observed",
      effectiveTier: "acknowledged",
      correlationId: "K1",
    });
  });
});

describe("CommandHistoryStore — dispatch-only history", () => {
  it("writes terminal_at when DISPATCHED completes a dispatch-only wait", () => {
    store.create(baseRecord({ commandId: "c1", effectiveTier: "dispatch" }));
    store.transition({
      commandId: "c1",
      toState: "DISPATCHED",
      timestamp: nextTs(),
      success: true,
      terminal: true,
    });
    const got = store.get("c1");
    expect(got?.lifecycleState).toBe("DISPATCHED");
    expect(got?.success).toBe(true);
    expect(got?.terminalAt).toBeGreaterThan(0);
    expect(got?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED"]);
  });
});

describe("CommandHistoryStore — acknowledged and observed histories", () => {
  it("persists REQUESTED -> DISPATCHED -> ACKNOWLEDGED for an ack-tier command", () => {
    store.create(baseRecord({ commandId: "c1", effectiveTier: "acknowledged" }));
    store.transition({ commandId: "c1", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
    store.transition({
      commandId: "c1",
      toState: "ACKNOWLEDGED",
      timestamp: nextTs(),
      success: true,
      terminal: true,
    });
    const got = store.get("c1");
    expect(got?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"]);
    expect(got?.lifecycleState).toBe("ACKNOWLEDGED");
    expect(got?.terminalAt).toBeGreaterThan(0);
  });

  it("persists the full REQUESTED -> DISPATCHED -> ACKNOWLEDGED -> OBSERVED chain", () => {
    store.create(baseRecord({ commandId: "c1", effectiveTier: "observed" }));
    store.transition({ commandId: "c1", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
    store.transition({ commandId: "c1", toState: "ACKNOWLEDGED", timestamp: nextTs(), terminal: false });
    store.transition({
      commandId: "c1",
      toState: "OBSERVED",
      timestamp: nextTs(),
      success: true,
      terminal: true,
    });
    const got = store.get("c1");
    expect(got?.transitions.map((t) => t.toState)).toEqual([
      "REQUESTED",
      "DISPATCHED",
      "ACKNOWLEDGED",
      "OBSERVED",
    ]);
    // ACKNOWLEDGED transition stays non-terminal until OBSERVED lands.
    expect(got?.lifecycleState).toBe("OBSERVED");
  });
});

describe("CommandHistoryStore — failure, timeout, mismatch", () => {
  it.each(["FAILED", "TIMED_OUT", "STATE_MISMATCH"] as const)(
    "records a terminal %s outcome with failure metadata",
    (terminalState) => {
      store.create(baseRecord({ commandId: "c1", effectiveTier: "observed" }));
      store.transition({ commandId: "c1", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
      store.transition({
        commandId: "c1",
        toState: terminalState,
        timestamp: nextTs(),
        success: false,
        failureKind: "execution",
        error: "boom",
        terminal: true,
      });
      const got = store.get("c1");
      expect(got?.lifecycleState).toBe(terminalState);
      expect(got?.success).toBe(false);
      expect(got?.error).toBe("boom");
      expect(got?.terminalAt).toBeGreaterThan(0);
    },
  );

  it("records REQUESTED -> FAILED for a pre-dispatch rejection", () => {
    store.create(baseRecord({ commandId: "c1" }));
    store.transition({
      commandId: "c1",
      toState: "FAILED",
      timestamp: nextTs(),
      success: false,
      failureKind: "not_found",
      terminal: true,
    });
    const got = store.get("c1");
    expect(got?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "FAILED"]);
    expect(got?.failureKind).toBe("not_found");
  });
});

describe("CommandHistoryStore — idempotency and guards (Req 3.6, 3.7)", () => {
  it("ignores a duplicate ACK without appending a second transition", () => {
    store.create(baseRecord({ commandId: "c1", effectiveTier: "observed" }));
    store.transition({ commandId: "c1", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
    store.transition({ commandId: "c1", toState: "ACKNOWLEDGED", timestamp: nextTs(), terminal: false });
    store.transition({ commandId: "c1", toState: "ACKNOWLEDGED", timestamp: nextTs(), terminal: false });
    const got = store.get("c1");
    expect(got?.transitions.filter((t) => t.toState === "ACKNOWLEDGED")).toHaveLength(1);
  });

  it("ignores a disallowed transition (e.g. REQUESTED -> OBSERVED)", () => {
    store.create(baseRecord({ commandId: "c1", effectiveTier: "observed" }));
    store.transition({ commandId: "c1", toState: "OBSERVED", timestamp: nextTs(), terminal: true });
    const got = store.get("c1");
    expect(got?.lifecycleState).toBe("REQUESTED");
    expect(got?.transitions).toHaveLength(1);
  });

  it("ignores a late transition after the configured wait is complete", () => {
    store.create(baseRecord({ commandId: "c1", effectiveTier: "acknowledged" }));
    store.transition({ commandId: "c1", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
    store.transition({ commandId: "c1", toState: "ACKNOWLEDGED", timestamp: nextTs(), success: true, terminal: true });
    // A late OBSERVED must not re-open a command whose configured wait is complete.
    store.transition({ commandId: "c1", toState: "OBSERVED", timestamp: nextTs(), success: true, terminal: true });
    const got = store.get("c1");
    expect(got?.lifecycleState).toBe("ACKNOWLEDGED");
    expect(got?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"]);
  });

  it("drops a transition for an unknown command id without throwing", () => {
    expect(() =>
      store.transition({ commandId: "ghost", toState: "DISPATCHED", timestamp: nextTs(), terminal: false }),
    ).not.toThrow();
    expect(store.get("ghost")).toBeUndefined();
  });
});

describe("CommandHistoryStore — list filters and bounds", () => {
  beforeEach(() => {
    store.create(baseRecord({ commandId: "a", targetDeviceId: "dev-1", sourceKind: "rest" }));
    store.create(
      baseRecord({ commandId: "b", targetDeviceId: "dev-2", sourceKind: "automation", ruleId: "r1", executionId: "e1" }),
    );
    store.create(baseRecord({ commandId: "c", targetDeviceId: "dev-1", sourceKind: "system" }));
  });

  it("returns newest-first", () => {
    const ids = store.list().map((r) => r.commandId);
    expect(ids).toEqual(["c", "b", "a"]);
  });

  it("filters by device, source kind, rule, execution, and state", () => {
    expect(store.list({ deviceId: "dev-1" }).map((r) => r.commandId).sort()).toEqual(["a", "c"]);
    expect(store.list({ sourceKind: "automation" }).map((r) => r.commandId)).toEqual(["b"]);
    expect(store.list({ ruleId: "r1" }).map((r) => r.commandId)).toEqual(["b"]);
    expect(store.list({ executionId: "e1" }).map((r) => r.commandId)).toEqual(["b"]);
    expect(store.list({ state: "REQUESTED" })).toHaveLength(3);
  });

  it("defaults and clamps the limit", () => {
    expect(store.list({ limit: 2 })).toHaveLength(2);
    expect(store.list({ limit: 0 })).toHaveLength(1); // clamped up to 1
    // Default and max are exposed constants, not magic numbers.
    expect(DEFAULT_COMMAND_LIST_LIMIT).toBe(50);
    expect(MAX_COMMAND_LIST_LIMIT).toBe(200);
    expect(store.list({ limit: 9999 }).length).toBeLessThanOrEqual(MAX_COMMAND_LIST_LIMIT);
  });
});

describe("CommandHistoryStore — correlation linkage", () => {
  it("sets and finds a command by correlation id", () => {
    store.create(baseRecord({ commandId: "c1" }));
    store.setCorrelation("c1", "K-123");
    expect(store.findByCorrelation("K-123")).toBe("c1");
    expect(store.get("c1")?.correlationId).toBe("K-123");
  });
});

describe("CommandHistoryStore — onTransitionRecorded hook (Req 7.5)", () => {
  it("emits after create (REQUESTED) and each committed transition, but not on no-ops", () => {
    const events: CommandLifecycleTransitionEvent[] = [];
    const s = new CommandHistoryStore(db, (e) => events.push(e));

    s.create(baseRecord({ commandId: "c1", effectiveTier: "acknowledged", correlationId: "K1", targetDeviceId: "dev-1", sourceKind: "automation", ruleId: "rA", executionId: "X1" }));
    s.transition({ commandId: "c1", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
    s.transition({ commandId: "c1", toState: "ACKNOWLEDGED", timestamp: nextTs(), success: true, terminal: true });
    // No-op transitions emit nothing.
    s.transition({ commandId: "c1", toState: "ACKNOWLEDGED", timestamp: nextTs(), terminal: true });
    s.transition({ commandId: "c1", toState: "OBSERVED", timestamp: nextTs(), terminal: true });

    expect(events.map((e) => e.state)).toEqual(["REQUESTED", "DISPATCHED", "ACKNOWLEDGED"]);
    const ack = events[2];
    expect(ack).toMatchObject({
      commandId: "c1",
      correlationId: "K1",
      targetDeviceId: "dev-1",
      sourceKind: "automation",
      ruleId: "rA",
      executionId: "X1",
      fromState: "DISPATCHED",
      state: "ACKNOWLEDGED",
      terminal: true,
      success: true,
    });
  });

  it("a subscriber error never breaks the write", () => {
    const s = new CommandHistoryStore(db, () => { throw new Error("subscriber boom"); });
    expect(() => s.create(baseRecord({ commandId: "c9" }))).not.toThrow();
    expect(s.get("c9")?.lifecycleState).toBe("REQUESTED");
  });
});

describe("CommandHistoryStore — reconcileInterrupted (Req 4)", () => {
  it("marks non-terminal records FAILED/interrupted and leaves terminal ones alone", () => {
    // Interrupted: acknowledged-tier command stuck at DISPATCHED (no terminal_at).
    store.create(baseRecord({ commandId: "stuck", effectiveTier: "acknowledged" }));
    store.transition({ commandId: "stuck", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
    // Complete: dispatch-only command already finished its configured wait at DISPATCHED.
    store.create(baseRecord({ commandId: "done", effectiveTier: "dispatch" }));
    store.transition({ commandId: "done", toState: "DISPATCHED", timestamp: nextTs(), success: true, terminal: true });

    const count = store.reconcileInterrupted(nextTs());
    expect(count).toBe(1);

    const stuck = store.get("stuck");
    expect(stuck?.lifecycleState).toBe("FAILED");
    expect(stuck?.failureKind).toBe("interrupted");
    expect(stuck?.terminalAt).toBeGreaterThan(0);
    expect(stuck?.transitions.map((t) => t.toState)).toEqual(["REQUESTED", "DISPATCHED", "FAILED"]);

    const done = store.get("done");
    expect(done?.lifecycleState).toBe("DISPATCHED");
    expect(done?.success).toBe(true);
  });

  it("reconciles a REQUESTED-only interrupted command", () => {
    store.create(baseRecord({ commandId: "req", effectiveTier: "observed" }));
    expect(store.reconcileInterrupted(nextTs())).toBe(1);
    expect(store.get("req")?.lifecycleState).toBe("FAILED");
  });

  it("is idempotent across repeated startups", () => {
    store.create(baseRecord({ commandId: "stuck", effectiveTier: "observed" }));
    store.transition({ commandId: "stuck", toState: "DISPATCHED", timestamp: nextTs(), terminal: false });
    expect(store.reconcileInterrupted(nextTs())).toBe(1);
    expect(store.reconcileInterrupted(nextTs())).toBe(0);
    expect(store.reconcileInterrupted(nextTs())).toBe(0);
    // No duplicate FAILED transition from the second/third runs.
    expect(store.get("stuck")?.transitions.filter((t) => t.toState === "FAILED")).toHaveLength(1);
  });
});
