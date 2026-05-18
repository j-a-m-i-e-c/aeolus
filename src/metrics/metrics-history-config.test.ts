// src/metrics/metrics-history-config.test.ts — Unit tests for metrics history config parser

import { describe, it, expect, vi } from "vitest";
import { parseMetricsHistoryConfig, type ConfigLogger } from "./metrics-history-config.js";

function createMockLogger(): ConfigLogger & { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() };
}

describe("parseMetricsHistoryConfig", () => {
  describe("defaults (missing env vars)", () => {
    it("returns all defaults when no env vars are set", () => {
      const result = parseMetricsHistoryConfig({});
      expect(result).toEqual({
        samplingIntervalMs: 30_000,
        aggregationIntervalMs: 300_000,
        liveRetentionMinutes: 10,
      });
    });

    it("returns defaults for empty string values", () => {
      const result = parseMetricsHistoryConfig({
        METRICS_HISTORY_INTERVAL_MS: "",
        METRICS_HISTORY_AGGREGATION_INTERVAL_MS: "",
        METRICS_HISTORY_LIVE_RETENTION_MINUTES: "",
      });
      expect(result).toEqual({
        samplingIntervalMs: 30_000,
        aggregationIntervalMs: 300_000,
        liveRetentionMinutes: 10,
      });
    });

    it("does not log warnings for missing values", () => {
      const logger = createMockLogger();
      parseMetricsHistoryConfig({}, logger);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("valid values", () => {
    it("parses valid sampling interval", () => {
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_INTERVAL_MS: "15000" });
      expect(result.samplingIntervalMs).toBe(15_000);
    });

    it("parses valid aggregation interval", () => {
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_AGGREGATION_INTERVAL_MS: "120000" });
      expect(result.aggregationIntervalMs).toBe(120_000);
    });

    it("parses valid retention minutes", () => {
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_LIVE_RETENTION_MINUTES: "20" });
      expect(result.liveRetentionMinutes).toBe(20);
    });

    it("accepts values at the exact minimum", () => {
      const result = parseMetricsHistoryConfig({
        METRICS_HISTORY_INTERVAL_MS: "5000",
        METRICS_HISTORY_AGGREGATION_INTERVAL_MS: "60000",
        METRICS_HISTORY_LIVE_RETENTION_MINUTES: "5",
      });
      expect(result).toEqual({
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
        liveRetentionMinutes: 5,
      });
    });
  });

  describe("clamping below minimum", () => {
    it("clamps sampling interval to 5000ms minimum", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_INTERVAL_MS: "1000" }, logger);
      expect(result.samplingIntervalMs).toBe(5_000);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("clamps aggregation interval to 60000ms minimum", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_AGGREGATION_INTERVAL_MS: "30000" }, logger);
      expect(result.aggregationIntervalMs).toBe(60_000);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("clamps retention to 5 minutes minimum", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_LIVE_RETENTION_MINUTES: "2" }, logger);
      expect(result.liveRetentionMinutes).toBe(5);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("invalid (non-numeric) values", () => {
    it("uses default for non-numeric sampling interval", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_INTERVAL_MS: "abc" }, logger);
      expect(result.samplingIntervalMs).toBe(30_000);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("uses default for non-numeric aggregation interval", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_AGGREGATION_INTERVAL_MS: "not-a-number" }, logger);
      expect(result.aggregationIntervalMs).toBe(300_000);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("uses default for non-numeric retention", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_LIVE_RETENTION_MINUTES: "ten" }, logger);
      expect(result.liveRetentionMinutes).toBe(10);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("uses default for negative values", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({
        METRICS_HISTORY_INTERVAL_MS: "-5000",
        METRICS_HISTORY_AGGREGATION_INTERVAL_MS: "-1",
        METRICS_HISTORY_LIVE_RETENTION_MINUTES: "-10",
      }, logger);
      expect(result.samplingIntervalMs).toBe(30_000);
      expect(result.aggregationIntervalMs).toBe(300_000);
      expect(result.liveRetentionMinutes).toBe(10);
      expect(logger.warn).toHaveBeenCalledTimes(3);
    });

    it("uses default for zero values", () => {
      const logger = createMockLogger();
      const result = parseMetricsHistoryConfig({
        METRICS_HISTORY_INTERVAL_MS: "0",
      }, logger);
      expect(result.samplingIntervalMs).toBe(30_000);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("logger is optional", () => {
    it("works without a logger for invalid values", () => {
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_INTERVAL_MS: "abc" });
      expect(result.samplingIntervalMs).toBe(30_000);
    });

    it("works without a logger for clamped values", () => {
      const result = parseMetricsHistoryConfig({ METRICS_HISTORY_INTERVAL_MS: "1000" });
      expect(result.samplingIntervalMs).toBe(5_000);
    });
  });
});
