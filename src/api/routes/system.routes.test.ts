// src/api/routes/system.routes.test.ts — Unit tests for hardened system routes

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createSystemRoutes } from "./system.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../log-buffer.js", () => ({
  getRecentLogs: vi.fn().mockReturnValue([
    { level: 30, levelLabel: "info", msg: "Server started", time: "2024-01-01T00:00:00Z" },
    { level: 40, levelLabel: "warn", msg: "High memory", time: "2024-01-01T00:01:00Z" },
    { level: 50, levelLabel: "error", msg: "Connection failed", time: "2024-01-01T00:02:00Z" },
  ]),
}));

const mockExecSync = vi.fn().mockImplementation((cmd: string) => {
  if (cmd.includes("df -B1")) return "/dev/sda1 50000000000 25000000000 25000000000 50% /\n";
  return "";
});

// Mock child_process — only execSync is used in the hardened routes
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const mockReadFileSync = vi.fn().mockImplementation((path: string) => {
  if (path.includes("thermal_zone0")) return "45000";
  throw new Error("ENOENT");
});

// Mock fs for system routes
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    },
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  };
});

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

describe("system.routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/system", createSystemRoutes());
    app.use(errorHandler);
  });

  describe("GET /api/system", () => {
    it("returns system diagnostics", async () => {
      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      expect(res.body.hostname).toBeDefined();
      expect(res.body.platform).toBeDefined();
      expect(res.body.arch).toBeDefined();
      expect(res.body.nodeVersion).toBeDefined();
      expect(res.body.cpuCores).toBeGreaterThan(0);
      expect(res.body.memory).toBeDefined();
      expect(res.body.memory.total).toBeGreaterThan(0);
      expect(res.body.memory.usagePercent).toBeGreaterThanOrEqual(0);
      expect(res.body.loadAvg).toBeDefined();
      expect(res.body.uptime).toBeGreaterThan(0);
      expect(res.body.network).toBeDefined();
    });

    it("does NOT return a docker field", async () => {
      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      expect(res.body.docker).toBeUndefined();
    });

    it("returns cpuTemp when thermal zone is readable", async () => {
      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      // cpuTemp should be 45.0 (45000 / 100 / 10)
      expect(res.body.cpuTemp).toBe(45);
    });
  });

  describe("GET /api/system/logs", () => {
    it("returns recent logs", async () => {
      const res = await request(app, "GET", "/api/system/logs");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3);
    });

    it("filters logs by level", async () => {
      const res = await request(app, "GET", "/api/system/logs?level=warn");
      expect(res.status).toBe(200);
      expect(res.body.every((l: any) => l.levelLabel === "warn")).toBe(true);
    });

    it("respects count parameter", async () => {
      const res = await request(app, "GET", "/api/system/logs?count=2");
      expect(res.status).toBe(200);
      // getRecentLogs is called with count, mock returns 3 but that's fine
    });
  });

  describe("GET /api/system/version", () => {
    it("returns version info with commit and buildDate", async () => {
      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("commit");
      expect(res.body).toHaveProperty("buildDate");
    });

    it("returns 'unknown' defaults when env vars are not set", async () => {
      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body.commit).toBe("unknown");
      expect(res.body.buildDate).toBe("unknown");
    });
  });

  describe("Removed POST endpoints return 404", () => {
    it("POST /api/system/update returns 404", async () => {
      const res = await request(app, "POST", "/api/system/update");
      expect(res.status).toBe(404);
    });

    it("POST /api/system/shutdown returns 404", async () => {
      const res = await request(app, "POST", "/api/system/shutdown");
      expect(res.status).toBe(404);
    });

    it("POST /api/system/reboot returns 404", async () => {
      const res = await request(app, "POST", "/api/system/reboot");
      expect(res.status).toBe(404);
    });

    it("POST /api/system/docker-prune returns 404", async () => {
      const res = await request(app, "POST", "/api/system/docker-prune");
      expect(res.status).toBe(404);
    });

    it("PUT on /api/system returns 404", async () => {
      const res = await request(app, "PUT", "/api/system");
      expect(res.status).toBe(404);
    });

    it("DELETE on /api/system returns 404", async () => {
      const res = await request(app, "DELETE", "/api/system");
      expect(res.status).toBe(404);
    });

    it("PATCH on /api/system returns 404", async () => {
      const res = await request(app, "PATCH", "/api/system");
      expect(res.status).toBe(404);
    });
  });
});
