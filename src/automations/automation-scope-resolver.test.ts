// Feature: scoped-automation-authoring — AutomationScopeResolver tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";
import { createAutomationScopeResolver } from "./automation-scope-resolver.js";
import type { DeviceExposureResolver } from "../auth/device-exposure-resolver.js";
import type { CollectionOwnershipStore } from "../auth/collection-ownership-store.js";

let db: DatabaseType;

// Fakes: the resolver only needs the tab→devices and tab→collections directions.
const deviceByTab = new Map<string, string[]>();
const collectionsByTab = new Map<string, string[]>();

const fakeDeviceExposure: DeviceExposureResolver = {
  getExposingTabs: () => [],
  getExposingTabsBatch: () => new Map(),
  getExposedDeviceIds: (tabId) => deviceByTab.get(tabId) ?? [],
};

const fakeCollectionStore: CollectionOwnershipStore = {
  getExposingTabs: () => [],
  getCollectionsForTab: (tabId) => collectionsByTab.get(tabId) ?? [],
  reconcileAll: () => {},
};

function insertRule(id: string, unrestricted: number, ownerTab: string | null): void {
  db.prepare(
    `INSERT INTO automation_rules (id, name, trigger_topic, authored_unrestricted, owner_tab_id, created_at)
     VALUES (?, ?, 't', ?, ?, ?)`,
  ).run(id, id, unrestricted, ownerTab, Date.now());
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  // Owner tabs must exist for the owner_tab_id FK.
  const insTab = db.prepare(
    "INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, 'i', 0, 0, ?)",
  );
  insTab.run("t1", "T1", Date.now());
  insTab.run("t2", "T2", Date.now());
  deviceByTab.clear();
  collectionsByTab.clear();
});

afterEach(() => db.close());

describe("AutomationScopeResolver", () => {
  it("resolves unrestricted for an admin-authored row", () => {
    insertRule("a1", 1, null);
    const r = createAutomationScopeResolver(fakeDeviceExposure, fakeCollectionStore, db);
    expect(r.resolve("a1")).toEqual({ kind: "unrestricted" });
  });

  it("resolves a scoped row to its owning tab's live device and collection sets", () => {
    insertRule("a1", 0, "t1");
    deviceByTab.set("t1", ["d1", "d2"]);
    collectionsByTab.set("t1", ["c1"]);
    const r = createAutomationScopeResolver(fakeDeviceExposure, fakeCollectionStore, db);
    const scope = r.resolve("a1");
    expect(scope.kind).toBe("scoped");
    if (scope.kind !== "scoped") return;
    expect(scope.tabId).toBe("t1");
    expect([...scope.deviceIds].sort()).toEqual(["d1", "d2"]);
    expect([...scope.collections]).toEqual(["c1"]);
  });

  it("fails closed (empty scoped) for a scoped row with no owning tab", () => {
    insertRule("a1", 0, null);
    const r = createAutomationScopeResolver(fakeDeviceExposure, fakeCollectionStore, db);
    const scope = r.resolve("a1");
    expect(scope.kind).toBe("scoped");
    if (scope.kind !== "scoped") return;
    expect(scope.tabId).toBeNull();
    expect(scope.deviceIds.size).toBe(0);
    expect(scope.collections.size).toBe(0);
  });

  it("fails closed for an unknown rule id", () => {
    const r = createAutomationScopeResolver(fakeDeviceExposure, fakeCollectionStore, db);
    expect(r.resolve("missing")).toMatchObject({ kind: "scoped", tabId: null });
  });

  // Feature: scoped-automation-authoring, Property 1: Unrestricted iff explicitly flagged
  it("resolves unrestricted iff authored_unrestricted = 1", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 1),
        fc.option(fc.constantFrom("t1", "t2"), { nil: null }),
        (unrestricted, ownerTab) => {
          db.exec("DELETE FROM automation_rules");
          insertRule("a1", unrestricted, ownerTab);
          const r = createAutomationScopeResolver(fakeDeviceExposure, fakeCollectionStore, db);
          const scope = r.resolve("a1");
          if (unrestricted === 1) {
            expect(scope.kind).toBe("unrestricted");
          } else {
            expect(scope.kind).toBe("scoped");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: scoped-automation-authoring, Property 2: Scoped device set equals the owning tab's live exposed devices
  it("scoped device set equals the owning tab's exposed devices (empty when tab null)", () => {
    fc.assert(
      fc.property(
        fc.option(fc.constant("t1"), { nil: null }),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 6 }),
        (ownerTab, devices) => {
          db.exec("DELETE FROM automation_rules");
          deviceByTab.clear();
          if (ownerTab) deviceByTab.set(ownerTab, devices);
          insertRule("a1", 0, ownerTab);
          const r = createAutomationScopeResolver(fakeDeviceExposure, fakeCollectionStore, db);
          const scope = r.resolve("a1");
          if (scope.kind !== "scoped") throw new Error("expected scoped");
          const expected = ownerTab ? new Set(devices) : new Set<string>();
          expect(scope.deviceIds).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: scoped-automation-authoring, Property 7: Fail-closed on a null owning tab
  it("a scoped row with null owner is never unrestricted and has empty sets", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string(), { maxLength: 5 }), (devices) => {
        db.exec("DELETE FROM automation_rules");
        // Even if some tab has devices, a null-owner scoped row must ignore them.
        deviceByTab.set("t1", devices);
        insertRule("a1", 0, null);
        const r = createAutomationScopeResolver(fakeDeviceExposure, fakeCollectionStore, db);
        const scope = r.resolve("a1");
        expect(scope.kind).toBe("scoped");
        if (scope.kind !== "scoped") return;
        expect(scope.tabId).toBeNull();
        expect(scope.deviceIds.size).toBe(0);
        expect(scope.collections.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});
