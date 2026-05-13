// src/data-store/__tests__/data-store-config.test.ts — Unit tests for DataStore schema and config

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

describe("DataStore — Schema and Config", () => {
  let db: Database;
  let eventBus: EventEmitter;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run("PRAGMA foreign_keys = ON;");
    eventBus = new EventEmitter();
  });

  describe("schema initialization", () => {
    it("creates ds_config table", () => {
      new DataStore(db, eventBus);
      const result = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ds_config'",
      );
      expect(result).toHaveLength(1);
      expect(result[0].values[0][0]).toBe("ds_config");
    });

    it("creates ds_collections table", () => {
      new DataStore(db, eventBus);
      const result = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ds_collections'",
      );
      expect(result).toHaveLength(1);
    });

    it("creates ds_records table", () => {
      new DataStore(db, eventBus);
      const result = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ds_records'",
      );
      expect(result).toHaveLength(1);
    });

    it("creates ds_buckets table", () => {
      new DataStore(db, eventBus);
      const result = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ds_buckets'",
      );
      expect(result).toHaveLength(1);
    });

    it("creates idx_ds_records_collection_ts index", () => {
      new DataStore(db, eventBus);
      const result = db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ds_records_collection_ts'",
      );
      expect(result).toHaveLength(1);
    });

    it("creates idx_ds_records_collection_tags index", () => {
      new DataStore(db, eventBus);
      const result = db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ds_records_collection_tags'",
      );
      expect(result).toHaveLength(1);
    });

    it("is idempotent — calling constructor twice does not error", () => {
      new DataStore(db, eventBus);
      expect(() => new DataStore(db, eventBus)).not.toThrow();
    });
  });

  describe("config defaults", () => {
    it("defaults to disabled", () => {
      const store = new DataStore(db, eventBus);
      expect(store.isEnabled()).toBe(false);
    });

    it("defaults maxStorageMb to 500", () => {
      const store = new DataStore(db, eventBus);
      expect(store.getConfig().maxStorageMb).toBe(500);
    });

    it("defaults maxRecordsPerCollection to 100_000", () => {
      const store = new DataStore(db, eventBus);
      expect(store.getConfig().maxRecordsPerCollection).toBe(100_000);
    });

    it("defaults maxCollections to 50", () => {
      const store = new DataStore(db, eventBus);
      expect(store.getConfig().maxCollections).toBe(50);
    });
  });

  describe("config override via constructor", () => {
    it("accepts partial config overrides", () => {
      const store = new DataStore(db, eventBus, { maxStorageMb: 200 });
      const config = store.getConfig();
      expect(config.maxStorageMb).toBe(200);
      expect(config.maxRecordsPerCollection).toBe(100_000); // default preserved
    });
  });

  describe("enable()", () => {
    it("sets enabled to true and persists config", () => {
      const store = new DataStore(db, eventBus);
      store.enable({
        enabled: true,
        maxStorageMb: 300,
        maxRecordsPerCollection: 50_000,
        maxCollections: 25,
      });

      expect(store.isEnabled()).toBe(true);
      expect(store.getConfig().maxStorageMb).toBe(300);

      // Verify persisted to db
      const result = db.exec("SELECT value FROM ds_config WHERE key = 'enabled'");
      expect(result[0].values[0][0]).toBe("true");
    });

    it("persists all config keys to ds_config table", () => {
      const store = new DataStore(db, eventBus);
      store.enable({
        enabled: true,
        maxStorageMb: 1000,
        maxRecordsPerCollection: 200_000,
        maxCollections: 100,
      });

      const result = db.exec("SELECT key, value FROM ds_config ORDER BY key");
      const configMap = new Map<string, string>();
      for (const row of result[0].values) {
        configMap.set(row[0] as string, row[1] as string);
      }

      expect(configMap.get("enabled")).toBe("true");
      expect(configMap.get("maxStorageMb")).toBe("1000");
      expect(configMap.get("maxRecordsPerCollection")).toBe("200000");
      expect(configMap.get("maxCollections")).toBe("100");
    });
  });

  describe("disable()", () => {
    it("sets enabled to false", () => {
      const store = new DataStore(db, eventBus);
      store.enable({
        enabled: true,
        maxStorageMb: 500,
        maxRecordsPerCollection: 100_000,
        maxCollections: 50,
      });
      store.disable();

      expect(store.isEnabled()).toBe(false);
    });

    it("persists disabled state to ds_config", () => {
      const store = new DataStore(db, eventBus);
      store.enable({
        enabled: true,
        maxStorageMb: 500,
        maxRecordsPerCollection: 100_000,
        maxCollections: 50,
      });
      store.disable();

      const result = db.exec("SELECT value FROM ds_config WHERE key = 'enabled'");
      expect(result[0].values[0][0]).toBe("false");
    });
  });

  describe("updateConfig()", () => {
    it("updates specific config fields", () => {
      const store = new DataStore(db, eventBus);
      store.updateConfig({ maxStorageMb: 1000 });

      expect(store.getConfig().maxStorageMb).toBe(1000);
      expect(store.getConfig().maxRecordsPerCollection).toBe(100_000); // unchanged
    });

    it("persists updated config to database", () => {
      const store = new DataStore(db, eventBus);
      store.updateConfig({ maxCollections: 75 });

      const result = db.exec("SELECT value FROM ds_config WHERE key = 'maxCollections'");
      expect(result[0].values[0][0]).toBe("75");
    });
  });

  describe("getConfig()", () => {
    it("returns a copy (not a reference)", () => {
      const store = new DataStore(db, eventBus);
      const config1 = store.getConfig();
      config1.maxStorageMb = 9999;

      expect(store.getConfig().maxStorageMb).toBe(500); // unchanged
    });
  });

  describe("config persistence across instances", () => {
    it("loads persisted config on construction", () => {
      // First instance: enable and configure
      const store1 = new DataStore(db, eventBus);
      store1.enable({
        enabled: true,
        maxStorageMb: 750,
        maxRecordsPerCollection: 80_000,
        maxCollections: 30,
      });

      // Second instance: should load persisted config
      const store2 = new DataStore(db, eventBus);
      const config = store2.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.maxStorageMb).toBe(750);
      expect(config.maxRecordsPerCollection).toBe(80_000);
      expect(config.maxCollections).toBe(30);
    });

    it("constructor overrides are superseded by persisted values", () => {
      // Persist config first
      const store1 = new DataStore(db, eventBus);
      store1.enable({
        enabled: true,
        maxStorageMb: 750,
        maxRecordsPerCollection: 80_000,
        maxCollections: 30,
      });

      // Constructor override should be superseded by persisted value
      const store2 = new DataStore(db, eventBus, { maxStorageMb: 200 });
      expect(store2.getConfig().maxStorageMb).toBe(750); // persisted wins
    });
  });

  describe("stub methods", () => {
    it("write() throws when disabled", () => {
      const store = new DataStore(db, eventBus);
      expect(() => store.write("test", {})).toThrow("Data Store is not enabled");
    });

    it("query() returns empty result for non-existent collection", () => {
      const store = new DataStore(db, eventBus);
      const result = store.query("test");
      expect(result).toEqual({ records: [], total: 0 });
    });

    it("get() returns undefined for non-existent key", () => {
      const store = new DataStore(db, eventBus);
      expect(store.get("bucket", "key")).toBeUndefined();
    });

    it("set() stores a value without throwing", () => {
      const store = new DataStore(db, eventBus);
      expect(() => store.set("bucket", "key", "value")).not.toThrow();
    });

    it("delete() does not throw for non-existent key", () => {
      const store = new DataStore(db, eventBus);
      expect(() => store.delete("bucket", "key")).not.toThrow();
    });

    it("listBucket() returns empty array for non-existent bucket", () => {
      const store = new DataStore(db, eventBus);
      expect(store.listBucket("bucket")).toEqual([]);
    });

    it("listBuckets() returns empty array when no buckets exist", () => {
      const store = new DataStore(db, eventBus);
      expect(store.listBuckets()).toEqual([]);
    });

    it("createCollection() creates a collection successfully", () => {
      const store = new DataStore(db, eventBus);
      expect(() => store.createCollection("test")).not.toThrow();
    });

    it("deleteCollection() throws when collection not found", () => {
      const store = new DataStore(db, eventBus);
      expect(() => store.deleteCollection("nonexistent")).toThrow("Collection not found");
    });

    it("listCollections() returns empty array when no collections exist", () => {
      const store = new DataStore(db, eventBus);
      expect(store.listCollections()).toEqual([]);
    });

    it("getStats() returns stats object", () => {
      const store = new DataStore(db, eventBus);
      const stats = store.getStats();
      expect(stats).toHaveProperty("totalRecords");
      expect(stats).toHaveProperty("totalBucketEntries");
      expect(stats).toHaveProperty("totalCollections");
      expect(stats).toHaveProperty("estimatedStorageMb");
      expect(stats).toHaveProperty("maxStorageMb");
      expect(stats).toHaveProperty("storagePercent");
    });

    it("enforceRetention() does not throw when no collections have retention", () => {
      const store = new DataStore(db, eventBus);
      expect(() => store.enforceRetention()).not.toThrow();
    });
  });

  describe("dispose()", () => {
    it("does not throw", () => {
      const store = new DataStore(db, eventBus);
      expect(() => store.dispose()).not.toThrow();
    });
  });
});
