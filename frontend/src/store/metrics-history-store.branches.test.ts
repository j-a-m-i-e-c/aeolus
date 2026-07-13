// frontend/src/store/metrics-history-store.branches.test.ts — Tests targeting uncovered branches

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import { useMetricsHistoryStore } from "./metrics-history-store";
import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);
const s = () => useMetricsHistoryStore.getState();

function recordsResponse(records: unknown[]) {
  return new Response(JSON.stringify({ records, total: records.length }), { status: 200 });
}

describe("metrics-history-store — branch coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue(recordsResponse([]));
    useMetricsHistoryStore.setState({ timeRange: "1h", chartData: {}, loading: false, error: null });
  });

  afterEach(() => {
    s().stopPolling();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("fetchChartData extracts mqtt collection data", async () => {
    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("mqtt")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:live:mqtt", payload: { messagesReceivedRate: 15 }, tags: {}, timestamp: 1000 },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    expect(s().chartData.mqttMessageRate).toBeDefined();
    expect(s().chartData.mqttMessageRate.currentValue).toBe(15);
  });

  it("fetchChartData extracts automations collection data", async () => {
    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("automations")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:live:automations", payload: { executionRate: 5 }, tags: {}, timestamp: 1000 },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    expect(s().chartData.automationExecutionRate).toBeDefined();
    expect(s().chartData.automationExecutionRate.currentValue).toBe(5);
  });

  it("fetchChartData extracts http collection data", async () => {
    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("http")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:live:http", payload: { requestRate: 42 }, tags: {}, timestamp: 1000 },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    expect(s().chartData.httpRequestRate).toBeDefined();
    expect(s().chartData.httpRequestRate.currentValue).toBe(42);
  });

  it("fetchChartData extracts history system data with peaks and spikes", async () => {
    useMetricsHistoryStore.setState({ timeRange: "7d" });

    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("history") && String(url).includes("system")) {
        return Promise.resolve(
          recordsResponse([
            {
              id: 1,
              collection: "_metrics:history:system",
              payload: {
                avgMemoryMb: 100,
                peakMemoryMb: 150,
                avgEventLoopLagMs: 2,
                peakEventLoopLagMs: 5,
                spikes: { memoryUsageMb: { at: 5000, value: 200 } },
              },
              tags: {},
              timestamp: 1000,
            },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    expect(s().chartData.memoryUsageMb).toBeDefined();
    expect(s().chartData.memoryUsageMb.peakPoints).toHaveLength(1);
    expect(s().chartData.memoryUsageMb.spikes).toHaveLength(1);
    expect(s().chartData.eventLoopLagMs).toBeDefined();
  });

  it("fetchChartData extracts history mqtt data", async () => {
    useMetricsHistoryStore.setState({ timeRange: "24h" });

    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("history") && String(url).includes("mqtt")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:history:mqtt", payload: { avgMessagesPerSec: 10, peakMessagesPerSec: 20 }, tags: {}, timestamp: 1000 },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    expect(s().chartData.mqttMessageRate).toBeDefined();
    expect(s().chartData.mqttMessageRate.peakPoints).toHaveLength(1);
  });

  it("fetchChartData extracts history automations data", async () => {
    useMetricsHistoryStore.setState({ timeRange: "30d" });

    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("history") && String(url).includes("automations")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:history:automations", payload: { totalExecutions: 100 }, tags: {}, timestamp: 1000 },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    expect(s().chartData.automationExecutionRate).toBeDefined();
  });

  it("fetchChartData extracts history http data", async () => {
    useMetricsHistoryStore.setState({ timeRange: "6h" });

    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("history") && String(url).includes("http")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:history:http", payload: { totalRequests: 500 }, tags: {}, timestamp: 1000 },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    expect(s().chartData.httpRequestRate).toBeDefined();
  });

  it("fetchChartData handles individual collection errors (partial results)", async () => {
    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("system")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:live:system", payload: { memoryUsageMb: 50, eventLoopLagMs: 2 }, tags: {}, timestamp: 1000 },
          ]),
        );
      }
      // All other collections fail
      return Promise.resolve(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
    });

    await s().fetchChartData();
    expect(s().chartData.memoryUsageMb).toBeDefined();
    expect(s().loading).toBe(false);
  });

  it("startPolling uses longer interval for non-1h ranges", () => {
    useMetricsHistoryStore.setState({ timeRange: "7d" });
    s().startPolling();

    const callsAfterStart = mockAuthFetch.mock.calls.length;
    // Advance 30 seconds — should NOT trigger another fetch for 7d range (60s interval)
    vi.advanceTimersByTime(30_000);
    expect(mockAuthFetch.mock.calls.length).toBe(callsAfterStart);

    // Advance to 60 seconds total — should trigger
    vi.advanceTimersByTime(30_000);
    expect(mockAuthFetch.mock.calls.length).toBeGreaterThan(callsAfterStart);
  });

  it("buildChartData handles empty records gracefully", async () => {
    mockAuthFetch.mockResolvedValue(recordsResponse([]));
    await s().fetchChartData();
    // No crash, no chart data
    expect(s().loading).toBe(false);
  });

  it("buildHistoryChartData handles records without spikes", async () => {
    useMetricsHistoryStore.setState({ timeRange: "7d" });

    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("history") && String(url).includes("system")) {
        return Promise.resolve(
          recordsResponse([
            {
              id: 1,
              collection: "_metrics:history:system",
              payload: { avgMemoryMb: 50, peakMemoryMb: 80, avgEventLoopLagMs: 1, peakEventLoopLagMs: 3 },
              tags: {},
              timestamp: 1000,
            },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();
    // No spikes field in result since none were in the payload
    expect(s().chartData.memoryUsageMb.spikes).toBeUndefined();
  });
});
