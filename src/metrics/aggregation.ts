/**
 * Pure aggregation functions for computing metric summaries and detecting spikes.
 */

/** Result of computing aggregate statistics over a numeric array. */
export interface AggregateResult {
  avg: number;
  peak: number;
}

/** A detected spike entry with timestamp and value. */
export interface SpikeEntry {
  at: number;
  value: number;
}

/** Default spike threshold multiplier (compile-time constant). */
const DEFAULT_SPIKE_THRESHOLD_MULTIPLIER = 2.0;

/**
 * Compute average and peak for a numeric array.
 * Returns avg=0, peak=0 for empty arrays.
 */
export function computeAggregate(values: number[]): AggregateResult {
  if (values.length === 0) {
    return { avg: 0, peak: 0 };
  }

  let sum = 0;
  let peak = -Infinity;

  for (const v of values) {
    sum += v;
    if (v > peak) {
      peak = v;
    }
  }

  return {
    avg: sum / values.length,
    peak,
  };
}

/**
 * Detect spikes in a set of timestamped values.
 * A spike is detected when any sample value exceeds thresholdMultiplier × average.
 * Returns the single highest outlier (max value among those exceeding threshold).
 * Returns null if fewer than 3 samples exist.
 */
export function detectSpikes(
  samples: Array<{ timestamp: number; value: number }>,
  thresholdMultiplier: number = DEFAULT_SPIKE_THRESHOLD_MULTIPLIER,
): SpikeEntry | null {
  if (samples.length < 3) {
    return null;
  }

  // Compute average
  let sum = 0;
  for (const sample of samples) {
    sum += sample.value;
  }
  const avg = sum / samples.length;

  const threshold = thresholdMultiplier * avg;

  // Find the highest outlier exceeding the threshold
  let spike: SpikeEntry | null = null;

  for (const sample of samples) {
    if (sample.value > threshold) {
      if (spike === null || sample.value > spike.value) {
        spike = { at: sample.timestamp, value: sample.value };
      }
    }
  }

  return spike;
}

/**
 * Align a timestamp to the nearest window boundary (floor).
 * Returns Math.floor(timestampMs / windowMs) * windowMs.
 */
export function alignToWindow(timestampMs: number, windowMs: number): number {
  return Math.floor(timestampMs / windowMs) * windowMs;
}
