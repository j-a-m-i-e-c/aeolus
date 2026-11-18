// src/core/retention-settings.test.ts — the admin's chosen history retention periods.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { DEFAULT_RETENTION_DAYS, createRetentionSettings } from "./retention-settings.js";

let db: DatabaseType;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, migrations);
});
afterEach(() => db.close());

const stored = (key: string) =>
  (db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;

describe("retention settings", () => {
  it("defaults both histories to seven days", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(7);
    expect(createRetentionSettings(db).get()).toEqual({ executionHistoryDays: 7, commandHistoryDays: 7 });
  });

  it("stores a period and returns the updated settings", () => {
    const settings = createRetentionSettings(db);
    expect(settings.set({ commandHistoryDays: 365 })).toEqual({ executionHistoryDays: 7, commandHistoryDays: 365 });
    // A fresh reader sees it: the value lives in the database, not in memory.
    expect(createRetentionSettings(db).get().commandHistoryDays).toBe(365);
  });

  it("stores null as keep forever", () => {
    const settings = createRetentionSettings(db);
    settings.set({ executionHistoryDays: null, commandHistoryDays: 30 });
    expect(settings.get()).toEqual({ executionHistoryDays: null, commandHistoryDays: 30 });
    expect(stored("retention.execution_history_days")).toBe("forever");
  });

  it("changes only the fields given", () => {
    const settings = createRetentionSettings(db);
    settings.set({ executionHistoryDays: 14, commandHistoryDays: 90 });
    settings.set({ executionHistoryDays: undefined, commandHistoryDays: 60 });
    expect(settings.get()).toEqual({ executionHistoryDays: 14, commandHistoryDays: 60 });
  });

  it.each(["", "abc", "0", "-3", "1.5", "99999"])("falls back to the default for an unreadable stored value %j", (value) => {
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('retention.command_history_days', ?)").run(value);
    expect(createRetentionSettings(db).get().commandHistoryDays).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("reads and writes only its own keys", () => {
    db.prepare("INSERT INTO system_settings (key, value) VALUES ('jwt_secret', 'secret')").run();
    createRetentionSettings(db).set({ executionHistoryDays: 30, commandHistoryDays: null });
    const keys = (db.prepare("SELECT key FROM system_settings ORDER BY key").all() as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(["jwt_secret", "retention.command_history_days", "retention.execution_history_days"]);
    expect(stored("jwt_secret")).toBe("secret");
  });
});
