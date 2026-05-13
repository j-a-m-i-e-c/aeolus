// src/data-store/__tests__/data-store-buckets.test.ts — Unit tests for key-value bucket operations

import { describe, it, expect, beforeEach, vi } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { EventEmitter } from "node:events";
import { DataStore } from "../data-store.js";

// Mock persistDatabase to no-op in tests
vi.mock("../../db/database.js", () => ({
  persistDatabase: vi.fn(),
}));

// Mock logger
vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("DataStore — Key-Value Bucket Operations", () => {
  let db: Database;
  let eventBus: EventEmitter;
  let store: DataStore;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run("PRAGMA foreign_keys = ON;");
    eventBus = new EventEmitter();
    store = new DataStore(db, eventBus);
  });

  describe("get()", () => {
    it("returns undefined for non-existent key", () => {
      expect(store.get("myBucket", "missing")).toBeUndefined();
    });

    it("returns the stored value after set", () => {
      store.set("myBucket", "greeting", "hello");
      expect(store.get("myBucket", "greeting")).toBe("hello");
    });

    it("returns parsed JSON objects", () => {
      const obj = { name: "test", count: 42, nested: { a: true } };
      store.set("myBucket", "config", obj);
      expect(store.get("myBucket", "config")).toEqual(obj);
    });

    it("returns parsed JSON arrays", () => {
      const arr = [1, 2, 3, "four"];
      store.set("myBucket", "list", arr);
      expect(store.get("myBucket", "list")).toEqual(arr);
    });

    it("handles null values", () => {
      store.set("myBucket", "empty", null);
      expect(store.get("myBucket", "empty")).toBeNull();
    });

    it("handles numeric values", () => {
      store.set("myBucket", "count", 99);
      expect(store.get("myBucket", "count")).toBe(99);
    });

    it("handles boolean values", () => {
      store.set("myBucket", "flag", true);
      expect(store.get("myBucket", "flag")).toBe(true);
    });

    it("isolates keys across different buckets", () => {
      store.set("bucket1", "key", "value1");
      store.set("bucket2", "key", "value2");
      expect(store.get("bucket1", "key")).toBe("value1");
      expect(store.get("bucket2", "key")).toBe("value2");
    });
  });

  describe("set()", () => {
    it("creates a new entry", () => {
      store.set("myBucket", "key1", "value1");
      expect(store.get("myBucket", "key1")).toBe("value1");
    });

    it("overwrites existing entry (upsert)", () => {
      store.set("myBucket", "key1", "original");
      store.set("myBucket", "key1", "updated");
      expect(store.get("myBucket", "key1")).toBe("updated");
    });

    it("implicitly creates bucket on first entry", () => {
      store.set("newBucket", "firstKey", "firstValue");
      expect(store.get("newBucket", "firstKey")).toBe("firstValue");
    });

    it("calls persistDatabase after set", async () => {
      const { persistDatabase } = await import("../../db/database.js");
      vi.mocked(persistDatabase).mockClear();
      store.set("myBucket", "key", "value");
      expect(persistDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe("delete()", () => {
    it("removes an existing entry", () => {
      store.set("myBucket", "key1", "value1");
      store.delete("myBucket", "key1");
      expect(store.get("myBucket", "key1")).toBeUndefined();
    });

    it("does not throw for non-existent key", () => {
      expect(() => store.delete("myBucket", "missing")).not.toThrow();
    });

    it("does not affect other keys in the same bucket", () => {
      store.set("myBucket", "key1", "value1");
      store.set("myBucket", "key2", "value2");
      store.delete("myBucket", "key1");
      expect(store.get("myBucket", "key2")).toBe("value2");
    });

    it("calls persistDatabase after delete", async () => {
      const { persistDatabase } = await import("../../db/database.js");
      vi.mocked(persistDatabase).mockClear();
      store.delete("myBucket", "key");
      expect(persistDatabase).toHaveBeenCalledTimes(1);
    });
  });

  describe("listBucket()", () => {
    it("returns empty array for non-existent bucket", () => {
      expect(store.listBucket("empty")).toEqual([]);
    });

    it("returns all entries in a bucket", () => {
      store.set("myBucket", "key1", "value1");
      store.set("myBucket", "key2", "value2");
      const entries = store.listBucket("myBucket");
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.key).sort()).toEqual(["key1", "key2"]);
    });

    it("returns correct value and updatedAt for each entry", () => {
      store.set("myBucket", "key1", { data: "test" });
      const entries = store.listBucket("myBucket");
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe("key1");
      expect(entries[0].value).toEqual({ data: "test" });
      expect(typeof entries[0].updatedAt).toBe("number");
      expect(entries[0].updatedAt).toBeGreaterThan(0);
    });

    it("reflects latest value after overwrite", () => {
      store.set("myBucket", "key1", "original");
      store.set("myBucket", "key1", "updated");
      const entries = store.listBucket("myBucket");
      expect(entries).toHaveLength(1);
      expect(entries[0].value).toBe("updated");
    });

    it("does not include deleted entries", () => {
      store.set("myBucket", "key1", "value1");
      store.set("myBucket", "key2", "value2");
      store.delete("myBucket", "key1");
      const entries = store.listBucket("myBucket");
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe("key2");
    });
  });

  describe("listBuckets()", () => {
    it("returns empty array when no buckets exist", () => {
      expect(store.listBuckets()).toEqual([]);
    });

    it("returns all buckets with key counts", () => {
      store.set("bucket1", "a", 1);
      store.set("bucket1", "b", 2);
      store.set("bucket2", "x", 10);
      const buckets = store.listBuckets();
      expect(buckets).toHaveLength(2);
      const sorted = buckets.sort((a, b) => a.bucket.localeCompare(b.bucket));
      expect(sorted[0]).toEqual({ bucket: "bucket1", keyCount: 2 });
      expect(sorted[1]).toEqual({ bucket: "bucket2", keyCount: 1 });
    });

    it("reflects correct count after deletes", () => {
      store.set("bucket1", "a", 1);
      store.set("bucket1", "b", 2);
      store.delete("bucket1", "a");
      const buckets = store.listBuckets();
      expect(buckets).toHaveLength(1);
      expect(buckets[0]).toEqual({ bucket: "bucket1", keyCount: 1 });
    });

    it("does not list bucket after all keys are deleted", () => {
      store.set("bucket1", "a", 1);
      store.delete("bucket1", "a");
      const buckets = store.listBuckets();
      expect(buckets).toEqual([]);
    });
  });
});
