// src/auth/resource-authorization.unit.test.ts
// Focused unit tests for edge branches of the device-exposure resolver and the
// permission resolver (batch/empty/no-group paths and malformed pane config).
// Feature: resource-level-authorization

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import { initSchema } from "../db/database.js";
import { DeviceRegistry } from "../core/device-registry.js";
import { createResourceOwnershipStore } from "./resource-ownership-store.js";
import { createDeviceExposureResolver } from "./device-exposure-resolver.js";
import { createPermissionResolver } from "./permission-resolver.js";

const NOW = 1_000_000;

function freshDb(): DatabaseType {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function insertTab(db: DatabaseType, id: string): void {
  db.prepare('INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, id, "layout", 0, 0, NOW);
}

describe("DeviceExposureResolver — edge branches", () => {
  it("returns an empty map for an empty id list and for ids with no device", () => {
    const db = freshDb();
    const resolver = createDeviceExposureResolver(new DeviceRegistry(db, new EventEmitter()), db);
    expect(resolver.getExposingTabsBatch([]).size).toBe(0);
    const batch = resolver.getExposingTabsBatch(["missing"]);
    expect(batch.get("missing")).toEqual([]);
    db.close();
  });

  it("returns [] for a device that is not in the registry", () => {
    const db = freshDb();
    const resolver = createDeviceExposureResolver(new DeviceRegistry(db, new EventEmitter()), db);
    expect(resolver.getExposingTabs("ghost")).toEqual([]);
    db.close();
  });

  it("normalizes malformed / empty / non-object pane config to {} without throwing", () => {
    const db = freshDb();
    insertTab(db, "t1");
    const insertPane = db.prepare(
      "INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    // Malformed JSON, empty string, JSON array, and JSON null all normalize to {}.
    insertPane.run("p1", "t1", "hue-control", "{bad json", 0, 0, 4, 4, NOW);
    insertPane.run("p2", "t1", "hue-control", "", 0, 0, 4, 4, NOW);
    insertPane.run("p3", "t1", "hue-control", "[1,2]", 0, 0, 4, 4, NOW);
    insertPane.run("p4", "t1", "hue-control", "null", 0, 0, 4, 4, NOW);

    const registry = new DeviceRegistry(db, new EventEmitter());
    registry.registerDevice({
      id: "hue-1", name: "Hue", type: "light", capabilities: [], state: {}, integration: "hue", lastSeen: 0,
    });
    const resolver = createDeviceExposureResolver(registry, db);
    // A Hue light still matches the hue-control panes despite malformed configs.
    expect(resolver.getExposingTabs("hue-1")).toEqual(["t1"]);
    db.close();
  });
});

describe("PermissionResolver — edge branches", () => {
  function buildResolver(db: DatabaseType) {
    const store = createResourceOwnershipStore(db);
    const deviceResolver = createDeviceExposureResolver(new DeviceRegistry(db, new EventEmitter()), db);
    return createPermissionResolver(store, deviceResolver, db);
  }

  it("filterByPermission returns [] for an empty id list", () => {
    const db = freshDb();
    const resolver = buildResolver(db);
    expect(resolver.filterByPermission("u", "automation", [], "read")).toEqual([]);
    db.close();
  });

  it("filterByPermission returns [] when the user has no group", () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("u", "u", "x", "user", null, NOW);
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1','a1','t',?)").run(NOW);
    const resolver = buildResolver(db);
    expect(resolver.filterByPermission("u", "automation", ["a1"], "read")).toEqual([]);
    db.close();
  });

  it("effectivePermission is 'none' for a user whose group has no permission on the exposing tabs", () => {
    const db = freshDb();
    db.prepare("INSERT INTO groups (id, name, created_at) VALUES ('g','g',?)").run(NOW);
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("u", "u", "x", "user", "g", NOW);
    insertTab(db, "t1");
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1','a1','t',?)").run(NOW);
    db.prepare("INSERT INTO automation_tab_assignments (automation_id, tab_id) VALUES ('a1','t1')").run();
    // Group has NO assignment on t1.
    const resolver = buildResolver(db);
    expect(resolver.effectivePermission("u", "automation", "a1")).toBe("none");
    expect(resolver.hasResourcePermission("u", "automation", "a1", "read")).toBe(false);
    db.close();
  });

  it("effectivePermission resolves each concrete level from the group's tab permission", () => {
    const db = freshDb();
    db.prepare("INSERT INTO groups (id, name, created_at) VALUES ('g','g',?)").run(NOW);
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("u", "u", "x", "user", "g", NOW);
    insertTab(db, "t1");
    db.prepare("INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES ('a1','a1','t',?)").run(NOW);
    db.prepare("INSERT INTO automation_tab_assignments (automation_id, tab_id) VALUES ('a1','t1')").run();
    const setPerm = db.prepare(
      "INSERT OR REPLACE INTO group_tab_assignments (group_id, tab_id, permission) VALUES ('g','t1',?)",
    );
    const resolver = buildResolver(db);
    for (const level of ["read", "interact", "write"] as const) {
      setPerm.run(level);
      expect(resolver.effectivePermission("u", "automation", "a1")).toBe(level);
    }
    db.close();
  });
});
