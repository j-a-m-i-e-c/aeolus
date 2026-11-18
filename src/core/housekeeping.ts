// src/core/housekeeping.ts — scheduled retention for execution history and the Data Store.
//
// Command evidence is durable audit data and is NEVER pruned here.
//
// Runs at startup, every six hours, and right after an admin changes the setting.
// The startup run matters: execution history used to be pruned first 24 hours after
// boot, so a backend restarted more often than daily (every `make deploy` restarts it)
// never pruned at all.
import type { ExecutionLog } from "../automations/execution-log.js";
import type { RetentionSettings } from "./retention-settings.js";

export const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;
interface HousekeepingLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}
export interface HousekeepingOptions {
  executionLog: ExecutionLog;
  retention: () => RetentionSettings;
  dataStore?: { isEnabled(): boolean; enforceRetention(): void };
  logger: HousekeepingLogger;
}
export interface HousekeepingResult { executionRows: number }

export function createHousekeeping(options: HousekeepingOptions) {
  let timer: ReturnType<typeof setInterval> | null = null;
  function runOnce(): HousekeepingResult {
    const result: HousekeepingResult = { executionRows: 0 };
    let retention: RetentionSettings;
    try {
      retention = options.retention();
    } catch (err) {
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
      if (options.dataStore?.isEnabled()) options.dataStore.enforceRetention();
    } catch (err) {
      options.logger.error({ error: (err as Error).message }, "Data Store retention failed");
    }
    if (result.executionRows > 0) {
      options.logger.info({ deletedExecutionRows: result.executionRows, retention }, "Housekeeping removed expired execution history");
    }
    return result;
  }
  return {
    runOnce,
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
