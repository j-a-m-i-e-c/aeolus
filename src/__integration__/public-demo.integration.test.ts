// src/__integration__/public-demo.integration.test.ts
//
// Feature: public-demo-mode. Exercises the fail-closed capability envelope end
// to end through the real Express stack (createTestApp with publicDemo:true):
// the demo-session endpoint, the allowlist guard, the bounded state/fire
// validators, and the additive property that existing authorization still
// applies and normal sessions are never constrained.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import request from "supertest";
import type { Express } from "express";
import { createTestDatabase, createTestApp, createAuthToken, cleanup } from "../__test-helpers__/index.js";
import { config } from "../config.js";

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
 * Seed the public demo identity and one exposed, interactive automation:
 *  - group g-demo; user `demo` (role user) in g-demo
 *  - tab-demo, group has INTERACT
 *  - a device exposed on tab-demo
 * The interactive automation is created via the admin API (so it is registered
 * in the engine and fireable), then exposed to tab-demo and given demo_access.
 */
function seedIdentity(db: DatabaseType): void {
  db.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("g-demo", "Public Demo", NOW);
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("u-demo", "demo", "x", "user", "g-demo", NOW);

  db.prepare('INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    "tab-demo", "Demo", "layout", 0, 0, NOW,
  );
  db.prepare("INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)").run(
    "g-demo", "tab-demo", "interact",
  );

  db.prepare(
    "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("dev-demo", "Demo Sensor", "sensor", "[]", "{}", "mqtt", NOW);
}

const demoToken = () =>
  createAuthToken({ userId: "u-demo", username: "demo", role: "user", groupId: "g-demo", sessionType: "public-demo" });
const adminToken = () => createAuthToken({ userId: "u-admin", role: "admin" });

const scriptProject = (body = "export default async function run() {}") => ({
  logicEntry: "logic/index.ts",
  uiEntry: null,
  files: [{ path: "logic/index.ts", content: body }],
});

describe("Public demo mode (integration)", () => {
  let db: DatabaseType;
  let app: Express;
  let ruleId: string;
  let unexposedRuleId: string;

  beforeEach(async () => {
    db = createTestDatabase();
    testDb = db;
    seedIdentity(db);
    const eventBus = new EventEmitter();
    app = createTestApp(db, eventBus, { publicDemo: true });

    // Create an interactive automation via the admin API so it is engine-registered.
    const created = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Demo Control", ruleType: "script", project: scriptProject() });
    ruleId = created.body.id;

    const unexposed = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Hidden", ruleType: "script", project: scriptProject() });
    unexposedRuleId = unexposed.body.id;

    // Expose only the first rule to the demo tab.
    db.prepare("INSERT INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)").run(ruleId, "tab-demo");
    // Declare its demo access via the admin endpoint (exercises PATCH demo-access).
    const patched = await request(app)
      .patch(`/api/automations/${ruleId}/demo-access`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ writableStateKeys: ["master"], fireEvents: ["pause"] });
    expect(patched.status).toBe(200);
  });

  afterEach(() => {
    cleanup({ databases: [db] });
  });

  it("trusts exactly one proxy hop in public-demo mode", () => {
    expect(app.get("trust proxy")).toBe(1);
  });

  // ── Demo session endpoint (Req 2) ──
  describe("demo-session endpoint", () => {
    afterEach(() => { config.publicDemo.enabled = false; });

    it("mints a demo token with no refresh cookie when enabled", async () => {
      config.publicDemo.enabled = true;
      const res = await request(app).post("/api/auth/demo-session").send({});
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe("string");
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("is inert (404) when demo mode is disabled", async () => {
      config.publicDemo.enabled = false;
      const res = await request(app).post("/api/auth/demo-session").send({});
      expect(res.status).toBe(404);
    });
  });

  // ── Allow matrix (Req 16.1) ──
  describe("a demo session CAN", () => {
    it("read /api/auth/me, /api/state and /api/automations", async () => {
      for (const path of ["/api/auth/me", "/api/state", "/api/automations"]) {
        const res = await request(app).get(path).set("Authorization", `Bearer ${demoToken()}`);
        expect(res.status).toBe(200);
      }
    });

    it("read an exposed automation's state", async () => {
      const res = await request(app).get(`/api/automations/${ruleId}/state`).set("Authorization", `Bearer ${demoToken()}`);
      expect(res.status).toBe(200);
    });

    it("write a permitted, bounded state key", async () => {
      const res = await request(app)
        .put(`/api/automations/${ruleId}/state`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ key: "master", value: true });
      expect(res.status).toBe(200);
    });

    it("fire a declared event", async () => {
      const res = await request(app)
        .post(`/api/automations/${ruleId}/fire`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ eventName: "pause" });
      expect(res.status).toBe(200);
    });
  });

  // ── Read-only admin visibility (requirements §7.3) ──
  describe("a demo session CAN read admin surfaces (scrubbed)", () => {
    it("read /api/system/logs (normally admin-only)", async () => {
      const res = await request(app).get("/api/system/logs").set("Authorization", `Bearer ${demoToken()}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("read /api/auth/users with usernames pseudonymised", async () => {
      const res = await request(app).get("/api/auth/users").set("Authorization", `Bearer ${demoToken()}`);
      expect(res.status).toBe(200);
      // The seeded demo user's real username ("demo") must not be disclosed;
      // the role structure is preserved.
      const usernames = (res.body as Array<{ username: string; role: string }>).map((u) => u.username);
      expect(usernames).not.toContain("demo");
      expect(res.body[0]).toHaveProperty("role", "user");
    });

    it("read the whole demo-generated Data Store without dashboard-pane ownership", async () => {
      await request(app)
        .post("/api/data-store/enable")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ maxStorageMb: 100, maxRecordsPerCollection: 1000, maxCollections: 20 });
      await request(app)
        .post("/api/data-store/collections")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "demo-history", description: "public showcase data" });
      await request(app)
        .post("/api/data-store/collections/demo-history/records")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ payload: { value: 42 } });

      // No data-collection pane exposes demo-history. A normal user would fail
      // closed, but the special public-demo session is a read-only admin showcase
      // surface and may inspect the demo-generated store.
      const list = await request(app)
        .get("/api/data-store/collections")
        .set("Authorization", `Bearer ${demoToken()}`);
      expect(list.status).toBe(200);
      expect(list.body.map((c: { name: string }) => c.name)).toContain("demo-history");

      const records = await request(app)
        .get("/api/data-store/collections/demo-history/records")
        .set("Authorization", `Bearer ${demoToken()}`);
      expect(records.status).toBe(200);
      expect(records.body.total).toBe(1);
    });

    it("read /api/system with host/network identifiers masked", async () => {
      const res = await request(app).get("/api/system").set("Authorization", `Bearer ${demoToken()}`);
      expect(res.status).toBe(200);
      // hostname is a sensitive key → masked; numeric metrics survive.
      expect(res.body.hostname).toBe("•••");
      for (const iface of res.body.network ?? []) {
        expect(iface.address).toBe("•••");
      }
    });

    it("does NOT relax admin reads for a normal (non-demo) non-admin session", async () => {
      const normalUser = createAuthToken({ userId: "u-demo", username: "demo", role: "user", groupId: "g-demo" });
      const res = await request(app).get("/api/auth/users").set("Authorization", `Bearer ${normalUser}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Deny matrix (Req 8, 16.2, 16.3) ──
  describe("a demo session CANNOT", () => {
    const denied403: Array<[string, string, unknown?]> = [
      ["post", "/api/automations", { name: "x", ruleType: "script", project: scriptProject() }],
      ["put", "/api/layout", { tabs: [], panes: [] }],
      ["post", "/api/mqtt/publish", { topic: "x", payload: "{}" }],
      ["post", "/api/data-store/collections", { name: "x" }],
      ["get", "/api/definitely/not/a/route", undefined],
    ];

    it.each(denied403)("be denied %s %s (fail closed)", async (method, path, body) => {
      const req = (request(app) as never as Record<string, (p: string) => request.Test>)[method](path).set(
        "Authorization",
        `Bearer ${demoToken()}`,
      );
      const res = await (body ? req.send(body) : req);
      expect(res.status).toBe(403);
    });

    it("edit or delete an automation", async () => {
      const put = await request(app).put(`/api/automations/${ruleId}`).set("Authorization", `Bearer ${demoToken()}`).send({ name: "hacked" });
      expect(put.status).toBe(403);
      const del = await request(app).delete(`/api/automations/${ruleId}`).set("Authorization", `Bearer ${demoToken()}`);
      expect(del.status).toBe(403);
    });

    it("write a non-declared state key", async () => {
      const res = await request(app)
        .put(`/api/automations/${ruleId}/state`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ key: "secret", value: 1 });
      expect(res.status).toBe(403);
    });

    it("write an oversized state value", async () => {
      const res = await request(app)
        .put(`/api/automations/${ruleId}/state`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ key: "master", value: "x".repeat(9000) });
      expect(res.status).toBe(400);
    });

    it("fire an undeclared event", async () => {
      const res = await request(app)
        .post(`/api/automations/${ruleId}/fire`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ eventName: "detonate" });
      expect(res.status).toBe(403);
    });

    it("supply an arbitrary automation context on fire", async () => {
      const res = await request(app)
        .post(`/api/automations/${ruleId}/fire`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ context: { topic: "arbitrary/topic", deviceId: "x", state: {} } });
      expect(res.status).toBe(403);
    });

    it("set its own demo-access allowlist (admin-only, not allowlisted)", async () => {
      const res = await request(app)
        .patch(`/api/automations/${ruleId}/demo-access`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ fireEvents: ["pause", "detonate"] });
      expect(res.status).toBe(403);
    });
  });

  // ── Additive: existing authz still applies; normal sessions unconstrained ──
  describe("guard is additive", () => {
    it("does not widen resource authorization (state write on an unexposed rule is 403)", async () => {
      const res = await request(app)
        .put(`/api/automations/${unexposedRuleId}/state`)
        .set("Authorization", `Bearer ${demoToken()}`)
        .send({ key: "master", value: true });
      expect(res.status).toBe(403);
    });

    it("never constrains a normal (admin) session even while demo mode is on", async () => {
      // A route not on the demo allowlist — an admin normal session sails through.
      const res = await request(app)
        .post("/api/automations")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Admin Rule", ruleType: "script", project: scriptProject() });
      expect(res.status).toBe(200);
    });
  });
});
