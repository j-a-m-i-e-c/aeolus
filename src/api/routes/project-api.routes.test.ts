// src/api/routes/project-api.routes.test.ts — only a real admin manages publications,
// and a publish is bound to the content the admin reviewed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../../db/migration-runner.js";
import { migrations } from "../../db/migrations/index.js";
import { compileAutomationProject, saveAutomationProject, type AutomationProjectFile } from "../../automations/automation-project.js";
import { createProjectApiStore } from "../../project-api/publication-store.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createProjectApiRoutes } from "./project-api.routes.js";

vi.mock("../../logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type User = { userId: string; username: string; role: "admin" | "user"; groupId: null; sessionType?: "normal" | "public-demo" };
const ADMIN: User = { userId: "u-admin", username: "admin", role: "admin", groupId: null };

let db: DatabaseType;
let user: User | null;

function files(handlerBody = "return { level: 1 };", extra: Record<string, string> = {}): AutomationProjectFile[] {
  return Object.entries({
    "logic/index.ts": "export default function run() {}",
    "api/routes.json": JSON.stringify({ version: 1, routes: [{ id: "level", method: "GET", path: "/level", handler: "getLevel", response: { type: "object" } }] }),
    "api/handlers.ts": `export function getLevel() { ${handlerBody} }`,
    ...extra,
  }).map(([path, content]) => ({ path, content }));
}

async function save(projectFiles: AutomationProjectFile[]) {
  const compiled = await compileAutomationProject({ files: projectFiles });
  db.prepare("UPDATE automation_rules SET revision = revision + 1 WHERE id = 'a1'").run();
  saveAutomationProject(db, "a1", compiled);
}

async function request(method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) (req as unknown as { user: User }).user = user; next(); });
  app.use("/api/project-apis", createProjectApiRoutes(db, createProjectApiStore(db)));
  app.use(errorHandler);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Aeolus-Mutation-Id": "mutation-7" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1)").run();
  db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES ('a1', 'Tanks', 't', 'script', 1, 1, 0, 1)`).run();
  await save(files());
  user = ADMIN;
});
afterEach(() => db.close());

describe("access", () => {
  const routes: Array<[string, string, unknown?]> = [
    ["GET", "/api/project-apis/audit"],
    ["GET", "/api/project-apis/a1"],
    ["PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" }],
    ["POST", "/api/project-apis/a1/publish", { contentHash: "0".repeat(64) }],
    ["POST", "/api/project-apis/a1/unpublish"],
  ];

  it.each(routes)("%s %s is refused to a non-admin", async (method, path, body) => {
    user = { ...ADMIN, userId: "u-user", role: "user" };
    expect((await request(method, path, body)).status).toBe(403);
  });

  it.each(routes)("%s %s is refused to a public-demo session, even on GET", async (method, path, body) => {
    user = { ...ADMIN, sessionType: "public-demo" };
    expect((await request(method, path, body)).status).toBe(403);
  });

  it("is refused with no authenticated user at all", async () => {
    user = null;
    expect((await request("GET", "/api/project-apis/a1")).status).toBe(403);
  });
});

describe("publication lifecycle", () => {
  it("shows what the source declares before any API exists", async () => {
    const res = await request("GET", "/api/project-apis/a1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ automationId: "a1", api: null, published: null, status: "no-api", compileErrors: null });
    expect(res.body.declared.routes).toEqual([{ id: "level", method: "GET", path: "/level", handler: "getLevel", response: { type: "object" } }]);
    expect(res.body.declared.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("publishes only the reviewed content, then reports later edits as unpublished changes", async () => {
    expect((await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" })).status).toBe(200);
    const before = await request("GET", "/api/project-apis/a1");
    expect(before.body).toMatchObject({ status: "unpublished", api: { slug: "tank-levels", path: "/api/exposed/v1/tank-levels" } });

    expect((await request("POST", "/api/project-apis/a1/publish", { contentHash: "f".repeat(64) })).status).toBe(409);
    const published = await request("POST", "/api/project-apis/a1/publish", { contentHash: before.body.declared.contentHash });
    expect(published.status).toBe(201);
    expect((await request("GET", "/api/project-apis/a1")).body).toMatchObject({ status: "serving", unpublishedChanges: false });

    await save(files("return { level: 2 };"));
    const after = await request("GET", "/api/project-apis/a1");
    expect(after.body).toMatchObject({ status: "serving", unpublishedChanges: true, published: { id: published.body.id } });

    // The stale hash the admin reviewed earlier no longer publishes.
    expect((await request("POST", "/api/project-apis/a1/publish", { contentHash: before.body.declared.contentHash })).status).toBe(409);

    expect((await request("POST", "/api/project-apis/a1/unpublish")).status).toBe(200);
    expect((await request("GET", "/api/project-apis/a1")).body).toMatchObject({ status: "unpublished" });
  });

  it("refuses to publish a project with an invalid transitive import, reporting where", async () => {
    await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
    // Stored directly: a save through the editor would already have refused it.
    db.prepare("UPDATE automation_project_files SET content = ? WHERE automation_id = 'a1' AND path = 'api/handlers.ts'")
      .run(`import { helper } from "../lib/helper";\nexport function getLevel() { return helper(); }`);
    db.prepare("INSERT INTO automation_project_files (automation_id, path, content, created_at, updated_at) VALUES ('a1', 'lib/helper.ts', ?, 1, 1)")
      .run(`import "../logic/index";\nexport const helper = () => 1;`);
    const status = await request("GET", "/api/project-apis/a1");
    expect(status.body.declared).toBeNull();
    expect(status.body.compileErrors[0]).toMatchObject({ path: "lib/helper.ts", line: 1 });
    expect(status.body.compileErrors[0].message).toMatch(/outside them/);
    expect((await request("POST", "/api/project-apis/a1/publish", { contentHash: "0".repeat(64) })).status).toBe(400);
  });

  it("refuses to publish a project that declares no API", async () => {
    await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
    await save([{ path: "logic/index.ts", content: "export default function run() {}" }]);
    expect((await request("POST", "/api/project-apis/a1/publish", { contentHash: "0".repeat(64) })).status).toBe(400);
  });

  it("reports why an existing API is not being served", async () => {
    await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
    const status = await request("GET", "/api/project-apis/a1");
    await request("POST", "/api/project-apis/a1/publish", { contentHash: status.body.declared.contentHash });
    db.prepare("UPDATE automation_rules SET enabled = 0").run();
    expect((await request("GET", "/api/project-apis/a1")).body).toMatchObject({ status: "disabled", unpublishedChanges: false });
  });

  it("refuses to publish a project whose current source does not compile", async () => {
    await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
    db.prepare("UPDATE automation_project_files SET content = 'export function getLevel() {' WHERE automation_id = 'a1' AND path = 'api/handlers.ts'").run();
    const res = await request("POST", "/api/project-apis/a1/publish", { contentHash: "0".repeat(64) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not compile/);
  });

  it("refuses to publish an unknown automation", async () => {
    expect((await request("POST", "/api/project-apis/missing/publish", { contentHash: "0".repeat(64) })).status).toBe(404);
  });

  it("maps store refusals to HTTP statuses", async () => {
    expect((await request("PUT", "/api/project-apis/a1/slug", { slug: "Bad Slug" })).status).toBe(400);
    expect((await request("PUT", "/api/project-apis/a1/slug", { slug: "x" })).status).toBe(400);
    expect((await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels", admin: true })).status).toBe(400);
    expect((await request("GET", "/api/project-apis/missing")).status).toBe(404);
    expect((await request("POST", "/api/project-apis/a1/unpublish")).status).toBe(404);
    db.prepare("UPDATE automation_rules SET authored_unrestricted = 0").run();
    expect((await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" })).status).toBe(403);
  });
});

describe("audit", () => {
  it("records the admin and the request's mutation id, pages, and reports storage", async () => {
    await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
    await request("PUT", "/api/project-apis/a1/slug", { slug: "water-levels" });
    const page = await request("GET", "/api/project-apis/audit?limit=1");
    expect(page.status).toBe(200);
    expect(page.body.events).toHaveLength(1);
    expect(page.body.events[0]).toMatchObject({ action: "api.slug.changed", actorUserId: "u-admin", actorUsername: "admin", requestId: "mutation-7" });
    const next = await request("GET", `/api/project-apis/audit?limit=1&before=${page.body.nextBefore}`);
    expect(next.body.events[0]).toMatchObject({ action: "api.created" });
    expect(page.body.storage).toMatchObject({ auditEvents: 2, snapshots: 0 });
  });

  it.each(["limit=0", "limit=201", "limit=x", "before=-1", "other=1"])("rejects ?%s", async (query) => {
    expect((await request("GET", `/api/project-apis/audit?${query}`)).status).toBe(400);
  });

  it("offers no way to change or delete audit history", async () => {
    for (const method of ["PUT", "PATCH", "DELETE", "POST"]) {
      expect((await request(method, "/api/project-apis/audit")).status).toBe(404);
    }
  });
});
