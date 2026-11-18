// src/core/housekeeping.test.ts — history is kept for the period an admin chose, no less
// and no more.
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
import { HOUSEKEEPING_INTERVAL_MS, createHousekeeping } from "./housekeeping.js";
import type { RetentionSettings } from "./retention-settings.js";

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
const sevenDays = (): RetentionSettings => ({ executionHistoryDays: 7, commandHistoryDays: 7 });

describe("execution history retention", () => {
  it("deletes rows older than the period and keeps every newer one, however many", () => {
    const log = new ExecutionLog(10, db);
    const now = Date.now();
    log.push(entry("old", now - 8 * DAY));
    for (let i = 0; i < 50; i++) log.push(entry(`r${i}`, now - i * 1000));

    expect(log.enforceRetention(7)).toBe(1);
    expect(count("execution_history")).toBe(50);
  });
});

describe("command history retention", () => {
  it("deletes completed commands older than the period, with their transitions", () => {
    const store = new CommandHistoryStore(db);
    command(store, "old", NOW - 8 * DAY);
    command(store, "recent", NOW - DAY);

    expect(pruneCommandHistory(db, 7, NOW)).toBe(1);
    expect(store.get("old")).toBeUndefined();
    expect(store.get("recent")).toBeDefined();
    expect((db.prepare("SELECT COUNT(*) AS n FROM command_transitions WHERE command_id = 'old'").get() as { n: number }).n).toBe(0);
  });

  it("never deletes a command still waiting for its evidence, however old", () => {
    const store = new CommandHistoryStore(db);
    command(store, "waiting", NOW - 90 * DAY, false);
    command(store, "done", NOW - 90 * DAY);

    expect(pruneCommandHistory(db, 7, NOW)).toBe(1);
    expect(store.get("waiting")?.lifecycleState).toBe("DISPATCHED");
    // A late confirmation can still be recorded against it.
    store.transition({ commandId: "waiting", toState: "OBSERVED", timestamp: NOW, success: true, terminal: true });
    expect(store.get("waiting")?.lifecycleState).toBe("OBSERVED");
  });

  it("deletes transitions even when the connection has foreign keys off", () => {
    db.pragma("foreign_keys = OFF");
    const store = new CommandHistoryStore(db);
    command(store, "old", NOW - 8 * DAY);
    pruneCommandHistory(db, 7, NOW);
    expect(count("command_transitions")).toBe(0);
  });
});

describe("housekeeping", () => {
  afterEach(() => vi.useRealTimers());

  it("prunes at startup, not only after the first interval", () => {
    // The original gap: a backend restarted more often than the interval never pruned.
    const log = new ExecutionLog(10, db);
    const store = new CommandHistoryStore(db);
    log.push(entry("stale", Date.now() - 8 * DAY));
    command(store, "stale", NOW - 8 * DAY);

    const keeper = createHousekeeping({ db, executionLog: log, retention: sevenDays, logger: logger(), now: () => NOW });
    keeper.start();
    keeper.stop();

    expect(count("execution_history")).toBe(0);
    expect(count("command_records")).toBe(0);
  });

  it("repeats on its interval and stops cleanly", () => {
    vi.useFakeTimers();
    const executionLog = { enforceRetention: vi.fn(() => 0) } as unknown as ExecutionLog;
    const keeper = createHousekeeping({ db, executionLog, retention: sevenDays, logger: logger() });
    keeper.start();
    vi.advanceTimersByTime(HOUSEKEEPING_INTERVAL_MS * 2);
    keeper.stop();
    vi.advanceTimersByTime(HOUSEKEEPING_INTERVAL_MS * 2);
    expect(executionLog.enforceRetention).toHaveBeenCalledTimes(3);
    expect(executionLog.enforceRetention).toHaveBeenCalledWith(7);
  });

  it("reads the setting on every run, so a change applies without a restart", () => {
    const executionLog = { enforceRetention: vi.fn(() => 0) } as unknown as ExecutionLog;
    let settings: RetentionSettings = { executionHistoryDays: 7, commandHistoryDays: 7 };
    const keeper = createHousekeeping({ db, executionLog, retention: () => settings, logger: logger() });
    keeper.runOnce();
    settings = { executionHistoryDays: 90, commandHistoryDays: 7 };
    keeper.runOnce();
    expect(executionLog.enforceRetention).toHaveBeenNthCalledWith(1, 7);
    expect(executionLog.enforceRetention).toHaveBeenNthCalledWith(2, 90);
  });

  it("keeps a history forever when its period is null", () => {
    const log = new ExecutionLog(10, db);
    const store = new CommandHistoryStore(db);
    log.push(entry("ancient", Date.now() - 400 * DAY));
    command(store, "ancient", NOW - 400 * DAY);

    const keeper = createHousekeeping({ db, executionLog: log, retention: () => ({ executionHistoryDays: null, commandHistoryDays: null }), logger: logger(), now: () => NOW });
    expect(keeper.runOnce()).toEqual({ executionRows: 0, commands: 0 });
    expect(count("execution_history")).toBe(1);
    expect(count("command_records")).toBe(1);
  });

  it("applies each history's own period", () => {
    const log = new ExecutionLog(10, db);
    const store = new CommandHistoryStore(db);
    log.push(entry("stale", Date.now() - 8 * DAY));
    command(store, "kept", NOW - 8 * DAY);

    const keeper = createHousekeeping({ db, executionLog: log, retention: () => ({ executionHistoryDays: 7, commandHistoryDays: 30 }), logger: logger(), now: () => NOW });
    expect(keeper.runOnce()).toEqual({ executionRows: 1, commands: 0 });
    expect(store.get("kept")).toBeDefined();
  });

  it("deletes nothing when the setting cannot be read", () => {
    const log = logger();
    const executionLog = { enforceRetention: vi.fn(() => 0) } as unknown as ExecutionLog;
    const dataStore = { isEnabled: () => true, enforceRetention: vi.fn() };
    const keeper = createHousekeeping({ db, executionLog, dataStore, retention: () => { throw new Error("database is locked"); }, logger: log });

    expect(keeper.runOnce()).toEqual({ executionRows: 0, commands: 0 });
    expect(executionLog.enforceRetention).not.toHaveBeenCalled();
    expect(dataStore.enforceRetention).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ error: "database is locked" }, "History retention setting unreadable; nothing pruned");
  });

  it("runs Data Store retention only while the store is enabled, including one enabled at runtime", () => {
    const dataStore = { enabled: false, isEnabled() { return this.enabled; }, enforceRetention: vi.fn() };
    const keeper = createHousekeeping({ db, executionLog: new ExecutionLog(10, db), retention: sevenDays, dataStore, logger: logger() });
    keeper.runOnce();
    expect(dataStore.enforceRetention).not.toHaveBeenCalled();
    dataStore.enabled = true;
    keeper.runOnce();
    expect(dataStore.enforceRetention).toHaveBeenCalledTimes(1);
  });

  it("keeps going when one retention rule fails, and logs it", () => {
    const log = logger();
    const executionLog = { enforceRetention: vi.fn(() => { throw new Error("disk I/O error"); }) } as unknown as ExecutionLog;
    const dataStore = { isEnabled: () => true, enforceRetention: vi.fn(() => { throw new Error("store failed"); }) };
    const store = new CommandHistoryStore(db);
    command(store, "stale", NOW - 8 * DAY);
    const keeper = createHousekeeping({ db, executionLog, dataStore, retention: sevenDays, logger: log, now: () => NOW });

    expect(keeper.runOnce()).toEqual({ executionRows: 0, commands: 1 });
    expect(log.error).toHaveBeenCalledWith({ error: "disk I/O error" }, "Execution history retention failed");
    expect(log.error).toHaveBeenCalledWith({ error: "store failed" }, "Data Store retention failed");
    expect(log.info).toHaveBeenCalled();
  });

  it("logs a command-history failure without skipping the rest", () => {
    const log = logger();
    const executionLog = { enforceRetention: vi.fn(() => 2) } as unknown as ExecutionLog;
    db.close();
    db = new Database(":memory:"); // no tables: the command prune throws
    const keeper = createHousekeeping({ db, executionLog, retention: sevenDays, logger: log });

    expect(keeper.runOnce()).toEqual({ executionRows: 2, commands: 0 });
    expect(log.error).toHaveBeenCalledWith(expect.anything(), "Command history retention failed");
  });
});
