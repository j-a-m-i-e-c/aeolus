// Phase 2 proof for Project APIs (ADR-0027): the /api/exposed router, end to end, with
// the same middleware in front of it as src/index.ts, a migrated SQLite database and a
// real isolated-vm sandbox. A skip is not a pass for anything here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import logger from "../logger.js";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { corsMiddleware } from "../api/middleware/cors-config.js";
import { requestLogger } from "../api/middleware/request-logger.js";
import { urlCredentialGuard } from "../api/middleware/url-credential-guard.js";
import { metricsMiddleware } from "../metrics/metrics-middleware.js";
import { metricsService } from "../metrics/metrics-service.js";
import { compileProjectApi, type CompiledProjectApi } from "../project-api/api-compiler.js";
import { createProjectApiStore, type AuditContext, type ProjectApiStore } from "../project-api/publication-store.js";
import { createApiAccessStore, type ApiAccessStore } from "../project-api/access-store.js";
import { createDisabledExposedApiRouter, createExposedApiRouter } from "../project-api/exposed-router.js";
import { createRequestLimiter } from "../project-api/request-limits.js";
import { DEFAULT_API_LIMITS } from "../project-api/api-sandbox.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

const ADMIN: AuditContext = { actor: { userId: "u-admin", username: "admin" }, requestId: "req" };
const LEVEL_SCHEMA = { type: "object", properties: { level: { type: "number" } }, required: ["level"], additionalProperties: false };
const route = (id: string, path: string, handler: string, response: Record<string, unknown> = LEVEL_SCHEMA) => ({ id, method: "GET", path, handler, response });

const ROUTES = [
  route("level", "/level", "getLevel"),
  route("tank", "/tanks/:id", "getTank"),
  route("bad", "/bad", "getBad"),
  route("spin", "/spin", "spin"),
  route("secret", "/secret", "getSecret"),
];
const HANDLERS = `
  export function getLevel() { return { level: state.get("level") }; }
  export function getTank(req: { params: { id: string } }) {
    if (req.params.id !== "main") return api.response(404, { error: "Tank not found" });
    return { level: 99 };
  }
  export function getBad() { return { level: "not a number" }; }
  export function spin() { while (true) {} }
  export function getSecret() { return { level: -1 }; }
`;

async function compile(routes = ROUTES, handlers = HANDLERS): Promise<CompiledProjectApi> {
  return (await compileProjectApi([
    { path: "api/routes.json", content: JSON.stringify({ version: 1, routes }) },
    { path: "api/handlers.ts", content: handlers },
  ]))!;
}

let db: DatabaseType;
let publications: ProjectApiStore;
let access: ApiAccessStore;
let state: Record<string, Record<string, unknown>>;
let onStateRead: (() => void) | null;
let logs: string[];
let fellThrough: number;

function addAutomation(id: string): void {
  db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES (?, ?, 't', 'script', 1, 1, 1, 1)`).run(id, id);
}

async function publish(automationId: string, slug: string, routes = ROUTES, handlers = HANDLERS) {
  if (!publications.get(automationId)) publications.setSlug(automationId, slug, ADMIN);
  const api = await compile(routes, handlers);
  const rev = (db.prepare("SELECT revision FROM automation_rules WHERE id = ?").get(automationId) as { revision: number }).revision;
  return publications.publish(automationId, api, rev, api.contentHash, ADMIN);
}

/** A client with one key, granted the given routes of a1's API. */
function client(name: string, routeIds: string[] = ["level", "tank", "bad", "spin"], automationId = "a1") {
  const record = access.createClient(name, ADMIN);
  const { key, credential } = access.issueKey(record.id, null, ADMIN);
  for (const routeId of routeIds) access.grant(record.id, automationId, routeId, ADMIN);
  return { id: record.id, key, credentialId: credential.id };
}

interface AppOptions { requireHttps?: boolean; trustProxy?: number; perMinute?: number; concurrent?: number; demo?: boolean }

function app(options: AppOptions = {}) {
  const server = express();
  if (options.trustProxy) server.set("trust proxy", options.trustProxy);
  server.use((req, res, next) => (req.path.startsWith("/api/exposed") ? next() : corsMiddleware(req, res, next)));
  server.use(express.json({ limit: "1mb" }));
  server.use(requestLogger);
  server.use(urlCredentialGuard);
  server.use(metricsMiddleware());
  server.use("/api/exposed", options.demo ? createDisabledExposedApiRouter() : createExposedApiRouter({
    publications,
    access,
    stateFor: (automationId) => ({
      get: (key) => { onStateRead?.(); return state[automationId]?.[key]; },
      getAll: () => ({ ...state[automationId] }),
    }),
    limiter: createRequestLimiter({ perMinute: options.perMinute ?? 1000, concurrentPerClient: options.concurrent ?? 4 }),
    requireHttps: options.requireHttps ?? false,
    sandboxLimits: { ...DEFAULT_API_LIMITS, deadlineMs: 400 },
    logger,
  }));
  // Stands in for authenticate and every dashboard route behind it.
  server.use((_req, res) => { fellThrough++; res.status(418).json({ dashboard: true }); });
  return server;
}

async function call(path: string, init: RequestInit & { key?: string } = {}, options: AppOptions = {}) {
  const server = app(options).listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const headers = new Headers(init.headers);
    if (init.key) headers.set("Authorization", `Bearer ${init.key}`);
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers });
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) as Record<string, unknown> : null, headers: res.headers };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const URL = (slug: string, rest: string) => `/api/exposed/v1/${slug}${rest}`;

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1), ('u-admin-2', 'second', 'x', 'admin', 1)").run();
  addAutomation("a1");
  addAutomation("a2");
  publications = createProjectApiStore(db);
  access = createApiAccessStore(db);
  state = { a1: { level: 42 }, a2: { level: 7 } };
  onStateRead = null;
  fellThrough = 0;
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(JSON.stringify(args)); };
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) vi.spyOn(logger, level).mockImplementation(capture as never);
  vi.spyOn(metricsService, "recordHttpRequest").mockImplementation((...args: unknown[]) => { logs.push(JSON.stringify(args)); });
  await publish("a1", "tank-levels");
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });

describe("serving a granted route", () => {
  realIt("runs the published snapshot and returns its schema-valid JSON", async () => {
    const c = client("Remote farm");
    const res = await call(URL("tank-levels", "/level"), { key: c.key });
    expect(res).toMatchObject({ status: 200, body: { level: 42 } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  realIt("passes a handler's own 404 through, and decodes path parameters once", async () => {
    const c = client("Remote farm");
    expect(await call(URL("tank-levels", "/tanks/main"), { key: c.key })).toMatchObject({ status: 200, body: { level: 99 } });
    expect(await call(URL("tank-levels", "/tanks/spare"), { key: c.key })).toMatchObject({ status: 404, body: { error: "Tank not found" } });
  });

  realIt("answers HEAD like GET, without a body", async () => {
    const c = client("Remote farm");
    const res = await call(URL("tank-levels", "/level"), { key: c.key, method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("");
  });

  realIt("refuses a body that breaks the declared schema, without leaking it", async () => {
    const c = client("Remote farm");
    const res = await call(URL("tank-levels", "/bad"), { key: c.key });
    expect(res).toMatchObject({ status: 500, body: { error: "Handler failed" } });
    expect(res.text).not.toContain("not a number");
  });

  realIt("ends a handler that never returns with 504", async () => {
    const c = client("Remote farm");
    expect(await call(URL("tank-levels", "/spin"), { key: c.key })).toMatchObject({ status: 504, body: { error: "Handler timed out" } });
  });

  realIt("never runs code edited after publication", async () => {
    const c = client("Remote farm");
    // The source changes to something else entirely; nothing is republished.
    await compile(ROUTES, HANDLERS.replace('state.get("level")', "-1"));
    expect(await call(URL("tank-levels", "/level"), { key: c.key })).toMatchObject({ status: 200, body: { level: 42 } });
  });
});

describe("credentials: one uniform 401", () => {
  realIt("for every way a key can be wrong, before any lookup of the API", async () => {
    const c = client("Remote farm");
    const [, id] = /^aeo_([0-9a-f]{16})_/.exec(c.key)!;
    const expired = access.issueKey(c.id, Date.now() + 50, ADMIN).key;
    const revoked = access.issueKey(c.id, null, ADMIN);
    access.revokeKey(c.id, revoked.credential.id, ADMIN);
    const disabled = client("Disabled client");
    access.setClientStatus(disabled.id, "disabled", ADMIN);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const cases: Array<RequestInit & { key?: string }> = [
      {},
      { headers: { Authorization: "Basic dXNlcjpwYXNz" } },
      { headers: { Authorization: `Bearer ${c.key} extra` } },
      { headers: { Authorization: c.key } },
      { key: "aeo_short_x" },
      { key: `aeo_${"f".repeat(16)}_${"A".repeat(43)}` },
      { key: `aeo_${id}_${"A".repeat(43)}` },
      { key: expired },
      { key: revoked.key },
      { key: disabled.key },
      { key: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl" },
      { headers: { Cookie: "aeolus_refresh=abc; refresh_token=abc" } },
    ];
    const bodies = new Set<string>();
    for (const init of cases) {
      const res = await call(URL("tank-levels", "/level"), init);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
      bodies.add(res.text);
    }
    expect([...bodies]).toEqual([JSON.stringify({ error: "Unauthorized" })]);
    expect(fellThrough).toBe(0);
  });

  realIt("treats a key on a path that does not exist the same way", async () => {
    expect((await call("/api/exposed/v1/no-such-api/whatever")).status).toBe(401);
    expect((await call("/api/exposed/anything")).status).toBe(401);
  });
});

describe("authorization: one uniform 404", () => {
  realIt("an ungranted route, unknown route, unknown slug, other project's API and wrong version are indistinguishable", async () => {
    const c = client("Remote farm", ["level"]);
    await publish("a2", "pump-status");
    const other = client("Other farm", ["level"], "a2");

    const paths = [
      URL("tank-levels", "/secret"),       // published, not granted
      URL("tank-levels", "/tanks/main"),   // published, not granted
      URL("tank-levels", "/nope"),         // no such route
      URL("tank-levels", "/level/extra"),
      URL("tank-levels", "/a%2Fb"),
      URL("no-such-api", "/level"),        // no such API
      URL("pump-status", "/level"),        // another project's API
      "/api/exposed/v2/tank-levels/level", // wrong version
      "/api/exposed/v1/BAD_SLUG/level",
      "/api/exposed/v1/tank-levels",
    ];
    const bodies = new Set<string>();
    for (const path of paths) {
      const res = await call(path, { key: c.key });
      expect(res.status, path).toBe(404);
      bodies.add(res.text);
    }
    expect([...bodies]).toEqual([JSON.stringify({ error: "Not found" })]);
    // The other client reaches its own API and nothing of a1's.
    expect(await call(URL("pump-status", "/level"), { key: other.key })).toMatchObject({ status: 200, body: { level: 7 } });
    expect((await call(URL("tank-levels", "/level"), { key: other.key })).status).toBe(404);
  });

  realIt("does not reveal a granted API's state to a caller with no grant to it", async () => {
    client("Granted", ["level"]);
    const stranger = client("Stranger", []);
    db.prepare("UPDATE automation_rules SET enabled = 0 WHERE id = 'a1'").run();
    expect((await call(URL("tank-levels", "/level"), { key: stranger.key })).status).toBe(404);
  });

  realIt("a reclaimed slug inherits nothing from the API that used to hold it", async () => {
    const c = client("Remote farm", ["level"]);
    publications.setSlug("a1", "water-levels", ADMIN);
    expect(await call(URL("water-levels", "/level"), { key: c.key })).toMatchObject({ status: 200 });
    publications.setSlug("a2", "tank-levels", ADMIN, true);
    await publish("a2", "tank-levels");
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(404);
  });
});

describe("methods, CORS and query strings", () => {
  realIt("returns the same 405 for any other method on existing and non-existent paths, with no CORS approval", async () => {
    const c = client("Remote farm");
    const bodies = new Set<string>();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of [URL("tank-levels", "/level"), URL("no-such-api", "/x"), "/api/exposed/zzz"]) {
        const res = await call(path, {
          method, key: c.key,
          headers: { Origin: "http://192.168.1.20:3000", "Access-Control-Request-Method": "GET" },
        });
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers.get("allow")).toBe("GET, HEAD");
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
        bodies.add(res.text);
      }
    }
    expect([...bodies]).toEqual([JSON.stringify({ error: "Method not allowed" })]);
    expect(fellThrough).toBe(0);
  });

  realIt("refuses any query string, and a key in one never reaches the logs or metrics", async () => {
    const c = client("Remote farm");
    expect((await call(`${URL("tank-levels", "/level")}?limit=5`, { key: c.key })).status).toBe(400);
    const leaked = await call(`${URL("tank-levels", "/level")}?api_key=${c.key}`);
    expect(leaked.status).toBe(400);
    expect((await call(`${URL("tank-levels", "/level")}?x=${encodeURIComponent(c.key)}`)).status).toBe(400);
    await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0));
    const secret = c.key.split("_").slice(2).join("_");
    expect(logs.join("\n")).not.toContain(secret);
  });

  realIt("keeps keys, response bodies and state out of logs and metrics on success too", async () => {
    const c = client("Remote farm");
    state.a1!.level = 123456789;
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(200);
    // The metrics label is recorded when the response finishes, after the log line.
    await vi.waitFor(() => expect(logs.some((line) => line.includes("/api/exposed/:slug/:route"))).toBe(true));
    const all = logs.join("\n");
    expect(all).toContain("Project API request");
    expect(all).not.toContain(c.key.split("_").slice(2).join("_"));
    expect(all).not.toContain("123456789");
    // Metrics carry one label for all exposed traffic, never the slug or route path.
    const metricLines = logs.filter((line) => line.startsWith('["GET"'));
    expect(metricLines.length).toBeGreaterThan(0);
    for (const line of metricLines) expect(line).toContain("/api/exposed/:slug/:route");
  });

  realIt("never falls through to the dashboard, whatever is sent", async () => {
    client("Remote farm");
    for (const path of ["/api/exposed", "/api/exposed/", "/api/exposed/v1"]) {
      await call(path, { headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln" } });
    }
    // Sent raw: fetch would normalise these dot segments away before sending.
    const server = app().listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      for (const path of ["/api/exposed/../automations", "/api/exposed/%2e%2e/automations", "/api/exposed/v1/tank-levels/../../../automations"]) {
        const status = await new Promise<number>((resolve, reject) => {
          const req = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
          req.on("error", reject);
          req.end();
        });
        expect(status, path).toBe(401);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect(fellThrough).toBe(0);
  });
});

describe("revocation and lifecycle take effect on the next request", () => {
  realIt("revoking the key mid-request lets that request finish and refuses the next", async () => {
    const c = client("Remote farm");
    onStateRead = () => { access.revokeKey(c.id, c.credentialId, ADMIN); onStateRead = null; };
    // Documented behaviour: an already-authorised read finishes within the sandbox deadline.
    expect(await call(URL("tank-levels", "/level"), { key: c.key })).toMatchObject({ status: 200, body: { level: 42 } });
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(401);
  });

  realIt("revoking a grant, disabling the client or unpublishing applies at once", async () => {
    const c = client("Remote farm");
    access.revokeGrant(c.id, "a1", "tank", ADMIN);
    expect((await call(URL("tank-levels", "/tanks/main"), { key: c.key })).status).toBe(404);
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(200);

    access.setClientStatus(c.id, "disabled", ADMIN);
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(401);
    access.setClientStatus(c.id, "active", ADMIN);
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(200);

    const { revokedGrants } = publications.unpublish("a1", ADMIN);
    expect(revokedGrants).toBe(3);
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(404);
  });

  realIt("unpublishing revokes grants for good: republishing identical source restores none, and the key still works elsewhere", async () => {
    const c = client("Remote farm", ["level"]);
    await publish("a2", "pump-status");
    access.grant(c.id, "a2", "level", ADMIN);

    publications.unpublish("a1", ADMIN);
    await publish("a1", "tank-levels");
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(404);
    expect((await call(URL("pump-status", "/level"), { key: c.key })).status).toBe(200);

    const history = access.getClient(c.id).grants.filter((g) => g.routeId === "level");
    expect(history.map((g) => g.revokeReason)).toContain("unpublished");
    access.grant(c.id, "a1", "level", ADMIN);
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(200);
  });

  realIt("disabling the automation is temporary: 503 for the granted caller, and grants survive re-enabling", async () => {
    const c = client("Remote farm", ["level"]);
    db.prepare("UPDATE automation_rules SET enabled = 0 WHERE id = 'a1'").run();
    expect(await call(URL("tank-levels", "/level"), { key: c.key })).toMatchObject({ status: 503, body: { error: "API unavailable" } });
    db.prepare("UPDATE automation_rules SET enabled = 1 WHERE id = 'a1'").run();
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(200);
  });

  realIt("a runtime-contract mismatch is temporary too, and revokes nothing", async () => {
    const c = client("Remote farm", ["level"]);
    const upgraded = createProjectApiStore(db, { runtimeContract: 2 });
    const server = express();
    server.use("/api/exposed", createExposedApiRouter({
      publications: upgraded, access, stateFor: () => ({ get: () => 1, getAll: () => ({}) }),
      limiter: createRequestLimiter({ perMinute: 100, concurrentPerClient: 2 }), requireHttps: false, logger,
    }));
    const listener = server.listen(0);
    const res = await fetch(`http://127.0.0.1:${(listener.address() as { port: number }).port}${URL("tank-levels", "/level")}`, { headers: { Authorization: `Bearer ${c.key}` } });
    await new Promise((resolve) => listener.close(resolve));
    expect(res.status).toBe(503);
    expect(access.getClient(c.id).grants.every((g) => g.revokedAt === null)).toBe(true);
  });

  realIt("demoting the publisher withdraws approval and revokes its grants", async () => {
    const c = client("Remote farm", ["level"]);
    db.prepare("UPDATE users SET role = 'user' WHERE id = 'u-admin'").run();
    db.prepare("UPDATE users SET role = 'admin' WHERE id = 'u-admin'").run();
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(404);
    expect(access.getClient(c.id).grants[0]).toMatchObject({ revokeReason: "publication-withdrawn" });
  });

  realIt("republishing keeps grants for unchanged routes and revokes them for changed ones", async () => {
    const c = client("Remote farm", ["level", "tank"]);
    const changed = ROUTES.map((r) => (r.id === "tank" ? { ...r, path: "/tank/:id" } : r));
    await publish("a1", "tank-levels", changed);
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(200);
    expect((await call(URL("tank-levels", "/tank/main"), { key: c.key })).status).toBe(404);
    expect(access.getClient(c.id).grants.find((g) => g.routeId === "tank")).toMatchObject({ revokeReason: "route-changed" });
  });

  realIt("a new route published later is not covered by an existing grant", async () => {
    const c = client("Remote farm", ["level"]);
    await publish("a1", "tank-levels", [...ROUTES, route("extra", "/extra", "getLevel")]);
    expect((await call(URL("tank-levels", "/extra"), { key: c.key })).status).toBe(404);
  });

  realIt("key rotation with an overlap keeps the old key working only until then", async () => {
    const c = client("Remote farm", ["level"]);
    const rotated = access.rotateKey(c.id, c.credentialId, 1, ADMIN);
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(200);
    expect((await call(URL("tank-levels", "/level"), { key: rotated.key })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await call(URL("tank-levels", "/level"), { key: c.key })).status).toBe(401);
    expect((await call(URL("tank-levels", "/level"), { key: rotated.key })).status).toBe(200);
  });
});

describe("limits", () => {
  realIt("returns 429 with Retry-After past the per-minute limit", async () => {
    const c = client("Remote farm", ["level"]);
    const server = app({ perMinute: 2 }).listen(0);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const statuses: number[] = [];
      let retryAfter: string | null = null;
      for (let i = 0; i < 3; i++) {
        const res = await fetch(base + URL("tank-levels", "/level"), { headers: { Authorization: `Bearer ${c.key}` } });
        statuses.push(res.status);
        retryAfter = res.headers.get("retry-after") ?? retryAfter;
      }
      expect(statuses).toEqual([200, 200, 429]);
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  realIt("caps concurrent requests per client", async () => {
    const c = client("Remote farm", ["spin"]);
    const server = app({ concurrent: 1 }).listen(0);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const go = () => fetch(base + URL("tank-levels", "/spin"), { headers: { Authorization: `Bearer ${c.key}` } }).then((r) => r.status);
      const statuses = await Promise.all([go(), go()]);
      expect(statuses.sort()).toEqual([429, 504]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("HTTPS enforcement", () => {
  realIt("refuses plain HTTP, and a forged X-Forwarded-Proto when no proxy is trusted", async () => {
    const c = client("Remote farm", ["level"]);
    expect(await call(URL("tank-levels", "/level"), { key: c.key }, { requireHttps: true })).toMatchObject({ status: 403, body: { error: "HTTPS is required" } });
    expect((await call(URL("tank-levels", "/level"), { key: c.key, headers: { "X-Forwarded-Proto": "https" } }, { requireHttps: true })).status).toBe(403);
  });

  realIt("accepts X-Forwarded-Proto only from a trusted proxy hop", async () => {
    const c = client("Remote farm", ["level"]);
    // trust proxy 1: the hop that connected (here 127.0.0.1) is the trusted proxy.
    expect((await call(URL("tank-levels", "/level"), { key: c.key, headers: { "X-Forwarded-Proto": "https" } }, { requireHttps: true, trustProxy: 1 })).status).toBe(200);
    expect((await call(URL("tank-levels", "/level"), { key: c.key, headers: { "X-Forwarded-Proto": "http" } }, { requireHttps: true, trustProxy: 1 })).status).toBe(403);
  });
});

describe("other refusals", () => {
  realIt("refuses an over-long URL with 414 before reading the key", async () => {
    expect((await call(URL("tank-levels", "/" + "a".repeat(2100)))).status).toBe(414);
  });

  realIt("maps a handler that throws to 500 and a full sandbox to 503 with Retry-After", async () => {
    await publish("a1", "tank-levels", [...ROUTES, route("boom", "/boom", "boom")], HANDLERS + "\nexport function boom() { throw new Error('secret internals'); }");
    const c = client("Remote farm", ["boom", "level"]);
    const failed = await call(URL("tank-levels", "/boom"), { key: c.key });
    expect(failed).toMatchObject({ status: 500, body: { error: "Handler failed" } });
    expect(failed.text).not.toContain("secret internals");

    const server = express();
    server.use("/api/exposed", createExposedApiRouter({
      publications, access, stateFor: () => ({ get: () => 1, getAll: () => ({}) }),
      limiter: createRequestLimiter({ perMinute: 100, concurrentPerClient: 4 }), requireHttps: false, logger,
      sandboxLimits: { ...DEFAULT_API_LIMITS, maxConcurrent: 0 },
    }));
    const listener = server.listen(0);
    const res = await fetch(`http://127.0.0.1:${(listener.address() as { port: number }).port}${URL("tank-levels", "/level")}`, { headers: { Authorization: `Bearer ${c.key}` } });
    await new Promise((resolve) => listener.close(resolve));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("1");
  });
});

describe("public-demo mode", () => {
  realIt("answers every exposed path with the fixed 404, even with a valid key", async () => {
    const c = client("Remote farm", ["level"]);
    expect(await call(URL("tank-levels", "/level"), { key: c.key }, { demo: true })).toMatchObject({ status: 404, body: { error: "Not found" } });
    expect((await call(URL("tank-levels", "/level"), { key: c.key, method: "POST" }, { demo: true })).status).toBe(404);
    expect(fellThrough).toBe(0);
  });
});
