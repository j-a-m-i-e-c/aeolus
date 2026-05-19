// src/api/routes/layout.routes.test.ts — Unit tests for layout CRUD routes

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { createLayoutRoutes } from "./layout.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createTestDatabase } from "../../__test-helpers__/index.js";
import type { Database as DatabaseType } from "better-sqlite3";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../auth/auth-middleware.js", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
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

describe("layout.routes", () => {
  let app: express.Express;
  let db: DatabaseType;

  beforeEach(() => {
    db = createTestDatabase();
    app = express();
    app.use(express.json());
    app.use("/api/layout", createLayoutRoutes(db));
    app.use(errorHandler);
  });

  afterEach(() => {
    db.close();
  });

  describe("GET /api/layout", () => {
    it("returns empty tabs and panes when database is empty", async () => {
      const res = await request(app, "GET", "/api/layout");
      expect(res.status).toBe(200);
      expect(res.body.tabs).toEqual([]);
      expect(res.body.panes).toEqual([]);
    });

    it("returns tabs and panes after PUT", async () => {
      const tabs = [
        { id: "tab-1", name: "System", icon: "server", order: 0, pinned: true, createdAt: 1000 },
        { id: "tab-2", name: "Custom", icon: "layout", order: 1, pinned: false, createdAt: 2000 },
      ];
      const panes = [
        { id: "pane-1", tabId: "tab-1", paneType: "devices", config: { filter: "all" }, x: 0, y: 0, w: 6, h: 4, createdAt: 1000 },
      ];

      await request(app, "PUT", "/api/layout", { tabs, panes });
      const res = await request(app, "GET", "/api/layout");

      expect(res.status).toBe(200);
      expect(res.body.tabs).toHaveLength(2);
      expect(res.body.tabs[0].id).toBe("tab-1");
      expect(res.body.tabs[0].name).toBe("System");
      expect(res.body.tabs[0].pinned).toBe(true);
      expect(res.body.tabs[1].pinned).toBe(false);
      expect(res.body.panes).toHaveLength(1);
      expect(res.body.panes[0].paneType).toBe("devices");
      expect(res.body.panes[0].config).toEqual({ filter: "all" });
    });
  });

  describe("PUT /api/layout", () => {
    it("replaces layout atomically and returns success", async () => {
      // First layout
      await request(app, "PUT", "/api/layout", {
        tabs: [{ id: "tab-1", name: "Old", icon: "x", order: 0, pinned: false, createdAt: 1000 }],
        panes: [],
      });

      // Replace with new layout
      const res = await request(app, "PUT", "/api/layout", {
        tabs: [{ id: "tab-2", name: "New", icon: "y", order: 0, pinned: true, createdAt: 2000 }],
        panes: [{ id: "pane-1", tabId: "tab-2", paneType: "chart", config: {}, x: 0, y: 0, w: 12, h: 6, createdAt: 2000 }],
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify old data is gone
      const getRes = await request(app, "GET", "/api/layout");
      expect(getRes.body.tabs).toHaveLength(1);
      expect(getRes.body.tabs[0].id).toBe("tab-2");
      expect(getRes.body.panes).toHaveLength(1);
    });

    it("returns 400 when tabs is not an array", async () => {
      const res = await request(app, "PUT", "/api/layout", {
        tabs: "not-array",
        panes: [],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("arrays");
    });

    it("returns 400 when panes is not an array", async () => {
      const res = await request(app, "PUT", "/api/layout", {
        tabs: [],
        panes: "not-array",
      });
      expect(res.status).toBe(400);
    });

    it("handles pane config with null gracefully", async () => {
      const res = await request(app, "PUT", "/api/layout", {
        tabs: [{ id: "tab-1", name: "Test", icon: "x", order: 0, pinned: false, createdAt: 1000 }],
        panes: [{ id: "pane-1", tabId: "tab-1", paneType: "test", config: null, x: 0, y: 0, w: 6, h: 4, createdAt: 1000 }],
      });
      expect(res.status).toBe(200);

      const getRes = await request(app, "GET", "/api/layout");
      expect(getRes.body.panes[0].config).toEqual({});
    });

    it("handles database errors during PUT (non-BadRequestError)", async () => {
      // Close the database to force an error during transaction
      const closedDb = createTestDatabase();
      const brokenApp = express();
      brokenApp.use(express.json());
      brokenApp.use("/api/layout", createLayoutRoutes(closedDb));
      brokenApp.use(errorHandler);
      closedDb.close();

      const res = await request(brokenApp, "PUT", "/api/layout", {
        tabs: [{ id: "tab-1", name: "Test", icon: "x", order: 0, pinned: false, createdAt: 1000 }],
        panes: [],
      });
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/layout — error handling", () => {
    it("returns empty arrays when database read fails", async () => {
      // Close the database to force an error
      const closedDb = createTestDatabase();
      const brokenApp = express();
      brokenApp.use(express.json());
      brokenApp.use("/api/layout", createLayoutRoutes(closedDb));
      brokenApp.use(errorHandler);
      closedDb.close();

      const res = await request(brokenApp, "GET", "/api/layout");
      expect(res.status).toBe(200);
      expect(res.body.tabs).toEqual([]);
      expect(res.body.panes).toEqual([]);
    });

    it("handles malformed JSON in pane config gracefully", async () => {
      // Insert a pane with malformed JSON config directly
      db.prepare("INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("tab-1", "Test", "x", 0, 0, 1000);
      db.prepare("INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("pane-1", "tab-1", "test", "not-valid-json{{{", 0, 0, 6, 4, 1000);

      const res = await request(app, "GET", "/api/layout");
      expect(res.status).toBe(200);
      expect(res.body.panes[0].config).toEqual({});
    });
  });
});
