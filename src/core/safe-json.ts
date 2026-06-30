// src/core/safe-json.ts — shared JSON.parse-or-skip helper for persisted columns

import logger from "../logger.js";

/**
 * Parse a JSON string read from persistence, returning `undefined` when the
 * value is malformed. On failure a warning is logged with the supplied
 * context so the offending row stays traceable.
 *
 * Persisted JSON can be corrupted by manual edits, partial writes, or schema
 * drift. Callers decide what a bad value means: skip the row (check
 * `=== undefined`) or substitute a default (`?? fallback`). `JSON.parse` never
 * yields `undefined`, so it is an unambiguous sentinel even for stored `null`,
 * `0`, `false`, or `""` values.
 */
export function safeJsonParse<T = unknown>(
  raw: string,
  context: Record<string, unknown>,
  message = "Malformed JSON in persisted column, skipping",
): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.warn({ ...context, raw }, message);
    return undefined;
  }
}
