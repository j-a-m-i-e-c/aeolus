// frontend/src/store/data-store-store.branches.test.ts — Tests for uncovered functions and branches

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import { useDataStoreStore } from "./data-store-store";
import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);
const s = () => useDataStoreStore.getState();

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("data-store-store — uncovered functions", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    useDataStoreStore.setState({
      config: null, enabled: false, stats: null,
      collections: [], selectedCollection: null,
      records: [], recordsTotal: 0, recordsLoading: false, recordsPage: 0,
      chartRecords: [], chartTotal: 0, chartLoading: false,
      buckets: [], selectedBucket: null, bucketEntries: [],
      timeRange: "24h", queryTags: {},
    });
  });

  describe("fetchCollections", () => {
    it("stores fetched collections", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk([
        { name: "sensors", description: null, retentionDays: null, recordCount: 10, oldestRecord: null, newestRecord: null, createdAt: 0, updatedAt: 0 },
      ]));
      await s().fetchCollections();
      expect(s().collections).toHaveLength(1);
      expect(s().collections[0].name).toBe("sensors");
    });

    it("handles fetch error gracefully", async () => {
      mockAuthFetch.mockRejectedValue(new Error("offline"));
      await s().fetchCollections();
      expect(s().collections).toEqual([]);
    });
  });

  describe("fetchBuckets", () => {
    it("stores fetched buckets", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk([
        { bucket: "settings", keyCount: 5 },
        { bucket: "cache", keyCount: 3 },
      ]));
      await s().fetchBuckets();
      expect(s().buckets).toHaveLength(2);
      expect(s().buckets[0].bucket).toBe("settings");
    });

    it("handles fetch error gracefully", async () => {
      mockAuthFetch.mockRejectedValue(new Error("offline"));
      await s().fetchBuckets();
      expect(s().buckets).toEqual([]);
    });
  });

  describe("fetchBucketEntries", () => {
    it("stores fetched entries for the given bucket", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk([
        { key: "theme", value: "dark", updatedAt: 1000 },
        { key: "lang", value: "en", updatedAt: 2000 },
      ]));
      await s().fetchBucketEntries("settings");
      expect(s().bucketEntries).toHaveLength(2);
      expect(s().bucketEntries[0].key).toBe("theme");
    });

    it("clears entries on error", async () => {
      useDataStoreStore.setState({ bucketEntries: [{ key: "old", value: "x", updatedAt: 0 }] });
      mockAuthFetch.mockRejectedValue(new Error("offline"));
      await s().fetchBucketEntries("settings");
      expect(s().bucketEntries).toEqual([]);
    });
  });

  describe("fetchStats", () => {
    it("stores fetched stats", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk({
        totalRecords: 100, totalBucketEntries: 50, totalCollections: 3,
        estimatedStorageMb: 10, maxStorageMb: 100, storagePercent: 10,
      }));
      await s().fetchStats();
      expect(s().stats?.totalRecords).toBe(100);
      expect(s().stats?.storagePercent).toBe(10);
    });

    it("handles fetch error gracefully", async () => {
      mockAuthFetch.mockRejectedValue(new Error("offline"));
      await s().fetchStats();
      expect(s().stats).toBeNull();
    });
  });

  describe("selectBucket", () => {
    it("sets selected bucket and clears entries", () => {
      useDataStoreStore.setState({ bucketEntries: [{ key: "old", value: "x", updatedAt: 0 }] });
      s().selectBucket("new-bucket");
      expect(s().selectedBucket).toBe("new-bucket");
      expect(s().bucketEntries).toEqual([]);
    });

    it("sets null to deselect", () => {
      useDataStoreStore.setState({ selectedBucket: "x" });
      s().selectBucket(null);
      expect(s().selectedBucket).toBeNull();
    });
  });

  describe("fetchRecords with tags option", () => {
    it("includes tags as JSON in query string", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk({ records: [], total: 0 }));
      await s().fetchRecords("sensors", { tags: { location: "kitchen" } });
      const url = String(mockAuthFetch.mock.calls[0][0]);
      expect(url).toContain("tags=");
      expect(url).toContain("kitchen");
    });

    it("includes offset in query string", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk({ records: [], total: 0 }));
      await s().fetchRecords("sensors", { offset: 20 });
      const url = String(mockAuthFetch.mock.calls[0][0]);
      expect(url).toContain("offset=20");
    });
  });

  describe("fetchConfig error path", () => {
    it("handles config fetch error gracefully", async () => {
      mockAuthFetch.mockRejectedValue(new Error("offline"));
      await s().fetchConfig();
      expect(s().config).toBeNull();
      expect(s().enabled).toBe(false);
    });
  });
});
