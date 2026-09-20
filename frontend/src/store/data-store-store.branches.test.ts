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
      sharedStateBuckets: [], selectedSharedStateBucket: null, sharedStateEntries: [],
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

  describe("fetchSharedStateBuckets", () => {
    it("stores fetched buckets", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk([
        { bucket: "settings", keyCount: 5 },
        { bucket: "cache", keyCount: 3 },
      ]));
      await s().fetchSharedStateBuckets();
      expect(s().sharedStateBuckets).toHaveLength(2);
      expect(s().sharedStateBuckets[0].bucket).toBe("settings");
    });

    it("reads from the Shared State API, not the deprecated bucket aliases", async () => {
      // Shared State is a core facility, so its API must not read as a corner of
      // historical storage (ADR-0016).
      mockAuthFetch.mockResolvedValue(jsonOk([]));
      await s().fetchSharedStateBuckets();
      expect(mockAuthFetch.mock.calls[0][0]).toMatch(/\/api\/shared-state$/);
    });

    it("handles fetch error gracefully", async () => {
      mockAuthFetch.mockRejectedValue(new Error("offline"));
      await s().fetchSharedStateBuckets();
      expect(s().sharedStateBuckets).toEqual([]);
    });
  });

  describe("fetchSharedStateEntries", () => {
    it("stores fetched entries for the given bucket", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk([
        { key: "theme", value: "dark", updatedAt: 1000 },
        { key: "lang", value: "en", updatedAt: 2000 },
      ]));
      await s().fetchSharedStateEntries("settings");
      expect(s().sharedStateEntries).toHaveLength(2);
      expect(s().sharedStateEntries[0].key).toBe("theme");
    });

    it("requests the bucket from the Shared State API, URL-encoded", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk([]));
      await s().fetchSharedStateEntries("_showcase:seed-ledger");
      expect(mockAuthFetch.mock.calls[0][0]).toContain("/api/shared-state/_showcase%3Aseed-ledger");
    });

    it("clears entries on error", async () => {
      useDataStoreStore.setState({ sharedStateEntries: [{ key: "old", value: "x", updatedAt: 0 }] });
      mockAuthFetch.mockRejectedValue(new Error("offline"));
      await s().fetchSharedStateEntries("settings");
      expect(s().sharedStateEntries).toEqual([]);
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

  describe("selectSharedStateBucket", () => {
    it("sets selected bucket and clears entries", () => {
      useDataStoreStore.setState({ sharedStateEntries: [{ key: "old", value: "x", updatedAt: 0 }] });
      s().selectSharedStateBucket("new-bucket");
      expect(s().selectedSharedStateBucket).toBe("new-bucket");
      expect(s().sharedStateEntries).toEqual([]);
    });

    it("sets null to deselect", () => {
      useDataStoreStore.setState({ selectedSharedStateBucket: "x" });
      s().selectSharedStateBucket(null);
      expect(s().selectedSharedStateBucket).toBeNull();
    });
  });

  describe("applySharedStateChange", () => {
    it("updates an existing value in the expanded bucket", () => {
      useDataStoreStore.setState({
        sharedStateBuckets: [{ bucket: "bunker-summary", keyCount: 1 }],
        selectedSharedStateBucket: "bunker-summary",
        sharedStateEntries: [{ key: "power", value: { battery: 74 }, updatedAt: 1000 }],
      });

      s().applySharedStateChange({
        bucket: "bunker-summary", key: "power", value: { battery: 73 }, deleted: false, timestamp: 2000,
      });

      expect(s().sharedStateEntries).toEqual([{ key: "power", value: { battery: 73 }, updatedAt: 2000 }]);
      // Overwriting a value does not change how many keys the bucket holds.
      expect(s().sharedStateBuckets[0].keyCount).toBe(1);
    });

    it("inserts a new key in key order and increments the count", () => {
      useDataStoreStore.setState({
        sharedStateBuckets: [{ bucket: "bunker-summary", keyCount: 1 }],
        selectedSharedStateBucket: "bunker-summary",
        sharedStateEntries: [{ key: "power", value: 1, updatedAt: 1000 }],
      });

      s().applySharedStateChange({
        bucket: "bunker-summary", key: "air", value: 2, deleted: false, timestamp: 2000,
      });

      expect(s().sharedStateEntries.map((e) => e.key)).toEqual(["air", "power"]);
      expect(s().sharedStateBuckets[0].keyCount).toBe(2);
    });

    it("removes a deleted key and decrements the count", () => {
      useDataStoreStore.setState({
        sharedStateBuckets: [{ bucket: "bunker-summary", keyCount: 2 }],
        selectedSharedStateBucket: "bunker-summary",
        sharedStateEntries: [
          { key: "air", value: 2, updatedAt: 1000 },
          { key: "power", value: 1, updatedAt: 1000 },
        ],
      });

      s().applySharedStateChange({
        bucket: "bunker-summary", key: "air", deleted: true, timestamp: 2000,
      });

      expect(s().sharedStateEntries.map((e) => e.key)).toEqual(["power"]);
      expect(s().sharedStateBuckets[0].keyCount).toBe(1);
    });

    it("drops a bucket once its last value is removed", () => {
      useDataStoreStore.setState({
        sharedStateBuckets: [{ bucket: "bunker-summary", keyCount: 1 }],
        selectedSharedStateBucket: "bunker-summary",
        sharedStateEntries: [{ key: "power", value: 1, updatedAt: 1000 }],
      });

      s().applySharedStateChange({
        bucket: "bunker-summary", key: "power", deleted: true, timestamp: 2000,
      });

      // Matches the server's view: a bucket is only a grouping of the keys it holds.
      expect(s().sharedStateBuckets).toEqual([]);
    });

    it("adds a previously unseen bucket in bucket order", () => {
      useDataStoreStore.setState({
        sharedStateBuckets: [{ bucket: "mine-summary", keyCount: 1 }],
        selectedSharedStateBucket: null,
        sharedStateEntries: [],
      });

      s().applySharedStateChange({
        bucket: "bunker-summary", key: "power", value: 1, deleted: false, timestamp: 2000,
      });

      expect(s().sharedStateBuckets.map((b) => b.bucket)).toEqual(["bunker-summary", "mine-summary"]);
    });

    it("leaves a collapsed bucket's entry list alone", () => {
      // Entries belong to whichever bucket is expanded; a change elsewhere must not
      // leak into that list.
      useDataStoreStore.setState({
        sharedStateBuckets: [
          { bucket: "bunker-summary", keyCount: 1 },
          { bucket: "mine-summary", keyCount: 1 },
        ],
        selectedSharedStateBucket: "bunker-summary",
        sharedStateEntries: [{ key: "power", value: 1, updatedAt: 1000 }],
      });

      s().applySharedStateChange({
        bucket: "mine-summary", key: "atmosphere", value: 5, deleted: false, timestamp: 2000,
      });

      expect(s().sharedStateEntries).toEqual([{ key: "power", value: 1, updatedAt: 1000 }]);
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
