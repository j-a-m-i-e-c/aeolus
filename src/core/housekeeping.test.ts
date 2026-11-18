// src/core/housekeeping.test.ts — history that grows on its own must have a ceiling.
//
// The case this exists for: the showcase left running on a Pi. Its simulated bunker
// power model publishes every two seconds, so automations triggered by it add tens of
// thousands of execution rows a day, and every verified simulated command adds a
// record and its transitions. Before this, command history was never pruned and
// execution history was pruned first 24 hours after boot, so a backend restarted more
// often than daily never pruned at all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { ExecutionLog, type ExecutionLogEntry } from "../automations/execution-log.js";
import { CommandHistoryStore, pruneCommandHistory, type CommandRecord } from "../automations/command-history-store.js";
import {
  EXECUTION_HISTORY_MAX_AGE_DAYS,
  EXECUTION_HISTORY_MAX_ROWS,
  HOUSEKEEPING_INTERVAL_MS,
  createHousekeeping,
} from "./housekeeping.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
let db: DatabaseType;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
});
afterEach(() => db.close());

function entry(id: string, timestamp: number): ExecutionLogEntry {
  return { id, ruleId: "rule", ruleName: "Power & Supplies", ruleType: "script", triggerTopic: "sensor/bunker/power/state", actions: [], duration: 3, timestamp, success: true };
}

function command(store: CommandHistoryStore, id: string, at: number, complete = true): void {
  const record: CommandRecord = { commandId: id, sourceKind: "automation", targetDeviceId: "switch/bunker/generator", actionType: "device_action", effectiveTier: "observed", lifecycleState: "REQUESTED", requestedAt: at };
  store.create(record);
  store.transition({ commandId: id, toState: "DISPATCHED", timestamp: at + 1, terminal: false });
  if (complete) store.transition({ commandId: id, toState: "OBSERVED", timestamp: at + 2, success: true, terminal: true });
}

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const logger = () => ({ info: vi.fn(), error: vi.fn() });

describe("execution history retention", () => {
  it("deletes rows past the age limit and beyond the row ceiling, newest kept", () => {
    const log = new ExecutionLog(10, db);
    const now = Date.now();
    log.push(entry("old", now - 8 * DAY));
    for (let i = 0; i < 5; i++) log.push(entry(`r${i}`, now - i * 1000));

    expect(log.enforceRetention(7, 3)).toBe(3);
    const kept = (db.prepare("SELECT id FROM execution_history ORDER BY timestamp DESC").all() as Array<{ id: string }>).map((r) => r.id);
    expect(kept).toEqual(["r0", "r1", "r2"]);
  });

  it("leaves rows alone when no row ceiling is given", () => {
    const log = new ExecutionLog(10, db);
    for (let i = 0; i < 5; i++) log.push(entry(`r${i}`, Date.now() - i));
    expect(log.enforceRetention(7)).toBe(0);
    expect(count("execution_history")).toBe(5);
  });
});

describe("command history retention", () => {
  it("deletes completed commands past the age limit, with their transitions", () => {
    const store = new CommandHistoryStore(db);
    command(store, "old", NOW - 31 * DAY);
    command(store, "recent", NOW - DAY);

    expect(pruneCommandHistory(db, { maxAgeDays: 30, maxRecords: 0 }, NOW)).toBe(1);
    expect(store.get("old")).toBeUndefined();
    expect(store.get("recent")).toBeDefined();
    expect((db.prepare("SELECT COUNT(*) AS n FROM command_transitions WHERE command_id = 'old'").get() as { n: number }).n).toBe(0);
  });

  it("keeps only the newest completed commands beyond the ceiling", () => {
    const store = new CommandHistoryStore(db);
    for (let i = 0; i < 5; i++) command(store, `c${i}`, NOW - (5 - i) * 1000);
    expect(pruneCommandHistory(db, { maxAgeDays: 0, maxRecords: 2 }, NOW)).toBe(3);
    expect((db.prepare("SELECT command_id FROM command_records ORDER BY requested_at").all() as Array<{ command_id: string }>).map((r) => r.command_id)).toEqual(["c3", "c4"]);
  });

  it("never deletes a command still waiting for its evidence, however old", () => {
    const store = new CommandHistoryStore(db);
    command(store, "waiting", NOW - 90 * DAY, false);
    command(store, "done", NOW - 90 * DAY);

    expect(pruneCommandHistory(db, { maxAgeDays: 30, maxRecords: 1 }, NOW)).toBe(1);
    expect(store.get("waiting")?.lifecycleState).toBe("DISPATCHED");
    // A late confirmation can still be recorded against it.
    store.transition({ commandId: "waiting", toState: "OBSERVED", timestamp: NOW, success: true, terminal: true });
    expect(store.get("waiting")?.lifecycleState).toBe("OBSERVED");
  });

  it("keeps everything when both bounds are off", () => {
    const store = new CommandHistoryStore(db);
    command(store, "ancient", NOW - 400 * DAY);
    expect(pruneCommandHistory(db, { maxAgeDays: 0, maxRecords: 0 }, NOW)).toBe(0);
    expect(count("command_records")).toBe(1);
  });

  it("deletes transitions even when the connection has foreign keys off", () => {
    db.pragma("foreign_keys = OFF");
    const store = new CommandHistoryStore(db);
    command(store, "old", NOW - 31 * DAY);
    pruneCommandHistory(db, { maxAgeDays: 30, maxRecords: 0 }, NOW);
    expect(count("command_transitions")).toBe(0);
  });
});

describe("housekeeping", () => {
  afterEach(() => vi.useRealTimers());

  it("prunes at startup, not only after the first interval", () => {
    // The original gap: a backend restarted more often than the interval never pruned.
    const log = new ExecutionLog(10, db);
    const store = new CommandHistoryStore(db);
    log.push(entry("stale", Date.now() - (EXECUTION_HISTORY_MAX_AGE_DAYS + 1) * DAY));
    command(store, "stale", NOW - 31 * DAY);

    const keeper = createHousekeeping({ db, executionLog: log, commandHistory: { maxAgeDays: 30, maxRecords: 0 }, logger: logger(), now: () => NOW });
    keeper.start();
    keeper.stop();

    expect(count("execution_history")).toBe(0);
    expect(count("command_records")).toBe(0);
  });

  it("repeats on its interval and stops cleanly", () => {
    vi.useFakeTimers();
    const executionLog = { enforceRetention: vi.fn(() => 0) } as unknown as ExecutionLog;
    const keeper = createHousekeeping({ db, executionLog, commandHistory: { maxAgeDays: 30, maxRecords: 0 }, logger: logger() });
    keeper.start();
    vi.advanceTimersByTime(HOUSEKEEPING_INTERVAL_MS * 2);
    keeper.stop();
    vi.advanceTimersByTime(HOUSEKEEPING_INTERVAL_MS * 2);
    expect(executionLog.enforceRetention).toHaveBeenCalledTimes(3);
    expect(executionLog.enforceRetention).toHaveBeenCalledWith(EXECUTION_HISTORY_MAX_AGE_DAYS, EXECUTION_HISTORY_MAX_ROWS);
  });

  it("runs Data Store retention only while the store is enabled, including one enabled at runtime", () => {
    const dataStore = { enabled: false, isEnabled() { return this.enabled; }, enforceRetention: vi.fn() };
    const keeper = createHousekeeping({ db, executionLog: new ExecutionLog(10, db), commandHistory: { maxAgeDays: 30, maxRecords: 0 }, dataStore, logger: logger() });
    keeper.runOnce();
    expect(dataStore.enforceRetention).not.toHaveBeenCalled();
    dataStore.enabled = true;
    keeper.runOnce();
    expect(dataStore.enforceRetention).toHaveBeenCalledTimes(1);
  });

  it("keeps going when one retention rule fails, and logs it", () => {
    const log = logger();
    const executionLog = { enforceRetention: vi.fn(() => { throw new Error("disk I/O error"); }) } as unknown as ExecutionLog;
    const store = new CommandHistoryStore(db);
    command(store, "stale", NOW - 31 * DAY);
    const keeper = createHousekeeping({ db, executionLog, commandHistory: { maxAgeDays: 30, maxRecords: 0 }, logger: log, now: () => NOW });

    expect(keeper.runOnce()).toEqual({ executionRows: 0, commands: 1 });
    expect(log.error).toHaveBeenCalledWith({ error: "disk I/O error" }, "Execution history retention failed");
    expect(log.info).toHaveBeenCalled();
  });

  it("keeps the documented ceilings inside a few tens of megabytes", () => {
    // Measured at ~270–465 bytes per execution row including indexes; this guards the
    // order of magnitude, so a change to the ceiling is a deliberate one.
    expect(EXECUTION_HISTORY_MAX_ROWS * 465).toBeLessThan(50 * 1024 * 1024);
  });
});
