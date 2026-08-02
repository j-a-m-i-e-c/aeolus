// src/__integration__/scoped-authoring.integration.test.ts
// Integration tests for scoped automation authoring: creation binds an
// authorization scope from the caller's role, the owning tab exposes the
// automation to its author, and a non-admin cannot change scope on update.
//
// Feature: scoped-automation-authoring

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

/** group g-a; user u-user in g-a; tab-a (group WRITE), tab-b (no permission). */
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
}

const userToken = () => createAuthToken({ userId: "u-user", username: "normaluser", role: "user", groupId: "g-a" });
const adminToken = () => createAuthToken({ userId: "u-admin", username: "admin", role: "admin", groupId: null });

const formRule = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  ruleType: "form",
  actionType: "log",
  actionTarget: "noop",
  triggerType: "none",
  ...extra,
});

function scopeRow(id: string): { authored_unrestricted: number; owner_tab_id: string | null } {
  return testDb
    .prepare("SELECT authored_unrestricted, owner_tab_id FROM automation_rules WHERE id = ?")
    .get(id) as { authored_unrestricted: number; owner_tab_id: string | null };
}

describe("Scoped automation authoring (integration)", () => {
  let db: DatabaseType;
  let app: Express;

  beforeEach(() => {
    db = createTestDatabase();
    testDb = db;
    seed(db);
    app = createTestApp(db, new EventEmitter());
  });

  afterEach(() => cleanup({ databases: [db] }));

  it("binds an admin-created automation as unrestricted", async () => {
    const res = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send(formRule("Admin rule"));
    expect(res.status).toBe(200);
    const { id, authoredUnrestricted, ownerTabId } = res.body;
    expect(authoredUnrestricted).toBe(true);
    expect(ownerTabId).toBeNull();
    expect(scopeRow(id)).toEqual({ authored_unrestricted: 1, owner_tab_id: null });
  });

  it("binds a non-admin-created automation as scoped to the named tab", async () => {
    const res = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${userToken()}`)
      .send(formRule("User rule", { tabId: "tab-a" }));
    expect(res.status).toBe(200);
    expect(res.body.authoredUnrestricted).toBe(false);
    expect(res.body.ownerTabId).toBe("tab-a");
    expect(scopeRow(res.body.id)).toEqual({ authored_unrestricted: 0, owner_tab_id: "tab-a" });
  });

  it("rejects a non-admin create with no owning tab (403)", async () => {
    const res = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${userToken()}`)
      .send(formRule("No tab"));
    expect(res.status).toBe(403);
  });

  it("rejects a non-admin create naming a tab they cannot write (403)", async () => {
    const res = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${userToken()}`)
      .send(formRule("Wrong tab", { tabId: "tab-b" }));
    expect(res.status).toBe(403);
  });

  it("exposes a scoped automation to its author via the owning tab (no pane needed)", async () => {
    const create = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${userToken()}`)
      .send(formRule("Visible rule", { tabId: "tab-a" }));
    const id = create.body.id as string;

    const list = await request(app)
      .get("/api/automations")
      .set("Authorization", `Bearer ${userToken()}`);
    expect(list.status).toBe(200);
    const ids = (list.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(id);
  });

  it("ignores scope fields on a non-admin update (scope is immutable)", async () => {
    const create = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${userToken()}`)
      .send(formRule("Immutable rule", { tabId: "tab-a" }));
    const id = create.body.id as string;

    const upd = await request(app)
      .put(`/api/automations/${id}`)
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ name: "Renamed", authoredUnrestricted: true, ownerTabId: "tab-b" });
    expect(upd.status).toBe(200);

    // Scope unchanged despite the malicious fields.
    expect(scopeRow(id)).toEqual({ authored_unrestricted: 0, owner_tab_id: "tab-a" });
  });

  it("blocks a non-admin from editing/deleting/toggling an admin-authored unrestricted automation exposed on their tab (audit Critical 1)", async () => {
    // Admin creates an unrestricted (system-wide authority) automation.
    const create = await request(app)
      .post("/api/automations")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send(formRule("Admin unrestricted"));
    const id = create.body.id as string;
    expect(scopeRow(id)).toEqual({ authored_unrestricted: 1, owner_tab_id: null });

    // Expose it on tab-a, which u-user's group can write. The resource-permission
    // resolver now legitimately grants u-user `write` on this automation.
    testDb
      .prepare("INSERT INTO automation_tab_assignments (automation_id, tab_id) VALUES (?, ?)")
      .run(id, "tab-a");

    // The non-admin must NOT be able to replace its Logic and inherit authority.
    const put = await request(app)
      .put(`/api/automations/${id}`)
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ name: "Hijacked", actionType: "log", actionTarget: "noop" });
    expect(put.status).toBe(403);

    const toggle = await request(app)
      .patch(`/api/automations/${id}/toggle`)
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ enabled: false });
    expect(toggle.status).toBe(403);

    const del = await request(app)
      .delete(`/api/automations/${id}`)
      .set("Authorization", `Bearer ${userToken()}`);
    expect(del.status).toBe(403);

    // The rule is untouched: still unrestricted and still present.
    expect(scopeRow(id)).toEqual({ authored_unrestricted: 1, owner_tab_id: null });

    // An admin can still update and delete it.
    const adminPut = await request(app)
      .put(`/api/automations/${id}`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Admin edit" });
    expect(adminPut.status).toBe(200);

    const adminDel = await request(app)
      .delete(`/api/automations/${id}`)
      .set("Authorization", `Bearer ${adminToken()}`);
    expect(adminDel.status).toBe(200);
  });
});
