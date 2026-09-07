// src/data-store/__tests__/data-store-query.test.ts — Unit tests for DataStore.query()

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import { DataStore } from "./data-store.js";

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("DataStore — Query Operations", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let store: DataStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    eventBus = new EventEmitter();
    store = new DataStore(db, eventBus);
    store.enable({
      enabled: true,
      maxStorageMb: 500,
      maxRecordsPerCollection: 100_000,
      maxCollections: 50,
    });
  });

  describe("non-existent collection", () => {
    it("returns empty records for non-existent collection", () => {
      const result = store.query("nonexistent");
      expect(result).toEqual({ records: [], total: 0 });
    });

    it("returns value: 0 for aggregation on non-existent collection", () => {
      const result = store.query("nonexistent", { aggregate: "count", field: "x" });
      expect(result).toEqual({ value: 0 });
    });
  });

  describe("basic query", () => {
    it("returns all records ordered by timestamp DESC", () => {
      store.write("metrics", { value: 1 }, { timestamp: 1000 });
      store.write("metrics", { value: 2 }, { timestamp: 2000 });
      store.write("metrics", { value: 3 }, { timestamp: 3000 });

      const result = store.query("metrics");
      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.records).toHaveLength(3);
        expect(result.total).toBe(3);
        expect(result.records[0].payload).toEqual({ value: 3 });
        expect(result.records[1].payload).toEqual({ value: 2 });
        expect(result.records[2].payload).toEqual({ value: 1 });
      }
    });

    it("preserves payload and tags in round-trip", () => {
      const payload = { temperature: 22.5, humidity: 65 };
      const tags = { zone: "living-room", source: "sensor-1" };
      store.write("readings", payload, { tags, timestamp: 5000 });

      const result = store.query("readings");
      if ("records" in result) {
        expect(result.records[0].payload).toEqual(payload);
        expect(result.records[0].tags).toEqual(tags);
        expect(result.records[0].timestamp).toBe(5000);
      }
    });
  });

  describe("time-range filtering", () => {
    beforeEach(() => {
      store.write("data", { v: 1 }, { timestamp: 1000 });
      store.write("data", { v: 2 }, { timestamp: 2000 });
      store.write("data", { v: 3 }, { timestamp: 3000 });
      store.write("data", { v: 4 }, { timestamp: 4000 });
      store.write("data", { v: 5 }, { timestamp: 5000 });
    });

    it("filters by from (epoch ms)", () => {
      const result = store.query("data", { from: 3000, to: 99999 });
      if ("records" in result) {
        expect(result.records).toHaveLength(3);
        expect(result.total).toBe(3);
      }
    });

    it("filters by to (epoch ms)", () => {
      const result = store.query("data", { from: 0, to: 3000 });
      if ("records" in result) {
        expect(result.records).toHaveLength(3);
        expect(result.total).toBe(3);
      }
    });

    it("filters by from and to range", () => {
      const result = store.query("data", { from: 2000, to: 4000 });
      if ("records" in result) {
        expect(result.records).toHaveLength(3);
        expect(result.records[0].payload).toEqual({ v: 4 });
        expect(result.records[2].payload).toEqual({ v: 2 });
      }
    });

    it("supports from as duration string", () => {
      // Write a record at "now - 30 minutes" and one at "now"
      const now = Date.now();
      store.write("recent", { v: "old" }, { timestamp: now - 120 * 60_000 }); // 2h ago
      store.write("recent", { v: "new" }, { timestamp: now - 10 * 60_000 }); // 10m ago

      const result = store.query("recent", { from: "1h" });
      if ("records" in result) {
        expect(result.records).toHaveLength(1);
        expect(result.records[0].payload).toEqual({ v: "new" });
      }
    });
  });

  describe("pagination", () => {
    beforeEach(() => {
      for (let i = 1; i <= 10; i++) {
        store.write("paged", { v: i }, { timestamp: i * 1000 });
      }
    });

    it("limits results", () => {
      const result = store.query("paged", { limit: 3 });
      if ("records" in result) {
        expect(result.records).toHaveLength(3);
        expect(result.total).toBe(10);
        // Newest first
        expect(result.records[0].payload).toEqual({ v: 10 });
      }
    });

    it("offsets results", () => {
      const result = store.query("paged", { limit: 3, offset: 3 });
      if ("records" in result) {
        expect(result.records).toHaveLength(3);
        expect(result.total).toBe(10);
        // After skipping 3 newest (10, 9, 8), get 7, 6, 5
        expect(result.records[0].payload).toEqual({ v: 7 });
        expect(result.records[2].payload).toEqual({ v: 5 });
      }
    });

    it("total reflects all matching records regardless of limit/offset", () => {
      const result = store.query("paged", { limit: 2, offset: 8 });
      if ("records" in result) {
        expect(result.records).toHaveLength(2);
        expect(result.total).toBe(10);
      }
    });
  });

  describe("range sampling", () => {
    /** One record every 5 minutes across `days`, newest at `now`. */
    function writeDense(collection: string, days: number, now: number): number {
      const stepMs = 5 * 60 * 1000;
      const count = Math.floor((days * 24 * 60 * 60 * 1000) / stepMs);
      for (let i = 0; i < count; i += 1) {
        store.write(collection, { v: i }, { timestamp: now - i * stepMs });
      }
      return count;
    }

    it("spreads points across the whole requested range instead of its newest edge", () => {
      // The defect this closes: a newest-first LIMIT over a 30-day range returned
      // only the most recent ~3.5 days while the axis still claimed 30 days.
      const now = 1_800_000_000_000;
      const total = writeDense("dense", 30, now);
      const from = now - 30 * 24 * 60 * 60 * 1000;

      const sampled = store.query("dense", { from, to: now, maxPoints: 500 });
      const paged = store.query("dense", { from, to: now, limit: 500 });
      if (!("records" in sampled) || !("records" in paged)) throw new Error("expected records");

      expect(sampled.total).toBe(total);
      expect(sampled.records.length).toBeLessThanOrEqual(500);
      expect(sampled.records.length).toBeGreaterThan(400);

      const spanOf = (records: typeof sampled.records) =>
        records[0].timestamp - records[records.length - 1].timestamp;
      const requestedSpan = now - from;
      // The sample reaches back across nearly the whole window; the page does not.
      expect(spanOf(sampled.records)).toBeGreaterThan(requestedSpan * 0.98);
      expect(spanOf(paged.records)).toBeLessThan(requestedSpan * 0.2);
    });

    it("reports the bucket width it used so a caller can describe the series", () => {
      const now = 1_800_000_000_000;
      writeDense("dense", 30, now);
      const from = now - 30 * 24 * 60 * 60 * 1000;

      const result = store.query("dense", { from, to: now, maxPoints: 500 });
      if (!("records" in result) || !result.sampling) throw new Error("expected sampling");

      expect(result.sampling.from).toBe(from);
      expect(result.sampling.to).toBe(now);
      // 30 days over 500 buckets is ~86.4 minutes each.
      expect(result.sampling.bucketMs).toBe(Math.ceil((now - from + 1) / 500));
    });

    it("returns real stored records rather than synthesised bucket averages", () => {
      const now = 1_800_000_000_000;
      writeDense("dense", 30, now);

      const result = store.query("dense", { from: now - 30 * 86_400_000, to: now, maxPoints: 200 });
      if (!("records" in result)) throw new Error("expected records");

      for (const record of result.records.slice(0, 20)) {
        const stored = store.query("dense", { from: record.timestamp, to: record.timestamp });
        if (!("records" in stored)) throw new Error("expected records");
        // Every point is an observation the site actually recorded, id and all.
        expect(stored.records.some((r) => r.id === record.id && r.payload.v === record.payload.v)).toBe(true);
      }
    });

    it("keeps the sample newest-first like every other record query", () => {
      const now = 1_800_000_000_000;
      writeDense("dense", 7, now);

      const result = store.query("dense", { from: now - 7 * 86_400_000, to: now, maxPoints: 50 });
      if (!("records" in result)) throw new Error("expected records");

      const timestamps = result.records.map((r) => r.timestamp);
      expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
    });

    it("does not sample when everything in the range already fits", () => {
      for (let i = 1; i <= 10; i += 1) store.write("small", { v: i }, { timestamp: i * 1000 });

      const result = store.query("small", { maxPoints: 500 });
      if (!("records" in result)) throw new Error("expected records");

      // Bucketing here would drop records that would have fitted, which is strictly
      // less faithful than returning the lot.
      expect(result.records).toHaveLength(10);
      expect(result.total).toBe(10);
      expect(result.sampling).toBeUndefined();
    });

    it("buckets the observed span when the caller does not pin a start", () => {
      const now = Date.now();
      const oldest = now - 20 * 60 * 60 * 1000;
      for (let i = 0; i < 400; i += 1) {
        store.write("unpinned", { v: i }, { timestamp: oldest + i * 180_000 });
      }

      const result = store.query("unpinned", { maxPoints: 40 });
      if (!("records" in result) || !result.sampling) throw new Error("expected sampling");

      expect(result.sampling.from).toBe(oldest);
      expect(result.records.length).toBeLessThanOrEqual(40);
      expect(result.records.length).toBeGreaterThan(30);
    });

    it("still honours tag filtering while sampling", () => {
      const now = 1_800_000_000_000;
      for (let i = 0; i < 300; i += 1) {
        store.write("mixed", { v: i }, { tags: { zone: i % 2 === 0 ? "a" : "b" }, timestamp: now - i * 60_000 });
      }

      const result = store.query("mixed", { from: now - 300 * 60_000, to: now, maxPoints: 20, tags: { zone: "a" } });
      if (!("records" in result)) throw new Error("expected records");

      expect(result.total).toBe(150);
      expect(result.records.length).toBeLessThanOrEqual(20);
      for (const record of result.records) expect(record.tags.zone).toBe("a");
    });
  });

  describe("tag filtering", () => {
    beforeEach(() => {
      store.write("tagged", { v: 1 }, { tags: { zone: "a", type: "temp" }, timestamp: 1000 });
      store.write("tagged", { v: 2 }, { tags: { zone: "b", type: "temp" }, timestamp: 2000 });
      store.write("tagged", { v: 3 }, { tags: { zone: "a", type: "humidity" }, timestamp: 3000 });
      store.write("tagged", { v: 4 }, { tags: { zone: "b", type: "humidity" }, timestamp: 4000 });
    });

    it("filters by single tag", () => {
      const result = store.query("tagged", { tags: { zone: "a" }, from: 0, to: 99999 });
      if ("records" in result) {
        expect(result.records).toHaveLength(2);
        expect(result.total).toBe(2);
      }
    });

    it("filters by multiple tags (AND logic)", () => {
      const result = store.query("tagged", { tags: { zone: "a", type: "temp" }, from: 0, to: 99999 });
      if ("records" in result) {
        expect(result.records).toHaveLength(1);
        expect(result.records[0].payload).toEqual({ v: 1 });
      }
    });

    it("returns empty when no records match tags", () => {
      const result = store.query("tagged", { tags: { zone: "c" }, from: 0, to: 99999 });
      if ("records" in result) {
        expect(result.records).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });
  });

  describe("aggregation", () => {
    beforeEach(() => {
      store.write("nums", { value: 10 }, { timestamp: 1000 });
      store.write("nums", { value: 20 }, { timestamp: 2000 });
      store.write("nums", { value: 30 }, { timestamp: 3000 });
      store.write("nums", { value: 40 }, { timestamp: 4000 });
      store.write("nums", { value: 50 }, { timestamp: 5000 });
    });

    it("computes sum", () => {
      const result = store.query("nums", { aggregate: "sum", field: "value", from: 0, to: 99999 });
      expect(result).toEqual({ value: 150 });
    });

    it("computes avg", () => {
      const result = store.query("nums", { aggregate: "avg", field: "value", from: 0, to: 99999 });
      expect(result).toEqual({ value: 30 });
    });

    it("computes min", () => {
      const result = store.query("nums", { aggregate: "min", field: "value", from: 0, to: 99999 });
      expect(result).toEqual({ value: 10 });
    });

    it("computes max", () => {
      const result = store.query("nums", { aggregate: "max", field: "value", from: 0, to: 99999 });
      expect(result).toEqual({ value: 50 });
    });

    it("computes count", () => {
      const result = store.query("nums", { aggregate: "count", field: "value", from: 0, to: 99999 });
      expect(result).toEqual({ value: 5 });
    });

    it("respects time range in aggregation", () => {
      const result = store.query("nums", { aggregate: "sum", field: "value", from: 2000, to: 4000 });
      expect(result).toEqual({ value: 90 }); // 20 + 30 + 40
    });

    it("respects tag filter in aggregation", () => {
      store.write("tagged-nums", { value: 100 }, { tags: { zone: "a" }, timestamp: 1000 });
      store.write("tagged-nums", { value: 200 }, { tags: { zone: "b" }, timestamp: 2000 });
      store.write("tagged-nums", { value: 300 }, { tags: { zone: "a" }, timestamp: 3000 });

      const result = store.query("tagged-nums", {
        aggregate: "sum",
        field: "value",
        tags: { zone: "a" },
        from: 0,
        to: 99999,
      });
      expect(result).toEqual({ value: 400 });
    });

    it("throws when aggregate is specified without field", () => {
      expect(() => store.query("nums", { aggregate: "sum" })).toThrow(
        "Aggregation requires a 'field' parameter",
      );
    });
  });
});
