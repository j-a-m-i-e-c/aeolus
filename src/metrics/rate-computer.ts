// src/metrics/rate-computer.ts — Stateful rate computation from monotonic counters

/**
 * RateComputer tracks previous counter values and computes per-second rates.
 *
 * Counters are monotonically increasing totals (e.g. messages received).
 * This class computes the delta between consecutive samples divided by the
 * interval to produce a meaningful rate (e.g. messages/sec).
 *
 * Handles counter resets (current < previous) by returning null and treating
 * the current value as the new baseline.
 */
export class RateComputer {
  private previousValues: Map<string, number> = new Map();

  /**
   * Store a counter value and compute the per-second rate.
   *
   * @param metricName - Unique identifier for the counter metric
   * @param currentValue - Current counter value (monotonically increasing)
   * @param intervalSeconds - Time elapsed since last sample in seconds
   * @returns The computed rate (units/sec), or null if first sample or counter reset
   */
  computeRate(metricName: string, currentValue: number, intervalSeconds: number): number | null {
    const previous = this.previousValues.get(metricName);
    this.previousValues.set(metricName, currentValue);

    // First sample — no previous value to compute delta from
    if (previous === undefined) {
      return null;
    }

    // Counter reset detected (process restart or registry clear)
    if (currentValue < previous) {
      return null;
    }

    return (currentValue - previous) / intervalSeconds;
  }

  /**
   * Clear all stored previous values.
   * Useful on service shutdown or when resetting state.
   */
  reset(): void {
    this.previousValues.clear();
  }
}
