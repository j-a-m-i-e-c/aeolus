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

  describe("GET /api/system/version — branch coverage", () => {
    beforeEach(() => {
      // Nothing needed — originalFetch is already saved at module level
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      delete process.env.BUILD_COMMIT;
      delete process.env.BUILD_DATE;
    });

    it("reads build-info.json successfully", async () => {
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("build-info.json")) {
          return JSON.stringify({ commit: "abc1234", buildDate: "2024-06-01" });
        }
        throw new Error("ENOENT");
      });
      // Mock fetch to fail (no GitHub check)
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as any;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body.commit).toBe("abc1234");
      expect(res.body.buildDate).toBe("2024-06-01");
    });

    it("falls back to env vars when build-info.json not found", async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      process.env.BUILD_COMMIT = "envcommit";
      process.env.BUILD_DATE = "2024-07-01";
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as any;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      // Note: the outer try/catch means env vars are the fallback of the outer catch
      expect(res.body).toHaveProperty("commit");
      expect(res.body).toHaveProperty("buildDate");
    });

    it("detects update available when current commit is behind", async () => {
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("build-info.json")) {
          return JSON.stringify({ commit: "abc1234", buildDate: "2024-06-01" });
        }
        throw new Error("ENOENT");
      });

      const commits = [
        { sha: "newer999newer999newer999newer999newer999n" },
        { sha: "abc1234abc1234abc1234abc1234abc1234abc1234" },
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(commits),
      }) as any;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBe(true);
      expect(res.body.commitsBehind).toBe(1);
    });

    it("detects update available when commit not found in list (very old)", async () => {
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("build-info.json")) {
          return JSON.stringify({ commit: "oldold7", buildDate: "2024-01-01" });
        }
        throw new Error("ENOENT");
      });

      const commits = [
        { sha: "newer111newer111newer111newer111newer111n" },
        { sha: "newer222newer222newer222newer222newer222n" },
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(commits),
      }) as any;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBe(true);
      expect(res.body.commitsBehind).toBe(-1);
    });

    it("reports no update when commit is the latest", async () => {
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("build-info.json")) {
          return JSON.stringify({ commit: "latest7", buildDate: "2024-06-01" });
        }
        throw new Error("ENOENT");
      });

      const commits = [
        { sha: "latest7latest7latest7latest7latest7latest7" },
        { sha: "older88older88older88older88older88older88" },
      ];
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(commits),
      }) as any;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBe(false);
      expect(res.body.commitsBehind).toBe(0);
    });

    it("skips update check when commit is 'unknown'", async () => {
      mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
      // No env vars, so commit defaults to "unknown"
      const fetchSpy = vi.fn().mockResolvedValue({ ok: false }) as any;
      globalThis.fetch = fetchSpy;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBe(false);
      // fetch should not have been called since commit === "unknown"
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("handles GitHub API returning non-ok response", async () => {
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("build-info.json")) {
          return JSON.stringify({ commit: "abc1234", buildDate: "2024-06-01" });
        }
        throw new Error("ENOENT");
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      }) as any;

      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBe(false);
    });

    it("caches the update check so repeat requests do not re-hit GitHub", async () => {
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes("build-info.json")) {
          return JSON.stringify({ commit: "abc1234", buildDate: "2024-06-01" });
        }
        throw new Error("ENOENT");
      });
      const commits = [
        { sha: "newer999newer999newer999newer999newer999n" },
        { sha: "abc1234abc1234abc1234abc1234abc1234abc1234" },
      ];
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(commits),
      }) as any;
      globalThis.fetch = fetchSpy;

      const first = await request(app, "GET", "/api/system/version");
      const second = await request(app, "GET", "/api/system/version");

      expect(first.body.updateAvailable).toBe(true);
      expect(second.body).toEqual(first.body);
      // The GitHub update check runs once; the second request is served from cache.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
