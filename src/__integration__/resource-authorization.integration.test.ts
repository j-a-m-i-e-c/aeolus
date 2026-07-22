// src/__integration__/resource-authorization.integration.test.ts
// Integration tests for resource-level authorization: device and automation routes
// are authorized against the target resource's server-side exposing tabs, never a
// caller-supplied tab id. Exercises the full Express stack with a real in-memory
// SQLite database, the live DeviceRegistry, and the real authorization middleware.
//
// Feature: resource-level-authorization

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

// Route the getDatabase() singleton at the test database so any singleton-based
// path (e.g. permission-service) reads the same data as the injected resolver.
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
 * Seed a fixed topology:
 *  - group g-a; user u-user (role user) in g-a
 *  - tab-a (group has WRITE), tab-b (group has nothing)
 *  - auto-a exposed by tab-a; auto-b exposed by tab-b
 *  - dev-hue (hue light) exposed only by tab-b's hue-control pane
 *  - dev-kasa (kasa) exposed by NO purposeful pane (tab-a only has a device-grid pane)
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

  // Devices — inserted before createTestApp so the DeviceRegistry loads them.
  const insertDevice = db.prepare(
    "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertDevice.run("dev-hue", "Hue Light", "light", "[]", "{}", "hue", NOW);
  insertDevice.run("dev-kasa", "Kasa Plug", "plug", "[]", "{}", "kasa", NOW);

  // Panes — tab-b exposes hue lights (purposeful); tab-a has only a non-purposeful
  // device-grid pane, which exposes nothing.
  const insertPane = db.prepare(
    "INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insertPane.run("pane-b-hue", "tab-b", "hue-control", "{}", 0, 0, 6, 4, NOW);
  insertPane.run("pane-a-grid", "tab-a", "device-grid", "{}", 0, 0, 12, 5, NOW);
}

const userToken = () => createAuthToken({ userId: "u-user", username: "normaluser", role: "user", groupId: "g-a" });
const adminToken = () => createAuthToken({ userId: "u-admin", role: "admin" });

describe("Resource-level authorization (integration)", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let app: Express;

  beforeEach(() => {
    db = createTestDatabase();
    testDb = db;
    seed(db);
    eventBus = new EventEmitter();
    app = createTestApp(db, eventBus); // registry.loadFromDb() picks up seeded devices
  });

  afterEach(() => {
    cleanup({ databases: [db] });
  });

  describe("Cross-tab bypass is closed (Property 12)", () => {
    it("denies a device action on a device exposed only by an unpermitted tab, even when the caller supplies a permitted tab id", async () => {
      // u-user has WRITE on tab-a, but dev-hue is exposed only by tab-b.
      const res = await request(app)
        .post("/api/devices/dev-hue/action")
        .set("Authorization", `Bearer ${userToken()}`)
        .send({ type: "toggle", tabId: "tab-a" }); // caller-supplied tab id must be ignored
      expect(res.status).toBe(403);
    });

    it("denies firing an automation exposed only by an unpermitted tab, ignoring a supplied tab id", async () => {
      const res = await request(app)
        .post("/api/automations/auto-b/fire")
        .set("Authorization", `Bearer ${userToken()}`)
        .send({ tabId: "tab-a" });
      expect(res.status).toBe(403);
    });
  });

  describe("Permitted access proceeds (R4.5, R5.5, R11.2)", () => {
    it("allows toggling an automation exposed by a tab the group can write", async () => {
      const res = await request(app)
        .patch("/api/automations/auto-a/toggle")
        .set("Authorization", `Bearer ${userToken()}`)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, enabled: false });
    });
  });

  describe("Existence before permission — 404 before 403 (Property 4)", () => {
    it("returns 404 for a missing device action target regardless of permission", async () => {
      const res = await request(app)
        .post("/api/devices/does-not-exist/action")
        .set("Authorization", `Bearer ${userToken()}`)
        .send({ type: "toggle" });
      expect(res.status).toBe(404);
    });

    it("returns 404 for a missing automation before evaluating permission", async () => {
      const res = await request(app)
        .patch("/api/automations/does-not-exist/toggle")
        .set("Authorization", `Bearer ${userToken()}`)
        .send({ enabled: true });
      expect(res.status).toBe(404);
    });
  });

  describe("Fail-closed for resources no tab exposes (R2.4, R2.5, R6.1)", () => {
    it("denies a non-admin action on a device shown only by a non-purposeful pane", async () => {
      // dev-kasa matches no purposeful pane (tab-a has only a device-grid pane).
      const res = await request(app)
        .post("/api/devices/dev-kasa/action")
        .set("Authorization", `Bearer ${userToken()}`)
        .send({ type: "toggle" });
      expect(res.status).toBe(403);
    });

    it("hides such a device from the non-admin device listing", async () => {
      const res = await request(app)
        .get("/api/devices")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((d) => d.id);
      expect(ids).not.toContain("dev-kasa");
      expect(ids).not.toContain("dev-hue"); // exposed only by tab-b
    });
  });

  describe("Admin bypass (R7)", () => {
    it("lets an admin read a device exposed by no tab the admin belongs to", async () => {
      // dev-hue is exposed only by tab-b; a non-admin would be 403, admin bypasses.
      const res = await request(app)
        .get("/api/devices/dev-hue")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: "dev-hue" });
    });

    it("lets an admin toggle an automation regardless of exposure", async () => {
      // auto-b is exposed only by tab-b; admin bypasses resource resolution.
      const res = await request(app)
        .patch("/api/automations/auto-b/toggle")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ enabled: false });
      expect(res.status).toBe(200);
    });

    it("returns 404 for an admin reading a missing device (handler 404 after authz)", async () => {
      const res = await request(app)
        .get("/api/devices/missing")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(res.status).toBe(404);
    });

    it("returns the full device and automation listings for an admin", async () => {
      const devRes = await request(app)
        .get("/api/devices")
        .set("Authorization", `Bearer ${adminToken()}`);
      const devIds = (devRes.body as Array<{ id: string }>).map((d) => d.id).sort();
      expect(devIds).toEqual(["dev-hue", "dev-kasa"]);

      const autoRes = await request(app)
        .get("/api/automations")
        .set("Authorization", `Bearer ${adminToken()}`);
      const autoIds = (autoRes.body as Array<{ id: string }>).map((a) => a.id).sort();
      expect(autoIds).toEqual(["auto-a", "auto-b"]);
    });
  });

  describe("Read filtering for non-admins (R10)", () => {
    it("returns only automations exposed by a tab the group can read", async () => {
      const res = await request(app)
        .get("/api/automations")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toEqual(["auto-a"]);
    });

    it("returns 403 on the detail read of an automation the group cannot reach", async () => {
      const res = await request(app)
        .get("/api/automations/auto-b/state")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it("returns 404 (not 403) on the detail read of a missing automation", async () => {
      const res = await request(app)
        .get("/api/automations/missing/state")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(404);
    });
  });

  describe("Destructive history routes stay admin-only (R11.1)", () => {
    it("rejects a non-admin and allows an admin without a resource check", async () => {
      const denied = await request(app)
        .delete("/api/devices/dev-hue/history")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(denied.status).toBe(403);

      const allowed = await request(app)
        .delete("/api/devices/dev-hue/history")
        .set("Authorization", `Bearer ${adminToken()}`);
      expect(allowed.status).toBe(200);
    });
  });
});
