/**
 * Duration parser and formatter — pure functions with no dependencies.
 *
 * Supported units:
 *   m = minutes, h = hours, d = days, w = weeks, y = years
 */

/** Supported units with their millisecond multipliers */
export const UNITS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
};

/** Valid duration pattern: positive integer followed by a supported unit suffix */
const DURATION_REGEX = /^(\d+)([a-z]+)$/;

/**
 * Parse a duration string like "7d", "24h", "30m" into milliseconds.
 *
 * @param input - Duration string (e.g. "7d", "24h", "30m", "1y")
 * @returns Milliseconds represented by the duration
 * @throws Error if input is empty, contains decimals, has unknown suffix, or is negative
 */
export function parseDuration(input: string): number {
  if (!input || input.trim() === "") {
    throw new Error(`Invalid duration: input must not be empty`);
  }

  const trimmed = input.trim();

  // Reject negative values
  if (trimmed.startsWith("-")) {
    throw new Error(
      `Invalid duration "${trimmed}": negative durations are not supported`,
    );
  }

  // Reject decimals
  if (trimmed.includes(".")) {
    throw new Error(
      `Invalid duration "${trimmed}": decimal values are not supported, use integers only`,
    );
  }

  const match = trimmed.match(DURATION_REGEX);
  if (!match) {
    throw new Error(
      `Invalid duration "${trimmed}": expected format is a positive integer followed by a unit suffix (${Object.keys(UNITS).join(", ")})`,
    );
  }

  const [, numStr, unit] = match;
  const multiplier = UNITS[unit];

  if (multiplier === undefined) {
    throw new Error(
      `Invalid duration "${trimmed}": unknown unit "${unit}". Supported units: ${Object.keys(UNITS).join(", ")}`,
    );
  }

  const value = parseInt(numStr, 10);

  if (value <= 0) {
    throw new Error(
      `Invalid duration "${trimmed}": value must be a positive integer`,
    );
  }

  return value * multiplier;
}

/**
 * Format milliseconds back into the shortest valid duration string
 * using the largest fitting unit.
 *
 * @param ms - Milliseconds to format
 * @returns Shortest valid duration string (e.g. "7d", "2w", "1y")
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) {
    throw new Error(
      `Invalid milliseconds: value must be positive, got ${ms}`,
    );
  }

  // Try units from largest to smallest for the shortest representation
  const unitOrder: Array<[string, number]> = [
    ["y", UNITS.y],
    ["w", UNITS.w],
    ["d", UNITS.d],
    ["h", UNITS.h],
    ["m", UNITS.m],
  ];

  for (const [suffix, multiplier] of unitOrder) {
    if (ms % multiplier === 0) {
      return `${ms / multiplier}${suffix}`;
    }
  }

  // Fallback: express in minutes (should not happen for valid parseDuration outputs)
  throw new Error(
    `Cannot format ${ms}ms as a valid duration: not evenly divisible by any supported unit`,
  );
}
