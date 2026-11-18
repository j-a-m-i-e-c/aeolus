import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { DEFAULT_RETENTION_DAYS, createRetentionSettings } from "./retention-settings.js";
let db: DatabaseType;
beforeEach(() => { db = new Database(":memory:"); runMigrations(db, migrations); });
afterEach(() => db.close());
const stored = (key: string) => (db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
describe("execution log retention settings", () => {
  it("defaults to seven days without storing any command retention policy", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(7);
    expect(createRetentionSettings(db).get()).toEqual({ executionHistoryDays: 7 });
    expect(stored("retention.command_history_days")).toBeUndefined();
  });
  it("sets a finite or unlimited execution period and persists it", () => {
    const settings = createRetentionSettings(db);
    expect(settings.set({ executionHistoryDays: 30 })).toEqual({ executionHistoryDays: 30 });
    expect(stored("retention.execution_history_days")).toBe("30");
    expect(settings.set({ executionHistoryDays: null })).toEqual({ executionHistoryDays: null });
    expect(stored("retention.execution_history_days")).toBe("forever");
  });
  it.each(["", "abc", "0", "-3", "1.5", "99999"])("uses the safe execution default for invalid value %j", (value) => {
    db.prepare("INSERT INTO system_settings (key,value) VALUES (?,?)").run("retention.execution_history_days", value);
    expect(createRetentionSettings(db).get()).toEqual({ executionHistoryDays: 7 });
  });
  it("does not touch unrelated keys, including an old command policy", () => {
    db.prepare("INSERT INTO system_settings(key,value) VALUES (?,?)").run("retention.command_history_days", "7");
    createRetentionSettings(db).set({ executionHistoryDays: 14 });
    expect(stored("retention.command_history_days")).toBe("7");
  });
});
