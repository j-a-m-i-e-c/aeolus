// frontend/src/lib/series.test.ts — shared numeric-series detection

import { describe, expect, it } from "vitest";
import { detectNumericFields, isTimeField } from "./series";

describe("isTimeField", () => {
  it("recognises a sample's own time coordinate regardless of casing", () => {
    expect(isTimeField("timestamp")).toBe(true);
    expect(isTimeField("Timestamp")).toBe(true);
    expect(isTimeField("recordedAt")).toBe(true);
    expect(isTimeField("ts")).toBe(true);
  });

  it("does not claim an ordinary measurement that merely mentions time", () => {
    expect(isTimeField("uptime")).toBe(false);
    expect(isTimeField("runtimeHours")).toBe(false);
    expect(isTimeField("header")).toBe(false);
  });
});

describe("detectNumericFields", () => {
  it("returns numeric fields in first-seen order", () => {
    const fields = detectNumericFields([{ header: 58, shedCatchment: 72, house: 40 }]);
    expect(fields).toEqual(["header", "shedCatchment", "house"]);
  });

  it("excludes a repeated time coordinate so the y-axis stays on the measurements", () => {
    const fields = detectNumericFields([
      { timestamp: 1_700_000_000_000, recordedAt: 1_700_000_000_000, header: 58 },
    ]);
    expect(fields).toEqual(["header"]);
  });

  it("ignores non-numeric and non-finite values", () => {
    const fields = detectNumericFields([
      { label: "shed", ok: true, broken: NaN, ratio: Infinity, level: 12 },
    ]);
    expect(fields).toEqual(["level"]);
  });

  it("finds a field that only appears in a later sample", () => {
    // Stopping at the first sample with any numeric field would hide `flow`
    // permanently whenever a device omits it from one reading.
    const fields = detectNumericFields([{ header: 58 }, { header: 60, flow: 12 }]);
    expect(fields).toEqual(["header", "flow"]);
  });

  it("caps the result at the caller's palette size", () => {
    const fields = detectNumericFields([{ a: 1, b: 2, c: 3, d: 4 }], { maxFields: 2 });
    expect(fields).toEqual(["a", "b"]);
  });

  it("inspects only a bounded number of samples", () => {
    const samples = [
      ...Array.from({ length: 40 }, () => ({ header: 1 })),
      { lateField: 2 },
    ];
    const fields = detectNumericFields(samples, { sampleLimit: 5 });
    expect(fields).toEqual(["header"]);
  });

  it("returns nothing for an empty set of samples", () => {
    expect(detectNumericFields([])).toEqual([]);
  });
});
