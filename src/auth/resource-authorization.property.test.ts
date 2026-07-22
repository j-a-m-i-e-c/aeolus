// src/auth/resource-authorization.property.test.ts
// Property-based tests for resource-level authorization: the ownership store,
// the live device-exposure resolver, and the permission resolver.
// Feature: resource-level-authorization

import { describe, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import { initSchema } from "../db/database.js";
import { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import { createResourceOwnershipStore } from "./resource-ownership-store.js";
import { createDeviceExposureResolver } from "./device-exposure-resolver.js";
import { createPermissionResolver } from "./permission-resolver.js";
import { matchesDeviceFilter } from "./device-filter.js";
import { PERMISSION_RANK, type PermissionLevel } from "./permission-service.js";

const RUNS = { numRuns: 100 };

const TAB_IDS = ["t1", "t2", "t3"] as const;
const AUTO_IDS = ["a1", "a2", "a3"] as const;
const NOW = 1_000_000;

/** Fresh in-memory DB with all tabs and automations pre-seeded (FK parents). */
function freshDb(): DatabaseType {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  const insertTab = db.prepare(
    'INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  TAB_IDS.forEach((id, i) => insertTab.run(id, id, "layout", i, 0, NOW));
  const insertRule = db.prepare(
    "INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES (?, ?, ?, ?)",
  );
  AUTO_IDS.forEach((id) => insertRule.run(id, id, "topic", NOW));
  return db;
}

// (automation, tab) subset generator.
const assignmentPairsArb = fc.uniqueArray(
  fc.tuple(fc.constantFrom(...AUTO_IDS), fc.constantFrom(...TAB_IDS)),
  { selector: (p) => `${p[0]}:${p[1]}`, maxLength: 9 },
);

// desiredByTab generator: for each tab, an arbitrary subset of automations.
const desiredByTabArb = fc.dictionary(
  fc.constantFrom(...TAB_IDS),
  fc.uniqueArray(fc.constantFrom(...AUTO_IDS), { maxLength: 3 }),
);

function toDesiredMap(dict: Record<string, string[]>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [tab, autos] of Object.entries(dict)) {
    if (autos.length > 0) m.set(tab, new Set(autos));
  }
  return m;
}

describe("Property 3: Automation exposing-tabs read consistency", () => {
  // Feature: resource-level-authorization, Property 3: querying the store for an
  // automation returns exactly the set of tab ids recorded for that automation.
  test.prop([assignmentPairsArb], RUNS)(
    "getExposingTabs returns exactly the recorded tabs",
    (pairs) => {
      const db = freshDb();
      try {
        const insert = db.prepare(
          "INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
        );
        for (const [auto, tab] of pairs) insert.run(auto, tab);
        const store = createResourceOwnershipStore(db);
        for (const auto of AUTO_IDS) {
          const expected = pairs.filter(([a]) => a === auto).map(([, t]) => t).sort();
          expect(store.getExposingTabs(auto).sort()).toEqual(expected);
        }
      } finally {
        db.close();
      }
    },
  );
});

describe("Property 9/10: Automation reconciliation matches desired set and is idempotent", () => {
  // Feature: resource-level-authorization, Property 9 & 10: after reconcileAll the
  // stored assignments equal the desired set, and re-applying changes nothing.
  test.prop([desiredByTabArb], RUNS)(
    "reconcileAll converges to the desired set idempotently",
    (dict) => {
      const db = freshDb();
      try {
        const store = createResourceOwnershipStore(db);
        const desired = toDesiredMap(dict);

        store.reconcileAll(desired);
        const after1 = snapshot(db);
        store.reconcileAll(desired);
        const after2 = snapshot(db);

        expect(after1).toEqual(expectedPairs(desired));
        expect(after2).toEqual(after1); // idempotent
      } finally {
        db.close();
      }
    },
  );
});

function snapshot(db: DatabaseType): string[] {
  const rows = db
    .prepare("SELECT automation_id, tab_id FROM automation_tab_assignments")
    .all() as { automation_id: string; tab_id: string }[];
  return rows.map((r) => `${r.automation_id}:${r.tab_id}`).sort();
}

function expectedPairs(desired: Map<string, Set<string>>): string[] {
  const out: string[] = [];
  for (const [tab, autos] of desired) for (const a of autos) out.push(`${a}:${tab}`);
  return out.sort();
}

describe("Property 11: Automation deletion cascades remove dependent assignments", () => {
  // Feature: resource-level-authorization, Property 11: deleting a tab or automation
  // removes exactly the referencing assignment rows.
  test.prop([assignmentPairsArb, fc.constantFrom(...TAB_IDS), fc.constantFrom(...AUTO_IDS)], RUNS)(
    "cascades remove referencing rows only",
    (pairs, delTab, delAuto) => {
      const db = freshDb();
      try {
        const insert = db.prepare(
          "INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
        );
        for (const [auto, tab] of pairs) insert.run(auto, tab);

        db.prepare("DELETE FROM tabs WHERE id = ?").run(delTab);
        db.prepare("DELETE FROM automation_rules WHERE id = ?").run(delAuto);

        const remaining = snapshot(db);
        const expected = pairs
          .filter(([a, t]) => t !== delTab && a !== delAuto)
          .map(([a, t]) => `${a}:${t}`)
          .sort();
        expect(remaining).toEqual(expected);
      } finally {
        db.close();
      }
    },
  );
});

// ─── Device exposure ─────────────────────────────────────────────────────────

const PANE_TYPES = ["hue-control", "kasa-control", "sensor-panel", "device-grid", "legacy-x", "automation"] as const;

const paneArb = fc.record({
  tabId: fc.constantFrom(...TAB_IDS),
  paneType: fc.constantFrom(...PANE_TYPES),
  config: fc.constantFrom({}, { deviceType: "light" }, { deviceType: "plug" }),
});

const deviceArb: fc.Arbitrary<Device> = fc.record({
  id: fc.constant("dev-x"),
  name: fc.constant("Dev"),
  type: fc.constantFrom("light", "plug", "sensor", "switch"),
  capabilities: fc.constant([] as string[]),
  state: fc.constant({} as Record<string, unknown>),
  integration: fc.constantFrom("hue", "kasa", "mqtt"),
  lastSeen: fc.constant(0),
});

describe("Property 13: Device exposure equals live purposeful-pane matches", () => {
  // Feature: resource-level-authorization, Property 13: a tab exposes a device iff it
  // has a purposeful pane matching the device; non-purposeful panes contribute nothing.
  test.prop([fc.array(paneArb, { maxLength: 8 }), deviceArb], RUNS)(
    "exposing tabs = distinct tabs with a purposeful matching pane",
    (panes, device) => {
      const db = freshDb();
      try {
        const insertPane = db.prepare(
          "INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        panes.forEach((p, i) =>
          insertPane.run(`p${i}`, p.tabId, p.paneType, JSON.stringify(p.config), 0, 0, 4, 4, NOW),
        );
        const eventBus = new EventEmitter();
        const registry = new DeviceRegistry(db, eventBus);
        registry.registerDevice(device);

        const resolver = createDeviceExposureResolver(registry, db);

        const expected = new Set<string>();
        for (const p of panes) {
          if (matchesDeviceFilter({ paneType: p.paneType, config: p.config }, device)) {
            expected.add(p.tabId);
          }
        }
        expect(resolver.getExposingTabs(device.id).sort()).toEqual([...expected].sort());
      } finally {
        db.close();
      }
    },
  );
});

describe("Property 14: Device exposure is fresh by construction", () => {
  // Feature: resource-level-authorization, Property 14: a device added after the panes
  // exist is exposed on the next evaluation with no persisted assignment.
  test.prop([fc.constantFrom(...TAB_IDS)], RUNS)(
    "a newly added matching device is exposed immediately with no writes",
    (tabId) => {
      const db = freshDb();
      try {
        db.prepare(
          "INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run("p0", tabId, "hue-control", "{}", 0, 0, 4, 4, NOW);

        const registry = new DeviceRegistry(db, new EventEmitter());
        const resolver = createDeviceExposureResolver(registry, db);

        // Not present yet → no exposure.
        expect(resolver.getExposingTabs("late-hue")).toEqual([]);

        // Add a matching device after the pane exists.
        registry.registerDevice({
          id: "late-hue", name: "Late", type: "light", capabilities: [], state: {}, integration: "hue", lastSeen: 0,
        });
        expect(resolver.getExposingTabs("late-hue")).toEqual([tabId]);

        // No persisted assignment was written for the device.
        const rows = db.prepare("SELECT COUNT(*) AS n FROM automation_tab_assignments").get() as { n: number };
        expect(rows.n).toBe(0);
      } finally {
        db.close();
      }
    },
  );
});

// ─── Permission resolver ───────────────────────────────────────────────────────

const LEVELS: PermissionLevel[] = ["read", "interact", "write"];

// group tab permission map generator
const groupPermsArb = fc.dictionary(
  fc.constantFrom(...TAB_IDS),
  fc.constantFrom<PermissionLevel>("read", "interact", "write"),
);

describe("Property 1/2: Effective permission is the most-permissive across exposing tabs, fail-closed otherwise", () => {
  // Feature: resource-level-authorization, Property 1 & 2: effective permission equals
  // the max group rank over the exposing tabs; none when the intersection is empty.
  test.prop([groupPermsArb, fc.uniqueArray(fc.constantFrom(...TAB_IDS), { maxLength: 3 })], RUNS)(
    "automation effective permission = max group rank over exposing tabs",
    (groupPerms, exposingTabs) => {
      const db = freshDb();
      try {
        // Seed a group and its per-tab permissions, and a user in that group.
        db.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("g", "g", NOW);
        db.prepare(
          "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run("u", "u", "x", "user", "g", NOW);
        const insertPerm = db.prepare(
          "INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)",
        );
        for (const [tab, level] of Object.entries(groupPerms)) insertPerm.run("g", tab, level);

        // Expose automation a1 on the chosen tabs.
        const insertA = db.prepare(
          "INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
        );
        for (const tab of exposingTabs) insertA.run("a1", tab);

        const store = createResourceOwnershipStore(db);
        const deviceResolver = createDeviceExposureResolver(new DeviceRegistry(db, new EventEmitter()), db);
        const resolver = createPermissionResolver(store, deviceResolver, db);

        // Expected: max rank over intersection of exposingTabs and group perms.
        let bestRank = 0;
        for (const tab of exposingTabs) {
          const lvl = groupPerms[tab];
          if (lvl && PERMISSION_RANK[lvl] > bestRank) bestRank = PERMISSION_RANK[lvl];
        }
        const expected = bestRank === 0 ? "none" : LEVELS.find((l) => PERMISSION_RANK[l] === bestRank)!;
        expect(resolver.effectivePermission("u", "automation", "a1")).toBe(expected);

        // hasResourcePermission agrees with the rank comparison for each level.
        for (const required of LEVELS) {
          expect(resolver.hasResourcePermission("u", "automation", "a1", required)).toBe(
            bestRank >= PERMISSION_RANK[required],
          );
        }
      } finally {
        db.close();
      }
    },
  );

  test.prop([fc.uniqueArray(fc.constantFrom(...TAB_IDS), { maxLength: 3 })], RUNS)(
    "a user with no group resolves to none and is denied",
    (exposingTabs) => {
      const db = freshDb();
      try {
        db.prepare(
          "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run("u", "u", "x", "user", null, NOW);
        const insertA = db.prepare(
          "INSERT OR IGNORE INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
        );
        for (const tab of exposingTabs) insertA.run("a1", tab);

        const store = createResourceOwnershipStore(db);
        const deviceResolver = createDeviceExposureResolver(new DeviceRegistry(db, new EventEmitter()), db);
        const resolver = createPermissionResolver(store, deviceResolver, db);

        expect(resolver.effectivePermission("u", "automation", "a1")).toBe("none");
        expect(resolver.hasResourcePermission("u", "automation", "a1", "read")).toBe(false);
      } finally {
        db.close();
      }
    },
  );
});
