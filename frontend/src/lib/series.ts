// frontend/src/lib/series.ts — shared numeric-series detection for charts

/**
 * Keys that carry a sample's own time coordinate rather than a measurement.
 *
 * A record already has its own `timestamp` column, so a payload that repeats the
 * time as a field would otherwise be charted as a series of epoch milliseconds —
 * flattening every real measurement against a y-axis in the trillions. This set
 * is deliberately small and explicit rather than a pattern match, so a field
 * legitimately named e.g. `uptime` is still charted.
 */
const TIME_FIELD_NAMES: ReadonlySet<string> = new Set([
  "timestamp",
  "ts",
  "time",
  "datetime",
  "recordedat",
  "observedat",
]);

/** Samples inspected while discovering fields, so detection stays O(1) in collection size. */
export const DEFAULT_FIELD_SAMPLE_LIMIT = 25;

/** True when `key` names a sample's time coordinate rather than a measurement series. */
export function isTimeField(key: string): boolean {
  return TIME_FIELD_NAMES.has(key.toLowerCase());
}

/**
 * Detect the numeric measurement fields present across a set of samples.
 *
 * Each sample is a flat bag of fields — a Data Store record `payload` or a
 * device-history `state`. Fields are returned in first-seen order and capped at
 * `maxFields` so a caller's colour palette is never exceeded.
 *
 * Several samples are inspected rather than stopping at the first one that has
 * any numeric field, because a device or automation may omit a field from an
 * individual sample; stopping early would hide that series permanently.
 */
export function detectNumericFields(
  samples: readonly Record<string, unknown>[],
  options?: { maxFields?: number; sampleLimit?: number },
): string[] {
  const maxFields = options?.maxFields ?? Infinity;
  const sampleLimit = options?.sampleLimit ?? DEFAULT_FIELD_SAMPLE_LIMIT;
  const fields = new Set<string>();

  const inspected = Math.min(samples.length, sampleLimit);
  for (let i = 0; i < inspected; i++) {
    for (const [key, value] of Object.entries(samples[i])) {
      if (isTimeField(key)) continue;
      if (typeof value !== "number" || !isFinite(value)) continue;
      fields.add(key);
      // Stop as soon as the palette is full; further fields could not be drawn.
      if (fields.size >= maxFields) return Array.from(fields);
    }
  }

  return Array.from(fields);
}
