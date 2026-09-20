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

/**
 * One Shared State bucket — a namespace grouping related current values.
 *
 * "Bucket" is the container term inside Shared State; "Shared State" is the
 * concept. It is not a storage mode of the historical Data Store (ADR-0016).
 */
export interface SharedStateBucket {
  bucket: string;
  keyCount: number;
}

/** One durable current value inside a Shared State bucket. */
export interface SharedStateEntry {
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
  /** Sample the whole range down to this many points instead of paging it. */
  maxPoints?: number;
}

/** How the server bucketed a `maxPoints` query. Absent when nothing was sampled. */
export interface RangeSampling {
  bucketMs: number;
  from: number;
  to: number;
}

// ---- Query bounds ----

/** Rows per page in the observations table. */
export const RECORDS_PAGE_SIZE = 50;

/**
 * Upper bound on points drawn by the chart.
 *
 * The chart visualises a time range, not a table page, so it needs its own bounded
 * query: a 30-day range holds far more than one page. This is sent as `maxPoints`
 * rather than `limit`, which is the difference between "1,000 points spread across
 * the 30 days" and "the most recent 1,000 observations" — the latter drew about
 * three and a half days under a 30-day axis. The server reports the matching `total`
 * and how it bucketed the range alongside, so the chart can say what it is drawing.
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
): Promise<{ records: DataRecord[]; total: number; sampling?: RangeSampling }> {
  const params = new URLSearchParams();
  if (options?.from != null) params.set("from", String(options.from));
  if (options?.to != null) params.set("to", String(options.to));
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.offset != null) params.set("offset", String(options.offset));
  if (options?.maxPoints != null) params.set("maxPoints", String(options.maxPoints));
  if (options?.tags) params.set("tags", JSON.stringify(options.tags));
  if (options?.aggregate) params.set("aggregate", options.aggregate);
  if (options?.field) params.set("field", options.field);

  const query = params.toString() ? `?${params.toString()}` : "";
  return request<{ records: DataRecord[]; total: number; sampling?: RangeSampling }>(
    `/api/data-store/collections/${encodeURIComponent(collection)}/records${query}`,
  );
}

/**
 * Add a live observation to the chart's series without misrepresenting it.
 *
 * A complete series is a plain newest-first list, so a new record goes on the front
 * and the oldest falls off the bound. A *sampled* series is one representative per
 * bucket over a fixed range, and a live record is a raw observation past its right
 * edge — so only one such point is kept. Prepending them without limit would grow
 * unbounded, and dropping buckets off the left to make room would silently shrink the
 * range the axis still claims to show.
 */
function appendLivePoint(
  record: DataRecord,
  series: DataRecord[],
  sampling: RangeSampling | null,
): DataRecord[] {
  if (!sampling) return [record, ...series].slice(0, CHART_MAX_POINTS);
  const newest = series[0];
  return newest && newest.timestamp > sampling.to
    ? [record, ...series.slice(1)]
    : [record, ...series];
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
  /** How the server bucketed the range, when it had to sample it. */
  chartSampling: RangeSampling | null;

  // Latest realtime record per collection, so independent panes (each showing a
  // different collection) can receive live updates without sharing the single
  // selected-collection `records` array used by the Data Explorer page.
  latestRecordByCollection: Record<string, DataRecord>;

  // Shared State — durable current values shared between automations. Always
  // available, independent of whether historical Collections are enabled.
  sharedStateBuckets: SharedStateBucket[];
  selectedSharedStateBucket: string | null;
  sharedStateEntries: SharedStateEntry[];

  // Query state
  timeRange: string;
  queryTags: Record<string, string>;

  // Actions
  fetchConfig: () => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchRecords: (collection: string, options?: QueryOptions) => Promise<void>;
  fetchChartRecords: (collection: string, options?: QueryOptions) => Promise<void>;
  fetchSharedStateBuckets: () => Promise<void>;
  fetchSharedStateEntries: (bucket: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  selectCollection: (name: string | null) => void;
  selectSharedStateBucket: (name: string | null) => void;
  setTimeRange: (range: string) => void;
  setRecordsPage: (page: number) => void;
  addRealtimeRecord: (collection: string, record: DataRecord) => void;
  /** Apply a live Shared State change pushed over the WebSocket. */
  applySharedStateChange: (change: {
    bucket: string;
    key: string;
    value?: unknown;
    deleted: boolean;
    timestamp: number;
  }) => void;
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
  chartSampling: null,
  latestRecordByCollection: {},
  sharedStateBuckets: [],
  selectedSharedStateBucket: null,
  sharedStateEntries: [],
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
        maxPoints: CHART_MAX_POINTS,
        ...options,
      });
      set({
        chartRecords: result.records,
        chartTotal: result.total,
        chartSampling: result.sampling ?? null,
        chartLoading: false,
      });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch chart records:", err);
      set({ chartRecords: [], chartTotal: 0, chartSampling: null, chartLoading: false });
    }
  },

  // Shared State reads go to /api/shared-state, not the deprecated
  // /api/data-store/buckets aliases: Shared State is a core facility, so its API
  // must not read as a corner of historical storage (ADR-0016).
  fetchSharedStateBuckets: async () => {
    try {
      const sharedStateBuckets = await request<SharedStateBucket[]>("/api/shared-state");
      set({ sharedStateBuckets });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch Shared State buckets:", err);
    }
  },

  fetchSharedStateEntries: async (bucket) => {
    try {
      const sharedStateEntries = await request<SharedStateEntry[]>(
        `/api/shared-state/${encodeURIComponent(bucket)}`,
      );
      set({ sharedStateEntries });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch Shared State entries:", err);
      set({ sharedStateEntries: [] });
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
      chartSampling: null,
    });
  },

  selectSharedStateBucket: (name) => {
    set({ selectedSharedStateBucket: name, sharedStateEntries: [] });
  },

  /**
   * Fold a live Shared State change into the browsed view.
   *
   * Only a REAL change arrives here — an identical write performs no work and
   * emits nothing — so every call moves something. The expanded bucket's entries
   * and the bucket key counts are both updated, because a new key changes the
   * count the collapsed row is showing.
   */
  applySharedStateChange: ({ bucket, key, value, deleted, timestamp }) => {
    set((prev) => {
      const isExpanded = prev.selectedSharedStateBucket === bucket;
      const existing = isExpanded ? prev.sharedStateEntries.find((e) => e.key === key) : undefined;

      const sharedStateEntries = !isExpanded
        ? prev.sharedStateEntries
        : deleted
          ? prev.sharedStateEntries.filter((e) => e.key !== key)
          : existing
            ? prev.sharedStateEntries.map((e) => (e.key === key ? { key, value, updatedAt: timestamp } : e))
            // Keep the list key-ordered, matching how the server returns it, so a
            // new key does not appear in an arbitrary position.
            : [...prev.sharedStateEntries, { key, value, updatedAt: timestamp }].sort((a, b) =>
                a.key.localeCompare(b.key),
              );

      // The key count only moves when a key appears or disappears, not when a
      // value is overwritten. Without the expanded entries to compare against, a
      // write to a collapsed bucket cannot be told apart from a create — so the
      // count is left alone and corrected by the next fetch, rather than guessed.
      const keyDelta = deleted ? -1 : isExpanded && !existing ? 1 : 0;
      const known = prev.sharedStateBuckets.some((b) => b.bucket === bucket);

      let sharedStateBuckets = prev.sharedStateBuckets;
      if (keyDelta !== 0 && known) {
        sharedStateBuckets = prev.sharedStateBuckets
          .map((b) => (b.bucket === bucket ? { ...b, keyCount: Math.max(0, b.keyCount + keyDelta) } : b))
          // A bucket with no keys left no longer exists, matching the server's view.
          .filter((b) => b.keyCount > 0);
      } else if (!known && !deleted) {
        sharedStateBuckets = [...prev.sharedStateBuckets, { bucket, keyCount: 1 }].sort((a, b) =>
          a.bucket.localeCompare(b.bucket),
        );
      }

      return { sharedStateEntries, sharedStateBuckets };
    });
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
        // The chart tracks the live edge of the range regardless of table paging.
        chartRecords: appendLivePoint(record, state.chartRecords, state.chartSampling),
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
        updates.chartSampling = null;
      }
      return updates;
    });
  },
}));
