// frontend/src/store/data-store-store.ts — Zustand store for Data Store state

import { create } from "zustand";
import { API_URL } from "../lib/env";

// ---- Types ----

export interface DataStoreConfig {
  enabled: boolean;
  maxStorageMb: number;
  maxRecordsPerCollection: number;
  maxCollections: number;
}

export interface DataStoreStats {
  totalRecords: number;
  totalBucketEntries: number;
  totalCollections: number;
  estimatedStorageMb: number;
  maxStorageMb: number;
  storagePercent: number;
}

export interface CollectionMetadata {
  name: string;
  description: string | null;
  retentionDays: number | null;
  recordCount: number;
  oldestRecord: number | null;
  newestRecord: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataRecord {
  id: number;
  collection: string;
  payload: Record<string, unknown>;
  tags: Record<string, string>;
  timestamp: number;
}

export interface BucketSummary {
  bucket: string;
  keyCount: number;
}

export interface BucketEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface QueryOptions {
  from?: string | number;
  to?: number;
  limit?: number;
  offset?: number;
  tags?: Record<string, string>;
  aggregate?: "sum" | "avg" | "min" | "max" | "count";
  field?: string;
}

// ---- Query bounds ----

/** Rows per page in the observations table. */
export const RECORDS_PAGE_SIZE = 50;

/**
 * Upper bound on observations fetched for the chart.
 *
 * The chart visualises a time range, not a table page, so it needs its own
 * bounded query: a 30-day range holds far more than one page. This ceiling keeps
 * a large collection from being pulled into the browser wholesale — the server
 * reports the matching `total` alongside, so the chart can say how much of the
 * range it is actually drawing.
 */
export const CHART_MAX_POINTS = 1000;

// ---- API helpers ----

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { authFetch } = await import("../lib/auth-fetch");
  const res = await authFetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Run one bounded record query. Shared by the table and chart fetches. */
async function queryRecords(
  collection: string,
  options?: QueryOptions,
): Promise<{ records: DataRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.from != null) params.set("from", String(options.from));
  if (options?.to != null) params.set("to", String(options.to));
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.offset != null) params.set("offset", String(options.offset));
  if (options?.tags) params.set("tags", JSON.stringify(options.tags));
  if (options?.aggregate) params.set("aggregate", options.aggregate);
  if (options?.field) params.set("field", options.field);

  const query = params.toString() ? `?${params.toString()}` : "";
  return request<{ records: DataRecord[]; total: number }>(
    `/api/data-store/collections/${encodeURIComponent(collection)}/records${query}`,
  );
}

// ---- State interface ----

interface DataStoreState {
  // Config & status
  config: DataStoreConfig | null;
  enabled: boolean;
  stats: DataStoreStats | null;

  // Collections
  collections: CollectionMetadata[];
  selectedCollection: string | null;

  // Observations table for the selected collection — one page of raw records.
  records: DataRecord[];
  recordsTotal: number;
  recordsLoading: boolean;
  /** Zero-based page of the observations table. Reset whenever the query changes. */
  recordsPage: number;

  // Chart series for the selected collection — a bounded window over the whole
  // selected time range, deliberately independent of the table's pagination so
  // paging the table never changes what the chart visualises.
  chartRecords: DataRecord[];
  chartTotal: number;
  chartLoading: boolean;

  // Latest realtime record per collection, so independent panes (each showing a
  // different collection) can receive live updates without sharing the single
  // selected-collection `records` array used by the Data Explorer page.
  latestRecordByCollection: Record<string, DataRecord>;

  // Buckets
  buckets: BucketSummary[];
  selectedBucket: string | null;
  bucketEntries: BucketEntry[];

  // Query state
  timeRange: string;
  queryTags: Record<string, string>;

  // Actions
  fetchConfig: () => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchRecords: (collection: string, options?: QueryOptions) => Promise<void>;
  fetchChartRecords: (collection: string, options?: QueryOptions) => Promise<void>;
  fetchBuckets: () => Promise<void>;
  fetchBucketEntries: (bucket: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  selectCollection: (name: string | null) => void;
  selectBucket: (name: string | null) => void;
  setTimeRange: (range: string) => void;
  setRecordsPage: (page: number) => void;
  addRealtimeRecord: (collection: string, record: DataRecord) => void;
  removeCollection: (name: string) => void;
}

// ---- Store ----

export const useDataStoreStore = create<DataStoreState>((set, get) => ({
  // Initial state
  config: null,
  enabled: false,
  stats: null,
  collections: [],
  selectedCollection: null,
  records: [],
  recordsTotal: 0,
  recordsLoading: false,
  recordsPage: 0,
  chartRecords: [],
  chartTotal: 0,
  chartLoading: false,
  latestRecordByCollection: {},
  buckets: [],
  selectedBucket: null,
  bucketEntries: [],
  timeRange: "24h",
  queryTags: {},

  // ---- Actions ----

  fetchConfig: async () => {
    try {
      const config = await request<DataStoreConfig>("/api/data-store/config");
      set({ config, enabled: config.enabled });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch config:", err);
    }
  },

  fetchCollections: async () => {
    try {
      const collections = await request<CollectionMetadata[]>("/api/data-store/collections");
      set({ collections });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch collections:", err);
    }
  },

  fetchRecords: async (collection, options) => {
    set({ recordsLoading: true });
    try {
      const result = await queryRecords(collection, options);
      set({ records: result.records, recordsTotal: result.total, recordsLoading: false });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch records:", err);
      set({ records: [], recordsTotal: 0, recordsLoading: false });
    }
  },

  /**
   * Fetch the chart's series window. Issued separately from `fetchRecords` so
   * the chart's dataset is driven only by the selected time range and the table's
   * dataset only by its page — changing one must never move the other.
   */
  fetchChartRecords: async (collection, options) => {
    set({ chartLoading: true });
    try {
      const result = await queryRecords(collection, {
        limit: CHART_MAX_POINTS,
        ...options,
      });
      set({ chartRecords: result.records, chartTotal: result.total, chartLoading: false });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch chart records:", err);
      set({ chartRecords: [], chartTotal: 0, chartLoading: false });
    }
  },

  fetchBuckets: async () => {
    try {
      const buckets = await request<BucketSummary[]>("/api/data-store/buckets");
      set({ buckets });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch buckets:", err);
    }
  },

  fetchBucketEntries: async (bucket) => {
    try {
      const bucketEntries = await request<BucketEntry[]>(
        `/api/data-store/buckets/${encodeURIComponent(bucket)}`,
      );
      set({ bucketEntries });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch bucket entries:", err);
      set({ bucketEntries: [] });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await request<DataStoreStats>("/api/data-store/stats");
      set({ stats });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch stats:", err);
    }
  },

  selectCollection: (name) => {
    set({
      selectedCollection: name,
      records: [],
      recordsTotal: 0,
      recordsPage: 0,
      chartRecords: [],
      chartTotal: 0,
    });
  },

  selectBucket: (name) => {
    set({ selectedBucket: name, bucketEntries: [] });
  },

  /**
   * Change the visualised time range. The table returns to its first page: an
   * offset that was valid for the previous range is meaningless in the new one,
   * and silently keeping it strands the table on a page the range may not have.
   */
  setTimeRange: (range) => {
    set({ timeRange: range, recordsPage: 0 });
  },

  setRecordsPage: (page) => {
    set({ recordsPage: Math.max(0, page) });
  },

  addRealtimeRecord: (collection, record) => {
    const state = get();
    if (state.selectedCollection === collection) {
      // The table shows one page of a newest-first query, so a live record only
      // belongs on page 0; prepending it while the user reads an older page would
      // both misplace it and push that page past its size. The total still moves
      // so the pagination footer stays honest.
      const onFirstPage = state.recordsPage === 0;
      set({
        records: onFirstPage
          ? [record, ...state.records].slice(0, RECORDS_PAGE_SIZE)
          : state.records,
        recordsTotal: state.recordsTotal + 1,
        // The chart tracks the live edge of the range regardless of table paging,
        // staying within its own bound by dropping the oldest point it holds.
        chartRecords: [record, ...state.chartRecords].slice(0, CHART_MAX_POINTS),
        chartTotal: state.chartTotal + 1,
      });
    }
    // Publish the latest record for this collection so any data-collection pane
    // showing it updates live, independent of the Data Explorer's selection.
    set((prev) => ({
      latestRecordByCollection: { ...prev.latestRecordByCollection, [collection]: record },
    }));
    // Update collection metadata (increment record count)
    set((prev) => ({
      collections: prev.collections.map((c) =>
        c.name === collection
          ? { ...c, recordCount: c.recordCount + 1, newestRecord: record.timestamp }
          : c,
      ),
    }));
  },

  removeCollection: (name) => {
    set((prev) => {
      const updates: Partial<DataStoreState> = {
        collections: prev.collections.filter((c) => c.name !== name),
      };
      // Clear selection if the removed collection was selected
      if (prev.selectedCollection === name) {
        updates.selectedCollection = null;
        updates.records = [];
        updates.recordsTotal = 0;
        updates.recordsPage = 0;
        updates.chartRecords = [];
        updates.chartTotal = 0;
      }
      return updates;
    });
  },
}));
