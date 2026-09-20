// src/api/routes/shared-state.routes.test.ts — Shared State REST API (ADR-0016)

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { EventEmitter } from "node:events";
import type { Database as DatabaseType } from "better-sqlite3";
import { createSharedStateRoutes } from "./shared-state.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createTestDatabase } from "../../__test-helpers__/index.js";
import { SHARED_STATE_CHANGE } from "../../core/event-bus.js";
import { SharedStateStore } from "../../shared-state/shared-state-store.js";
import { MAX_SHARED_STATE_VALUE_BYTES } from "../../shared-state/shared-state-limits.js";
import type { SharedStateChange } from "../../shared-state/shared-state-types.js";

// Auth is mocked through so these tests cover route + storage behaviour. That the
// routes ARE admin-only is asserted separately below against the real middleware
// reference, so mocking it here cannot hide a missing guard.
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const setAdminUser: express.RequestHandler = (req, _res, next) => {
  req.user = { userId: "admin-1", username: "admin", role: "admin", groupId: null };
  next();
};

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) options.body = JSON.stringify(body);
      fetch(`http://127.0.0.1:${addr.port}${path}`, options)
        .then(async (res) => {
          const responseBody = (res.headers.get("content-type") || "").includes("application/json")
            ? await res.json()
            : await res.text();
          server.close();
          resolve({ status: res.status, body: responseBody });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("Shared State routes", () => {
  let db: DatabaseType;
  let bus: EventEmitter;
  let changes: SharedStateChange[];
  let store: SharedStateStore;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDatabase();
    bus = new EventEmitter();
    changes = [];
    bus.on(SHARED_STATE_CHANGE, (change: SharedStateChange) => changes.push(change));
    store = new SharedStateStore(db, bus);

    app = express();
    app.use(express.json());
    app.use(setAdminUser);
    app.use("/api/shared-state", createSharedStateRoutes(store));
    app.use(errorHandler);
  });

  afterEach(() => {
    db.close();
  });

  describe("GET /api/shared-state", () => {
    it("lists buckets with key counts", async () => {
      store.set("bunker-summary", "power", 1);
      store.set("bunker-summary", "air", 2);
      store.set("mine-summary", "atmosphere", 3);

      const res = await request(app, "GET", "/api/shared-state");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { bucket: "bunker-summary", keyCount: 2 },
        { bucket: "mine-summary", keyCount: 1 },
      ]);
    });

    it("returns an empty list when nothing is stored", async () => {
      const res = await request(app, "GET", "/api/shared-state");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/shared-state/:bucket", () => {
    it("lists the entries in a bucket", async () => {
      store.set("bunker-summary", "power", { battery: 74 });

      const res = await request(app, "GET", "/api/shared-state/bunker-summary");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ key: "power", value: { battery: 74 } });
      expect(res.body[0].updatedAt).toBeGreaterThan(0);
    });

    it("returns an empty list for an unknown bucket", async () => {
      const res = await request(app, "GET", "/api/shared-state/nothing-here");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/shared-state/:bucket/:key", () => {
    it("returns one current value", async () => {
      store.set("bunker-summary", "power", { battery: 74 });

      const res = await request(app, "GET", "/api/shared-state/bunker-summary/power");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        bucket: "bunker-summary",
        key: "power",
        value: { battery: 74 },
      });
    });

    it("404s for a key that is not set", async () => {
      const res = await request(app, "GET", "/api/shared-state/bunker-summary/power");

      expect(res.status).toBe(404);
    });

    it("returns a stored null rather than treating it as absent", async () => {
      // `null` is a legitimate shared value. Collapsing it into the 404 path would
      // make it impossible to store.
      store.set("bunker-summary", "power", null);

      const res = await request(app, "GET", "/api/shared-state/bunker-summary/power");

      expect(res.status).toBe(200);
      expect(res.body.value).toBeNull();
    });

    it("reads a bucket or key containing URL-encoded characters", async () => {
      store.set("_showcase:seed-ledger", "automation:farm-water", "rule-1");

      const res = await request(
        app,
        "GET",
        `/api/shared-state/${encodeURIComponent("_showcase:seed-ledger")}/${encodeURIComponent("automation:farm-water")}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.value).toBe("rule-1");
    });
  });

  describe("PUT /api/shared-state/:bucket/:key", () => {
    it("writes a value and reports that it changed", async () => {
      const res = await request(app, "PUT", "/api/shared-state/bunker-summary/power", {
        value: { battery: 74 },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, changed: true });
      expect(store.get("bunker-summary", "power")).toEqual({ battery: 74 });
    });

    it("reports changed: false for an identical write and emits nothing", async () => {
      await request(app, "PUT", "/api/shared-state/bunker-summary/power", { value: 74 });
      changes.length = 0;

      const res = await request(app, "PUT", "/api/shared-state/bunker-summary/power", { value: 74 });

      expect(res.body).toEqual({ success: true, changed: false });
      expect(changes).toHaveLength(0);
    });

    it("emits one internal change for a real write", async () => {
      await request(app, "PUT", "/api/shared-state/bunker-summary/power", { value: 74 });

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        bucket: "bunker-summary",
        key: "power",
        value: 74,
        deleted: false,
      });
    });

    it("attributes the write to the calling user rather than to an automation", async () => {
      await request(app, "PUT", "/api/shared-state/bunker-summary/power", { value: 74 });

      expect(changes[0]!.source).toEqual({ kind: "api", userId: "admin-1" });
    });

    it("accepts null and false as values", async () => {
      const nullRes = await request(app, "PUT", "/api/shared-state/b/k1", { value: null });
      const falseRes = await request(app, "PUT", "/api/shared-state/b/k2", { value: false });

      expect(nullRes.body.changed).toBe(true);
      expect(falseRes.body.changed).toBe(true);
      expect(store.get("b", "k1")).toBeNull();
      expect(store.get("b", "k2")).toBe(false);
    });

    it("400s when the body omits a value field", async () => {
      const res = await request(app, "PUT", "/api/shared-state/bunker-summary/power", {});

      expect(res.status).toBe(400);
      expect(store.get("bunker-summary", "power")).toBeUndefined();
    });

    it("400s on an oversized value rather than 500ing", async () => {
      const res = await request(app, "PUT", "/api/shared-state/bunker-summary/power", {
        value: { blob: "x".repeat(MAX_SHARED_STATE_VALUE_BYTES) },
      });

      // A refused bound is the caller's mistake, so it must read as a bad request.
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Shared State limit/i);
      expect(store.get("bunker-summary", "power")).toBeUndefined();
    });

    it("400s on a name that would make the reactive path ambiguous", async () => {
      // A key carrying `+` would behave as a wildcard in a trigger pattern.
      const res = await request(app, "PUT", `/api/shared-state/bunker-summary/${encodeURIComponent("po+wer")}`, {
        value: 1,
      });

      expect(res.status).toBe(400);
    });

    it("400s on an over-long name", async () => {
      const res = await request(app, "PUT", `/api/shared-state/${"x".repeat(201)}/power`, {
        value: 1,
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/shared-state/:bucket/:key", () => {
    it("removes a value and reports that it changed", async () => {
      store.set("bunker-summary", "power", 74);
      changes.length = 0;

      const res = await request(app, "DELETE", "/api/shared-state/bunker-summary/power");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, changed: true });
      expect(store.get("bunker-summary", "power")).toBeUndefined();
      expect(changes).toHaveLength(1);
      expect(changes[0]!.deleted).toBe(true);
    });

    it("is idempotent for a key that is not set", async () => {
      // A reconciling caller (the showcase seeder) deletes keys it may not hold;
      // making that a 404 would force it to probe first for no benefit.
      const res = await request(app, "DELETE", "/api/shared-state/bunker-summary/power");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, changed: false });
      expect(changes).toHaveLength(0);
    });
  });

  describe("authorisation", () => {
    it("guards every route with requireAdmin", async () => {
      // Shared State is global with no bucket→tab ownership model, so there is no
      // basis for partial non-admin authority. Asserted by re-mounting the router
      // behind a denying guard: with auth mocked through above, a route that forgot
      // requireAdmin would otherwise look fine.
      const authModule = await import("../../auth/auth-middleware.js");
      const denying = vi
        .spyOn(authModule, "requireAdmin")
        .mockImplementation((_req, res) => {
          res.status(403).json({ error: "Forbidden" });
        });

      const guarded = express();
      guarded.use(express.json());
      guarded.use(setAdminUser);
      guarded.use("/api/shared-state", createSharedStateRoutes(store));
      guarded.use(errorHandler);

      for (const [method, path] of [
        ["GET", "/api/shared-state"],
        ["GET", "/api/shared-state/b"],
        ["GET", "/api/shared-state/b/k"],
        ["PUT", "/api/shared-state/b/k"],
        ["DELETE", "/api/shared-state/b/k"],
      ] as const) {
        const res = await request(guarded, method, path, method === "PUT" ? { value: 1 } : undefined);
        expect(res.status, `${method} ${path}`).toBe(403);
      }

      denying.mockRestore();
    });
  });
});
