// src/api/routes/system.routes.branches.test.ts — Tests targeting uncovered branches in system routes

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  ]),
}));

// We need to control fs.readFileSync and child_process.execSync per test
const mockExecSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...(actual as any).default,
      readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
      existsSync: (...args: unknown[]) => mockReadFileSync.existsSync?.(...args) ?? true,
    },
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    existsSync: (...args: unknown[]) => mockReadFileSync.existsSync?.(...args) ?? true,
  };
});

async function request(
  app: express.Express,
  method: string,
  path: string,
): Promise<{ status: number; body: any }> {
  // Use the real fetch (stored before any mock can interfere)
  const realFetch = originalFetch;
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      realFetch(`http://127.0.0.1:${addr.port}${path}`, { method: method.toUpperCase() })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

// Save real fetch before tests
const originalFetch = globalThis.fetch;

describe("system.routes — branch coverage", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // The diagnostics and logs routes are admin-gated; the real global
    // `authenticate` runs before them in production. Inject an admin principal.
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = { role: "admin" };
      next();
    });
    app.use("/api/system", createSystemRoutes());
    app.use(errorHandler);
  });

  describe("GET /api/system — edge cases", () => {
    it("returns cpuTemp null when thermal_zone read fails", async () => {
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("thermal_zone0")) {
          throw new Error("ENOENT");
        }
        throw new Error("ENOENT");
      });
      mockExecSync.mockImplementation(() => {
        throw new Error("Command not found");
      });

      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      expect(res.body.cpuTemp).toBeNull();
    });

    it("returns disk null when df command fails", async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      mockExecSync.mockImplementation(() => { throw new Error("not supported"); });

      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      expect(res.body.disk).toBeNull();
    });

    it("returns disk data when df succeeds", async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("df -B1")) return "/dev/sda1 100000000 60000000 40000000 60% /\n";
        return "";
      });

      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      expect(res.body.disk).toBeDefined();
      expect(res.body.disk.total).toBe(100000000);
      expect(res.body.disk.used).toBe(60000000);
      expect(res.body.disk.usagePercent).toBe(60);
    });
  });

  describe("GET /api/system/logs — edge branches", () => {
    it("returns empty array for invalid log level", async () => {
      const res = await request(app, "GET", "/api/system/logs?level=invalid");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("uses default count when count param is invalid", async () => {
      const res = await request(app, "GET", "/api/system/logs?count=abc");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("uses default count when count is out of range", async () => {
      const res = await request(app, "GET", "/api/system/logs?count=500");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("uses default count when count is less than 1", async () => {
      const res = await request(app, "GET", "/api/system/logs?count=0");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("version routes — branch coverage", () => {
    afterEach(() => {
      globalThis.fetch = originalFetch;
      delete process.env.AEOLUS_VERSION;
      delete process.env.BUILD_COMMIT;
      delete process.env.BUILD_DATE;
    });

    it("GET /version is local only and does not contact GitHub", async () => {
      process.env.AEOLUS_VERSION = "1.2.3";
      process.env.BUILD_COMMIT = "abc1234";
      process.env.BUILD_DATE = "2026-09-19";
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as any;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ version: "1.2.3", commit: "abc1234", buildDate: "2026-09-19" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("POST /version/check compares the latest release semver", async () => {
      process.env.AEOLUS_VERSION = "1.2.3";
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tag_name: "v1.3.0" }) }) as any;
      const res = await request(app, "POST", "/api/system/version/check");
      expect(res.status).toBe(200);
      expect(res.body.latestVersion).toBe("v1.3.0");
      expect(res.body.updateAvailable).toBe(true);
      expect(res.body.checkedAt).toBeTruthy();
    });

    it("reports current when the release is not newer", async () => {
      process.env.AEOLUS_VERSION = "1.3.0";
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tag_name: "v1.3.0" }) }) as any;
      const res = await request(app, "POST", "/api/system/version/check");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBe(false);
    });

    it("handles repositories with no published release", async () => {
      process.env.AEOLUS_VERSION = "1.3.0";
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
      const res = await request(app, "POST", "/api/system/version/check");
      expect(res.status).toBe(200);
      expect(res.body.latestVersion).toBeNull();
      expect(res.body.updateAvailable).toBe(false);
    });

    it("does not invent an update result for non-semver development builds", async () => {
      process.env.AEOLUS_VERSION = "dev";
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tag_name: "v1.3.0" }) }) as any;
      const res = await request(app, "POST", "/api/system/version/check");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBeNull();
      expect(res.body.error).toContain("semantic versioning");
    });

    it("returns 502 when GitHub is unavailable", async () => {
      process.env.AEOLUS_VERSION = "1.2.3";
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as any;
      const res = await request(app, "POST", "/api/system/version/check");
      expect(res.status).toBe(502);
      expect(res.body.updateAvailable).toBeNull();
      expect(res.body.error).toContain("offline");
    });
  });

});
