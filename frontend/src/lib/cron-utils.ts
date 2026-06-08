// frontend/src/lib/cron-utils.ts — Client-side cron expression utilities

export interface CronPreset {
  label: string;
  expression: string;
}

/** Special value for the custom picker option in the dropdown */
export const CUSTOM_PICKER_OPTION = "__picker__";

/** Special value for the raw cron input option in the dropdown */
export const CUSTOM_CRON_OPTION = "custom";

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

/**
 * Validate a cron expression (five-field standard syntax).
 * Uses regex-based validation on the frontend to avoid importing node-cron.
 */
export function isValidCron(expression: string): boolean {
  if (!expression || typeof expression !== "string") return false;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  // Each field can be: *, */N, N, N-N, N,N, or combinations with /N step
  const _fieldPattern = /^(\*|\d{1,2}(-\d{1,2})?(,(\d{1,2}(-\d{1,2})?))*)(\/(\ d{1,2}))?$/;

  // More permissive pattern that handles all valid cron field formats
  const validField = (field: string): boolean => {
    // Simple patterns
    if (field === "*") return true;
    if (/^\*\/\d{1,2}$/.test(field)) return true; // */N
    if (/^\d{1,2}$/.test(field)) return true; // N
    if (/^\d{1,2}-\d{1,2}$/.test(field)) return true; // N-N
    if (/^\d{1,2}-\d{1,2}\/\d{1,2}$/.test(field)) return true; // N-N/N
    // Comma-separated values (each can be N or N-N)
    if (/^(\d{1,2}(-\d{1,2})?)(,\d{1,2}(-\d{1,2})?)*$/.test(field)) return true;
    return false;
  };

  for (const part of parts) {
    if (!validField(part)) return false;
  }

  // Basic range validation
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const getBaseNumber = (field: string): number[] => {
    const nums: number[] = [];
    // Extract all numbers from the field
    const matches = field.match(/\d+/g);
    if (matches) {
      for (const m of matches) nums.push(Number(m));
    }
    return nums;
  };

  const minuteNums = getBaseNumber(minute);
  const hourNums = getBaseNumber(hour);
  const domNums = getBaseNumber(dayOfMonth);
  const monthNums = getBaseNumber(month);
  const dowNums = getBaseNumber(dayOfWeek);

  if (minuteNums.some(n => n > 59)) return false;
  if (hourNums.some(n => n > 23)) return false;
  if (domNums.some(n => n > 31)) return false;
  if (monthNums.some(n => n > 12)) return false;
  if (dowNums.some(n => n > 7)) return false;

  return true;
}

/** Convert a cron expression to a human-readable description */
export function describeCron(expression: string): string {
  if (!expression) return "";
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "Runs on custom schedule";

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (expression.trim() === "* * * * *") return "Runs every minute";

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
  if (!minute.includes("*") && !hour.includes("*") && dayOfMonth === "*" && month === "*" && dayOfWeek === "0,6") {
    const h = hour.padStart(2, "0");
    const m = minute.padStart(2, "0");
    return `Runs at ${h}:${m} on weekends`;
  }

  // Specific days at specific time
  if (!minute.includes("*") && !hour.includes("*") && dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const h = hour.padStart(2, "0");
    const m = minute.padStart(2, "0");
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = dayOfWeek.split(",").map((d) => dayNames[Number(d)] || d).join(", ");
    return `Runs at ${h}:${m} on ${days}`;
  }

  return "Runs on custom schedule";
}
