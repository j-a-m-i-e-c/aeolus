// frontend/src/store/metrics-history-store.ts — Zustand store for metrics history charts

import { create } from "zustand";
import { authFetch } from "../lib/auth-fetch";

const API_URL =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

// ---- Types ----

export type TimeRange = "1h" | "6h" | "24h" | "7d" | "30d";

export interface MetricChartData {
  points: Array<{ timestamp: number; value: number }>;
  peakPoints?: Array<{ timestamp: number; value: number }>;
  spikes?: Array<{ at: number; value: number }>;
  currentValue: number;
}

export interface MetricsHistoryState {
  timeRange: TimeRange;
  chartData: Record<string, MetricChartData>;
  loading: boolean;
  error: string | null;

  setTimeRange(range: TimeRange): void;
  fetchChartData(): Promise<void>;
  startPolling(): void;
  stopPolling(): void;
}

// ---- Constants ----

const POLLING_INTERVAL_1H_MS = 30_000;
const POLLING_INTERVAL_LONG_MS = 60_000;

const TIME_RANGE_MS: Record<TimeRange, number> = {
  "1h": 3_600_000,
  "6h": 21_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

/** Collections queried for the 1h (live) view */
const LIVE_COLLECTIONS = [
  "_metrics:live:system",
  "_metrics:live:mqtt",
  "_metrics:live:automations",
  "_metrics:live:http",
] as const;

/** Collections queried for longer (history) views */
const HISTORY_COLLECTIONS = [
  "_metrics:history:system",
  "_metrics:history:mqtt",
  "_metrics:history:automations",
  "_metrics:history:http",
] as const;

// ---- Helpers ----

interface DataRecord {
  id: number;
  collection: string;
  payload: Record<string, unknown>;
  tags: Record<string, string>;
  timestamp: number;
}

interface RecordsResponse {
  records: DataRecord[];
  total: number;
}

async function fetchCollectionRecords(
  collection: string,
  from: number,
  to: number,
): Promise<DataRecord[]> {
  const params = new URLSearchParams();
  params.set("from", String(from));
  params.set("to", String(to));

  const url = `${API_URL}/api/data-store/collections/${encodeURIComponent(collection)}/records?${params.toString()}`;
  const res = await authFetch(url);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  const data: RecordsResponse = await res.json();
  return data.records;
}

/**
 * Extract chart data from live collection records.
 * For live collections, we pick the primary value field based on collection name.
 */
function extractLiveChartData(
  collection: string,
  records: DataRecord[],
): Record<string, MetricChartData> {
  const result: Record<string, MetricChartData> = {};

  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);

  switch (collection) {
    case "_metrics:live:system": {
      result["memoryUsageMb"] = buildChartData(sorted, "memoryUsageMb");
      result["eventLoopLagMs"] = buildChartData(sorted, "eventLoopLagMs");
      break;
    }
    case "_metrics:live:mqtt": {
      result["mqttMessageRate"] = buildChartData(sorted, "messagesReceivedRate");
      break;
    }
    case "_metrics:live:automations": {
      result["automationExecutionRate"] = buildChartData(sorted, "executionRate");
      break;
    }
    case "_metrics:live:http": {
      result["httpRequestRate"] = buildChartData(sorted, "requestRate");
      break;
    }
  }

  return result;
}

/**
 * Extract chart data from history collection records.
 * History records have avg/peak fields and optional spikes.
 */
function extractHistoryChartData(
  collection: string,
  records: DataRecord[],
): Record<string, MetricChartData> {
  const result: Record<string, MetricChartData> = {};

  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);

  switch (collection) {
    case "_metrics:history:system": {
      result["memoryUsageMb"] = buildHistoryChartData(
        sorted,
        "avgMemoryMb",
        "peakMemoryMb",
        "memoryUsageMb",
      );
      result["eventLoopLagMs"] = buildHistoryChartData(
        sorted,
        "avgEventLoopLagMs",
        "peakEventLoopLagMs",
        "eventLoopLagMs",
      );
      break;
    }
    case "_metrics:history:mqtt": {
      result["mqttMessageRate"] = buildHistoryChartData(
        sorted,
        "avgMessagesPerSec",
        "peakMessagesPerSec",
        "messagesReceivedRate",
      );
      break;
    }
    case "_metrics:history:automations": {
      result["automationExecutionRate"] = buildHistoryChartData(
        sorted,
        "totalExecutions",
        undefined,
        "executionRate",
      );
      break;
    }
    case "_metrics:history:http": {
      result["httpRequestRate"] = buildHistoryChartData(
        sorted,
        "totalRequests",
        undefined,
        "requestRate",
      );
      break;
    }
  }

  return result;
}

function buildChartData(records: DataRecord[], field: string): MetricChartData {
  const points: Array<{ timestamp: number; value: number }> = [];

  for (const record of records) {
    const value = Number(record.payload[field] ?? 0);
    points.push({ timestamp: record.timestamp, value });
  }

  const currentValue = points.length > 0 ? points[points.length - 1].value : 0;

  return { points, currentValue };
}

function buildHistoryChartData(
  records: DataRecord[],
  avgField: string,
  peakField: string | undefined,
  spikeKey: string,
): MetricChartData {
  const points: Array<{ timestamp: number; value: number }> = [];
  const peakPoints: Array<{ timestamp: number; value: number }> = [];
  const spikes: Array<{ at: number; value: number }> = [];

  for (const record of records) {
    const avgValue = Number(record.payload[avgField] ?? 0);
    points.push({ timestamp: record.timestamp, value: avgValue });

    if (peakField) {
      const peakValue = Number(record.payload[peakField] ?? 0);
      peakPoints.push({ timestamp: record.timestamp, value: peakValue });
    }

    // Extract spikes from the record
    const recordSpikes = record.payload.spikes as Record<
      string,
      { at: number; value: number }
    > | null;
    if (recordSpikes && recordSpikes[spikeKey]) {
      spikes.push(recordSpikes[spikeKey]);
    }
  }

  const currentValue = points.length > 0 ? points[points.length - 1].value : 0;

  return {
    points,
    ...(peakPoints.length > 0 ? { peakPoints } : {}),
    ...(spikes.length > 0 ? { spikes } : {}),
    currentValue,
  };
}

// ---- Store ----

let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

export const useMetricsHistoryStore = create<MetricsHistoryState>((set, get) => ({
  timeRange: "1h",
  chartData: {},
  loading: false,
  error: null,

  setTimeRange: (range: TimeRange) => {
    set({ timeRange: range });
    // Restart polling with the new interval and fetch immediately
    const { stopPolling, startPolling } = get();
    stopPolling();
    startPolling();
  },

  fetchChartData: async () => {
    set({ loading: true, error: null });

    try {
      const { timeRange } = get();
      const now = Date.now();
      const from = now - TIME_RANGE_MS[timeRange];

      const isLive = timeRange === "1h";
      const collections = isLive ? LIVE_COLLECTIONS : HISTORY_COLLECTIONS;

      const allChartData: Record<string, MetricChartData> = {};

      // Fetch all collections in parallel
      const results = await Promise.allSettled(
        collections.map((col) => fetchCollectionRecords(col, from, now)),
      );

      for (let i = 0; i < collections.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          const records = result.value;
          const extracted = isLive
            ? extractLiveChartData(collections[i], records)
            : extractHistoryChartData(collections[i], records);
          Object.assign(allChartData, extracted);
        }
        // Silently skip failed collections — partial data is better than none
      }

      set({ chartData: allChartData, loading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch metrics history";
      set({ error: message, loading: false });
    }
  },

  startPolling: () => {
    // Fetch immediately
    get().fetchChartData();

    // Clear any existing interval before starting a new one
    if (pollingIntervalId !== null) {
      clearInterval(pollingIntervalId);
    }

    const { timeRange } = get();
    const interval =
      timeRange === "1h" ? POLLING_INTERVAL_1H_MS : POLLING_INTERVAL_LONG_MS;

    pollingIntervalId = setInterval(() => {
      get().fetchChartData();
    }, interval);
  },

  stopPolling: () => {
    if (pollingIntervalId !== null) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = null;
    }
  },
}));
