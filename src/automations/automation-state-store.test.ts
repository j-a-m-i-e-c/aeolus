import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { createTestDatabase } from "../__test-helpers__/index.js";
import { AutomationStateStore } from "./automation-state-store.js";

describe("AutomationStateStore", () => {
  let db: DatabaseType;
  let store: AutomationStateStore;

  beforeEach(() => {
    db = createTestDatabase();
    store = new AutomationStateStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("persisting rule enabled/disabled state", () => {
    it("stores and retrieves enabled state for a rule", () => {
      store.set("rule-1", "enabled", true);

      expect(store.get("rule-1", "enabled")).toBe(true);
    });

    it("stores and retrieves disabled state for a rule", () => {
      store.set("rule-1", "enabled", false);

      expect(store.get("rule-1", "enabled")).toBe(false);
    });

    it("overwrites enabled state when toggled", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-1", "enabled", false);

      expect(store.get("rule-1", "enabled")).toBe(false);
    });

    it("persists state for multiple rules independently", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-2", "enabled", false);

      expect(store.get("rule-1", "enabled")).toBe(true);
      expect(store.get("rule-2", "enabled")).toBe(false);
    });

    it("returns undefined for a rule with no state", () => {
      expect(store.get("nonexistent", "enabled")).toBeUndefined();
    });

    it("returns all state for a rule via getAll", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-1", "lastRun", "2024-01-01T00:00:00Z");

      expect(store.getAll("rule-1")).toEqual({
        enabled: true,
        lastRun: "2024-01-01T00:00:00Z",
      });
    });

    it("deletes a single key without affecting other keys", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-1", "lastRun", "2024-01-01T00:00:00Z");

      store.delete("rule-1", "lastRun");

      expect(store.get("rule-1", "enabled")).toBe(true);
      expect(store.get("rule-1", "lastRun")).toBeUndefined();
    });

    it("deletes all state for a rule", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-1", "lastRun", "2024-01-01T00:00:00Z");

      store.deleteAll("rule-1");

      expect(store.getAll("rule-1")).toEqual({});
    });
  });

  describe("reading state back after re-instantiation with same database", () => {
    it("persists enabled state across store re-instantiation", () => {
      store.set("rule-1", "enabled", true);

      // Create a new store instance backed by the same database
      const store2 = new AutomationStateStore(db);
      store2.loadFromDb();

      expect(store2.get("rule-1", "enabled")).toBe(true);
    });

    it("persists disabled state across store re-instantiation", () => {
      store.set("rule-1", "enabled", false);

      const store2 = new AutomationStateStore(db);
      store2.loadFromDb();

      expect(store2.get("rule-1", "enabled")).toBe(false);
    });

    it("persists multiple rules across store re-instantiation", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-2", "enabled", false);
      store.set("rule-3", "enabled", true);

      const store2 = new AutomationStateStore(db);
      store2.loadFromDb();

      expect(store2.get("rule-1", "enabled")).toBe(true);
      expect(store2.get("rule-2", "enabled")).toBe(false);
      expect(store2.get("rule-3", "enabled")).toBe(true);
    });

    it("persists complex state values across re-instantiation", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-1", "config", { threshold: 25, unit: "celsius" });

      const store2 = new AutomationStateStore(db);
      store2.loadFromDb();

      expect(store2.get("rule-1", "enabled")).toBe(true);
      expect(store2.get("rule-1", "config")).toEqual({
        threshold: 25,
        unit: "celsius",
      });
    });

    it("reflects deletions after re-instantiation", () => {
      store.set("rule-1", "enabled", true);
      store.set("rule-2", "enabled", false);
      store.delete("rule-1", "enabled");

      const store2 = new AutomationStateStore(db);
      store2.loadFromDb();

      expect(store2.get("rule-1", "enabled")).toBeUndefined();
      expect(store2.get("rule-2", "enabled")).toBe(false);
    });
  });
});
