// Execution history is a high-volume diagnostic log. Command evidence is NOT
// subject to automatic retention housekeeping; it is retained indefinitely.
import type { Database as DatabaseType } from "better-sqlite3";

export const DEFAULT_RETENTION_DAYS = 7;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
const KEY = "retention.execution_history_days";
const FOREVER = "forever";

export interface RetentionSettings {
  executionHistoryDays: number | null;
}

function parse(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_RETENTION_DAYS;
  if (raw === FOREVER) return null;
  const days = Number(raw);
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS
    ? days : DEFAULT_RETENTION_DAYS;
}

export function createRetentionSettings(db: DatabaseType) {
  const read = db.prepare("SELECT value FROM system_settings WHERE key = ?");
  const write = db.prepare(
    "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  return {
    get(): RetentionSettings {
      return { executionHistoryDays: parse((read.get(KEY) as { value: string } | undefined)?.value) };
    },
    set(update: Partial<RetentionSettings>): RetentionSettings {
      if (update.executionHistoryDays !== undefined) {
        write.run(KEY, update.executionHistoryDays === null ? FOREVER : String(update.executionHistoryDays));
      }
      return this.get();
    },
  };
}

export type RetentionSettingsStore = ReturnType<typeof createRetentionSettings>;
