// src/api/routes/project-api.access.routes.test.ts — managing API clients, keys and
// grants (ADR-0027, Phase 2). Real admins only; a key is shown once; machine keys
// cannot use any management or dashboard route.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../../db/migration-runner.js";
import { migrations } from "../../db/migrations/index.js";
import { compileAutomationProject, saveAutomationProject } from "../../automations/automation-project.js";
import { createProjectApiStore } from "../../project-api/publication-store.js";
import { createApiAccessStore } from "../../project-api/access-store.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createProjectApiRoutes } from "./project-api.routes.js";

vi.mock("../../logger.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let db: DatabaseType;
const ADMIN = { userId: "u-admin", username: "admin", role: "admin" as const, groupId: null };

async function request(method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: typeof ADMIN }).user = ADMIN; next(); });
  app.use("/api/project-apis", createProjectApiRoutes(db, createProjectApiStore(db), createApiAccessStore(db)));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function publishA1() {
  await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
  const status = await request("GET", "/api/project-apis/a1");
  expect((await request("POST", "/api/project-apis/a1/publish", { contentHash: status.body.declared.contentHash })).status).toBe(201);
}

beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, migrations);
  db.prepare("INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-admin', 'admin', 'x', 'admin', 1)").run();
  db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
    VALUES ('a1', 'Tanks', 't', 'script', 1, 1, 1, 1)`).run();
  saveAutomationProject(db, "a1", await compileAutomationProject({ files: [
    { path: "logic/index.ts", content: "export default function run() {}" },
    { path: "api/routes.json", content: JSON.stringify({ version: 1, routes: [{ id: "level", method: "GET", path: "/level", handler: "getLevel", response: { type: "object" } }] }) },
    { path: "api/handlers.ts", content: "export function getLevel() { return {}; }" },
  ] }));
});
afterEach(() => db.close());

describe("clients and keys", () => {
  it("creates a client and shows its key once, never again", async () => {
    const created = await request("POST", "/api/project-apis/clients", { name: "Remote Farm Installation" });
    expect(created.status).toBe(201);
    const issued = await request("POST", `/api/project-apis/clients/${created.body.id}/keys`, {});
    expect(issued.status).toBe(201);
    expect(issued.body.key).toMatch(/^aeo_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    const secret = issued.body.key.split("_").slice(2).join("_");
    expect(issued.body.credential.last4).toBe(secret.slice(-4));

    const detail = await request("GET", `/api/project-apis/clients/${created.body.id}`);
    const list = await request("GET", "/api/project-apis/clients");
    const audit = await request("GET", "/api/project-apis/audit?limit=200");
    for (const res of [detail, list, audit]) {
      expect(res.text).not.toContain(secret);
      expect(res.text).not.toContain("secret_hash");
      expect(res.text).not.toContain("secretHash");
    }
    expect(detail.body.credentials[0]).toMatchObject({ keyId: issued.body.credential.keyId, revokedAt: null });
    expect(list.body.clients[0]).toMatchObject({ name: "Remote Farm Installation", activeKeys: 1, activeGrants: 0 });
    expect(audit.body.events.map((e: { action: string }) => e.action)).toEqual(["key.issued", "client.created"]);
  });

  it("rotates with or without overlap and revokes", async () => {
    const client = (await request("POST", "/api/project-apis/clients", { name: "Farm" })).body;
    const first = (await request("POST", `/api/project-apis/clients/${client.id}/keys`, {})).body;
    const rotated = await request("POST", `/api/project-apis/clients/${client.id}/keys/${first.credential.id}/rotate`, { overlapSeconds: 3600 });
    expect(rotated.status).toBe(201);
    expect(rotated.body.key).not.toBe(first.key);
    const detail = (await request("GET", `/api/project-apis/clients/${client.id}`)).body;
    expect(detail.credentials.find((c: { id: string }) => c.id === first.credential.id).expiresAt).toBeGreaterThan(Date.now());

    expect((await request("POST", `/api/project-apis/clients/${client.id}/keys/${rotated.body.credential.id}/revoke`)).body.revokedAt).not.toBeNull();
    expect((await request("POST", `/api/project-apis/clients/${client.id}/keys/${rotated.body.credential.id}/rotate`, {})).status).toBe(409);
  });

  it.each([
    ["an empty name", "/api/project-apis/clients", { name: "" }],
    ["an unknown field", "/api/project-apis/clients", { name: "x", role: "admin" }],
    ["a past expiry", "KEYS", { expiresAt: 1 }],
    ["an overlap over a week", "ROTATE", { overlapSeconds: 8 * 24 * 3600 }],
  ])("rejects %s with 400", async (_label, path, body) => {
    const client = (await request("POST", "/api/project-apis/clients", { name: "Farm" })).body;
    const key = (await request("POST", `/api/project-apis/clients/${client.id}/keys`, {})).body;
    const target = path === "KEYS" ? `/api/project-apis/clients/${client.id}/keys`
      : path === "ROTATE" ? `/api/project-apis/clients/${client.id}/keys/${key.credential.id}/rotate` : path;
    expect((await request("POST", target, body)).status).toBe(400);
  });

  it("returns 404 for unknown clients and keys", async () => {
    expect((await request("GET", "/api/project-apis/clients/nope")).status).toBe(404);
    expect((await request("POST", "/api/project-apis/clients/nope/keys", {})).status).toBe(404);
    const client = (await request("POST", "/api/project-apis/clients", { name: "Farm" })).body;
    expect((await request("POST", `/api/project-apis/clients/${client.id}/keys/nope/revoke`)).status).toBe(404);
  });

  it("disables and re-enables a client, audited", async () => {
    const client = (await request("POST", "/api/project-apis/clients", { name: "Farm" })).body;
    expect((await request("POST", `/api/project-apis/clients/${client.id}/disable`)).body.status).toBe("disabled");
    expect((await request("POST", `/api/project-apis/clients/${client.id}/disable`)).body.status).toBe("disabled");
    expect((await request("POST", `/api/project-apis/clients/${client.id}/enable`)).body.status).toBe("active");
    const actions = (await request("GET", "/api/project-apis/audit")).body.events.map((e: { action: string }) => e.action);
    expect(actions.slice(0, 2)).toEqual(["client.enabled", "client.disabled"]);
  });
});

describe("grants", () => {
  it("grants only a route of a live publication, and unpublishing reports the revocations", async () => {
    const client = (await request("POST", "/api/project-apis/clients", { name: "Farm" })).body;
    expect((await request("POST", "/api/project-apis/a1/grants", { clientId: client.id, routeId: "level" })).status).toBe(409);
    await publishA1();
    expect((await request("POST", "/api/project-apis/a1/grants", { clientId: client.id, routeId: "nope" })).status).toBe(404);
    const granted = await request("POST", "/api/project-apis/a1/grants", { clientId: client.id, routeId: "level" });
    expect(granted.status).toBe(201);
    expect(granted.body).toMatchObject({ routeId: "level", access: "read", revokedAt: null });
    // Granting again is idempotent.
    expect((await request("POST", "/api/project-apis/a1/grants", { clientId: client.id, routeId: "level" })).body.id).toBe(granted.body.id);

    const unpublished = await request("POST", "/api/project-apis/a1/unpublish");
    expect(unpublished.body).toEqual({ success: true, revokedGrants: 1 });
    const detail = (await request("GET", `/api/project-apis/clients/${client.id}`)).body;
    expect(detail.grants[0]).toMatchObject({ revokeReason: "unpublished", revokedBy: "u-admin" });
    expect(detail.credentials).toEqual([]);
  });

  it("revokes one grant, and refuses grants to a disabled client", async () => {
    await publishA1();
    const client = (await request("POST", "/api/project-apis/clients", { name: "Farm" })).body;
    await request("POST", "/api/project-apis/a1/grants", { clientId: client.id, routeId: "level" });
    expect((await request("POST", "/api/project-apis/a1/grants/revoke", { clientId: client.id, routeId: "level" })).body).toEqual({ revoked: true });
    expect((await request("POST", "/api/project-apis/a1/grants/revoke", { clientId: client.id, routeId: "level" })).body).toEqual({ revoked: false });
    await request("POST", `/api/project-apis/clients/${client.id}/disable`);
    expect((await request("POST", "/api/project-apis/a1/grants", { clientId: client.id, routeId: "level" })).status).toBe(409);
    expect((await request("POST", "/api/project-apis/missing/grants/revoke", { clientId: client.id, routeId: "level" })).status).toBe(404);
  });

  it("reports the previous API when a slug is reclaimed", async () => {
    await request("PUT", "/api/project-apis/a1/slug", { slug: "tank-levels" });
    const original = (await request("GET", "/api/project-apis/a1")).body.api.id;
    await request("PUT", "/api/project-apis/a1/slug", { slug: "water-levels" });
    db.prepare(`INSERT INTO automation_rules (id, name, trigger_topic, rule_type, enabled, authored_unrestricted, revision, created_at)
      VALUES ('a2', 'Pumps', 't', 'script', 1, 1, 1, 1)`).run();
    const reclaimed = await request("PUT", "/api/project-apis/a2/slug", { slug: "tank-levels", reclaim: true });
    expect(reclaimed.body).toMatchObject({ slug: "tank-levels", reclaimedFrom: original });
    expect(reclaimed.body.id).not.toBe(original);
  });
});

describe("machine keys on dashboard routes", () => {
  it("are refused by dashboard authentication with 401", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret-for-project-api-routes-0123456789");
    const { authenticate } = await import("../../auth/auth-middleware.js");
    const app = express();
    app.use(authenticate);
    app.use("/api/project-apis", (_req, res) => { res.json({ reached: true }); });
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/project-apis/clients`, {
        headers: { Authorization: `Bearer aeo_${"a".repeat(16)}_${"B".repeat(43)}` },
      });
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain("reached");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      vi.unstubAllEnvs();
    }
  });
});
