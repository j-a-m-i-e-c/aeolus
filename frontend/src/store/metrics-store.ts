// frontend/src/store/metrics-store.ts — Zustand store for metrics dashboard pane

import { create } from "zustand";
import { authFetch } from "../lib/auth-fetch";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;
const POLLING_INTERVAL_MS = 15_000;

export interface MetricsSummary {
  mqtt: {
    messagesReceivedRate: number;
    messagesPublishedRate: number;
    connected: boolean;
  };
  devices: {
    registeredCount: number;
  };
  automations: {
    executionRate: number;
    activeRules: number;
    errorRate: number;
  };
  websocket: {
    activeConnections: number;
  };
  system: {
    uptimeSeconds: number;
    memoryUsageMb: number;
    eventLoopLagMs: number;
  };
}

export interface MetricsState {
  summary: MetricsSummary | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;

  fetchSummary(): Promise<void>;
  startPolling(): void;
  stopPolling(): void;
}

let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

export const useMetricsStore = create<MetricsState>((set, get) => ({
  summary: null,
  loading: false,
  error: null,
  lastUpdated: null,

  fetchSummary: async () => {
    set({ loading: true });
    try {
      const response = await authFetch(`${API_URL}/api/metrics/summary`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: response.statusText }));
        set({ error: body.error || `Request failed: ${response.status}`, loading: false });
        return;
      }
      const data: MetricsSummary = await response.json();
      set({ summary: data, error: null, lastUpdated: Date.now(), loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch metrics summary";
      set({ error: message, loading: false });
    }
  },

  startPolling: () => {
    // Fetch immediately
    get().fetchSummary();

    // Clear any existing interval before starting a new one
    if (pollingIntervalId !== null) {
      clearInterval(pollingIntervalId);
    }

    pollingIntervalId = setInterval(() => {
      get().fetchSummary();
    }, POLLING_INTERVAL_MS);
  },

  stopPolling: () => {
    if (pollingIntervalId !== null) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  },
}));
