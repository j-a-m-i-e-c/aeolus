// src/core/housekeeping.ts — apply the history retention an admin has chosen.
//
// Aeolus runs unattended for months, often with the showcase left on, so history that
// grows by itself is pruned on a schedule:
//
//   execution history   retention-settings.ts, default 7 days, editable on the System page
//   command history     retention-settings.ts, default 7 days, editable on the System page;
//                       only completed commands are ever removed
//   Data Store          per-collection retention plus its own record/size caps (data-store.ts)
//   device_history      STATE_HISTORY_MAX entries per device (state-history.ts)
//
// Either history can be set to "keep forever", which is the admin's decision to make:
// it then grows without limit.
//
// Retention runs at startup, every six hours, and immediately after the setting is
// changed. Running only on a long interval was a real gap: execution history used to be
// pruned first 24 hours after boot, so a backend restarted more often than daily (every
// `make deploy` restarts it) never pruned at all.
//
// Deleted rows free pages that SQLite reuses; the database file stays at its largest
// size rather than shrinking.

import type { Database as DatabaseType } from "better-sqlite3";
import type { ExecutionLog } from "../automations/execution-log.js";
import { pruneCommandHistory } from "../automations/command-history-store.js";
import type { RetentionSettings } from "./retention-settings.js";

export const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface HousekeepingLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface HousekeepingOptions {
  db: DatabaseType;
  executionLog: ExecutionLog;
  /** Read on every run, so a change on the System page applies without a restart. */
  retention: () => RetentionSettings;
  /** Data Store retention, when the store is enabled. */
  dataStore?: { isEnabled(): boolean; enforceRetention(): void };
  logger: HousekeepingLogger;
  now?: () => number;
}

export interface HousekeepingResult {
  executionRows: number;
  commands: number;
}

export function createHousekeeping(options: HousekeepingOptions) {
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Run every retention rule once. Each is isolated, so one failing cannot skip the rest. */
  function runOnce(): HousekeepingResult {
    const result: HousekeepingResult = { executionRows: 0, commands: 0 };
    let retention: RetentionSettings;
    try {
      retention = options.retention();
    } catch (err) {
      // Without a readable setting, delete nothing rather than guess.
      options.logger.error({ error: (err as Error).message }, "History retention setting unreadable; nothing pruned");
      return result;
    }
    try {
      if (retention.executionHistoryDays !== null) {
        result.executionRows = options.executionLog.enforceRetention(retention.executionHistoryDays);
      }
    } catch (err) {
      options.logger.error({ error: (err as Error).message }, "Execution history retention failed");
    }
    try {
      if (retention.commandHistoryDays !== null) {
        result.commands = pruneCommandHistory(options.db, retention.commandHistoryDays, now());
      }
    } catch (err) {
      options.logger.error({ error: (err as Error).message }, "Command history retention failed");
    }
    try {
      if (options.dataStore?.isEnabled()) options.dataStore.enforceRetention();
    } catch (err) {
      options.logger.error({ error: (err as Error).message }, "Data Store retention failed");
    }
    if (result.executionRows > 0 || result.commands > 0) {
      options.logger.info(
        { deletedExecutionRows: result.executionRows, deletedCommands: result.commands, retention },
        "Housekeeping removed history older than its retention period",
      );
    }
    return result;
  }

  return {
    runOnce,
    /** Run now, then every {@link HOUSEKEEPING_INTERVAL_MS}. The timer never holds the process open. */
    start(): void {
      runOnce();
      if (timer) return;
      timer = setInterval(runOnce, HOUSEKEEPING_INTERVAL_MS);
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type Housekeeping = ReturnType<typeof createHousekeeping>;
