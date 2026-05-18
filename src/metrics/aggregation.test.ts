import { describe, it, expect } from "vitest";
import {
  computeAggregate,
  detectSpikes,
  alignToWindow,
} from "./aggregation.js";

describe("computeAggregate", () => {
  it("returns avg=0 and peak=0 for empty array", () => {
    const result = computeAggregate([]);
    expect(result.avg).toBe(0);
    expect(result.peak).toBe(0);
  });

  it("returns the value itself for a single-element array", () => {
    const result = computeAggregate([5]);
    expect(result.avg).toBe(5);
    expect(result.peak).toBe(5);
  });

  it("computes correct avg and peak for known values", () => {
    const result = computeAggregate([2, 4, 6, 8, 10]);
    expect(result.avg).toBe(6);
    expect(result.peak).toBe(10);
  });

  it("handles all identical values", () => {
    const result = computeAggregate([3, 3, 3, 3]);
    expect(result.avg).toBe(3);
    expect(result.peak).toBe(3);
  });

  it("handles values with decimals", () => {
    const result = computeAggregate([1.5, 2.5, 3.5]);
    expect(result.avg).toBeCloseTo(2.5);
    expect(result.peak).toBe(3.5);
  });
});

describe("detectSpikes", () => {
  it("returns null when fewer than 3 samples", () => {
    expect(detectSpikes([])).toBeNull();
    expect(detectSpikes([{ timestamp: 1, value: 10 }])).toBeNull();
    expect(
      detectSpikes([
        { timestamp: 1, value: 10 },
        { timestamp: 2, value: 20 },
      ]),
    ).toBeNull();
  });

  it("returns null when no sample exceeds 2x average", () => {
    const samples = [
      { timestamp: 1000, value: 5 },
      { timestamp: 2000, value: 6 },
      { timestamp: 3000, value: 7 },
    ];
    // avg = 6, threshold = 12, no value exceeds 12
    expect(detectSpikes(samples)).toBeNull();
  });

  it("detects a spike when a value exceeds 2x average", () => {
    const samples = [
      { timestamp: 1000, value: 2 },
      { timestamp: 2000, value: 2 },
      { timestamp: 3000, value: 20 },
    ];
    // avg = 8, threshold = 16, value 20 exceeds 16
    const result = detectSpikes(samples);
    expect(result).toEqual({ at: 3000, value: 20 });
  });

  it("returns the highest outlier when multiple spikes exist", () => {
    const samples = [
      { timestamp: 1000, value: 1 },
      { timestamp: 2000, value: 1 },
      { timestamp: 3000, value: 1 },
      { timestamp: 4000, value: 50 },
      { timestamp: 5000, value: 30 },
    ];
    // avg = 16.6, threshold = 33.2, only 50 exceeds threshold
    const result = detectSpikes(samples);
    expect(result).toEqual({ at: 4000, value: 50 });
  });

  it("uses custom threshold multiplier", () => {
    const samples = [
      { timestamp: 1000, value: 5 },
      { timestamp: 2000, value: 5 },
      { timestamp: 3000, value: 11 },
    ];
    // avg = 7, default threshold (2.0) = 14, no spike
    expect(detectSpikes(samples)).toBeNull();
    // custom threshold (1.5) = 10.5, value 11 exceeds 10.5
    expect(detectSpikes(samples, 1.5)).toEqual({ at: 3000, value: 11 });
  });

  it("handles all zero values without detecting spikes", () => {
    const samples = [
      { timestamp: 1000, value: 0 },
      { timestamp: 2000, value: 0 },
      { timestamp: 3000, value: 0 },
    ];
    // avg = 0, threshold = 0, no value > 0
    expect(detectSpikes(samples)).toBeNull();
  });
});

describe("alignToWindow", () => {
  it("aligns a timestamp to the 5-minute boundary", () => {
    const fiveMinMs = 5 * 60 * 1000; // 300,000
    // 1700000120000 should align to 1700000000000 (if that's the boundary)
    const aligned = alignToWindow(1700000120000, fiveMinMs);
    expect(aligned).toBe(Math.floor(1700000120000 / fiveMinMs) * fiveMinMs);
    expect(aligned).toBeLessThanOrEqual(1700000120000);
    expect(aligned % fiveMinMs).toBe(0);
  });

  it("returns the same value when already aligned", () => {
    const windowMs = 300000;
    const aligned = alignToWindow(300000, windowMs);
    expect(aligned).toBe(300000);
  });

  it("floors to the previous boundary", () => {
    const windowMs = 300000;
    // 300001 should floor to 300000
    expect(alignToWindow(300001, windowMs)).toBe(300000);
    // 599999 should floor to 300000
    expect(alignToWindow(599999, windowMs)).toBe(300000);
  });

  it("handles zero timestamp", () => {
    expect(alignToWindow(0, 300000)).toBe(0);
  });

  it("works with arbitrary window sizes", () => {
    const windowMs = 60000; // 1 minute
    expect(alignToWindow(90000, windowMs)).toBe(60000);
    expect(alignToWindow(120000, windowMs)).toBe(120000);
  });
});
