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

  describe("sampleOnce() — data collection", () => {
    it("skips writes when DataStore is disabled", async () => {
      const deps = createMockDeps();
      (deps.dataStore.isEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const service = new MetricsHistoryService(deps);
      await service.sampleOnce();
      expect(deps.dataStore.write).not.toHaveBeenCalled();
    });

    it("initializes live collections on first sample", async () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps);
      await service.sampleOnce();
      expect(deps.dataStore.createCollection).toHaveBeenCalled();
    });

    it("does not re-initialize collections on subsequent samples", async () => {
      const deps = createMockDeps();
      const service = new MetricsHistoryService(deps);
      await service.sampleOnce();
      const callCount = (deps.dataStore.createCollection as ReturnType<typeof vi.fn>).mock.calls.length;
      await service.sampleOnce();
      expect((deps.dataStore.createCollection as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
    });

    it("writes system metrics (memory, event loop lag)", async () => {
      const deps = createMockDeps();
      // Mock registry to return metric values
      (deps.registry.getSingleMetric as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === "process_resident_memory_bytes") {
          return { get: async () => ({ values: [{ value: 100 * 1024 * 1024 }] }) };
        }
        if (name === "nodejs_eventloop_lag_seconds") {
          return { get: async () => ({ values: [{ value: 0.015 }] }) };
        }
        return null;
      });
      const service = new MetricsHistoryService(deps);
      await service.sampleOnce();
      expect(deps.dataStore.write).toHaveBeenCalledWith(
        "_metrics:live:system",
        expect.objectContaining({ memoryUsageMb: expect.any(Number), eventLoopLagMs: expect.any(Number) }),
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });

    it("writes MQTT metrics (rates, connected)", async () => {
      const deps = createMockDeps();
      (deps.registry.getSingleMetric as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === "aeolus_mqtt_messages_received_total") {
          return { get: async () => ({ values: [{ value: 100 }] }) };
        }
        if (name === "aeolus_mqtt_messages_published_total") {
          return { get: async () => ({ values: [{ value: 50 }] }) };
        }
        if (name === "aeolus_mqtt_connection_state") {
          return { get: async () => ({ values: [{ value: 1 }] }) };
        }
        return null;
      });
      const service = new MetricsHistoryService(deps, { samplingIntervalMs: 30000 });
      await service.sampleOnce();
      expect(deps.dataStore.write).toHaveBeenCalledWith(
        "_metrics:live:mqtt",
        expect.objectContaining({ messagesReceivedRate: expect.any(Number), connected: expect.any(Number) }),
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });

    it("writes automation metrics (execution rate, active rules)", async () => {
      const deps = createMockDeps();
      (deps.registry.getSingleMetric as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === "aeolus_automations_executions_total") {
          return { get: async () => ({ values: [{ value: 10, labels: { status: "success" } }, { value: 2, labels: { status: "error" } }] }) };
        }
        if (name === "aeolus_automations_active_rules") {
          return { get: async () => ({ values: [{ value: 5 }] }) };
        }
        return null;
      });
      const service = new MetricsHistoryService(deps, { samplingIntervalMs: 30000 });
      await service.sampleOnce();
      expect(deps.dataStore.write).toHaveBeenCalledWith(
        "_metrics:live:automations",
        expect.objectContaining({ executionRate: expect.any(Number), activeRules: expect.any(Number) }),
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });

    it("writes HTTP metrics (request rate)", async () => {
      const deps = createMockDeps();
      (deps.registry.getSingleMetric as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === "aeolus_http_requests_total") {
          return { get: async () => ({ values: [{ value: 200 }] }) };
        }
        return null;
      });
      const service = new MetricsHistoryService(deps, { samplingIntervalMs: 30000 });
      await service.sampleOnce();
      expect(deps.dataStore.write).toHaveBeenCalledWith(
        "_metrics:live:http",
        expect.objectContaining({ requestRate: expect.any(Number) }),
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );
    });

    it("handles metric read errors gracefully (logs warning, continues)", async () => {
      const deps = createMockDeps();
      (deps.registry.getSingleMetric as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
        if (name === "process_resident_memory_bytes") {
          return { get: async () => { throw new Error("metric read failed"); } };
        }
        return null;
      });
      const service = new MetricsHistoryService(deps);
      await service.sampleOnce();
      expect(deps.logger.warn).toHaveBeenCalled();
      // Should still write other metrics (mqtt, automations, http)
    });

    it("handles createCollection errors gracefully (collection already exists)", async () => {
      const deps = createMockDeps();
      (deps.dataStore.createCollection as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("collection already exists");
      });
      const service = new MetricsHistoryService(deps);
      // Should not throw
      await service.sampleOnce();
    });
  });

  describe("aggregateOnce() — data aggregation", () => {
    it("skips aggregation when DataStore is disabled", () => {
      const deps = createMockDeps();
      (deps.dataStore.isEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
      const service = new MetricsHistoryService(deps);
      service.aggregateOnce();
      expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    });

    it("skips aggregation when fewer than 2 samples in window", () => {
      const deps = createMockDeps();
      (deps.dataStore.query as ReturnType<typeof vi.fn>).mockReturnValue({ records: [{ payload: {}, timestamp: Date.now() }], total: 1 });
      const service = new MetricsHistoryService(deps);
      service.aggregateOnce();
      // Should not write to history collections
      expect(deps.dataStore.write).not.toHaveBeenCalled();
    });

    it("aggregates system metrics when sufficient samples exist", () => {
      const deps = createMockDeps();
      const now = Date.now();
      const samples = [
        { payload: { memoryUsageMb: 100, eventLoopLagMs: 10 }, tags: {}, timestamp: now - 60000, id: 1, collection: "_metrics:live:system" },
        { payload: { memoryUsageMb: 120, eventLoopLagMs: 15 }, tags: {}, timestamp: now - 30000, id: 2, collection: "_metrics:live:system" },
        { payload: { memoryUsageMb: 110, eventLoopLagMs: 12 }, tags: {}, timestamp: now, id: 3, collection: "_metrics:live:system" },
      ];
      (deps.dataStore.query as ReturnType<typeof vi.fn>).mockReturnValue({ records: samples, total: 3 });
      const service = new MetricsHistoryService(deps, { aggregationIntervalMs: 300000 });
      service.aggregateOnce();
      expect(deps.dataStore.write).toHaveBeenCalledWith(
        "_metrics:history:system",
        expect.objectContaining({
          avgMemoryMb: expect.any(Number),
          peakMemoryMb: expect.any(Number),
          avgEventLoopLagMs: expect.any(Number),
          peakEventLoopLagMs: expect.any(Number),
        }),
      );
    });

    it("aggregates MQTT metrics with connected percentage", () => {
      const deps = createMockDeps();
      const now = Date.now();
      const samples = [
        { payload: { messagesReceivedRate: 5, messagesPublishedRate: 2, connected: 1 }, tags: {}, timestamp: now - 60000, id: 1, collection: "_metrics:live:mqtt" },
        { payload: { messagesReceivedRate: 8, messagesPublishedRate: 3, connected: 1 }, tags: {}, timestamp: now - 30000, id: 2, collection: "_metrics:live:mqtt" },
        { payload: { messagesReceivedRate: 0, messagesPublishedRate: 0, connected: 0 }, tags: {}, timestamp: now, id: 3, collection: "_metrics:live:mqtt" },
      ];
      (deps.dataStore.query as ReturnType<typeof vi.fn>).mockReturnValue({ records: samples, total: 3 });
      const service = new MetricsHistoryService(deps, { aggregationIntervalMs: 300000 });
      service.aggregateOnce();
      // Should write to mqtt history
      const mqttWrite = (deps.dataStore.write as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === "_metrics:history:mqtt"
      );
      expect(mqttWrite).toBeDefined();
      expect(mqttWrite![1].connectedPct).toBeCloseTo(66.67, 0);
    });

    it("aggregates automation metrics with total executions", () => {
      const deps = createMockDeps();
      const now = Date.now();
      const samples = [
        { payload: { executionRate: 2, errorRate: 0.5, activeRules: 3 }, tags: {}, timestamp: now - 60000, id: 1, collection: "_metrics:live:automations" },
        { payload: { executionRate: 3, errorRate: 1, activeRules: 4 }, tags: {}, timestamp: now - 30000, id: 2, collection: "_metrics:live:automations" },
      ];
      (deps.dataStore.query as ReturnType<typeof vi.fn>).mockReturnValue({ records: samples, total: 2 });
      const service = new MetricsHistoryService(deps, { samplingIntervalMs: 30000, aggregationIntervalMs: 300000 });
      service.aggregateOnce();
      const autoWrite = (deps.dataStore.write as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === "_metrics:history:automations"
      );
      expect(autoWrite).toBeDefined();
      expect(autoWrite![1].totalExecutions).toBeGreaterThan(0);
      expect(autoWrite![1].totalErrors).toBeGreaterThan(0);
      expect(autoWrite![1].avgActiveRules).toBeGreaterThan(0);
    });

    it("aggregates HTTP metrics with total requests", () => {
      const deps = createMockDeps();
      const now = Date.now();
      const samples = [
        { payload: { requestRate: 10 }, tags: {}, timestamp: now - 60000, id: 1, collection: "_metrics:live:http" },
        { payload: { requestRate: 15 }, tags: {}, timestamp: now - 30000, id: 2, collection: "_metrics:live:http" },
      ];
      (deps.dataStore.query as ReturnType<typeof vi.fn>).mockReturnValue({ records: samples, total: 2 });
      const service = new MetricsHistoryService(deps, { samplingIntervalMs: 30000, aggregationIntervalMs: 300000 });
      service.aggregateOnce();
      const httpWrite = (deps.dataStore.write as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === "_metrics:history:http"
      );
      expect(httpWrite).toBeDefined();
      expect(httpWrite![1].totalRequests).toBeGreaterThan(0);
    });

    it("handles aggregation errors for individual categories gracefully", () => {
      const deps = createMockDeps();
      let callCount = 0;
      (deps.dataStore.query as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("system query failed");
        return { records: [], total: 0 };
      });
      const service = new MetricsHistoryService(deps, { aggregationIntervalMs: 300000 });
      // Should not throw — errors are caught per category
      expect(() => service.aggregateOnce()).not.toThrow();
      expect(deps.logger.error).toHaveBeenCalled();
    });
  });
});
