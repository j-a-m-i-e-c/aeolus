// src/auth/user-service.project-api.test.ts — demoting or deleting the admin who
// published a Project API withdraws that approval, recorded against the acting admin,
// and promoting them back restores nothing (ADR-0027).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";

let testDb: DatabaseType;
vi.mock("../db/database.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/database.js")>()),
  getDatabase: () => testDb,
}));
vi.mock("../logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { updateUser, deleteUser } = await import("./user-service.js");
const { compileProjectApi } = await import("../project-api/api-compiler.js");
const { createProjectApiStore } = await import("../project-api/publication-store.js");

const ACTOR = { userId: "u-boss", username: "boss", requestId: "req-demote" };

async function publishAs(userId: string) {
  const store = createProjectApiStore(testDb);
  const ctx = { actor: { userId, username: userId }, requestId: "req-publish" };
  store.setSlug("a1", "tank-levels", ctx);
  const api = (await compileProjectApi([
    { path: "api/routes.json", content: JSON.stringify({ version: 1, routes: [{ id: "level", method: "GET", path: "/level", handler: "getLevel", response: { type: "object" } }] }) },
    { path: "api/handlers.ts", content: "export function getLevel() { return {}; }" },
  ]))!;
  store.publish("a1", api, 1, api.contentHash, ctx);
  return store;
}

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  runMigrations(testDb, migrations);
  for (const id of ["u-pub", "u-boss"]) {
    testDb.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, 'x', 'admin', 1)").run(id, id);
  }
  testDb.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES ('a1', 'Tanks', 't', 'script', 1, 1, 1, 1)`).run();
});
afterEach(() => testDb.close());

describe("user management and Project API approval", () => {
  it("demote then promote, with no request in between, leaves the API unpublished", async () => {
    const store = await publishAs("u-pub");
    await updateUser("u-pub", { role: "user" }, ACTOR);
    await updateUser("u-pub", { role: "admin" }, ACTOR);
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
    const withdrawn = store.listAudit().events.filter((e) => e.action === "api.approval.revoked");
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]).toMatchObject({ actorUserId: "u-boss", requestId: "req-demote", metadata: { reason: "publisher-demoted" } });
  });

  it("deleting the publisher withdraws approval, recorded against the acting admin", async () => {
    const store = await publishAs("u-pub");
    deleteUser("u-pub", ACTOR);
    expect(store.resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
    expect(store.listAudit().events[0]).toMatchObject({ action: "api.approval.revoked", actorUserId: "u-boss", metadata: { reason: "publisher-deleted" } });
  });

  it("a role change that is not a demotion withdraws nothing", async () => {
    const store = await publishAs("u-pub");
    testDb.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-new', 'new', 'x', 'user', 1)").run();
    await updateUser("u-new", { role: "admin" }, ACTOR);
    await updateUser("u-pub", { role: "admin" }, ACTOR);
    expect(store.resolve("tank-levels").ok).toBe(true);
  });

  it("refusing to demote the last admin changes nothing", async () => {
    testDb.prepare("DELETE FROM users WHERE id = 'u-boss'").run();
    const store = await publishAs("u-pub");
    await expect(updateUser("u-pub", { role: "user" }, ACTOR)).rejects.toThrow();
    expect(store.resolve("tank-levels").ok).toBe(true);
  });
});
