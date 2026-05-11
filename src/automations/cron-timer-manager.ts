// src/automations/cron-timer-manager.ts — Per-rule cron timer management

import cron from "node-cron";
import { isValidCron } from "./cron-utils.js";
import logger from "../logger.js";

export class CronTimerManager {
  private timers = new Map<string, cron.ScheduledTask>();

  /** Start a cron timer for a rule. Returns false if expression is invalid. */
  start(ruleId: string, expression: string, onFire: () => void): boolean {
    if (!isValidCron(expression)) {
      logger.warn({ ruleId, expression }, "Invalid cron expression — skipping timer");
      return false;
    }
    this.stop(ruleId); // Stop existing timer if any
    const task = cron.schedule(expression, onFire);
    this.timers.set(ruleId, task);
    return true;
  }

  /** Stop and remove a timer for a rule. No-op if no timer exists. */
  stop(ruleId: string): void {
    const task = this.timers.get(ruleId);
    if (task) {
      task.stop();
      this.timers.delete(ruleId);
    }
  }

  /** Check if a rule has an active timer */
  has(ruleId: string): boolean {
    return this.timers.has(ruleId);
  }

  /** Stop all timers (used on engine shutdown) */
  stopAll(): void {
    for (const task of this.timers.values()) {
      task.stop();
    }
    this.timers.clear();
  }

  /** Get count of active timers */
  get size(): number {
    return this.timers.size;
  }
}
