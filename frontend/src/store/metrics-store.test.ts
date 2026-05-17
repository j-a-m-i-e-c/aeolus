// frontend/src/store/metrics-store.test.ts — Unit tests for metrics store

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMetricsStore } from "./metrics-store";

// Mock authFetch
vi.mock("../lib/auth-fetch", () => ({
  authFetch: vi.fn(),
}));

import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);

describe("metrics-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store state between tests
    useMetricsStore.setState({
      summary: null,
      loading: false,
      error: null,
      lastUpdated: null,
    });
    mockAuthFetch.mockReset();
  });

  afterEach(() => {
    useMetricsStore.getState().stopPolling();
    vi.useRealTimers();
  });

  const mockSummary = {
    mqtt: { messagesReceivedRate: 12.5, messagesPublishedRate: 3.2, connected: true },
    devices: { registeredCount: 24 },
    automations: { executionRate: 0.8, activeRules: 7, errorRate: 0.01 },
    websocket: { activeConnections: 2 },
    system: { uptimeSeconds: 86400, memoryUsageMb: 78.3, eventLoopLagMs: 1.2 },
  };

  describe("fetchSummary", () => {
    it("sets loading to true during fetch", async () => {
      mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));

      const promise = useMetricsStore.getState().fetchSummary();
      expect(useMetricsStore.getState().loading).toBe(true);
      await promise;
      expect(useMetricsStore.getState().loading).toBe(false);
    });

    it("sets summary and lastUpdated on success", async () => {
      mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));

      await useMetricsStore.getState().fetchSummary();

      const state = useMetricsStore.getState();
      expect(state.summary).toEqual(mockSummary);
      expect(state.lastUpdated).toBeTypeOf("number");
      expect(state.error).toBeNull();
    });

    it("sets error on non-ok response", async () => {
      mockAuthFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      );

      await useMetricsStore.getState().fetchSummary();

      const state = useMetricsStore.getState();
      expect(state.error).toBe("Unauthorized");
      expect(state.summary).toBeNull();
      expect(state.loading).toBe(false);
    });

    it("sets error on network failure", async () => {
      mockAuthFetch.mockRejectedValue(new Error("Network error"));

      await useMetricsStore.getState().fetchSummary();

      const state = useMetricsStore.getState();
      expect(state.error).toBe("Network error");
      expect(state.loading).toBe(false);
    });

    it("clears previous error on successful fetch", async () => {
      useMetricsStore.setState({ error: "Previous error" });
      mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));

      await useMetricsStore.getState().fetchSummary();

      expect(useMetricsStore.getState().error).toBeNull();
    });
  });

  describe("startPolling", () => {
    it("fetches immediately when polling starts", async () => {
      mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));

      useMetricsStore.getState().startPolling();

      expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    });

    it("fetches again after 15 seconds", async () => {
      mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));

      useMetricsStore.getState().startPolling();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    });

    it("fetches multiple times at 15-second intervals", async () => {
      mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));

      useMetricsStore.getState().startPolling();
      await vi.advanceTimersByTimeAsync(45_000);

      // Initial + 3 intervals = 4 calls
      expect(mockAuthFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe("stopPolling", () => {
    it("stops the polling interval", async () => {
      mockAuthFetch.mockResolvedValue(new Response(JSON.stringify(mockSummary), { status: 200 }));

      useMetricsStore.getState().startPolling();
      useMetricsStore.getState().stopPolling();
      await vi.advanceTimersByTimeAsync(30_000);

      // Only the initial fetch should have been called
      expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    });

    it("is safe to call when not polling", () => {
      expect(() => useMetricsStore.getState().stopPolling()).not.toThrow();
    });
  });
});
