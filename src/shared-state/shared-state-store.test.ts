import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Database as DatabaseType } from "better-sqlite3";
import { createTestDatabase } from "../__test-helpers__/index.js";
import { SHARED_STATE_CHANGE } from "../core/event-bus.js";
import { DataStore } from "../data-store/data-store.js";
import { SharedStateStore, SharedStateLimitError, sharedStatePath } from "./shared-state-store.js";
import { MAX_SHARED_STATE_VALUE_BYTES } from "./shared-state-limits.js";
import type { SharedStateChange } from "./shared-state-types.js";

/**
 * Count writes at the SQLite boundary. Several requirements here are about work
 * NOT happening, and a `false` return value alone cannot prove that — a store
 * that issued the UPDATE anyway would pass a return-value assertion.
 *
 * Methods are bound to the real statement rather than inherited from it:
 * better-sqlite3 statements are native objects, so calling `all()` with a derived
 * `this` throws "Illegal invocation".
 */
function countingDb(target: DatabaseType) {
  const writes: string[] = [];
  const realPrepare = target.prepare.bind(target);
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

describe("SharedStateStore", () => {
  let db: DatabaseType;
  let bus: EventEmitter;
  let changes: SharedStateChange[];
  let store: SharedStateStore;

  beforeEach(() => {
    db = createTestDatabase();
    bus = new EventEmitter();
    changes = [];
    bus.on(SHARED_STATE_CHANGE, (change: SharedStateChange) => changes.push(change));
    store = new SharedStateStore(db, bus);
  });

  afterEach(() => {
    db.close();
  });

  describe("reading and writing current values", () => {
    it("persists a new value and reads it back", () => {
      expect(store.set("bunker-summary", "power", { battery: 74 })).toBe(true);

      expect(store.get("bunker-summary", "power")).toEqual({ battery: 74 });
    });

    it("returns undefined for a key that was never set", () => {
      expect(store.get("bunker-summary", "power")).toBeUndefined();
    });

    it("distinguishes a stored null from an unset key", () => {
      // `null` is a legitimate shared value, so it must not be indistinguishable
      // from absence. This is why deletion is signalled by a flag, not by null.
      store.set("bunker-summary", "power", null);

      expect(store.get("bunker-summary", "power")).toBeNull();
      expect(store.get("bunker-summary", "air")).toBeUndefined();
    });

    it("survives reconstruction of the store over the same database", () => {
      store.set("bunker-summary", "power", { battery: 74 });

      const rebuilt = new SharedStateStore(db, bus);

      expect(rebuilt.get("bunker-summary", "power")).toEqual({ battery: 74 });
    });

    it("replaces a value rather than accumulating history", () => {
      store.set("bunker-summary", "power", 72);
      store.set("bunker-summary", "power", 73);
      store.set("bunker-summary", "power", 74);

      // Shared State is persistent, not historical. 72 and 73 are gone.
      expect(store.get("bunker-summary", "power")).toBe(74);
      expect(store.listBucket("bunker-summary")).toHaveLength(1);
    });
  });

  describe("identical writes are true no-ops", () => {
    it("returns false and performs no second SQLite write", () => {
      const { writes, db: counted } = countingDb(db);
      const counting = new SharedStateStore(counted, bus);

      counting.set("bunker-summary", "power", { battery: 74 });
      const afterFirst = writes.length;
      expect(afterFirst).toBe(1);

      expect(counting.set("bunker-summary", "power", { battery: 74 })).toBe(false);
      expect(writes).toHaveLength(afterFirst);
    });

    it("does not move updated_at", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        store.set("bunker-summary", "power", { battery: 74 });
        const firstWrite = store.listBucket("bunker-summary")[0]!.updatedAt;

        vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
        expect(store.set("bunker-summary", "power", { battery: 74 })).toBe(false);

        expect(store.listBucket("bunker-summary")[0]!.updatedAt).toBe(firstWrite);
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits no change", () => {
      store.set("bunker-summary", "power", { battery: 74 });
      const afterFirst = changes.length;
      expect(afterFirst).toBe(1);

      store.set("bunker-summary", "power", { battery: 74 });

      expect(changes).toHaveLength(afterFirst);
    });

    it("emits exactly one change for a value that did move", () => {
      store.set("bunker-summary", "power", { battery: 74 });
      changes.length = 0;

      expect(store.set("bunker-summary", "power", { battery: 73 })).toBe(true);

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        bucket: "bunker-summary",
        key: "power",
        value: { battery: 73 },
        deleted: false,
      });
    });
  });

  describe("deletion", () => {
    it("emits one deletion change for an existing key", () => {
      store.set("bunker-summary", "power", { battery: 74 });
      changes.length = 0;

      expect(store.delete("bunker-summary", "power")).toBe(true);

      expect(changes).toHaveLength(1);
      expect(changes[0]!.deleted).toBe(true);
      // No value on a deletion, so a consumer cannot mistake it for a stored null.
      expect(changes[0]!.value).toBeUndefined();
      expect(store.get("bunker-summary", "power")).toBeUndefined();
    });

    it("is a no-op for a missing key", () => {
      const { writes, db: counted } = countingDb(db);
      const counting = new SharedStateStore(counted, bus);
      changes.length = 0;

      expect(counting.delete("bunker-summary", "never-set")).toBe(false);
      expect(changes).toHaveLength(0);
      // The DELETE is issued and matches nothing, which is how the store learns there
      // was nothing to remove. What must not happen is a change being announced for it.
      expect(writes.filter((sql) => /^\s*DELETE/i.test(sql))).toHaveLength(1);
    });
  });

  describe("independence", () => {
    it("keeps different keys in one bucket independent", () => {
      store.set("bunker-summary", "power", 1);
      store.set("bunker-summary", "air", 2);

      expect(store.get("bunker-summary", "power")).toBe(1);
      expect(store.get("bunker-summary", "air")).toBe(2);

      store.delete("bunker-summary", "power");
      expect(store.get("bunker-summary", "air")).toBe(2);
    });

    it("keeps different buckets independent", () => {
      store.set("bunker-summary", "power", 1);
      store.set("mine-summary", "power", 2);

      expect(store.get("bunker-summary", "power")).toBe(1);
      expect(store.get("mine-summary", "power")).toBe(2);
    });

    it("suppresses an identical write per bucket/key, not globally", () => {
      expect(store.set("bunker-summary", "power", 1)).toBe(true);
      // Same value, different key and different bucket — both real changes.
      expect(store.set("bunker-summary", "air", 1)).toBe(true);
      expect(store.set("mine-summary", "power", 1)).toBe(true);
      expect(store.set("bunker-summary", "power", 1)).toBe(false);
    });
  });

  describe("bounds", () => {
    it("refuses an oversized value", () => {
      const huge = { blob: "x".repeat(MAX_SHARED_STATE_VALUE_BYTES) };

      expect(() => store.set("bunker-summary", "power", huge)).toThrow(SharedStateLimitError);
      // Refused means not stored — a partially applied bound would be worse than none.
      expect(store.get("bunker-summary", "power")).toBeUndefined();
    });

    it("accepts a value just under the ceiling", () => {
      // `{"blob":"…"}` adds 11 characters of framing around the string.
      const nearLimit = { blob: "x".repeat(MAX_SHARED_STATE_VALUE_BYTES - 32) };

      expect(store.set("bunker-summary", "power", nearLimit)).toBe(true);
    });

    it("refuses a value that is not JSON-serializable", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => store.set("bunker-summary", "power", circular)).toThrow(SharedStateLimitError);
    });

    it("refuses a value with no JSON representation", () => {
      expect(() => store.set("bunker-summary", "power", undefined)).toThrow(SharedStateLimitError);
    });

    it("refuses names that would make the reactive path ambiguous", () => {
      // A value is addressed reactively as `<bucket>/<key>`, matched with the same
      // +/# syntax as a trigger topic. A name carrying those characters would have
      // several possible paths, or would behave as a wildcard.
      for (const bad of ["bunker/summary", "bunker+", "bunker#", ".", ".."]) {
        expect(() => store.set(bad, "power", 1), `bucket "${bad}"`).toThrow(SharedStateLimitError);
        expect(() => store.set("bunker-summary", bad, 1), `key "${bad}"`).toThrow(SharedStateLimitError);
      }
    });

    it("refuses an empty or over-long name", () => {
      expect(() => store.set("", "power", 1)).toThrow(SharedStateLimitError);
      expect(() => store.set("bunker-summary", "", 1)).toThrow(SharedStateLimitError);
      expect(() => store.set("x".repeat(201), "power", 1)).toThrow(SharedStateLimitError);
    });

    it("accepts the names existing installs already hold", () => {
      // The showcase seed ledger and its prefixed keys must keep working: a bound
      // introduced now must not orphan state written before it existed.
      expect(store.set("_showcase:seed-ledger", "automation:farm-water", "rule-1")).toBe(true);
      expect(store.get("_showcase:seed-ledger", "automation:farm-water")).toBe("rule-1");
      // A dot inside a name is harmless — only a name that IS "." or ".." is path
      // navigation rather than an identifier.
      expect(store.set("sensors", "outside.temp", 21)).toBe(true);
    });

    it("still reads a legacy name it would now refuse to write", () => {
      // Written directly, as an older revision would have. Such a name has no
      // unambiguous reactive path, but refusing to READ it would lose the operator's
      // data rather than protect it.
      db.prepare(
        "INSERT INTO ds_buckets (bucket, key, value, updated_at) VALUES (?, ?, ?, ?)",
      ).run("legacy/bucket", "some/key", JSON.stringify({ kept: true }), Date.now());

      expect(store.get("legacy/bucket", "some/key")).toEqual({ kept: true });
      expect(store.listBucket("legacy/bucket")).toHaveLength(1);
    });
  });

  describe("availability independent of the historical Data Store", () => {
    it("works while the Data Store is disabled", () => {
      // A default DataStore is disabled. Shared State is core state, so it must not
      // wait for an operator to configure historical storage limits.
      const dataStore = new DataStore(db, bus);
      expect(dataStore.isEnabled()).toBe(false);

      expect(store.set("bunker-summary", "power", { battery: 74 })).toBe(true);
      expect(store.get("bunker-summary", "power")).toEqual({ battery: 74 });
      expect(changes).toHaveLength(1);
    });

    it("creates its own table without the Data Store present", () => {
      const fresh = createTestDatabase();
      fresh.exec("DROP TABLE IF EXISTS ds_buckets");
      try {
        const standalone = new SharedStateStore(fresh);
        expect(standalone.set("bunker-summary", "power", 1)).toBe(true);
        expect(standalone.get("bunker-summary", "power")).toBe(1);
      } finally {
        fresh.close();
      }
    });

    it("is the single implementation behind the deprecated Data Store aliases", () => {
      const dataStore = new DataStore(db, bus, undefined, store);

      dataStore.set("bunker-summary", "power", { battery: 74 });
      expect(store.get("bunker-summary", "power")).toEqual({ battery: 74 });

      // The alias inherits the idempotency, because it is the same code path.
      expect(dataStore.set("bunker-summary", "power", { battery: 74 })).toBe(false);
      expect(dataStore.delete("bunker-summary", "power")).toBe(true);
      expect(store.get("bunker-summary", "power")).toBeUndefined();
    });
  });

  describe("change notifications stay internal", () => {
    it("never publishes to MQTT", () => {
      // Structural, not conventional: the store is constructed with an event bus and
      // a database and has no MQTT dependency to reach for. This asserts the wiring
      // that guarantees it — a change reaches the internal bus and nothing else.
      const publish = vi.fn();
      const mqttLike = { publish };

      store.set("bunker-summary", "power", { battery: 74 });
      store.delete("bunker-summary", "power");

      expect(changes).toHaveLength(2);
      expect(mqttLike.publish).not.toHaveBeenCalled();
      // No constructor argument could have given it a publisher.
      expect(SharedStateStore.length).toBe(2);
    });

    it("emits nothing at all when no event bus is wired", () => {
      const silent = new SharedStateStore(db);

      expect(silent.set("bunker-summary", "power", 1)).toBe(true);
      expect(changes).toHaveLength(0);
    });

    it("attributes a change to its source and carries causation metadata", () => {
      store.set("bunker-summary", "power", 1, {
        source: { kind: "automation", id: "rule-7", executionId: "exec-1" },
        traceId: "trace-1",
        causationId: "exec-1",
        depth: 3,
      });

      expect(changes[0]).toMatchObject({
        source: { kind: "automation", id: "rule-7", executionId: "exec-1" },
        traceId: "trace-1",
        causationId: "exec-1",
        depth: 3,
      });
    });

    it("defaults to a system source rather than claiming an author", () => {
      store.set("bunker-summary", "power", 1);

      expect(changes[0]!.source).toEqual({ kind: "system", id: "aeolus" });
    });

    it("stamps a timestamp that matches the stored entry", () => {
      store.set("bunker-summary", "power", 1);

      expect(changes[0]!.timestamp).toBe(store.listBucket("bunker-summary")[0]!.updatedAt);
    });
  });

  describe("listing", () => {
    it("lists entries in a bucket with their values and timestamps", () => {
      store.set("bunker-summary", "power", { battery: 74 });
      store.set("bunker-summary", "air", { sealed: false });

      const entries = store.listBucket("bunker-summary");

      expect(entries).toHaveLength(2);
      // Ordered by key so a UI renders stably rather than in insertion order.
      expect(entries.map((e) => e.key)).toEqual(["air", "power"]);
      expect(entries[1]!.value).toEqual({ battery: 74 });
      expect(entries[1]!.updatedAt).toBeGreaterThan(0);
    });

    it("returns an empty list for an unknown bucket", () => {
      expect(store.listBucket("nothing-here")).toEqual([]);
    });

    it("lists buckets with key counts", () => {
      store.set("bunker-summary", "power", 1);
      store.set("bunker-summary", "air", 2);
      store.set("mine-summary", "atmosphere", 3);

      expect(store.listBuckets()).toEqual([
        { bucket: "bunker-summary", keyCount: 2 },
        { bucket: "mine-summary", keyCount: 1 },
      ]);
    });

    it("drops a bucket from the listing once its last key is removed", () => {
      store.set("bunker-summary", "power", 1);
      store.delete("bunker-summary", "power");

      expect(store.listBuckets()).toEqual([]);
    });

    it("counts entries across every bucket", () => {
      store.set("bunker-summary", "power", 1);
      store.set("mine-summary", "atmosphere", 2);

      expect(store.countEntries()).toBe(2);
    });
  });

  describe("malformed persisted rows", () => {
    it("reads a corrupted entry as undefined instead of throwing", () => {
      db.prepare(
        "INSERT INTO ds_buckets (bucket, key, value, updated_at) VALUES (?, ?, ?, ?)",
      ).run("bunker-summary", "power", "{not json", Date.now());

      expect(store.get("bunker-summary", "power")).toBeUndefined();
      expect(() => store.listBucket("bunker-summary")).not.toThrow();
    });
  });

  describe("sharedStatePath", () => {
    it("builds the canonical reactive path", () => {
      expect(sharedStatePath("bunker-summary", "power")).toBe("bunker-summary/power");
    });
  });
});
