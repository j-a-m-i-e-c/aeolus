// src/core/housekeeping.ts — storage retention for history that grows on its own.
//
// Aeolus is meant to run unattended on a Pi for months, often with the showcase left
// running. Everything that is appended to over time must therefore have a ceiling
// that holds without anyone remembering to clean up:
//
//   execution_history   7 days, and at most 100,000 rows (~27–47 MB)
//   command history     30 days, and at most 50,000 completed commands (~65 MB),
//                       both configurable; see config.ts
//   Data Store          per-collection retention plus its own record/size caps,
//                       enforced on every write (data-store.ts)
//   device_history      STATE_HISTORY_MAX entries per device (state-history.ts)
//
// Retention runs once at startup and then every few hours. Running only on a long
// interval was a real gap: execution history used to be pruned first 24 hours after
// boot, so a backend restarted more often than daily (every `make deploy` restarts
// it) never pruned at all.
//
// Deleted rows free pages that SQLite reuses; the database file stays at its largest
// size rather than shrinking, which is what makes these ceilings, not the file size,
// the bound that matters.

import type { Database as DatabaseType } from "better-sqlite3";
import type { ExecutionLog } from "../automations/execution-log.js";
import { pruneCommandHistory, type CommandHistoryRetention } from "../automations/command-history-store.js";

export const EXECUTION_HISTORY_MAX_AGE_DAYS = 7;
export const EXECUTION_HISTORY_MAX_ROWS = 100_000;
export const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface HousekeepingLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface HousekeepingOptions {
  db: DatabaseType;
  executionLog: ExecutionLog;
  commandHistory: CommandHistoryRetention;
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
    try {
      result.executionRows = options.executionLog.enforceRetention(EXECUTION_HISTORY_MAX_AGE_DAYS, EXECUTION_HISTORY_MAX_ROWS);
    } catch (err) {
      options.logger.error({ error: (err as Error).message }, "Execution history retention failed");
    }
    try {
      result.commands = pruneCommandHistory(options.db, options.commandHistory, now());
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
        { deletedExecutionRows: result.executionRows, deletedCommands: result.commands },
        "Housekeeping removed history past its retention limits",
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
