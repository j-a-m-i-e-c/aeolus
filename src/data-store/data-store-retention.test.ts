// src/data-store/__tests__/data-store-retention.test.ts — Tests for retention enforcement

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { DataStore } from "./data-store.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("DataStore — retention enforcement", () => {
  let dataStore: DataStore;
  let eventBus: EventEmitter;
  let db: DatabaseType;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventEmitter();
    db = new Database(":memory:");
    dataStore = new DataStore(db, eventBus, {
      enabled: true,
      maxStorageMb: 500,
      maxRecordsPerCollection: 100000,
      maxCollections: 50,
    });
  });

  afterEach(() => {
    dataStore.dispose();
    db.close();
    vi.useRealTimers();
  });

  describe("enforceRetention", () => {
    it("prunes records older than retention days", () => {
      // Create a collection with 1-day retention
      dataStore.createCollection("short-lived", "Test", 1);

      // Write records with old timestamps
      const oldTimestamp = Date.now() - 2 * 86_400_000; // 2 days ago
      dataStore.write("short-lived", { value: 1 }, { timestamp: oldTimestamp });
      dataStore.write("short-lived", { value: 2 }, { timestamp: oldTimestamp - 1000 });
      // Write a recent record
      dataStore.write("short-lived", { value: 3 }, { timestamp: Date.now() });

      dataStore.enforceRetention();

      const result = dataStore.query("short-lived") as { records: unknown[]; total: number };
      expect(result.total).toBe(1); // Only the recent record remains
    });

    it("does nothing when no collections have retention policies", () => {
      dataStore.createCollection("no-retention", "Test");
      dataStore.write("no-retention", { value: 1 });

      // Should not throw
      dataStore.enforceRetention();

      const result = dataStore.query("no-retention") as { records: unknown[]; total: number };
      expect(result.total).toBe(1);
    });

    it("handles multiple collections with different retention policies", () => {
      dataStore.createCollection("short", "Short retention", 1);
      dataStore.createCollection("long", "Long retention", 30);

      const oldTimestamp = Date.now() - 5 * 86_400_000; // 5 days ago
      dataStore.write("short", { value: 1 }, { timestamp: oldTimestamp });
      dataStore.write("long", { value: 1 }, { timestamp: oldTimestamp });

      dataStore.enforceRetention();

      const shortResult = dataStore.query("short") as { records: unknown[]; total: number };
      const longResult = dataStore.query("long") as { records: unknown[]; total: number };
      expect(shortResult.total).toBe(0); // Pruned (older than 1 day)
      expect(longResult.total).toBe(1); // Kept (within 30 days)
    });
  });

  describe("startRetentionTimer / stopRetentionTimer", () => {
    it("starts a timer that calls enforceRetention periodically", () => {
      const spy = vi.spyOn(dataStore, "enforceRetention");
      dataStore.startRetentionTimer();

      // Advance by 1 hour (3_600_000 ms)
      vi.advanceTimersByTime(3_600_000);
      expect(spy).toHaveBeenCalledTimes(1);

      // Advance by another hour
      vi.advanceTimersByTime(3_600_000);
      expect(spy).toHaveBeenCalledTimes(2);

      dataStore.stopRetentionTimer();
    });

    it("stopRetentionTimer stops the periodic enforcement", () => {
      const spy = vi.spyOn(dataStore, "enforceRetention");
      dataStore.startRetentionTimer();
      dataStore.stopRetentionTimer();

      vi.advanceTimersByTime(7_200_000); // 2 hours
      expect(spy).not.toHaveBeenCalled();
    });

    it("handles enforceRetention errors gracefully in timer", () => {
      vi.spyOn(dataStore, "enforceRetention").mockImplementation(() => {
        throw new Error("retention failed");
      });
      dataStore.startRetentionTimer();

      // Should not throw
      vi.advanceTimersByTime(3_600_000);

      dataStore.stopRetentionTimer();
    });
  });

  describe("dispose", () => {
    it("stops retention timer on dispose", () => {
      dataStore.startRetentionTimer();
      dataStore.dispose();

      const spy = vi.spyOn(dataStore, "enforceRetention");
      vi.advanceTimersByTime(7_200_000);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("FIFO eviction", () => {
    it("evicts oldest records when collection exceeds maxRecordsPerCollection", () => {
      // Create a data store with very low limit
      const smallDb = new Database(":memory:");
      const smallStore = new DataStore(smallDb, eventBus, {
        enabled: true,
        maxStorageMb: 500,
        maxRecordsPerCollection: 3,
        maxCollections: 50,
      });

      smallStore.write("test", { value: 1 }, { timestamp: 1000 });
      smallStore.write("test", { value: 2 }, { timestamp: 2000 });
      smallStore.write("test", { value: 3 }, { timestamp: 3000 });
      // This should trigger eviction of the oldest
      smallStore.write("test", { value: 4 }, { timestamp: 4000 });

      const result = smallStore.query("test") as { records: Array<{ payload: { value: number } }>; total: number };
      expect(result.total).toBe(3);
      // Oldest record (value: 1) should be evicted
      const values = result.records.map(r => r.payload.value);
      expect(values).not.toContain(1);
      expect(values).toContain(4);

      smallStore.dispose();
      smallDb.close();
    });
  });

  describe("storage limit", () => {
    it("throws when storage limit is exceeded", () => {
      // Create a store with very low storage limit
      const tinyDb = new Database(":memory:");
      const tinyStore = new DataStore(tinyDb, eventBus, {
        enabled: true,
        maxStorageMb: 0, // 0 MB limit — any write should fail
        maxRecordsPerCollection: 100000,
        maxCollections: 50,
      });

      // With maxStorageMb = 0, estimated storage (0 records * 200 bytes = 0 MB) >= 0 MB
      // So the very first write should fail
      expect(() => tinyStore.write("test", { value: 1 })).toThrow("storage limit exceeded");

      tinyStore.dispose();
      tinyDb.close();
    });
  });

  describe("write — validation", () => {
    it("throws when DataStore is disabled", () => {
      dataStore.disable();
      expect(() => dataStore.write("test", { value: 1 })).toThrow("not enabled");
    });

    it("throws for non-serializable payload", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(() => dataStore.write("test", circular)).toThrow("Invalid payload");
    });
  });
});
