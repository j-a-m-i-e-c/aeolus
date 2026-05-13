// frontend/src/store/data-store-store.ts — Zustand store for Data Store state

import { create } from "zustand";

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

// ---- API helpers ----

const API_URL =
  (import.meta as any).env?.VITE_API_URL ||
  `http://${window.location.hostname}:3001`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
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

  // Records for selected collection
  records: DataRecord[];
  recordsTotal: number;
  recordsLoading: boolean;

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
  fetchBuckets: () => Promise<void>;
  fetchBucketEntries: (bucket: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  selectCollection: (name: string | null) => void;
  selectBucket: (name: string | null) => void;
  setTimeRange: (range: string) => void;
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
      const params = new URLSearchParams();
      if (options?.from != null) params.set("from", String(options.from));
      if (options?.to != null) params.set("to", String(options.to));
      if (options?.limit != null) params.set("limit", String(options.limit));
      if (options?.offset != null) params.set("offset", String(options.offset));
      if (options?.tags) params.set("tags", JSON.stringify(options.tags));
      if (options?.aggregate) params.set("aggregate", options.aggregate);
      if (options?.field) params.set("field", options.field);

      const query = params.toString() ? `?${params.toString()}` : "";
      const result = await request<{ records: DataRecord[]; total: number }>(
        `/api/data-store/collections/${encodeURIComponent(collection)}/records${query}`,
      );
      set({ records: result.records, recordsTotal: result.total, recordsLoading: false });
    } catch (err) {
      console.warn("[data-store-store] Failed to fetch records:", err);
      set({ records: [], recordsTotal: 0, recordsLoading: false });
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
    set({ selectedCollection: name, records: [], recordsTotal: 0 });
  },

  selectBucket: (name) => {
    set({ selectedBucket: name, bucketEntries: [] });
  },

  setTimeRange: (range) => {
    set({ timeRange: range });
  },

  addRealtimeRecord: (collection, record) => {
    const state = get();
    if (state.selectedCollection === collection) {
      set({
        records: [record, ...state.records],
        recordsTotal: state.recordsTotal + 1,
      });
    }
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
      }
      return updates;
    });
  },
}));
