// src/data-store/duration.test.ts — Unit tests for duration parsing and formatting

import { describe, it, expect } from "vitest";
import { parseDuration, formatDuration, UNITS } from "./duration.js";

describe("duration", () => {
  describe("parseDuration", () => {
    it("parses minutes", () => {
      expect(parseDuration("30m")).toBe(30 * 60_000);
      expect(parseDuration("1m")).toBe(60_000);
    });

    it("parses hours", () => {
      expect(parseDuration("24h")).toBe(24 * 3_600_000);
      expect(parseDuration("1h")).toBe(3_600_000);
    });

    it("parses days", () => {
      expect(parseDuration("7d")).toBe(7 * 86_400_000);
      expect(parseDuration("1d")).toBe(86_400_000);
    });

    it("parses weeks", () => {
      expect(parseDuration("2w")).toBe(2 * 604_800_000);
      expect(parseDuration("1w")).toBe(604_800_000);
    });

    it("parses years", () => {
      expect(parseDuration("1y")).toBe(31_536_000_000);
    });

    it("trims whitespace", () => {
      expect(parseDuration("  7d  ")).toBe(7 * 86_400_000);
    });

    it("throws on empty input", () => {
      expect(() => parseDuration("")).toThrow("must not be empty");
      expect(() => parseDuration("   ")).toThrow("must not be empty");
    });

    it("throws on negative values", () => {
      expect(() => parseDuration("-7d")).toThrow("negative");
    });

    it("throws on decimal values", () => {
      expect(() => parseDuration("1.5d")).toThrow("decimal");
    });

    it("throws on unknown unit suffix", () => {
      expect(() => parseDuration("7x")).toThrow("unknown unit");
    });

    it("throws on missing number", () => {
      expect(() => parseDuration("d")).toThrow("expected format");
    });

    it("throws on zero value", () => {
      expect(() => parseDuration("0d")).toThrow("positive integer");
    });

    it("throws on invalid format", () => {
      expect(() => parseDuration("abc")).toThrow("expected format");
      expect(() => parseDuration("7")).toThrow("expected format");
    });
  });

  describe("formatDuration", () => {
    it("formats to years when evenly divisible", () => {
      expect(formatDuration(31_536_000_000)).toBe("1y");
      expect(formatDuration(2 * 31_536_000_000)).toBe("2y");
    });

    it("formats to weeks when evenly divisible", () => {
      expect(formatDuration(604_800_000)).toBe("1w");
      expect(formatDuration(2 * 604_800_000)).toBe("2w");
    });

    it("formats to days when evenly divisible", () => {
      expect(formatDuration(86_400_000)).toBe("1d");
      expect(formatDuration(7 * 86_400_000)).toBe("1w"); // 7d = 1w
    });

    it("formats to hours when evenly divisible", () => {
      expect(formatDuration(3_600_000)).toBe("1h");
      expect(formatDuration(12 * 3_600_000)).toBe("12h");
    });

    it("formats to minutes when evenly divisible", () => {
      expect(formatDuration(60_000)).toBe("1m");
      expect(formatDuration(30 * 60_000)).toBe("30m");
    });

    it("uses largest fitting unit", () => {
      // 24h = 1d
      expect(formatDuration(24 * 3_600_000)).toBe("1d");
      // 168h = 1w
      expect(formatDuration(168 * 3_600_000)).toBe("1w");
    });

    it("throws on zero or negative values", () => {
      expect(() => formatDuration(0)).toThrow("positive");
      expect(() => formatDuration(-1000)).toThrow("positive");
    });

    it("throws when not evenly divisible by any unit", () => {
      expect(() => formatDuration(12345)).toThrow("not evenly divisible");
    });
  });

  describe("round-trip", () => {
    it("parseDuration(formatDuration(x)) === x for valid durations", () => {
      const testCases = [60_000, 3_600_000, 86_400_000, 604_800_000, 31_536_000_000];
      for (const ms of testCases) {
        expect(parseDuration(formatDuration(ms))).toBe(ms);
      }
    });
  });

  describe("UNITS", () => {
    it("exports correct unit multipliers", () => {
      expect(UNITS.m).toBe(60_000);
      expect(UNITS.h).toBe(3_600_000);
      expect(UNITS.d).toBe(86_400_000);
      expect(UNITS.w).toBe(604_800_000);
      expect(UNITS.y).toBe(31_536_000_000);
    });
  });
});
