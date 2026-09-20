// Real-isolate proof for the `shared` sandbox global (ADR-0016).
//
// Separate from the pure sandbox tests because the thing under test is the host
// callback boundary: whether `shared.set()` in authored Logic actually reaches
// SharedStateStore, what crosses back, and — critically — that `shared` exists
// when the historical Data Store is disabled. A structural assertion on the
// bootstrap source cannot answer any of those.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Database as DatabaseType } from "better-sqlite3";
import { Sandbox } from "../automations/sandbox.js";
import { SharedStateStore } from "../shared-state/shared-state-store.js";
import { MAX_SHARED_STATE_VALUE_BYTES } from "../shared-state/shared-state-limits.js";
import { SHARED_STATE_CHANGE } from "../core/event-bus.js";
import { DataStore } from "../data-store/data-store.js";
import { createTestDatabase } from "../__test-helpers__/index.js";
import type { SharedStateChange } from "../shared-state/shared-state-types.js";
import type { ActionResult, Device } from "../core/types.js";
import type { AuthorizationScope } from "../automations/automation-scope-resolver.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

const devices: Device[] = [
  { id: "light-1", name: "Light", type: "light", capabilities: ["on/off"], state: { on: false }, integration: "test", lastSeen: 1 },
];

const context = { topic: "manual/test", deviceId: "", state: {}, timestamp: Date.now() };

describe("real isolated-vm Shared State boundary", () => {
  let db: DatabaseType;
  let bus: EventEmitter;
  let changes: SharedStateChange[];
  let sharedStateStore: SharedStateStore;

  beforeEach(() => {
    db = createTestDatabase();
    bus = new EventEmitter();
    changes = [];
    bus.on(SHARED_STATE_CHANGE, (change: SharedStateChange) => changes.push(change));
    sharedStateStore = new SharedStateStore(db, bus);
  });

  afterEach(() => {
    db.close();
  });

  function makeSandbox(options?: { scope?: AuthorizationScope; dataStore?: DataStore; withSharedState?: boolean }): Sandbox {
    const commandService = {
      execute: async (): Promise<ActionResult> => ({ success: true, lifecycleState: "DISPATCHED", commandId: "cmd-1" }),
    };
    return new Sandbox({
      commandService: commandService as never,
      deviceRegistry: { getAll: () => devices } as never,
      ...(options?.withSharedState === false ? {} : { sharedStateStore }),
      ...(options?.dataStore ? { dataStore: options.dataStore } : {}),
      ...(options?.scope
        ? { scopeResolver: { resolve: () => options.scope! } as never }
        : {}),
    });
  }

  describe("availability", () => {
    realIt("exposes `shared` while the historical Data Store is disabled", async () => {
      // The point of the whole extraction: Shared State is core state, so an
      // automation must not have to wait for an operator to configure historical
      // storage limits before it can keep a durable shared value.
      const dataStore = new DataStore(db, bus);
      expect(dataStore.isEnabled()).toBe(false);

      const result = await makeSandbox({ dataStore }).execute(`
        if (typeof shared === "undefined") throw new Error("shared missing");
        if (typeof db !== "undefined") throw new Error("db should be absent while disabled");
        shared.set("bunker-summary", "power", { battery: 74 });
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("bunker-summary", "power")).toEqual({ battery: 74 });
    });

    realIt("omits `shared` entirely when no Shared State store is wired", async () => {
      // Absent rather than a silent no-op, so an author sees `undefined` instead of
      // a function that pretends to store things.
      const result = await makeSandbox({ withSharedState: false }).execute(`
        if (typeof shared !== "undefined") throw new Error("shared was fabricated");
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
    });
  });

  describe("get / set / delete cross the boundary", () => {
    realIt("writes a value that the host store can read back", async () => {
      const result = await makeSandbox().execute(`
        shared.set("bunker-summary", "power", { battery: 74, solar: 980 });
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("bunker-summary", "power")).toEqual({ battery: 74, solar: 980 });
    });

    realIt("reads a value the host wrote, as a real object rather than a Reference", async () => {
      sharedStateStore.set("bunker-summary", "power", { battery: 74, charging: true });

      const result = await makeSandbox().execute(`
        const power = shared.get("bunker-summary", "power");
        // A Reference is truthy but carries none of these properties, which is the
        // failure mode ADR-0011's transfer contract exists to prevent.
        if (power.battery !== 74) throw new Error("battery did not cross: " + JSON.stringify(power));
        if (power.charging !== true) throw new Error("boolean did not cross");
        shared.set("bunker-summary", "echo", power.battery);
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("bunker-summary", "echo")).toBe(74);
    });

    realIt("reports undefined for an unset key and null for a stored null", async () => {
      sharedStateStore.set("bunker-summary", "explicit-null", null);

      const result = await makeSandbox().execute(`
        if (shared.get("bunker-summary", "never-set") !== undefined) throw new Error("expected undefined");
        if (shared.get("bunker-summary", "explicit-null") !== null) throw new Error("expected null");
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
    });

    realIt("returns whether a write actually changed anything", async () => {
      const result = await makeSandbox().execute(`
        const first = shared.set("bunker-summary", "power", 74);
        const second = shared.set("bunker-summary", "power", 74);
        const third = shared.set("bunker-summary", "power", 73);
        if (first !== true) throw new Error("first write should change");
        if (second !== false) throw new Error("identical write should be a no-op");
        if (third !== true) throw new Error("changed write should change");
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      // Two real changes, not three writes.
      expect(changes).toHaveLength(2);
    });

    realIt("deletes a value and reports whether anything was removed", async () => {
      sharedStateStore.set("bunker-summary", "power", 74);

      const result = await makeSandbox().execute(`
        const removed = shared.delete("bunker-summary", "power");
        const again = shared.delete("bunker-summary", "power");
        if (removed !== true) throw new Error("expected removal");
        if (again !== false) throw new Error("expected no-op");
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("bunker-summary", "power")).toBeUndefined();
    });
  });

  describe("provenance", () => {
    realIt("attributes a change to the writing automation", async () => {
      await makeSandbox().execute(`
        shared.set("bunker-summary", "power", 74);
      `, context, "rule-power-control");

      expect(changes).toHaveLength(1);
      expect(changes[0]!.source).toMatchObject({ kind: "automation", id: "rule-power-control" });
    });

    realIt("stamps a causal depth so a shared-state chain can be bounded", async () => {
      await makeSandbox().execute(`
        shared.set("bunker-summary", "power", 74);
      `, context, "rule-1");

      // One deeper than the trigger that caused it. With no inbound depth the
      // trigger counts as 0, so the first write sits at 1.
      expect(changes[0]!.depth).toBe(1);
    });
  });

  describe("bounds are enforced at the boundary, not inside the isolate", () => {
    realIt("refuses an oversized value without failing the execution", async () => {
      const result = await makeSandbox().execute(`
        const huge = { blob: "x".repeat(${MAX_SHARED_STATE_VALUE_BYTES}) };
        const changed = shared.set("bunker-summary", "power", huge);
        if (changed !== false) throw new Error("oversized write should report no change");
      `, context, "rule-1");

      // The Logic keeps running (a refused write is not a crash), but nothing is
      // stored and the refusal is visible in the return value.
      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("bunker-summary", "power")).toBeUndefined();
      expect(changes).toHaveLength(0);
    });

    realIt("refuses a name that would make the reactive path ambiguous", async () => {
      const result = await makeSandbox().execute(`
        const changed = shared.set("bunker/summary", "power", 1);
        if (changed !== false) throw new Error("ambiguous bucket should be refused");
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.listBuckets()).toEqual([]);
    });
  });

  describe("automation scope", () => {
    const scoped: AuthorizationScope = {
      kind: "scoped",
      tabId: "tab-1",
      deviceIds: new Set(["light-1"]),
      collections: new Set<string>(),
    };

    realIt("refuses a scoped automation, because there is no bucket ownership model", async () => {
      // Global Shared State stays unrestricted/admin-authored territory. Granting a
      // scoped automation a slice of it would mean inferring authority from a
      // matching string prefix, which is not authority.
      const result = await makeSandbox({ scope: scoped }).execute(`
        const changed = shared.set("bunker-summary", "power", 74);
        if (changed !== false) throw new Error("scoped write should be refused");
        if (shared.get("bunker-summary", "power") !== undefined) throw new Error("scoped read should be refused");
        if (shared.delete("bunker-summary", "power") !== false) throw new Error("scoped delete should be refused");
      `, context, "rule-scoped");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("bunker-summary", "power")).toBeUndefined();
      expect(changes).toHaveLength(0);
    });

    realIt("cannot read state an unrestricted automation stored", async () => {
      sharedStateStore.set("bunker-summary", "power", { battery: 74 });

      const result = await makeSandbox({ scope: scoped }).execute(`
        if (shared.get("bunker-summary", "power") !== undefined) {
          throw new Error("scoped automation read global Shared State");
        }
      `, context, "rule-scoped");

      expect(result).toEqual({ success: true });
    });

    realIt("allows an unrestricted automation", async () => {
      const result = await makeSandbox({ scope: { kind: "unrestricted" } }).execute(`
        if (shared.set("bunker-summary", "power", 74) !== true) throw new Error("expected write");
      `, context, "rule-unrestricted");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("bunker-summary", "power")).toBe(74);
    });
  });

  describe("legacy db bucket aliases", () => {
    realIt("delegate to the same Shared State store", async () => {
      const dataStore = new DataStore(db, bus, undefined, sharedStateStore);
      dataStore.enable({ enabled: true, maxStorageMb: 100, maxRecordsPerCollection: 1000, maxCollections: 10 });

      const result = await makeSandbox({ dataStore }).execute(`
        db.set("computed", "dailyAvgKwh", 12.5);
        if (shared.get("computed", "dailyAvgKwh") !== 12.5) {
          throw new Error("db.set did not reach Shared State");
        }
        shared.set("computed", "viaShared", 1);
        if (db.get("computed", "viaShared") !== 1) {
          throw new Error("db.get did not read Shared State");
        }
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      expect(sharedStateStore.get("computed", "dailyAvgKwh")).toBe(12.5);
    });

    realIt("inherit the idempotency of the underlying store", async () => {
      const dataStore = new DataStore(db, bus, undefined, sharedStateStore);
      dataStore.enable({ enabled: true, maxStorageMb: 100, maxRecordsPerCollection: 1000, maxCollections: 10 });

      const result = await makeSandbox({ dataStore }).execute(`
        const first = db.set("computed", "x", 1);
        const second = db.set("computed", "x", 1);
        if (first !== true || second !== false) {
          throw new Error("legacy alias did not report change truthfully");
        }
      `, context, "rule-1");

      expect(result).toEqual({ success: true });
      expect(changes).toHaveLength(1);
    });
  });
});
