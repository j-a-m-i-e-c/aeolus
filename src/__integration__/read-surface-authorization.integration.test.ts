// src/__integration__/read-surface-authorization.integration.test.ts
// Integration tests for read-surface authorization: the aggregated state endpoint,
// the device auxiliary detail reads, the automation execution history, and the
// layout endpoint are all filtered by the same server-side resource-permission
// model as the core device/automation routes. Exercises the full Express stack
// with a real in-memory SQLite database, the live DeviceRegistry, and the real
// authorization middleware.
//
// Feature: read-surface-authorization

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import request from "supertest";
import type { Express } from "express";
import {
  createTestDatabase,
  createTestApp,
  createAuthToken,
  cleanup,
} from "../__test-helpers__/index.js";

vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return { ...original, getDatabase: () => testDb };
});

let testDb: DatabaseType;

vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }),
  },
}));

const NOW = Date.now();

/**
 * Same fixed topology as resource-authorization.integration.test.ts:
 *  - group g-a; user u-user (role user) in g-a
 *  - tab-a (group has WRITE), tab-b (group has nothing)
 *  - auto-a exposed by tab-a; auto-b exposed by tab-b
 *  - dev-hue (hue light) exposed only by tab-b's hue-control pane
 *  - dev-kasa exposed by NO purposeful pane (tab-a has only a device-grid pane)
 *
 * For u-user this means: accessible tabs = {tab-a}; readable devices = {} (dev-hue
 * is on tab-b, dev-kasa on no purposeful pane); readable automations = {auto-a}.
 */
function seed(db: DatabaseType): void {
  db.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("g-a", "Group A", NOW);
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("u-user", "normaluser", "x", "user", "g-a", NOW);

  const insertTab = db.prepare(
    'INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertTab.run("tab-a", "Tab A", "layout", 0, 0, NOW);
  insertTab.run("tab-b", "Tab B", "layout", 1, 0, NOW);

  db.prepare(
    "INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)",
  ).run("g-a", "tab-a", "write");

  const insertRule = db.prepare(
    "INSERT INTO automation_rules (id, name, trigger_topic, created_at) VALUES (?, ?, ?, ?)",
  );
  insertRule.run("auto-a", "Automation A", "topic/a", NOW);
  insertRule.run("auto-b", "Automation B", "topic/b", NOW);

  const insertAssignment = db.prepare(
    "INSERT INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)",
  );
  insertAssignment.run("auto-a", "tab-a");
  insertAssignment.run("auto-b", "tab-b");

  const insertDevice = db.prepare(
    "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertDevice.run("dev-hue", "Hue Light", "light", "[]", "{}", "hue", NOW);
  insertDevice.run("dev-kasa", "Kasa Plug", "plug", "[]", "{}", "kasa", NOW);

  const insertPane = db.prepare(
    "INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insertPane.run("pane-b-hue", "tab-b", "hue-control", "{}", 0, 0, 6, 4, NOW);
  insertPane.run("pane-a-grid", "tab-a", "device-grid", "{}", 0, 0, 12, 5, NOW);
}

const userToken = () => createAuthToken({ userId: "u-user", username: "normaluser", role: "user", groupId: "g-a" });
const adminToken = () => createAuthToken({ userId: "u-admin", role: "admin" });
// A role=user token whose user id has no row (and thus no group) → no access.
const grouplessToken = () => createAuthToken({ userId: "u-ghost", username: "ghost", role: "user", groupId: null });

describe("Read-surface authorization (integration)", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let app: Express;

  beforeEach(() => {
    db = createTestDatabase();
    testDb = db;
    seed(db);
    eventBus = new EventEmitter();
    app = createTestApp(db, eventBus);
  });

  afterEach(() => {
    cleanup({ databases: [db] });
  });

  describe("GET /api/state (R1)", () => {
    it("returns every device for an admin", async () => {
      const res = await request(app).get("/api/state").set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body as object).sort()).toEqual(["dev-hue", "dev-kasa"]);
    });

    it("returns only readable devices for a non-admin (empty here) and matches GET /api/devices", async () => {
      const stateRes = await request(app).get("/api/state").set("Authorization", `Bearer ${userToken()}`);
      expect(stateRes.status).toBe(200);
      expect(Object.keys(stateRes.body as object)).toEqual([]);

      const devRes = await request(app).get("/api/devices").set("Authorization", `Bearer ${userToken()}`);
      const devIds = (devRes.body as Array<{ id: string }>).map((d) => d.id);
      expect(Object.keys(stateRes.body as object).sort()).toEqual(devIds.sort());
    });
  });

  describe("Device auxiliary reads (R3)", () => {
    it("denies a non-admin the action catalog of a device it cannot read (403)", async () => {
      const res = await request(app)
        .get("/api/devices/dev-hue/actions")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it("denies a non-admin the history of a device it cannot read (403)", async () => {
      const res = await request(app)
        .get("/api/devices/dev-hue/history")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it("denies a non-admin the completion tiers of a device it cannot read (403)", async () => {
      const res = await request(app)
        .get("/api/devices/dev-hue/completion-tiers")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 (not 403) for a missing device before evaluating permission", async () => {
      const res = await request(app)
        .get("/api/devices/missing/actions")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(404);
    });

    it("lets an admin read the action catalog and history of any device", async () => {
      const actions = await request(app)
        .get("/api/devices/dev-hue/actions")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(actions.status).toBe(200);

      const history = await request(app)
        .get("/api/devices/dev-hue/history")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(history.status).toBe(200);
    });
  });

  describe("GET /api/automations/history (R4)", () => {
    it("returns 403 on a ruleId the non-admin cannot read", async () => {
      const res = await request(app)
        .get("/api/automations/history?ruleId=auto-b")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it("allows a ruleId the non-admin can read", async () => {
      const res = await request(app)
        .get("/api/automations/history?ruleId=auto-a")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("lets an admin read any rule's history", async () => {
      const res = await request(app)
        .get("/api/automations/history?ruleId=auto-b")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/layout (R5)", () => {
    it("returns every tab and pane for an admin", async () => {
      const res = await request(app).get("/api/layout").set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      const tabIds = (res.body.tabs as Array<{ id: string }>).map((t) => t.id).sort();
      expect(tabIds).toEqual(["tab-a", "tab-b"]);
      expect((res.body.panes as unknown[]).length).toBe(2);
    });

    it("returns only accessible tabs and their panes for a non-admin", async () => {
      const res = await request(app).get("/api/layout").set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
      const tabIds = (res.body.tabs as Array<{ id: string }>).map((t) => t.id);
      expect(tabIds).toEqual(["tab-a"]);
      const paneIds = (res.body.panes as Array<{ id: string }>).map((p) => p.id);
      expect(paneIds).toEqual(["pane-a-grid"]);
    });

    it("returns empty tabs and panes for a groupless non-admin", async () => {
      const res = await request(app).get("/api/layout").set("Authorization", `Bearer ${grouplessToken()}`);
      expect(res.status).toBe(200);
      expect(res.body.tabs).toEqual([]);
      expect(res.body.panes).toEqual([]);
    });
  });
});
