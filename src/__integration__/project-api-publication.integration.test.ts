// Phase 1 proof for Project APIs (ADR-0027): what runs is the published snapshot,
// across edits made while it is running and across restarts. Real isolated-vm and a
// real SQLite file; a skip is not a pass.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { compileAutomationProject, saveAutomationProject, readAutomationProject, type AutomationProjectFile } from "../automations/automation-project.js";
import { createProjectApiStore, type AuditContext } from "../project-api/publication-store.js";
import { invokeApiHandler } from "../project-api/api-sandbox.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

const ADMIN: AuditContext = { actor: { userId: "u-admin", username: "admin" }, requestId: "req" };
const state = { get: (key: string) => ({ level: 42 } as Record<string, unknown>)[key], getAll: () => ({ level: 42 }) };

function files(handlerBody: string): AutomationProjectFile[] {
  return [
    { path: "logic/index.ts", content: "export default function run() {}" },
    { path: "api/routes.json", content: JSON.stringify({ version: 1, routes: [{ id: "level", method: "GET", path: "/level", handler: "getLevel", response: { type: "object" } }] }) },
    { path: "api/handlers.ts", content: `export async function getLevel() { ${handlerBody} }` },
  ];
}

let dir: string;
let dbPath: string;
let db: DatabaseType;

function open(): DatabaseType {
  const handle = new Database(dbPath);
  handle.pragma("foreign_keys = ON");
  runMigrations(handle, migrations);
  return handle;
}

/** Save a project the way PUT /api/automations/:id/project does: compile, bump revision, store. */
async function save(handlerBody: string): Promise<void> {
  const compiled = await compileAutomationProject({ files: files(handlerBody) });
  db.transaction(() => {
    db.prepare("UPDATE automation_rules SET revision = revision + 1, compiled_js = ? WHERE id = 'a1'").run(compiled.compiledJs);
    saveAutomationProject(db, "a1", compiled);
  })();
}

async function publishCurrent(store: ReturnType<typeof createProjectApiStore>) {
  const stored = readAutomationProject(db, "a1")!;
  const compiled = await compileAutomationProject({ files: stored.files });
  return store.publish("a1", compiled.api!, stored.revision, compiled.api!.contentHash, ADMIN);
}

async function call(store: ReturnType<typeof createProjectApiStore>) {
  const resolution = store.resolve("tank-levels");
  if (!resolution.ok) return resolution;
  return invokeApiHandler(resolution.snapshot.bundle, resolution.routes[0]!.handler, { routeId: "level", params: {} }, state);
}

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "aeolus-papi-"));
  dbPath = path.join(dir, "aeolus.db");
  db = open();
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1)").run();
  db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES ('a1', 'Tanks', 't', 'script', 1, 1, 0, 1)`).run();
  await save(`return { version: 1, level: state.get("level") };`);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Project API publication (real isolated-vm, SQLite file)", () => {
  realIt("serves the published snapshot while the source is edited during an active request", async () => {
    const store = createProjectApiStore(db);
    store.setSlug("a1", "tank-levels", ADMIN);
    const snapshot = await publishCurrent(store);

    // A request resolves the snapshot and starts; the project is edited before it ends.
    const resolution = store.resolve("tank-levels");
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const inFlight = invokeApiHandler(
      resolution.snapshot.bundle, "getLevel", { routeId: "level", params: {} }, state,
    );
    await save(`return { version: 2, level: -1 };`);

    expect(await inFlight).toMatchObject({ ok: true, body: { version: 1, level: 42 } });
    // Requests after the edit still get the reviewed code.
    expect(await call(store)).toMatchObject({ ok: true, body: { version: 1 } });
    const again = store.resolve("tank-levels");
    expect(again.ok && again.snapshot.id).toBe(snapshot.id);

    // The new code runs only once an admin publishes it.
    await publishCurrent(store);
    expect(await call(store)).toMatchObject({ ok: true, body: { version: 2 } });
  });

  realIt("keeps serving the same snapshot after a restart, and keeps its fail-closed state", async () => {
    let store = createProjectApiStore(db);
    store.setSlug("a1", "tank-levels", ADMIN);
    const snapshot = await publishCurrent(store);
    await save(`return { version: 2 };`);

    db.close();
    db = open();
    store = createProjectApiStore(db);
    const resolution = store.resolve("tank-levels");
    expect(resolution.ok && resolution.snapshot.id).toBe(snapshot.id);
    expect(await call(store)).toMatchObject({ ok: true, body: { version: 1, level: 42 } });

    store.unpublish("a1", ADMIN);
    db.close();
    db = open();
    expect(createProjectApiStore(db).resolve("tank-levels")).toEqual({ ok: false, reason: "unpublished" });
  });

  realIt("stops serving at once when the automation is disabled, without touching the snapshot", async () => {
    const store = createProjectApiStore(db);
    store.setSlug("a1", "tank-levels", ADMIN);
    await publishCurrent(store);
    db.prepare("UPDATE automation_rules SET enabled = 0").run();
    expect(await call(store)).toMatchObject({ ok: false, reason: "disabled" });
    db.prepare("UPDATE automation_rules SET enabled = 1").run();
    expect(await call(store)).toMatchObject({ ok: true });
  });
});
