// src/api/routes/project-api.endpoints.routes.test.ts — what the Endpoints editor
// section reads (ADR-0027, Phase 4): route changes before a republish, why an API is
// not published, the API's grants, the OpenAPI document of the published snapshot,
// stable refusal reasons, and no caching of anything, one-time keys above all.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { Validator } from "@seriousme/openapi-schema-validator";
import { runMigrations } from "../../db/migration-runner.js";
import { migrations } from "../../db/migrations/index.js";
import { compileAutomationProject, saveAutomationProject, type AutomationProjectFile } from "../../automations/automation-project.js";
import { createProjectApiStore } from "../../project-api/publication-store.js";
import { createApiAccessStore } from "../../project-api/access-store.js";
import { createExposedApiRouter } from "../../project-api/exposed-router.js";
import { createRequestLimiter } from "../../project-api/request-limits.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createProjectApiRoutes } from "./project-api.routes.js";

vi.mock("../../logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const loggedByExposed: string[] = [];
const exposedLogger = {
  info: (obj: object, msg: string) => { loggedByExposed.push(JSON.stringify([obj, msg])); },
  warn: (obj: object, msg: string) => { loggedByExposed.push(JSON.stringify([obj, msg])); },
};

type User = { userId: string; username: string; role: "admin" | "user"; groupId: null; sessionType?: "normal" | "public-demo" };
const ADMIN: User = { userId: "u-admin", username: "admin", role: "admin", groupId: null };

const LEVEL = { type: "object", properties: { level: { type: "number", minimum: 0 } }, required: ["level"], additionalProperties: false };
const TANK = { type: "object", properties: { id: { type: "string" }, level: { type: "number" } }, required: ["id", "level"] };

let db: DatabaseType;
let user: User | null;

function project(routes: Array<Record<string, unknown>>, handlers: string): AutomationProjectFile[] {
  return [
    { path: "logic/index.ts", content: "export default function run() {}" },
    { path: "api/routes.json", content: JSON.stringify({ version: 1, routes }) },
    { path: "api/handlers.ts", content: handlers },
  ];
}
const BASE_ROUTES = [
  { id: "level", method: "GET", path: "/level", handler: "getLevel", description: "Current level", response: LEVEL },
  { id: "tank", method: "GET", path: "/tanks/:id", handler: "getTank", response: TANK },
];
const BASE_HANDLERS = `export function getLevel() { return { level: 1 }; }
export function getTank(req: { params: { id: string } }) { return { id: req.params.id, level: 2 }; }`;

async function save(files: AutomationProjectFile[]) {
  const compiled = await compileAutomationProject({ files });
  db.prepare("UPDATE automation_rules SET revision = revision + 1 WHERE id = 'a1'").run();
  saveAutomationProject(db, "a1", compiled);
}

async function request(method: string, path: string, body?: unknown, options: { exposed?: boolean } = {}) {
  const app = express();
  let port = 0;
  const publications = createProjectApiStore(db);
  const access = createApiAccessStore(db);
  // The real /api/exposed router, mounted before authentication as in src/index.ts.
  app.use("/api/exposed", createExposedApiRouter({
    publications, access, stateFor: () => ({ get: () => 7, getAll: () => ({}) }),
    limiter: createRequestLimiter({ perMinute: 60, concurrentPerClient: 2 }), requireHttps: false, logger: exposedLogger,
  }));
  app.use(express.json());
  app.use((req, _res, next) => { if (user) (req as unknown as { user: User }).user = user; next(); });
  app.use("/api/project-apis", createProjectApiRoutes(db, publications, access,
    options.exposed === false ? {} : { exposedBaseUrl: () => `http://127.0.0.1:${port}` }));
  app.use(errorHandler);
  const server = app.listen(0);
  port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) as Record<string, any> };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function publishCurrent() {
  const status = await request("GET", "/api/project-apis/a1");
  return request("POST", "/api/project-apis/a1/publish", { contentHash: status.body.declared.contentHash });
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1)").run();
  db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES ('a1', 'Tank farm', 't', 'script', 1, 1, 0, 1)`).run();
  await save(project(BASE_ROUTES, BASE_HANDLERS));
  user = ADMIN;
  await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
});
afterEach(() => db.close());

describe("access to the Endpoints routes", () => {
  const routes: Array<[string, string]> = [
    ["GET", "/api/project-apis/a1/openapi.json"],
    ["GET", "/api/project-apis/a1/grants"],
  ];
  it.each(routes)("%s %s is refused to a non-admin and to a public-demo session", async (method, path) => {
    await publishCurrent();
    user = { ...ADMIN, userId: "u-user", role: "user" };
    expect((await request(method, path)).status).toBe(403);
    user = { ...ADMIN, sessionType: "public-demo" };
    expect((await request(method, path)).status).toBe(403);
  });
});

describe("no caching", () => {
  it("marks every management response no-store, the one-time key responses included", async () => {
    const client = await request("POST", "/api/project-apis/clients", { name: "Farm" });
    const issued = await request("POST", `/api/project-apis/clients/${client.body.id}/keys`, { expiresAt: null });
    const rotated = await request("POST", `/api/project-apis/clients/${client.body.id}/keys/${issued.body.credential.id}/rotate`, { expiresAt: null });
    expect(issued.body.key).toMatch(/^aeo_/);
    for (const res of [issued, rotated, client, await request("GET", "/api/project-apis/a1"), await request("GET", "/api/project-apis/clients")]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("pragma")).toBe("no-cache");
    }
    // Refusals too, so a cached 403 cannot outlive a role change.
    user = { ...ADMIN, role: "user" };
    expect((await request("GET", "/api/project-apis/clients")).headers.get("cache-control")).toBe("no-store");
  });

  it("never returns a key after the response that issued it", async () => {
    const client = await request("POST", "/api/project-apis/clients", { name: "Farm" });
    const issued = await request("POST", `/api/project-apis/clients/${client.body.id}/keys`, {});
    const secret = String(issued.body.key).split("_").slice(2).join("_");
    const detail = await request("GET", `/api/project-apis/clients/${client.body.id}`);
    const list = await request("GET", "/api/project-apis/clients");
    const audit = await request("GET", "/api/project-apis/audit");
    for (const res of [detail, list, audit]) expect(JSON.stringify(res.body)).not.toContain(secret);
  });
});

describe("status for the Endpoints section", () => {
  it("lists the published routes and how a republish would change each", async () => {
    expect((await request("GET", "/api/project-apis/a1")).body).toMatchObject({ publishedRoutes: null, routeChanges: [], lastPublicationEvent: null });
    await publishCurrent();
    const unchanged = (await request("GET", "/api/project-apis/a1")).body;
    expect(unchanged.publishedRoutes.map((r: { id: string }) => r.id)).toEqual(["level", "tank"]);
    expect(unchanged.publishedRoutes[0]).not.toHaveProperty("segments");
    expect(unchanged.routeChanges).toEqual([{ routeId: "level", change: "unchanged" }, { routeId: "tank", change: "unchanged" }]);
    expect(unchanged.lastPublicationEvent).toMatchObject({ action: "api.published", actorUsername: "admin" });

    // A handler-only edit keeps the route contract; a schema edit changes it; a route
    // goes away and another arrives.
    await save(project([
      { ...BASE_ROUTES[0], response: { ...LEVEL, properties: { level: { type: "number" } } } },
      { id: "summary", method: "GET", path: "/summary", handler: "getLevel", response: LEVEL },
    ], BASE_HANDLERS));
    const edited = (await request("GET", "/api/project-apis/a1")).body;
    expect(edited.unpublishedChanges).toBe(true);
    expect(edited.routeChanges).toEqual([
      { routeId: "level", change: "changed" },
      { routeId: "tank", change: "removed" },
      { routeId: "summary", change: "added" },
    ]);
    // What is published is still the snapshot, not the edited source.
    expect(edited.publishedRoutes.map((r: { id: string }) => r.id)).toEqual(["level", "tank"]);
  });

  it("explains an unpublished API: unpublished by an admin, or approval withdrawn", async () => {
    await publishCurrent();
    await request("POST", "/api/project-apis/a1/unpublish");
    expect((await request("GET", "/api/project-apis/a1")).body).toMatchObject({
      status: "unpublished", lastPublicationEvent: { action: "api.unpublished", actorUsername: "admin" },
    });

    await publishCurrent();
    db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-other', 'other', 'x', 'admin', 1)").run();
    db.prepare("UPDATE users SET role = 'user' WHERE id = 'u-admin'").run();
    user = { ...ADMIN, userId: "u-other", username: "other" };
    expect((await request("GET", "/api/project-apis/a1")).body).toMatchObject({
      status: "unpublished",
      // The users trigger records the actor as user id `system`, username `user-management`.
      lastPublicationEvent: { action: "api.approval.revoked", actorUsername: "user-management", reason: "publisher-demoted" },
    });
  });

  it("lists the API's live grants with client names, and nothing for an API without one", async () => {
    expect((await request("GET", "/api/project-apis/a1/grants")).body).toEqual({ grants: [] });
    db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
      VALUES ('a2', 'No API', 't', 'script', 1, 1, 0, 1)`).run();
    expect((await request("GET", "/api/project-apis/a2/grants")).body).toEqual({ grants: [] });

    await publishCurrent();
    const farm = (await request("POST", "/api/project-apis/clients", { name: "Remote farm" })).body;
    const office = (await request("POST", "/api/project-apis/clients", { name: "Office" })).body;
    await request("POST", "/api/project-apis/a1/grants", { clientId: farm.id, routeId: "level" });
    await request("POST", "/api/project-apis/a1/grants", { clientId: office.id, routeId: "tank" });
    await request("POST", "/api/project-apis/a1/grants", { clientId: office.id, routeId: "level" });
    await request("POST", "/api/project-apis/a1/grants/revoke", { clientId: office.id, routeId: "level" });
    await request(`POST`, `/api/project-apis/clients/${office.id}/disable`);

    const { grants } = (await request("GET", "/api/project-apis/a1/grants")).body;
    expect(grants.map((g: Record<string, unknown>) => [g.clientName, g.routeId, g.clientStatus])).toEqual([
      ["Remote farm", "level", "active"],
      ["Office", "tank", "disabled"],
    ]);
  });
});

describe("refusals carry a stable reason", () => {
  it("for a retired slug, so the UI can offer an explicit reclaim", async () => {
    await request("PUT", "/api/project-apis/a1/slug", { slug: "water-levels" });
    const refused = await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
    expect(refused).toMatchObject({ status: 409, body: { details: { reason: "slug-retired" } } });
    const reclaimed = await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels", reclaim: true });
    expect(reclaimed.status).toBe(200);
  });

  it("for a slug another API holds", async () => {
    db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
      VALUES ('a2', 'Other', 't', 'script', 1, 1, 0, 1)`).run();
    expect(await request("PUT", "/api/project-apis/a2/slug", { slug: "tank-levels" })).toMatchObject({ status: 409, body: { details: { reason: "slug-taken" } } });
  });

  it("for a publish of content that changed after review", async () => {
    const reviewed = (await request("GET", "/api/project-apis/a1")).body.declared.contentHash;
    await save(project(BASE_ROUTES, BASE_HANDLERS.replace("level: 1", "level: 3")));
    expect(await request("POST", "/api/project-apis/a1/publish", { contentHash: reviewed }))
      .toMatchObject({ status: 409, body: { details: { reason: "content-changed" } } });
  });

  it("for a publish before any slug", async () => {
    db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
      VALUES ('a2', 'Other', 't', 'script', 1, 1, 0, 1)`).run();
    const compiled = await compileAutomationProject({ files: project(BASE_ROUTES, BASE_HANDLERS) });
    saveAutomationProject(db, "a2", compiled);
    const hash = (await request("GET", "/api/project-apis/a2")).body.declared.contentHash;
    expect(await request("POST", "/api/project-apis/a2/publish", { contentHash: hash }))
      .toMatchObject({ status: 409, body: { details: { reason: "no-slug" } } });
  });
});

describe("OpenAPI document", () => {
  it("is 404 until something is published", async () => {
    expect((await request("GET", "/api/project-apis/a1/openapi.json")).status).toBe(404);
  });

  it("is a valid OpenAPI 3.1 document of the published snapshot", async () => {
    const snapshot = (await publishCurrent()).body;
    const res = await request("GET", "/api/project-apis/a1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="tank-levels.openapi.json"');
    const doc = res.body;

    const result = await new Validator().validate(structuredClone(doc));
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([expect.objectContaining({ url: "/api/exposed/v1/tank-levels" })]);
    expect(Object.keys(doc.paths)).toEqual(["/level", "/tanks/{id}"]);
    const tank = doc.paths["/tanks/{id}"].get;
    expect(tank.operationId).toBe("tank");
    expect(tank.parameters).toEqual([expect.objectContaining({ name: "id", in: "path", required: true })]);
    expect(tank.responses["200"].content["application/json"].schema).toEqual(TANK);
    expect(Object.keys(tank.responses)).toEqual(["200", "400", "401", "404", "429", "500", "503", "504"]);
    expect(doc.paths["/level"].get.summary).toBe("Current level");
    expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: "http", scheme: "bearer" });
    expect(doc["x-aeolus-snapshot"]).toMatchObject({ id: snapshot.id, contentHash: snapshot.contentHash });
    expect(JSON.stringify(doc)).not.toMatch(/aeo_[0-9a-f]{16}_/);
  });

  it("describes the snapshot, not later edits to the source", async () => {
    await publishCurrent();
    await save(project([{ id: "other", method: "GET", path: "/other", handler: "getLevel", response: LEVEL }], BASE_HANDLERS));
    const doc = (await request("GET", "/api/project-apis/a1/openapi.json")).body;
    expect(Object.keys(doc.paths)).toEqual(["/level", "/tanks/{id}"]);
  });

  it("is 404 again after unpublishing", async () => {
    await publishCurrent();
    await request("POST", "/api/project-apis/a1/unpublish");
    expect((await request("GET", "/api/project-apis/a1/openapi.json")).status).toBe(404);
  });
});

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

describe("testing a published route from the UI", () => {
  async function grantedKey(routeIds: string[]) {
    const client = (await request("POST", "/api/project-apis/clients", { name: "Tester" })).body;
    const { key } = (await request("POST", `/api/project-apis/clients/${client.id}/keys`, { expiresAt: null })).body;
    for (const routeId of routeIds) await request("POST", "/api/project-apis/a1/grants", { clientId: client.id, routeId });
    return { clientId: client.id as string, key: key as string };
  }

  realIt("goes through the real pipeline and reports what a client receives", async () => {
    await publishCurrent();
    const { key } = await grantedKey(["tank"]);
    const ok = await request("POST", "/api/project-apis/a1/try", { routeId: "tank", params: { id: "north/1" }, key });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ path: "/api/exposed/v1/tank-levels/tanks/north%2F1", status: 404 });
    const plain = await request("POST", "/api/project-apis/a1/try", { routeId: "tank", params: { id: "north" }, key });
    expect(plain.body).toMatchObject({ status: 200, body: { id: "north", level: 2 }, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(plain.body.durationMs).toBeGreaterThanOrEqual(0);

    // The grant is enforced exactly as for a client: an ungranted route is 404.
    expect((await request("POST", "/api/project-apis/a1/try", { routeId: "level", key })).body).toMatchObject({ status: 404, body: { error: "Not found" } });
    // A wrong key is 401.
    expect((await request("POST", "/api/project-apis/a1/try", { routeId: "tank", params: { id: "x" }, key: "aeo_0000000000000000_" + "A".repeat(43) })).body)
      .toMatchObject({ status: 401 });
  });

  realIt("never stores, logs, audits or echoes the key", async () => {
    await publishCurrent();
    const { key } = await grantedKey(["level"]);
    const secret = key.split("_").slice(2).join("_");
    loggedByExposed.length = 0;
    const res = await request("POST", "/api/project-apis/a1/try", { routeId: "level", key });
    expect(res.body.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(loggedByExposed.join("\n")).not.toContain(secret);
    const audit = (await request("GET", "/api/project-apis/audit")).body;
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(audit.events.map((e: { action: string }) => e.action)).not.toContain("api.tried");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("needs the API published, the route to exist and every path parameter", async () => {
    expect(await request("POST", "/api/project-apis/a1/try", { routeId: "level", key: "k" })).toMatchObject({ status: 409 });
    await publishCurrent();
    expect(await request("POST", "/api/project-apis/a1/try", { routeId: "nope", key: "k" })).toMatchObject({ status: 404 });
    expect(await request("POST", "/api/project-apis/a1/try", { routeId: "tank", key: "k" }))
      .toMatchObject({ status: 400, body: { error: "Fill in the path parameter id" } });
    expect((await request("POST", "/api/project-apis/a1/try", { routeId: "level", key: "k", extra: 1 })).status).toBe(400);
  });

  it("is refused to a non-admin and a public-demo session, and absent without a loopback URL", async () => {
    await publishCurrent();
    user = { ...ADMIN, role: "user" };
    expect((await request("POST", "/api/project-apis/a1/try", { routeId: "level", key: "k" })).status).toBe(403);
    user = { ...ADMIN, sessionType: "public-demo" };
    expect((await request("POST", "/api/project-apis/a1/try", { routeId: "level", key: "k" })).status).toBe(403);
    user = ADMIN;
    expect((await request("POST", "/api/project-apis/a1/try", { routeId: "level", key: "k" }, { exposed: false })).status).toBe(404);
  });

  it("refuses every management route on a public-demo server, even to a real admin", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: User }).user = ADMIN; next(); });
    app.use("/api/project-apis", createProjectApiRoutes(db, createProjectApiStore(db), createApiAccessStore(db), { publicDemo: true }));
    app.use(errorHandler);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/project-apis`;
    try {
      const calls: Array<[string, string, unknown?]> = [
        ["GET", "/a1"], ["GET", "/clients"], ["POST", "/clients", { name: "x" }], ["POST", "/a1/publish", { contentHash: "0".repeat(64) }],
        ["PUT", "/a1/slug", { slug: "abc" }], ["GET", "/a1/openapi.json"], ["POST", "/a1/try", { routeId: "level", key: "k" }], ["GET", "/audit"],
      ];
      for (const [method, path, body] of calls) {
        const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.headers.get("cache-control")).toBe("no-store");
      }
      expect(db.prepare("SELECT COUNT(*) AS n FROM api_clients").get()).toEqual({ n: 0 });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("reports an unreachable endpoint as 502", async () => {
    await publishCurrent();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as unknown as { user: User }).user = ADMIN; next(); });
    app.use("/api/project-apis", createProjectApiRoutes(db, createProjectApiStore(db), createApiAccessStore(db), { exposedBaseUrl: "http://127.0.0.1:9" }));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/project-apis/a1/try`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routeId: "level", key: "k" }),
      });
      expect(res.status).toBe(502);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
