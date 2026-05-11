// src/automations/cron-utils.ts — Shared cron expression utilities

import cron from "node-cron";

export interface CronPreset {
  label: string;
  expression: string;
}

/** Predefined cron schedule presets for the trigger selector */
export const CRON_PRESETS: CronPreset[] = [
  { label: "Every 1 minute", expression: "* * * * *" },
  { label: "Every 5 minutes", expression: "*/5 * * * *" },
  { label: "Every 15 minutes", expression: "*/15 * * * *" },
  { label: "Every 30 minutes", expression: "*/30 * * * *" },
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Every 12 hours", expression: "0 */12 * * *" },
  { label: "Daily at midnight", expression: "0 0 * * *" },
];

/** Validate a cron expression (five-field standard syntax) */
export function isValidCron(expression: string): boolean {
  if (!expression || typeof expression !== "string") return false;
  return cron.validate(expression);
}

/** Convert a cron expression to a human-readable description */
export function describeCron(expression: string): string {
  if (!expression) return "";
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "Runs on custom schedule";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (expression === "* * * * *") return "Runs every minute";

  // Every N minutes
  if (minute.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = minute.slice(2);
    return `Runs every ${n} minute${n === "1" ? "" : "s"}`;
  }

  // Every N hours (at minute 0)
  if (minute === "0" && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = hour.slice(2);
    return `Runs every ${n} hour${n === "1" ? "" : "s"}`;
  }

  // Every hour at specific minute
  if (!minute.includes("*") && !minute.includes("/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Runs every hour at minute ${minute}`;
  }

  // Daily at specific time
  if (!minute.includes("*") && !minute.includes("/") && !hour.includes("*") && !hour.includes("/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const h = hour.padStart(2, "0");
    const m = minute.padStart(2, "0");
    return `Runs daily at ${h}:${m}`;
  }

  // Weekdays at specific time
  if (!minute.includes("*") && !hour.includes("*") && dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    const h = hour.padStart(2, "0");
    const m = minute.padStart(2, "0");
    return `Runs at ${h}:${m} on weekdays`;
  }

  // Weekends at specific time
  if (!minute.includes("*") && !hour.includes("*") && dayOfMonth === "*" && month === "*" && (dayOfWeek === "0,6" || dayOfWeek === "6,0")) {
    const h = hour.padStart(2, "0");
    const m = minute.padStart(2, "0");
    return `Runs at ${h}:${m} on weekends`;
  }

  return "Runs on custom schedule";
}
