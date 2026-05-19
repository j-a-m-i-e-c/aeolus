// src/auth/auth-middleware.test.ts — Unit tests for auth middleware

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import jwt from "jsonwebtoken";
import { initSchema } from "../db/database.js";

let testDb: DatabaseType;
const TEST_SECRET = "test-middleware-secret";

vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  authenticate,
  requireAdmin,
  requireTabPermission,
  createSetupGuard,
  PUBLIC_ROUTES,
} from "./auth-middleware.js";
import { _resetSecretCache } from "./token-service.js";
import { errorHandler } from "../api/middleware/error-handler.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createToken(payload: Record<string, unknown>, secret = TEST_SECRET): string {
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "15m" });
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json", ...headers },
      };
      if (body !== undefined) options.body = JSON.stringify(body);
      fetch(`http://127.0.0.1:${addr.port}${path}`, options)
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("auth-middleware", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    testDb.pragma("foreign_keys = ON");
    initSchema(testDb);
    process.env.JWT_SECRET = TEST_SECRET;
    _resetSecretCache();
  });

  afterEach(() => {
    testDb.close();
    delete process.env.JWT_SECRET;
    _resetSecretCache();
  });

  describe("authenticate", () => {
    it("allows public routes without token", async () => {
      const app = express();
      app.use(authenticate);
      app.get("/api/health", (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/health");
      expect(res.status).toBe(200);
    });

    it("returns 401 when no Authorization header", async () => {
      const app = express();
      app.use(authenticate);
      app.get("/api/devices", (_req, res) => res.json([]));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/devices");
      expect(res.status).toBe(401);
    });

    it("returns 401 when Authorization header is not Bearer", async () => {
      const app = express();
      app.use(authenticate);
      app.get("/api/devices", (_req, res) => res.json([]));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/devices", { Authorization: "Basic abc123" });
      expect(res.status).toBe(401);
    });

    it("returns 401 when token is empty after Bearer prefix", async () => {
      const app = express();
      app.use(authenticate);
      app.get("/api/devices", (_req, res) => res.json([]));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/devices", { Authorization: "Bearer " });
      expect(res.status).toBe(401);
    });

    it("returns 401 when token is invalid", async () => {
      const app = express();
      app.use(authenticate);
      app.get("/api/devices", (_req, res) => res.json([]));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/devices", { Authorization: "Bearer invalid-token" });
      expect(res.status).toBe(401);
    });

    it("attaches user context on valid token", async () => {
      const token = createToken({
        userId: "user-1",
        username: "testuser",
        role: "admin",
        groupId: null,
      });
      const app = express();
      app.use(authenticate);
      app.get("/api/devices", (req, res) => res.json({ user: req.user }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/devices", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
      expect(res.body.user.userId).toBe("user-1");
      expect(res.body.user.role).toBe("admin");
    });
  });

  describe("requireAdmin", () => {
    it("returns 401 when no user context", async () => {
      const app = express();
      app.get("/api/admin", requireAdmin, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/admin");
      expect(res.status).toBe(401);
    });

    it("returns 403 when user is not admin", async () => {
      const token = createToken({
        userId: "user-1",
        username: "testuser",
        role: "user",
        groupId: "group-1",
      });
      const app = express();
      app.use(authenticate);
      app.get("/api/admin", requireAdmin, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/admin", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(403);
    });

    it("allows admin users through", async () => {
      const token = createToken({
        userId: "admin-1",
        username: "admin",
        role: "admin",
        groupId: null,
      });
      const app = express();
      app.use(authenticate);
      app.get("/api/admin", requireAdmin, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/admin", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
    });
  });

  describe("requireTabPermission", () => {
    beforeEach(() => {
      // Set up groups, users, tabs, and assignments
      testDb.prepare("INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("tab-1", "Tab 1", "home", 0, 0, Date.now());
      testDb.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("group-1", "Group 1", Date.now());
      testDb.prepare("INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)").run("group-1", "tab-1", "read");
      testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("user-1", "user1", "hash", "user", "group-1", Date.now());
      testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("admin-1", "admin", "hash", "admin", null, Date.now());
    });

    it("returns 401 when no user context", async () => {
      const app = express();
      app.get("/api/tabs/:tabId", requireTabPermission("read"), (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/tabs/tab-1");
      expect(res.status).toBe(401);
    });

    it("allows admin users regardless of tab permission", async () => {
      const token = createToken({
        userId: "admin-1",
        username: "admin",
        role: "admin",
        groupId: null,
      });
      const app = express();
      app.use(authenticate);
      app.get("/api/tabs/:tabId", requireTabPermission("read"), (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/tabs/tab-1", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
    });

    it("returns 403 when tabId is missing", async () => {
      const token = createToken({
        userId: "user-1",
        username: "user1",
        role: "user",
        groupId: "group-1",
      });
      const app = express();
      app.use(express.json());
      app.use(authenticate);
      app.get("/api/data", requireTabPermission("read"), (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/data", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(403);
    });

    it("allows user with sufficient permission", async () => {
      const token = createToken({
        userId: "user-1",
        username: "user1",
        role: "user",
        groupId: "group-1",
      });
      const app = express();
      app.use(authenticate);
      app.get("/api/tabs/:tabId", requireTabPermission("read"), (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/tabs/tab-1", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
    });

    it("returns 403 when user lacks required permission level", async () => {
      const token = createToken({
        userId: "user-1",
        username: "user1",
        role: "user",
        groupId: "group-1",
      });
      const app = express();
      app.use(authenticate);
      // User has "read" but we require "write"
      app.get("/api/tabs/:tabId", requireTabPermission("write"), (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "GET", "/api/tabs/tab-1", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(403);
    });
  });

  describe("createSetupGuard", () => {
    it("allows unauthenticated access when setup is needed", async () => {
      const setupGuard = createSetupGuard(() => true);
      const app = express();
      app.use(express.json());
      app.post("/api/protected/setup", setupGuard, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "POST", "/api/protected/setup");
      expect(res.status).toBe(200);
    });

    it("requires authentication when setup is complete", async () => {
      const setupGuard = createSetupGuard(() => false);
      const app = express();
      app.use(express.json());
      app.post("/api/protected/setup", setupGuard, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "POST", "/api/protected/setup");
      expect(res.status).toBe(401);
    });

    it("allows authenticated access when setup is complete", async () => {
      const token = createToken({
        userId: "admin-1",
        username: "admin",
        role: "admin",
        groupId: null,
      });
      const setupGuard = createSetupGuard(() => false);
      const app = express();
      app.use(express.json());
      app.post("/api/protected/setup", setupGuard, (_req, res) => res.json({ ok: true }));
      app.use(errorHandler);

      const res = await request(app, "POST", "/api/protected/setup", { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
    });
  });

  describe("PUBLIC_ROUTES", () => {
    it("contains expected public routes", () => {
      expect(PUBLIC_ROUTES).toContainEqual({ method: "GET", path: "/api/health" });
      expect(PUBLIC_ROUTES).toContainEqual({ method: "POST", path: "/api/auth/login" });
      expect(PUBLIC_ROUTES).toContainEqual({ method: "POST", path: "/api/auth/refresh" });
      expect(PUBLIC_ROUTES).toContainEqual({ method: "POST", path: "/api/auth/setup" });
      expect(PUBLIC_ROUTES).toContainEqual({ method: "GET", path: "/metrics" });
    });
  });
});
