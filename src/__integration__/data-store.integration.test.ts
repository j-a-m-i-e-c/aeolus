// src/__integration__/data-store.integration.test.ts — Integration tests for Data Store lifecycle
// Requirements: 3.1, 3.2, 3.3, 3.4, 3.5

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  createTestDatabase,
  createTestDataStore,
  cleanup,
} from "../__test-helpers__/index.js";
import type { DataStore } from "../data-store/data-store.js";

describe("Data Store Integration", () => {
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

  describe("write-then-query round-trip (Requirement 3.1)", () => {
    it("returns written data points with correct timestamps and values", () => {
      const timestamp = Date.now();
      const payload = { temperature: 22.5, humidity: 60 };

      dataStore.write("sensors", payload, { timestamp });

      const result = dataStore.query("sensors");
      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(1);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].payload).toEqual(payload);
      expect(result.records[0].timestamp).toBe(timestamp);
      expect(result.records[0].collection).toBe("sensors");
    });

    it("returns multiple written data points in correct order", () => {
      const now = Date.now();
      dataStore.write("metrics", { value: 10 }, { timestamp: now - 2000 });
      dataStore.write("metrics", { value: 20 }, { timestamp: now - 1000 });
      dataStore.write("metrics", { value: 30 }, { timestamp: now });

      const result = dataStore.query("metrics");
      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(3);
      // Query returns records ordered by timestamp DESC
      expect(result.records[0].payload).toEqual({ value: 30 });
      expect(result.records[1].payload).toEqual({ value: 20 });
      expect(result.records[2].payload).toEqual({ value: 10 });
    });

    it("preserves tags on written data points", () => {
      const timestamp = Date.now();
      dataStore.write(
        "sensors",
        { temperature: 18.0 },
        { timestamp, tags: { location: "kitchen", device: "sensor-1" } },
      );

      const result = dataStore.query("sensors");
      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.records[0].tags).toEqual({
        location: "kitchen",
        device: "sensor-1",
      });
    });
  });

  describe("retention enforcement (Requirement 3.2)", () => {
    it("removes data points older than the retention period", () => {
      const now = Date.now();
      const oneDayMs = 86_400_000;

      // Create collection with 1-day retention
      dataStore.createCollection("short-lived", undefined, 1);

      // Write a record that is 2 days old (should be pruned)
      dataStore.write("short-lived", { value: "old" }, { timestamp: now - 2 * oneDayMs });
      // Write a record that is recent (should be kept)
      dataStore.write("short-lived", { value: "new" }, { timestamp: now });

      // Enforce retention
      dataStore.enforceRetention();

      const result = dataStore.query("short-lived");
      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(1);
      expect(result.records[0].payload).toEqual({ value: "new" });
    });

    it("does not remove data points within the retention period", () => {
      const now = Date.now();
      const oneDayMs = 86_400_000;

      // Create collection with 7-day retention
      dataStore.createCollection("weekly", undefined, 7);

      // Write records within the retention window
      dataStore.write("weekly", { value: "day1" }, { timestamp: now - 1 * oneDayMs });
      dataStore.write("weekly", { value: "day3" }, { timestamp: now - 3 * oneDayMs });
      dataStore.write("weekly", { value: "day6" }, { timestamp: now - 6 * oneDayMs });

      dataStore.enforceRetention();

      const result = dataStore.query("weekly");
      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(3);
    });
  });

  describe("retention cross-collection isolation (Requirement 3.3)", () => {
    it("retention on one collection does not affect other collections", () => {
      const now = Date.now();
      const oneDayMs = 86_400_000;

      // Create collection A with 1-day retention
      dataStore.createCollection("collection-a", undefined, 1);
      // Create collection B with no retention
      dataStore.createCollection("collection-b");

      // Write old data to both collections
      dataStore.write("collection-a", { value: "a-old" }, { timestamp: now - 2 * oneDayMs });
      dataStore.write("collection-a", { value: "a-new" }, { timestamp: now });
      dataStore.write("collection-b", { value: "b-old" }, { timestamp: now - 2 * oneDayMs });
      dataStore.write("collection-b", { value: "b-new" }, { timestamp: now });

      // Enforce retention
      dataStore.enforceRetention();

      // Collection A should have old record pruned
      const resultA = dataStore.query("collection-a");
      expect("records" in resultA).toBe(true);
      if (!("records" in resultA)) return;
      expect(resultA.total).toBe(1);
      expect(resultA.records[0].payload).toEqual({ value: "a-new" });

      // Collection B should still have both records (no retention policy)
      const resultB = dataStore.query("collection-b");
      expect("records" in resultB).toBe(true);
      if (!("records" in resultB)) return;
      expect(resultB.total).toBe(2);
    });
  });

  describe("key-value bucket overwrite (Requirement 3.4)", () => {
    it("returns only the latest value after overwrite", () => {
      dataStore.set("config", "theme", "dark");
      dataStore.set("config", "theme", "light");

      const value = dataStore.get("config", "theme");
      expect(value).toBe("light");
    });

    it("overwrites complex objects correctly", () => {
      dataStore.set("state", "device-1", { online: true, battery: 80 });
      dataStore.set("state", "device-1", { online: false, battery: 75 });

      const value = dataStore.get("state", "device-1");
      expect(value).toEqual({ online: false, battery: 75 });
    });

    it("different keys in the same bucket are independent", () => {
      dataStore.set("settings", "key-a", "value-a");
      dataStore.set("settings", "key-b", "value-b");
      dataStore.set("settings", "key-a", "value-a-updated");

      expect(dataStore.get("settings", "key-a")).toBe("value-a-updated");
      expect(dataStore.get("settings", "key-b")).toBe("value-b");
    });
  });

  describe("time range query (Requirement 3.5)", () => {
    it("returns only data points within the specified time range", () => {
      const now = Date.now();

      dataStore.write("temps", { value: 10 }, { timestamp: now - 5000 });
      dataStore.write("temps", { value: 20 }, { timestamp: now - 3000 });
      dataStore.write("temps", { value: 30 }, { timestamp: now - 1000 });

      // Query for range that includes only the middle record
      const result = dataStore.query("temps", {
        from: now - 4000,
        to: now - 2000,
      });

      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(1);
      expect(result.records[0].payload).toEqual({ value: 20 });
    });

    it("returns all records when range covers all timestamps", () => {
      const now = Date.now();

      dataStore.write("data", { v: 1 }, { timestamp: now - 3000 });
      dataStore.write("data", { v: 2 }, { timestamp: now - 2000 });
      dataStore.write("data", { v: 3 }, { timestamp: now - 1000 });

      const result = dataStore.query("data", {
        from: now - 5000,
        to: now,
      });

      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(3);
    });

    it("returns empty result when range excludes all records", () => {
      const now = Date.now();

      dataStore.write("data", { v: 1 }, { timestamp: now - 3000 });
      dataStore.write("data", { v: 2 }, { timestamp: now - 2000 });

      // Query for a range in the future
      const result = dataStore.query("data", {
        from: now + 1000,
        to: now + 5000,
      });

      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(0);
      expect(result.records).toHaveLength(0);
    });

    it("includes records at exact boundary timestamps (inclusive)", () => {
      const now = Date.now();
      const fromTs = now - 3000;
      const toTs = now - 1000;

      dataStore.write("boundary", { v: "at-from" }, { timestamp: fromTs });
      dataStore.write("boundary", { v: "middle" }, { timestamp: now - 2000 });
      dataStore.write("boundary", { v: "at-to" }, { timestamp: toTs });

      const result = dataStore.query("boundary", {
        from: fromTs,
        to: toTs,
      });

      expect("records" in result).toBe(true);
      if (!("records" in result)) return;

      expect(result.total).toBe(3);
    });
  });
});
