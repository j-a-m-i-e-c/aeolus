// src/__integration__/data-store-access-control.integration.test.ts
// Integration tests for Data Store access control: management, mutations, and
// buckets are admin-only; non-admin collection reads are filtered by the
// collection→tab ownership model. Exercises the full Express stack with a real
// in-memory SQLite database and the real authorization middleware.
//
// Feature: data-store-access-control

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
 * Topology:
 *  - group g-a; user u-user (role user) in g-a with WRITE on tab-a
 *  - tab-a (reachable by g-a), tab-b (not reachable)
 *  - collection "temps" surfaced by tab-a; collection "secret" surfaced by tab-b
 *  So u-user can read "temps" but not "secret" (and not any unsurfaced collection).
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

  const insertAssignment = db.prepare(
    "INSERT INTO collection_tab_assignments (collection_name, tab_id) VALUES (?, ?)",
  );
  insertAssignment.run("temps", "tab-a");
  insertAssignment.run("secret", "tab-b");
}

const userToken = () => createAuthToken({ userId: "u-user", username: "normaluser", role: "user", groupId: "g-a" });
const adminToken = () => createAuthToken({ userId: "u-admin", role: "admin" });

describe("Data Store access control (integration)", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let app: Express;

  beforeEach(async () => {
    db = createTestDatabase();
    testDb = db;
    seed(db);
    eventBus = new EventEmitter();
    app = createTestApp(db, eventBus);

    // Enable the Data Store and create the two collections as admin.
    await request(app).post("/api/data-store/enable").set("Authorization", `Bearer ${adminToken()}`).send({ maxStorageMb: 100, maxRecordsPerCollection: 10000, maxCollections: 50 });
    await request(app).post("/api/data-store/collections").set("Authorization", `Bearer ${adminToken()}`).send({ name: "temps" });
    await request(app).post("/api/data-store/collections").set("Authorization", `Bearer ${adminToken()}`).send({ name: "secret" });
  });

  afterEach(() => {
    cleanup({ databases: [db] });
  });

  describe("Management, mutations, and buckets are admin-only (R1, R2)", () => {
    const adminOnly: Array<[string, string, unknown?]> = [
      ["post", "/api/data-store/collections", { name: "new-one" }],
      ["patch", "/api/data-store/collections/temps", { description: "x" }],
      ["delete", "/api/data-store/collections/temps"],
      ["post", "/api/data-store/collections/temps/records", { payload: { v: 1 } }],
      ["get", "/api/data-store/buckets"],
      ["get", "/api/data-store/buckets/some-bucket"],
      ["put", "/api/data-store/buckets/some-bucket/some-key", { value: 1 }],
      ["delete", "/api/data-store/buckets/some-bucket/some-key"],
      ["get", "/api/data-store/config"],
      ["put", "/api/data-store/config", { maxStorageMb: 50 }],
      ["get", "/api/data-store/stats"],
      ["post", "/api/data-store/enable", {}],
      ["post", "/api/data-store/disable"],
    ];

    it.each(adminOnly)("rejects a non-admin: %s %s → 403", async (method, path, body) => {
      const req = (request(app) as any)[method](path).set("Authorization", `Bearer ${userToken()}`);
      const res = body !== undefined ? await req.send(body) : await req;
      expect(res.status).toBe(403);
    });

    it("allows an admin to write a record and manage buckets", async () => {
      const write = await request(app)
        .post("/api/data-store/collections/temps/records")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ payload: { temperature: 21 } });
      expect(write.status).toBe(201);

      const bucket = await request(app)
        .put("/api/data-store/buckets/prefs/theme")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ value: "dark" });
      expect(bucket.status).toBe(200);
    });
  });

  describe("Non-admin collection reads are filtered (R3, R4)", () => {
    it("lists only collections surfaced by a tab the non-admin can reach", async () => {
      const res = await request(app)
        .get("/api/data-store/collections")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(200);
      const names = (res.body as Array<{ name: string }>).map((c) => c.name);
      expect(names).toEqual(["temps"]); // "secret" is on tab-b (unreachable)
    });

    it("returns every collection to an admin", async () => {
      const res = await request(app)
        .get("/api/data-store/collections")
        .set("Authorization", `Bearer ${adminToken()}`);
      const names = (res.body as Array<{ name: string }>).map((c) => c.name).sort();
      expect(names).toEqual(["secret", "temps"]);
    });

    it("allows a non-admin to read records/export of an accessible collection", async () => {
      const records = await request(app)
        .get("/api/data-store/collections/temps/records")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(records.status).toBe(200);

      const csv = await request(app)
        .get("/api/data-store/collections/temps/export")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(csv.status).toBe(200);
    });

    it("denies a non-admin reading a collection surfaced only by an unreachable tab", async () => {
      const res = await request(app)
        .get("/api/data-store/collections/secret/records")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });

    it("denies a non-admin reading a collection surfaced by no tab (fail-closed)", async () => {
      const res = await request(app)
        .get("/api/data-store/collections/does-not-exist/records")
        .set("Authorization", `Bearer ${userToken()}`);
      expect(res.status).toBe(403);
    });
  });
});
