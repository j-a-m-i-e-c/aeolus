// frontend/src/store/metrics-history-store.test.ts — Unit tests for the metrics-history store

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

describe("metrics-history-store", () => {
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

  it("fetchChartData extracts live system metrics into chart data", async () => {
    mockAuthFetch.mockImplementation((url) => {
      if (String(url).includes("system")) {
        return Promise.resolve(
          recordsResponse([
            { id: 1, collection: "_metrics:live:system", payload: { memoryUsageMb: 50, eventLoopLagMs: 2 }, tags: {}, timestamp: 1000 },
            { id: 2, collection: "_metrics:live:system", payload: { memoryUsageMb: 60, eventLoopLagMs: 3 }, tags: {}, timestamp: 2000 },
          ]),
        );
      }
      return Promise.resolve(recordsResponse([]));
    });

    await s().fetchChartData();

    expect(s().loading).toBe(false);
    expect(s().chartData.memoryUsageMb.points).toEqual([
      { timestamp: 1000, value: 50 },
      { timestamp: 2000, value: 60 },
    ]);
    expect(s().chartData.memoryUsageMb.currentValue).toBe(60);
    expect(s().chartData.eventLoopLagMs.currentValue).toBe(3);
  });

  it("tolerates all collections failing (partial-data design)", async () => {
    mockAuthFetch.mockRejectedValue(new Error("offline"));

    await s().fetchChartData();

    expect(s().chartData).toEqual({});
    expect(s().loading).toBe(false);
  });

  it("queries the 1h live collections", async () => {
    await s().fetchChartData();
    const urls = mockAuthFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("live%3Asystem") || u.includes("live:system"))).toBe(true);
    expect(mockAuthFetch).toHaveBeenCalledTimes(4); // 4 live collections
  });

  it("setTimeRange updates the range and triggers an immediate fetch", () => {
    s().setTimeRange("7d");
    expect(s().timeRange).toBe("7d");
    expect(mockAuthFetch).toHaveBeenCalled();
    // 7d is a history view → queries the history collections
    const urls = mockAuthFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("history"))).toBe(true);
  });

  it("stopPolling halts further polling fetches", () => {
    s().startPolling();
    const callsAfterStart = mockAuthFetch.mock.calls.length;
    s().stopPolling();
    vi.advanceTimersByTime(120_000);
    expect(mockAuthFetch.mock.calls.length).toBe(callsAfterStart);
  });
});
