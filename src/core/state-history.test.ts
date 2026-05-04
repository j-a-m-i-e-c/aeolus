// src/core/state-history.test.ts — Unit tests for StateHistory service

import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { StateHistory, type HistoryEntry } from "./state-history.js";

// Mock persistDatabase to no-op in tests
vi.mock("../db/database.js", () => ({
  persistDatabase: vi.fn(),
}));

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS device_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      state TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_device_history_device_ts
    ON device_history(device_id, timestamp DESC);
  `);
}

describe("StateHistory", () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    createTable(db);
  });

  describe("record()", () => {
    it("records a state entry", () => {
      const history = new StateHistory(db, 100, 0); // no throttle
      const recorded = history.record("sensor-1", { temperature: 22 }, 1000);
      expect(recorded).toBe(true);

      const entries = history.getHistory("sensor-1");
      expect(entries).toHaveLength(1);
      expect(entries[0].deviceId).toBe("sensor-1");
      expect(entries[0].state).toEqual({ temperature: 22 });
      expect(entries[0].timestamp).toBe(1000);
    });

    it("throttles recording within the interval", () => {
      const history = new StateHistory(db, 100, 5000);
      expect(history.record("sensor-1", { temperature: 22 }, 1000)).toBe(true);
      expect(history.record("sensor-1", { temperature: 23 }, 3000)).toBe(false);
      expect(history.record("sensor-1", { temperature: 24 }, 6001)).toBe(true);

      const entries = history.getHistory("sensor-1");
      expect(entries).toHaveLength(2);
    });

    it("throttles per device independently", () => {
      const history = new StateHistory(db, 100, 5000);
      expect(history.record("sensor-1", { temperature: 22 }, 1000)).toBe(true);
      expect(history.record("sensor-2", { humidity: 50 }, 1000)).toBe(true);
      // sensor-1 throttled, sensor-2 throttled
      expect(history.record("sensor-1", { temperature: 23 }, 2000)).toBe(false);
      expect(history.record("sensor-2", { humidity: 55 }, 2000)).toBe(false);
    });

    it("prunes oldest entries when exceeding max", () => {
      const history = new StateHistory(db, 3, 0); // max 3 entries, no throttle
      history.record("sensor-1", { v: 1 }, 1000);
      history.record("sensor-1", { v: 2 }, 2000);
      history.record("sensor-1", { v: 3 }, 3000);
      history.record("sensor-1", { v: 4 }, 4000);
      history.record("sensor-1", { v: 5 }, 5000);

      const entries = history.getHistory("sensor-1", 100);
      expect(entries).toHaveLength(3);
      // Newest first
      expect(entries[0].state).toEqual({ v: 5 });
      expect(entries[1].state).toEqual({ v: 4 });
      expect(entries[2].state).toEqual({ v: 3 });
    });

    it("does not prune entries from other devices", () => {
      const history = new StateHistory(db, 2, 0);
      history.record("sensor-1", { v: 1 }, 1000);
      history.record("sensor-1", { v: 2 }, 2000);
      history.record("sensor-1", { v: 3 }, 3000); // prunes sensor-1 oldest
      history.record("sensor-2", { v: 10 }, 1000);

      expect(history.getHistory("sensor-1", 100)).toHaveLength(2);
      expect(history.getHistory("sensor-2", 100)).toHaveLength(1);
    });
  });

  describe("getHistory()", () => {
    it("returns entries newest first", () => {
      const history = new StateHistory(db, 100, 0);
      history.record("sensor-1", { v: 1 }, 1000);
      history.record("sensor-1", { v: 2 }, 2000);
      history.record("sensor-1", { v: 3 }, 3000);

      const entries = history.getHistory("sensor-1");
      expect(entries[0].timestamp).toBe(3000);
      expect(entries[1].timestamp).toBe(2000);
      expect(entries[2].timestamp).toBe(1000);
    });

    it("respects the limit parameter", () => {
      const history = new StateHistory(db, 100, 0);
      for (let i = 0; i < 10; i++) {
        history.record("sensor-1", { v: i }, i * 1000);
      }

      const entries = history.getHistory("sensor-1", 3);
      expect(entries).toHaveLength(3);
      expect(entries[0].timestamp).toBe(9000);
    });

    it("defaults to 50 entries", () => {
      const history = new StateHistory(db, 200, 0);
      for (let i = 0; i < 60; i++) {
        history.record("sensor-1", { v: i }, i * 1000);
      }

      const entries = history.getHistory("sensor-1");
      expect(entries).toHaveLength(50);
    });

    it("returns empty array for unknown device", () => {
      const history = new StateHistory(db, 100, 0);
      expect(history.getHistory("nonexistent")).toEqual([]);
    });
  });

  describe("getHistoryRange()", () => {
    it("returns entries within the time range", () => {
      const history = new StateHistory(db, 100, 0);
      history.record("sensor-1", { v: 1 }, 1000);
      history.record("sensor-1", { v: 2 }, 2000);
      history.record("sensor-1", { v: 3 }, 3000);
      history.record("sensor-1", { v: 4 }, 4000);
      history.record("sensor-1", { v: 5 }, 5000);

      const entries = history.getHistoryRange("sensor-1", 2000, 4000);
      expect(entries).toHaveLength(3);
      expect(entries[0].timestamp).toBe(4000);
      expect(entries[2].timestamp).toBe(2000);
    });

    it("returns empty array when no entries in range", () => {
      const history = new StateHistory(db, 100, 0);
      history.record("sensor-1", { v: 1 }, 1000);

      const entries = history.getHistoryRange("sensor-1", 5000, 10000);
      expect(entries).toEqual([]);
    });

    it("returns entries newest first within range", () => {
      const history = new StateHistory(db, 100, 0);
      history.record("sensor-1", { v: 1 }, 1000);
      history.record("sensor-1", { v: 2 }, 2000);
      history.record("sensor-1", { v: 3 }, 3000);

      const entries = history.getHistoryRange("sensor-1", 1000, 3000);
      expect(entries[0].timestamp).toBeGreaterThanOrEqual(entries[entries.length - 1].timestamp);
    });
  });

  describe("clearDevice()", () => {
    it("clears all history for a specific device", () => {
      const history = new StateHistory(db, 100, 0);
      history.record("sensor-1", { v: 1 }, 1000);
      history.record("sensor-1", { v: 2 }, 2000);
      history.record("sensor-2", { v: 10 }, 1000);

      const deleted = history.clearDevice("sensor-1");
      expect(deleted).toBe(2);
      expect(history.getHistory("sensor-1")).toEqual([]);
      expect(history.getHistory("sensor-2")).toHaveLength(1);
    });

    it("returns 0 for a device with no history", () => {
      const history = new StateHistory(db, 100, 0);
      expect(history.clearDevice("nonexistent")).toBe(0);
    });

    it("resets throttle so new records are accepted immediately", () => {
      const history = new StateHistory(db, 100, 5000);
      history.record("sensor-1", { v: 1 }, 1000);
      history.clearDevice("sensor-1");
      // Should record immediately since throttle was reset
      expect(history.record("sensor-1", { v: 2 }, 1500)).toBe(true);
    });
  });

  describe("clearAll()", () => {
    it("clears history for all devices", () => {
      const history = new StateHistory(db, 100, 0);
      history.record("sensor-1", { v: 1 }, 1000);
      history.record("sensor-1", { v: 2 }, 2000);
      history.record("sensor-2", { v: 10 }, 1000);
      history.record("sensor-3", { v: 20 }, 1000);

      const deleted = history.clearAll();
      expect(deleted).toBe(4);
      expect(history.getHistory("sensor-1")).toEqual([]);
      expect(history.getHistory("sensor-2")).toEqual([]);
      expect(history.getHistory("sensor-3")).toEqual([]);
    });

    it("returns 0 when no history exists", () => {
      const history = new StateHistory(db, 100, 0);
      expect(history.clearAll()).toBe(0);
    });
  });
});
