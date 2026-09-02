// frontend/src/store/data-store-store.test.ts — Unit tests for the Data Store Zustand store

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/auth-fetch", () => ({ authFetch: vi.fn() }));
vi.mock("../lib/env", () => ({ API_URL: "http://test.local:3001" }));

import {
  useDataStoreStore,
  CHART_MAX_POINTS,
  RECORDS_PAGE_SIZE,
  type DataRecord,
  type CollectionMetadata,
} from "./data-store-store";
import { authFetch } from "../lib/auth-fetch";

const mockAuthFetch = vi.mocked(authFetch);
const s = () => useDataStoreStore.getState();

function record(id: number, collection: string, timestamp = id): DataRecord {
  return { id, collection, payload: {}, tags: {}, timestamp };
}

function collection(name: string, recordCount = 0): CollectionMetadata {
  return {
    name, description: null, retentionDays: null, recordCount,
    oldestRecord: null, newestRecord: null, createdAt: 0, updatedAt: 0,
  };
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("data-store-store", () => {
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

  describe("selection + pure actions", () => {
    it("selectCollection sets the name and clears prior records", () => {
      useDataStoreStore.setState({ records: [record(1, "old")], recordsTotal: 1 });
      s().selectCollection("sensors");
      expect(s().selectedCollection).toBe("sensors");
      expect(s().records).toEqual([]);
      expect(s().recordsTotal).toBe(0);
    });

    it("selectCollection also clears the chart dataset and table page", () => {
      useDataStoreStore.setState({
        chartRecords: [record(1, "old")],
        chartTotal: 1,
        recordsPage: 3,
      });
      s().selectCollection("sensors");
      expect(s().chartRecords).toEqual([]);
      expect(s().chartTotal).toBe(0);
      expect(s().recordsPage).toBe(0);
    });

    it("setTimeRange updates the range", () => {
      s().setTimeRange("7d");
      expect(s().timeRange).toBe("7d");
    });

    it("setTimeRange returns the table to its first page", () => {
      // An offset valid for the previous range is meaningless in the new one.
      useDataStoreStore.setState({ recordsPage: 3 });
      s().setTimeRange("7d");
      expect(s().recordsPage).toBe(0);
    });

    it("setRecordsPage refuses a negative page", () => {
      s().setRecordsPage(-2);
      expect(s().recordsPage).toBe(0);
    });
  });

  describe("addRealtimeRecord", () => {
    it("prepends the record when its collection is selected", () => {
      useDataStoreStore.setState({
        selectedCollection: "sensors",
        records: [record(1, "sensors")],
        recordsTotal: 1,
        collections: [collection("sensors", 1)],
      });

      s().addRealtimeRecord("sensors", record(2, "sensors", 99));

      expect(s().records.map((r) => r.id)).toEqual([2, 1]);
      expect(s().recordsTotal).toBe(2);
      expect(s().collections[0].recordCount).toBe(2);
      expect(s().collections[0].newestRecord).toBe(99);
    });

    it("updates only metadata when the collection is not selected", () => {
      useDataStoreStore.setState({
        selectedCollection: "other",
        records: [],
        collections: [collection("sensors", 5)],
      });

      s().addRealtimeRecord("sensors", record(2, "sensors"));

      expect(s().records).toEqual([]); // not prepended
      expect(s().collections[0].recordCount).toBe(6);
    });

    it("does not push a live record onto a page the user is not reading", () => {
      // The table shows one page of a newest-first query, so a new record belongs
      // on page 0 only. The total still advances so pagination stays honest.
      useDataStoreStore.setState({
        selectedCollection: "sensors",
        records: [record(1, "sensors")],
        recordsTotal: 120,
        recordsPage: 2,
        collections: [collection("sensors", 120)],
      });

      s().addRealtimeRecord("sensors", record(2, "sensors", 99));

      expect(s().records.map((r) => r.id)).toEqual([1]);
      expect(s().recordsTotal).toBe(121);
    });

    it("never grows the visible page beyond its size", () => {
      useDataStoreStore.setState({
        selectedCollection: "sensors",
        records: Array.from({ length: RECORDS_PAGE_SIZE }, (_, i) => record(i + 1, "sensors")),
        recordsTotal: RECORDS_PAGE_SIZE,
        recordsPage: 0,
        collections: [collection("sensors", RECORDS_PAGE_SIZE)],
      });

      s().addRealtimeRecord("sensors", record(999, "sensors", 99));

      expect(s().records).toHaveLength(RECORDS_PAGE_SIZE);
      expect(s().records[0].id).toBe(999);
    });

    it("extends the chart dataset regardless of the table page", () => {
      useDataStoreStore.setState({
        selectedCollection: "sensors",
        records: [],
        recordsPage: 4,
        chartRecords: [record(1, "sensors")],
        chartTotal: 1,
        collections: [collection("sensors", 1)],
      });

      s().addRealtimeRecord("sensors", record(2, "sensors", 99));

      expect(s().chartRecords.map((r) => r.id)).toEqual([2, 1]);
      expect(s().chartTotal).toBe(2);
    });

    it("keeps the chart dataset within its bound", () => {
      useDataStoreStore.setState({
        selectedCollection: "sensors",
        chartRecords: Array.from({ length: CHART_MAX_POINTS }, (_, i) => record(i + 1, "sensors")),
        chartTotal: CHART_MAX_POINTS,
        collections: [collection("sensors", CHART_MAX_POINTS)],
      });

      s().addRealtimeRecord("sensors", record(9999, "sensors", 99));

      expect(s().chartRecords).toHaveLength(CHART_MAX_POINTS);
      expect(s().chartRecords[0].id).toBe(9999);
    });
  });

  describe("removeCollection", () => {
    it("drops the collection and clears selection if it was selected", () => {
      useDataStoreStore.setState({
        collections: [collection("a"), collection("b")],
        selectedCollection: "a",
        records: [record(1, "a")],
        recordsTotal: 1,
      });

      s().removeCollection("a");

      expect(s().collections.map((c) => c.name)).toEqual(["b"]);
      expect(s().selectedCollection).toBeNull();
      expect(s().records).toEqual([]);
    });

    it("keeps selection when a different collection is removed", () => {
      useDataStoreStore.setState({
        collections: [collection("a"), collection("b")],
        selectedCollection: "b",
      });
      s().removeCollection("a");
      expect(s().selectedCollection).toBe("b");
    });
  });

  describe("fetch actions", () => {
    it("fetchConfig stores config and mirrors the enabled flag", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk({ enabled: true, maxStorageMb: 100, maxRecordsPerCollection: 1000, maxCollections: 50 }));
      await s().fetchConfig();
      expect(s().enabled).toBe(true);
      expect(s().config?.maxStorageMb).toBe(100);
    });

    it("fetchRecords builds a query string and stores the result", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk({ records: [record(1, "sensors")], total: 1 }));

      await s().fetchRecords("sensors", { limit: 10, aggregate: "avg", field: "temp", from: 100, to: 200 });

      const url = String(mockAuthFetch.mock.calls[0][0]);
      expect(url).toContain("/api/data-store/collections/sensors/records?");
      expect(url).toContain("limit=10");
      expect(url).toContain("aggregate=avg");
      expect(url).toContain("field=temp");
      expect(url).toContain("from=100");
      expect(url).toContain("to=200");
      expect(s().records).toHaveLength(1);
      expect(s().recordsTotal).toBe(1);
      expect(s().recordsLoading).toBe(false);
    });

    it("fetchRecords resets to empty on error and clears the loading flag", async () => {
      mockAuthFetch.mockResolvedValue(new Response("", { status: 500 }));
      await s().fetchRecords("sensors");
      expect(s().records).toEqual([]);
      expect(s().recordsTotal).toBe(0);
      expect(s().recordsLoading).toBe(false);
    });

    it("fetchChartRecords bounds its query and never sends a table offset", async () => {
      mockAuthFetch.mockResolvedValue(jsonOk({ records: [record(1, "sensors")], total: 8421 }));

      await s().fetchChartRecords("sensors", { from: "30d" });

      const url = String(mockAuthFetch.mock.calls[0][0]);
      expect(url).toContain("from=30d");
      expect(url).toContain(`limit=${CHART_MAX_POINTS}`);
      expect(url).not.toContain("offset=");
      expect(s().chartRecords).toHaveLength(1);
      expect(s().chartTotal).toBe(8421);
      expect(s().chartLoading).toBe(false);
    });

    it("fetchChartRecords writes only the chart dataset, leaving the table untouched", async () => {
      useDataStoreStore.setState({ records: [record(1, "sensors")], recordsTotal: 1 });
      mockAuthFetch.mockResolvedValue(jsonOk({ records: [record(2, "sensors")], total: 2 }));

      await s().fetchChartRecords("sensors", { from: "24h" });

      expect(s().records.map((r) => r.id)).toEqual([1]);
      expect(s().recordsTotal).toBe(1);
      expect(s().chartRecords.map((r) => r.id)).toEqual([2]);
    });

    it("fetchRecords writes only the table dataset, leaving the chart untouched", async () => {
      useDataStoreStore.setState({ chartRecords: [record(9, "sensors")], chartTotal: 9 });
      mockAuthFetch.mockResolvedValue(jsonOk({ records: [record(1, "sensors")], total: 1 }));

      await s().fetchRecords("sensors", { from: "24h", limit: 50, offset: 100 });

      expect(s().chartRecords.map((r) => r.id)).toEqual([9]);
      expect(s().chartTotal).toBe(9);
    });

    it("fetchChartRecords resets to empty on error and clears the loading flag", async () => {
      mockAuthFetch.mockResolvedValue(new Response("", { status: 500 }));
      await s().fetchChartRecords("sensors");
      expect(s().chartRecords).toEqual([]);
      expect(s().chartTotal).toBe(0);
      expect(s().chartLoading).toBe(false);
    });
  });
});
