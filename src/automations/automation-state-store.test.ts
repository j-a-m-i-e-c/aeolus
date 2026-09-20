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

  describe("idempotent writes", () => {
    /**
     * Count writes at the SQLite boundary rather than trusting the return value
     * alone. `set()` reporting `false` while still issuing an UPDATE would pass
     * a return-value-only assertion and keep the cost this change exists to
     * remove.
     */
    function countingDb(target: DatabaseType) {
      const writes: string[] = [];
      const realPrepare = target.prepare.bind(target);
      // Methods are bound to the real statement rather than inherited from it:
      // better-sqlite3 statements are native objects, so calling `all()` with a
      // derived `this` throws "Illegal invocation".
      const prepare = (sql: string) => {
        const stmt = realPrepare(sql);
        return {
          run: (...args: never[]) => {
            if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
            return stmt.run(...args);
          },
          all: (...args: never[]) => stmt.all(...args),
          get: (...args: never[]) => stmt.get(...args),
        };
      };
      return {
        writes,
        db: new Proxy(target, {
          get: (t, p) => (p === "prepare" ? prepare : Reflect.get(t, p)),
        }) as unknown as DatabaseType,
      };
    }

    it("reports a change and writes once for a new scalar", () => {
      const { writes, db: counted } = countingDb(db);
      const counting = new AutomationStateStore(counted);

      expect(counting.set("rule-1", "battery", 100)).toBe(true);
      expect(writes).toHaveLength(1);
    });

    it("reports no change and performs no write for an identical scalar", () => {
      const { writes, db: counted } = countingDb(db);
      const counting = new AutomationStateStore(counted);

      counting.set("rule-1", "battery", 100);
      const writesAfterFirst = writes.length;

      expect(counting.set("rule-1", "battery", 100)).toBe(false);
      expect(writes).toHaveLength(writesAfterFirst);
    });

    it("reports a change and writes again for a changed scalar", () => {
      const { writes, db: counted } = countingDb(db);
      const counting = new AutomationStateStore(counted);

      counting.set("rule-1", "battery", 100);
      const writesAfterFirst = writes.length;

      expect(counting.set("rule-1", "battery", 99)).toBe(true);
      expect(writes).toHaveLength(writesAfterFirst + 1);
    });

    it("performs no write when an object serializes identically", () => {
      const { writes, db: counted } = countingDb(db);
      const counting = new AutomationStateStore(counted);

      counting.set("rule-1", "config", { threshold: 25, unit: "celsius" });
      const writesAfterFirst = writes.length;

      // A fresh object, not the same reference — equality is on the serialized
      // representation, which is what SQLite actually holds.
      expect(counting.set("rule-1", "config", { threshold: 25, unit: "celsius" })).toBe(false);
      expect(writes).toHaveLength(writesAfterFirst);
    });

    it("performs no write when a value loaded from the database is set again", () => {
      // The serialized cache has to survive a restart, or the first projection
      // after every boot would rewrite every key it touches.
      store.set("rule-1", "config", { threshold: 25, unit: "celsius" });

      const { writes, db: counted } = countingDb(db);
      const reloaded = new AutomationStateStore(counted);
      reloaded.loadFromDb();

      expect(reloaded.set("rule-1", "config", { threshold: 25, unit: "celsius" })).toBe(false);
      expect(writes).toHaveLength(0);
    });

    it("distinguishes keys and rules when suppressing identical writes", () => {
      expect(store.set("rule-1", "a", 1)).toBe(true);
      // Same value, different key — a real change for that key.
      expect(store.set("rule-1", "b", 1)).toBe(true);
      // Same value and key, different rule — private state, so also a change.
      expect(store.set("rule-2", "a", 1)).toBe(true);
      expect(store.set("rule-1", "a", 1)).toBe(false);
    });

    it("treats a re-set after a delete as a change", () => {
      store.set("rule-1", "battery", 100);
      store.delete("rule-1", "battery");

      expect(store.set("rule-1", "battery", 100)).toBe(true);
    });

    it("reports whether a delete removed anything", () => {
      store.set("rule-1", "battery", 100);

      expect(store.delete("rule-1", "battery")).toBe(true);
      expect(store.delete("rule-1", "battery")).toBe(false);
      expect(store.delete("rule-1", "never-set")).toBe(false);
    });

    it("refuses a value with no JSON representation rather than storing 'undefined'", () => {
      expect(store.set("rule-1", "nothing", undefined)).toBe(false);
      expect(store.get("rule-1", "nothing")).toBeUndefined();

      // The row must not exist at all — persisting the text "undefined" would
      // make loadFromDb() skip it as malformed on every subsequent boot.
      const row = db
        .prepare("SELECT value FROM automation_state WHERE rule_id = ? AND key = ?")
        .get("rule-1", "nothing");
      expect(row).toBeUndefined();
    });
  });
});
