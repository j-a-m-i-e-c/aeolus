// src/metrics/metrics-history-service.test.ts — Unit tests for MetricsHistoryService lifecycle

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricsHistoryService, type MetricsHistoryDeps } from "./metrics-history-service.js";

/** Create minimal mock dependencies for testing */
function createMockDeps(): MetricsHistoryDeps {
  return {
    dataStore: {
      isEnabled: vi.fn().mockReturnValue(true),
      write: vi.fn(),
      query: vi.fn().mockReturnValue({ records: [], total: 0 }),
      createCollection: vi.fn(),
    } as unknown as MetricsHistoryDeps["dataStore"],
    registry: {
      getSingleMetricAsString: vi.fn().mockResolvedValue(""),
      getSingleMetric: vi.fn().mockResolvedValue(null),
      getMetricsAsJSON: vi.fn().mockResolvedValue([]),
    } as unknown as MetricsHistoryDeps["registry"],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as MetricsHistoryDeps["logger"],
  };
}

describe("MetricsHistoryService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should create an instance with default config from env", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps);
      expect(service).toBeInstanceOf(MetricsHistoryService);
      expect(service.isRunning()).toBe(false);
    });

    it("should accept explicit config overrides", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 10_000,
        aggregationIntervalMs: 120_000,
      });
      expect(service).toBeInstanceOf(MetricsHistoryService);
    });
  });

  describe("start()", () => {
    it("should set timers and report running", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      service.start();
      expect(service.isRunning()).toBe(true);
    });

    it("should not start twice if already running", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      service.start();
      service.start(); // second call should warn, not create duplicate timers
      expect(deps.logger.warn).toHaveBeenCalledWith("MetricsHistoryService is already running");
    });

    it("should call sampleOnce on sampling interval tick", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      const sampleSpy = vi.spyOn(service, "sampleOnce");
      service.start();

      vi.advanceTimersByTime(5_000);
      expect(sampleSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5_000);
      expect(sampleSpy).toHaveBeenCalledTimes(2);
    });

    it("should call aggregateOnce on aggregation interval tick", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      const aggSpy = vi.spyOn(service, "aggregateOnce");
      service.start();

      vi.advanceTimersByTime(60_000);
      expect(aggSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("dispose()", () => {
    it("should stop timers and report not running", async () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      service.start();
      expect(service.isRunning()).toBe(true);

      await service.dispose();
      expect(service.isRunning()).toBe(false);
    });

    it("should attempt final aggregation on dispose", async () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      const aggSpy = vi.spyOn(service, "aggregateOnce");
      service.start();
      await service.dispose();

      expect(aggSpy).toHaveBeenCalledTimes(1);
    });

    it("should not throw if aggregateOnce throws during dispose", async () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      vi.spyOn(service, "aggregateOnce").mockImplementation(() => {
        throw new Error("aggregation failed");
      });

      service.start();
      // Should not throw
      await expect(service.dispose()).resolves.toBeUndefined();
    });

    it("should stop timers so no further ticks fire", async () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });

      const sampleSpy = vi.spyOn(service, "sampleOnce");
      service.start();
      await service.dispose();

      // Advance time — no more ticks should fire
      vi.advanceTimersByTime(60_000);
      expect(sampleSpy).not.toHaveBeenCalled();
    });
  });

  describe("isRunning()", () => {
    it("should return false before start", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps);
      expect(service.isRunning()).toBe(false);
    });

    it("should return true after start", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });
      service.start();
      expect(service.isRunning()).toBe(true);
    });

    it("should return false after dispose", async () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps, {
        samplingIntervalMs: 5_000,
        aggregationIntervalMs: 60_000,
      });
      service.start();
      await service.dispose();
      expect(service.isRunning()).toBe(false);
    });
  });

  describe("sampleOnce() and aggregateOnce() stubs", () => {
    it("sampleOnce should be callable without error", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps);
      expect(() => service.sampleOnce()).not.toThrow();
    });

    it("aggregateOnce should be callable without error", () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps);
      expect(() => service.aggregateOnce()).not.toThrow();
    });
  });
});
