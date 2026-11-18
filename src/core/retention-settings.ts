// src/core/retention-settings.ts — how long Aeolus keeps history, as chosen by an admin.
//
// Two independent settings, edited on the System page:
//
//   executionHistoryDays   "an automation ran": one row per run, high volume
//   commandHistoryDays     "a device was told to do something", with its evidence
//                          timeline: the audit trail for physical actions
//
// Each is a whole number of days, or null for "keep forever". Both default to 7.
// Critical installations that must keep a longer audit trail raise it; nothing else
// silently caps it, so the period chosen is the period kept.
//
// Stored in `system_settings` under explicit keys. That table also holds secrets (the
// JWT secret, MQTT passwords), so this module only ever reads and writes its own keys.

import type { Database as DatabaseType } from "better-sqlite3";

export const DEFAULT_RETENTION_DAYS = 7;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

const KEYS = {
  executionHistoryDays: "retention.execution_history_days",
  commandHistoryDays: "retention.command_history_days",
} as const;
const FOREVER = "forever";

export interface RetentionSettings {
  /** Days of execution history kept, or null to keep it forever. */
  executionHistoryDays: number | null;
  /** Days of completed command history kept, or null to keep it forever. */
  commandHistoryDays: number | null;
}

/** A stored value, or the default when absent or unreadable. */
function parse(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_RETENTION_DAYS;
  if (raw === FOREVER) return null;
  const days = Number(raw);
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS
    ? days
    : DEFAULT_RETENTION_DAYS;
}

export function createRetentionSettings(db: DatabaseType) {
  const read = db.prepare("SELECT value FROM system_settings WHERE key = ?");
  const write = db.prepare(
    "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const value = (key: string) => (read.get(key) as { value: string } | undefined)?.value;

  return {
    get(): RetentionSettings {
      return {
        executionHistoryDays: parse(value(KEYS.executionHistoryDays)),
        commandHistoryDays: parse(value(KEYS.commandHistoryDays)),
      };
    },
    /** Update either or both. Values must already be validated (see the route schema). */
    set(update: Partial<RetentionSettings>): RetentionSettings {
      db.transaction(() => {
        for (const field of ["executionHistoryDays", "commandHistoryDays"] as const) {
          const days = update[field];
          if (days === undefined) continue;
          write.run(KEYS[field], days === null ? FOREVER : String(days));
        }
      })();
      return this.get();
    },
  };
}

export type RetentionSettingsStore = ReturnType<typeof createRetentionSettings>;
