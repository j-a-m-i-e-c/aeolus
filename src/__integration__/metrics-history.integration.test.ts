// Integration tests for metrics history: sampling, aggregation, and time range queries
// Validates: Requirements 6.1, 6.2, 6.3
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createTestDatabase,
  createTestDataStore,
  cleanup,
} from "../__test-helpers__/index.js";
import type { DataStore } from "../data-store/data-store.js";

describe("Metrics History Integration", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let dataStore: DataStore;

  beforeEach(() => {
    db = createTestDatabase();
    eventBus = new EventEmitter();
    dataStore = createTestDataStore(db, eventBus);
  });

  afterEach(() => {
    cleanup({ dataStores: [dataStore], databases: [db] });
  });

  describe("metrics sampling and retrieval (Requirement 6.1)", () => {
    it("sampled metrics can be queried back from the metrics collection", () => {
      const now = Date.now();

      dataStore.write("metrics.cpu", { value: 45.2 }, { timestamp: now });
      dataStore.write("metrics.cpu", { value: 62.8 }, { timestamp: now + 1000 });
      dataStore.write("metrics.cpu", { value: 51.0 }, { timestamp: now + 2000 });

      const result = dataStore.query("metrics.cpu", {
        from: now,
        to: now + 2000,
      });

      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.total).toBe(3);
        expect(result.records).toHaveLength(3);

        const values = result.records.map((r) => r.payload.value);
        expect(values).toContain(45.2);
        expect(values).toContain(62.8);
        expect(values).toContain(51.0);
      }
    });

    it("metrics stored with tags can be queried by tag", () => {
      const now = Date.now();

      dataStore.write(
        "metrics.temperature",
        { value: 22.5 },
        { timestamp: now, tags: { location: "living-room" } },
      );
      dataStore.write(
        "metrics.temperature",
        { value: 18.3 },
        { timestamp: now + 1000, tags: { location: "bedroom" } },
      );
      dataStore.write(
        "metrics.temperature",
        { value: 23.1 },
        { timestamp: now + 2000, tags: { location: "living-room" } },
      );

      const result = dataStore.query("metrics.temperature", {
        from: now,
        to: now + 2000,
        tags: { location: "living-room" },
      });

      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.total).toBe(2);
        const values = result.records.map((r) => r.payload.value);
        expect(values).toContain(22.5);
        expect(values).toContain(23.1);
      }
    });

    it("querying an empty collection returns zero records", () => {
      const result = dataStore.query("metrics.nonexistent", {
        from: 0,
        to: Date.now(),
      });

      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.records).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });
  });

  describe("aggregation correctness (Requirement 6.2)", () => {
    const baseTime = 1700000000000;

    beforeEach(() => {
      // Write a known set of numeric data points
      const values = [10, 20, 30, 40, 50];
      values.forEach((v, i) => {
        dataStore.write(
          "metrics.sensor",
          { temperature: v },
          { timestamp: baseTime + i * 1000 },
        );
      });
    });

    it("avg aggregation produces mathematically correct average", () => {
      const result = dataStore.query("metrics.sensor", {
        from: baseTime,
        to: baseTime + 4000,
        aggregate: "avg",
        field: "temperature",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        // avg of [10, 20, 30, 40, 50] = 150 / 5 = 30
        expect(result.value).toBe(30);
      }
    });

    it("min aggregation returns the minimum value", () => {
      const result = dataStore.query("metrics.sensor", {
        from: baseTime,
        to: baseTime + 4000,
        aggregate: "min",
        field: "temperature",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        expect(result.value).toBe(10);
      }
    });

    it("max aggregation returns the maximum value", () => {
      const result = dataStore.query("metrics.sensor", {
        from: baseTime,
        to: baseTime + 4000,
        aggregate: "max",
        field: "temperature",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        expect(result.value).toBe(50);
      }
    });

    it("count aggregation returns the number of records", () => {
      const result = dataStore.query("metrics.sensor", {
        from: baseTime,
        to: baseTime + 4000,
        aggregate: "count",
        field: "temperature",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        expect(result.value).toBe(5);
      }
    });

    it("sum aggregation returns the correct total", () => {
      const result = dataStore.query("metrics.sensor", {
        from: baseTime,
        to: baseTime + 4000,
        aggregate: "sum",
        field: "temperature",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        // sum of [10, 20, 30, 40, 50] = 150
        expect(result.value).toBe(150);
      }
    });

    it("aggregation on subset of data produces correct result", () => {
      // Only query the first 3 data points (10, 20, 30)
      const result = dataStore.query("metrics.sensor", {
        from: baseTime,
        to: baseTime + 2000,
        aggregate: "avg",
        field: "temperature",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        // avg of [10, 20, 30] = 60 / 3 = 20
        expect(result.value).toBe(20);
      }
    });

    it("aggregation on non-existent collection returns 0", () => {
      const result = dataStore.query("metrics.nonexistent", {
        from: baseTime,
        to: baseTime + 4000,
        aggregate: "avg",
        field: "temperature",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        expect(result.value).toBe(0);
      }
    });
  });

  describe("time range query filtering (Requirement 6.3)", () => {
    const baseTime = 1700000000000;

    beforeEach(() => {
      // Write data points spread across time
      dataStore.write("metrics.humidity", { value: 40 }, { timestamp: baseTime });
      dataStore.write("metrics.humidity", { value: 45 }, { timestamp: baseTime + 10000 });
      dataStore.write("metrics.humidity", { value: 50 }, { timestamp: baseTime + 20000 });
      dataStore.write("metrics.humidity", { value: 55 }, { timestamp: baseTime + 30000 });
      dataStore.write("metrics.humidity", { value: 60 }, { timestamp: baseTime + 40000 });
    });

    it("returns only metrics within the specified time range", () => {
      // Query for the middle 3 data points
      const result = dataStore.query("metrics.humidity", {
        from: baseTime + 10000,
        to: baseTime + 30000,
      });

      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.total).toBe(3);
        const values = result.records.map((r) => r.payload.value);
        expect(values).toContain(45);
        expect(values).toContain(50);
        expect(values).toContain(55);
        // Should NOT contain the boundary-excluded values
        expect(values).not.toContain(40);
        expect(values).not.toContain(60);
      }
    });

    it("returns empty result when range contains no data", () => {
      const result = dataStore.query("metrics.humidity", {
        from: baseTime + 100000,
        to: baseTime + 200000,
      });

      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.records).toHaveLength(0);
        expect(result.total).toBe(0);
      }
    });

    it("includes boundary timestamps (inclusive range)", () => {
      // Query exactly at the timestamps of first and last points
      const result = dataStore.query("metrics.humidity", {
        from: baseTime,
        to: baseTime + 40000,
      });

      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.total).toBe(5);
        const timestamps = result.records.map((r) => r.timestamp);
        expect(timestamps).toContain(baseTime);
        expect(timestamps).toContain(baseTime + 40000);
      }
    });

    it("time range filtering works with aggregation queries", () => {
      // Aggregate only the middle 3 values: 45, 50, 55
      const result = dataStore.query("metrics.humidity", {
        from: baseTime + 10000,
        to: baseTime + 30000,
        aggregate: "avg",
        field: "value",
      });

      expect("value" in result).toBe(true);
      if ("value" in result) {
        // avg of [45, 50, 55] = 150 / 3 = 50
        expect(result.value).toBe(50);
      }
    });

    it("narrow time range returns single data point", () => {
      const result = dataStore.query("metrics.humidity", {
        from: baseTime + 20000,
        to: baseTime + 20000,
      });

      expect("records" in result).toBe(true);
      if ("records" in result) {
        expect(result.total).toBe(1);
        expect(result.records[0].payload.value).toBe(50);
        expect(result.records[0].timestamp).toBe(baseTime + 20000);
      }
    });
  });
});
