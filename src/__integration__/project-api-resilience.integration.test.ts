// Phase 3 proof for Project APIs (ADR-0027): a handler that misbehaves cannot hold the
// host, and every request admitted to the sandbox gives its slots back.
//
// Each case runs through the /api/exposed router with a migrated SQLite database and
// a real isolated-vm sandbox. After every test, no request is still counted against
// the per-client limit and no isolate is still running. A skip is not a pass.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import logger from "../logger.js";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { compileProjectApi } from "../project-api/api-compiler.js";
import { createProjectApiStore, type AuditContext } from "../project-api/publication-store.js";
import { createApiAccessStore } from "../project-api/access-store.js";
import { createExposedApiRouter } from "../project-api/exposed-router.js";
import { createRequestLimiter, type RequestLimiter } from "../project-api/request-limits.js";
import { activeApiInvocations, DEFAULT_API_LIMITS, type ApiLimits, type ApiStateReader } from "../project-api/api-sandbox.js";

let isolatedVmAvailable = true;
try {
  await import("isolated-vm");
} catch {
  isolatedVmAvailable = false;
}
const realIt = isolatedVmAvailable ? it : it.skip;

const ADMIN: AuditContext = { actor: { userId: "u-admin", username: "admin" }, requestId: "req" };
const ANY = { type: ["object", "array", "string", "number", "boolean", "null"] };

const HANDLERS: Record<string, string> = {
  spin: `export function spin() { while (true) {} }`,
  spinAfterAwait: `export async function spinAfterAwait() { await Promise.resolve(); while (true) {} }`,
  hang: `export function hang() { return new Promise(() => {}); }`,
  boom: `export function boom() { throw new Error("internal detail 1234"); }`,
  throwString: `export function throwString() { throw "plain string 5678"; }`,
  rejectLater: `export async function rejectLater() { await Promise.resolve(); throw new Error("later 9012"); }`,
  recurse: `export function recurse() { const f = (n: number): number => f(n + 1) + 1; return f(0); }`,
  huge: `export function huge() { return "x".repeat(2 * 1024 * 1024); }`,
  wide: `export function wide() { return "\\u00e9".repeat(40 * 1024); }`,
  hog: `export function hog() { const a: string[] = []; for (;;) a.push("x".repeat(1024 * 1024)); }`,
  echo: `export async function echo(req: { params: { id: string } }) { await Promise.resolve(); return { id: req.params.id }; }`,
  level: `export function level() { return { level: state.get("level") }; }`,
};
const PATHS: Record<string, string> = { echo: "/echo/:id" };
const ROUTES = Object.keys(HANDLERS).map((name) => ({
  id: name.toLowerCase(), method: "GET", path: PATHS[name] ?? `/${name.toLowerCase()}`, handler: name, response: ANY,
}));

let db: DatabaseType;
let key: string;
let clientId: string;
let logs: string[];
const servers: http.Server[] = [];
const limiters: RequestLimiter[] = [];

function migrate(target: DatabaseType): void {
  target.pragma("foreign_keys = ON");
  runMigrations(target, migrations);
}

async function seed(target: DatabaseType): Promise<void> {
  target.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1)").run();
  target.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES ('a1', 'a1', 't', 'script', 1, 1, 1, 1)`).run();
  const api = (await compileProjectApi([
    { path: "api/routes.json", content: JSON.stringify({ version: 1, routes: ROUTES }) },
    { path: "api/handlers.ts", content: Object.values(HANDLERS).join("\n") },
  ]))!;
  const publications = createProjectApiStore(target);
  publications.setSlug("a1", "resilience", ADMIN);
  publications.publish("a1", api, 1, api.contentHash, ADMIN);
  const access = createApiAccessStore(target);
  const client = access.createClient("Consumer", ADMIN);
  clientId = client.id;
  key = access.issueKey(client.id, null, ADMIN).key;
  for (const route of ROUTES) access.grant(client.id, "a1", route.id, ADMIN);
}

interface ServeOptions {
  sandbox?: Partial<ApiLimits>;
  perMinute?: number;
  concurrent?: number;
  stateFor?: (automationId: string) => ApiStateReader;
  database?: DatabaseType;
}

/** A server like src/index.ts mounts, with the limiter returned so its count can be checked. */
function serve(options: ServeOptions = {}) {
  const target = options.database ?? db;
  const limiter = createRequestLimiter({ perMinute: options.perMinute ?? 1000, concurrentPerClient: options.concurrent ?? 8 });
  limiters.push(limiter);
  const app = express();
  app.use("/api/exposed", createExposedApiRouter({
    publications: createProjectApiStore(target),
    access: createApiAccessStore(target),
    stateFor: options.stateFor ?? (() => ({ get: () => 42, getAll: () => ({ level: 42 }) })),
    limiter,
    requireHttps: false,
    sandboxLimits: { ...DEFAULT_API_LIMITS, deadlineMs: 400, ...options.sandbox },
    logger,
  }));
  const server = app.listen(0);
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  const get = async (route: string, withKey = key) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/exposed/v1/resilience${route}`, { headers: { Authorization: `Bearer ${withKey}` } });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as unknown, retryAfter: res.headers.get("retry-after") };
  };
  /** Start a request on a raw socket that the test can drop. */
  const open = (route: string) => {
    const req = http.request({ host: "127.0.0.1", port, path: `/api/exposed/v1/resilience${route}`, headers: { Authorization: `Bearer ${key}` } });
    req.on("error", () => { /* dropped on purpose */ });
    req.end();
    return req;
  };
  return { get, open, limiter, server };
}

const settled = async () => {
  await vi.waitFor(() => {
    expect(activeApiInvocations()).toBe(0);
    for (const limiter of limiters) expect(limiter.inFlight()).toBe(0);
  }, { timeout: 6000, interval: 20 });
};

beforeEach(async () => {
  db = new Database(":memory:");
  migrate(db);
  await seed(db);
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(JSON.stringify(args)); };
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) vi.spyOn(logger, level).mockImplementation(capture as never);
});

afterEach(async () => {
  // Every admitted request has given back its client slot and its isolate.
  await settled();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  limiters.splice(0);
  vi.restoreAllMocks();
  if (db.open) db.close();
});

describe("a handler that never finishes", () => {
  realIt("is ended at the deadline for a synchronous loop, a loop after await and a promise that never settles", async () => {
    const { get } = serve();
    for (const route of ["/spin", "/spinafterawait", "/hang"]) {
      const started = Date.now();
      expect(await get(route), route).toMatchObject({ status: 504, body: { error: "Handler timed out" } });
      expect(Date.now() - started, route).toBeLessThan(400 + 600);
    }
  });

  realIt("does not stall the host's event loop while it spins after an await", async () => {
    const { get } = serve({ sandbox: { deadlineMs: 600 } });
    let ticks = 0;
    const heartbeat = setInterval(() => ticks++, 20);
    const result = await get("/spinafterawait");
    clearInterval(heartbeat);
    expect(result.status).toBe(504);
    expect(ticks).toBeGreaterThan(10);
  });

  realIt("leaves the server answering other requests while one spins", async () => {
    const { get } = serve({ sandbox: { deadlineMs: 800 } });
    const spinning = get("/spin");
    const started = Date.now();
    expect(await get("/level")).toMatchObject({ status: 200, body: { level: 42 } });
    expect(Date.now() - started).toBeLessThan(800);
    expect((await spinning).status).toBe(504);
  });
});

describe("a handler that fails", () => {
  realIt("maps every kind of exception to the same 500, without its message", async () => {
    const { get } = serve();
    for (const route of ["/boom", "/throwstring", "/rejectlater", "/recurse"]) {
      const result = await get(route);
      expect(result, route).toMatchObject({ status: 500, body: { error: "Handler failed" } });
      expect(result.text).not.toMatch(/1234|5678|9012|stack|Maximum call/);
    }
  });

  realIt("refuses an oversized response, whether it is long in characters or only in UTF-8 bytes", async () => {
    const { get } = serve();
    for (const route of ["/huge", "/wide"]) {
      const result = await get(route);
      expect(result, route).toMatchObject({ status: 500, body: { error: "Handler failed" } });
      expect(result.text.length).toBeLessThan(100);
    }
    expect(logs.some((line) => line.includes('"too-large"'))).toBe(true);
  });

  realIt("ends a handler that exhausts its memory, and the next request is served normally", async () => {
    const { get } = serve({ sandbox: { memoryMb: 16, deadlineMs: 5000 } });
    expect(await get("/hog")).toMatchObject({ status: 500, body: { error: "Handler failed" } });
    expect(logs.some((line) => line.includes('"memory"'))).toBe(true);
    expect(await get("/level")).toMatchObject({ status: 200, body: { level: 42 } });
  });

  realIt("releases its slot when the host's state reader fails before the isolate starts", async () => {
    const { get } = serve({ stateFor: () => { throw new Error("state store unavailable"); }, concurrent: 1 });
    expect(await get("/level")).toMatchObject({ status: 500, body: { error: "Handler failed" } });
    // With one slot per client, a leaked slot would make this a 429.
    expect((await get("/level")).status).toBe(500);
  });

  realIt("releases its slot when a state read fails inside the isolate", async () => {
    const { get } = serve({ stateFor: () => ({ get: () => { throw new Error("database is locked"); }, getAll: () => ({}) }), concurrent: 1 });
    expect((await get("/level")).status).toBe(500);
    expect((await get("/level")).status).toBe(500);
  });

  realIt("gives back every slot after a run of mixed failures with one concurrent slot", async () => {
    const { get } = serve({ concurrent: 1, sandbox: { memoryMb: 16, deadlineMs: 400 } });
    const statuses: number[] = [];
    for (const route of ["/boom", "/spin", "/huge", "/hog", "/hang", "/recurse", "/nope", "/level"]) statuses.push((await get(route)).status);
    expect(statuses).toEqual([500, 504, 500, 500, 504, 500, 404, 200]);
  });
});

describe("concurrent requests", () => {
  realIt("each run in their own isolate and get their own answer", async () => {
    const { get } = serve({ sandbox: { maxConcurrent: 8 }, concurrent: 8 });
    const ids = Array.from({ length: 8 }, (_, i) => `req-${i}`);
    const results = await Promise.all(ids.map((id) => get(`/echo/${id}`)));
    expect(results.map((r) => r.status)).toEqual(ids.map(() => 200));
    expect(results.map((r) => (r.body as { id: string }).id)).toEqual(ids);
  });

  realIt("past the server-wide isolate cap get 503 with Retry-After, and the cap frees up afterwards", async () => {
    const { get } = serve({ sandbox: { maxConcurrent: 2 }, concurrent: 8 });
    const results = await Promise.all([get("/hang"), get("/hang"), get("/hang")]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([503, 504, 504]);
    expect(results.find((r) => r.status === 503)!.retryAfter).toBe("1");
    await settled();
    expect((await get("/level")).status).toBe(200);
  });

  realIt("past the per-client cap get 429, and the slot frees up afterwards", async () => {
    const { get } = serve({ concurrent: 2 });
    const statuses = (await Promise.all([get("/hang"), get("/hang"), get("/hang")])).map((r) => r.status).sort();
    expect(statuses).toEqual([429, 504, 504]);
    expect((await get("/level")).status).toBe(200);
  });
});

describe("a caller that goes away", () => {
  realIt("has its isolate disposed at once rather than at the deadline, and its slots released", async () => {
    const { open, limiter } = serve({ sandbox: { deadlineMs: 5000 }, concurrent: 1 });
    const req = open("/spin");
    await vi.waitFor(() => expect(activeApiInvocations()).toBe(1), { timeout: 2000, interval: 10 });
    expect(limiter.inFlight()).toBe(1);
    const dropped = Date.now();
    req.destroy();
    await vi.waitFor(() => expect(activeApiInvocations()).toBe(0), { timeout: 2000, interval: 10 });
    expect(Date.now() - dropped).toBeLessThan(1000);
    expect(limiter.inFlight()).toBe(0);
    await vi.waitFor(() => expect(logs.some((line) => line.includes("client-disconnected"))).toBe(true));
  });

  realIt("waiting on a promise is ended the same way", async () => {
    const { open, get } = serve({ sandbox: { deadlineMs: 5000 }, concurrent: 1 });
    const req = open("/hang");
    await vi.waitFor(() => expect(activeApiInvocations()).toBe(1), { timeout: 2000, interval: 10 });
    req.destroy();
    await settled();
    // The one slot is free again.
    expect((await get("/level")).status).toBe(200);
  });
});

describe("restarting the server", () => {
  realIt("serves the same snapshot, grants and keys from the database; limits and in-flight work do not survive", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aeolus-restart-"));
    const file = path.join(dir, "aeolus.db");
    let first: DatabaseType | null = new Database(file);
    try {
      migrate(first);
      await seed(first);
      const before = serve({ database: first, perMinute: 3, sandbox: { deadlineMs: 5000 } });
      expect((await before.get("/level")).status).toBe(200);
      expect((await before.get("/level")).status).toBe(200);
      // Shutting the listener down mid-request ends the isolate and records nothing
      // about the request: nothing about in-flight work is persisted.
      before.open("/spin");
      await vi.waitFor(() => expect(activeApiInvocations()).toBe(1), { timeout: 2000, interval: 10 });
      expect((await before.get("/level")).status).toBe(429);
      before.server.closeAllConnections();
      await new Promise((resolve) => before.server.close(resolve));
      await settled();
      first.close();
      first = null;

      const second = new Database(file);
      try {
        migrate(second);
        const after = serve({ database: second, perMinute: 2 });
        // In-memory rate windows started again; the snapshot, grant and key did not.
        expect(await after.get("/level")).toMatchObject({ status: 200, body: { level: 42 } });
        expect(await after.get("/echo/again")).toMatchObject({ status: 200, body: { id: "again" } });
        // A revocation made before a restart still holds after it.
        createApiAccessStore(second).setClientStatus(clientId, "disabled", ADMIN);
        second.close();
        const third = new Database(file);
        try {
          expect((await serve({ database: third }).get("/level")).status).toBe(401);
        } finally {
          await settled();
          for (const server of servers.splice(0)) {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
          }
          third.close();
        }
      } finally {
        if (second.open) second.close();
      }
    } finally {
      first?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
