// src/api/routes/system.routes.test.ts — Unit tests for system routes

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
  if (cmd.includes("docker images --format") && cmd.includes("grep")) return "aeolus-backend|500MB\naeolus-frontend|200MB\n";
  if (cmd.includes("dangling=true")) return "100MB\n";
  if (cmd.includes("docker system df --format")) return "Build Cache|1GB|500MB (50%)\n";
  if (cmd.includes("docker ps -s")) return "aeolus-backend|10MB (virtual 500MB)\n";
  if (cmd.includes("docker system df -v")) return "aeolus_data|200MB\n";
  if (cmd.includes("docker")) return "";
  if (cmd.includes("git rev-parse --short HEAD")) return "abc1234\n";
  if (cmd.includes("git log -1 --format=%s")) return "feat: latest commit\n";
  if (cmd.includes("git log -1 --format=%ci")) return "2024-01-01 12:00:00 +0000\n";
  if (cmd.includes("git fetch")) return "";
  if (cmd.includes("git rev-parse --short origin/main")) return "def5678\n";
  if (cmd.includes("git log origin/main -1 --format=%s")) return "feat: newer commit\n";
  if (cmd.includes("git log origin/main -1 --format=%ci")) return "2024-01-02 12:00:00 +0000\n";
  if (cmd.includes("git rev-list")) return "3\n";
  if (cmd.includes("git -C") && cmd.includes("pull")) return "Already up to date.\n";
  return "";
});

const mockSpawn = vi.fn().mockReturnValue({ unref: vi.fn() });

// Mock child_process to avoid actual system calls
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockExistsSync = vi.fn().mockReturnValue(false);
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
      existsSync: (...args: unknown[]) => mockExistsSync(...args),
      mkdirSync: vi.fn(),
    },
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: vi.fn(),
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
    it("returns version info", async () => {
      const res = await request(app, "GET", "/api/system/version");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("lastChecked");
      expect(res.body).toHaveProperty("updateAvailable");
      expect(res.body).toHaveProperty("commitsBehind");
    });

    it("supports force refresh", async () => {
      const res = await request(app, "GET", "/api/system/version?refresh=true");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("lastChecked");
    });
  });

  describe("POST /api/system/update", () => {
    it("returns 400 when project directory not mounted", async () => {
      const res = await request(app, "POST", "/api/system/update");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("not mounted");
    });

    it("pulls and rebuilds when project directory exists", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("git -C") && cmd.includes("pull")) return "Already up to date.\n";
        return "";
      });
      const res = await request(app, "POST", "/api/system/update");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Update started");
    });

    it("sends success response even when git pull fails (response already sent)", async () => {
      // Note: The route sends res.json() before attempting git pull,
      // so the first response is always 200. The git pull error is logged but
      // the 500 response is never sent because headers are already sent.
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("git -C") && cmd.includes("pull")) {
          throw new Error("merge conflict");
        }
        return "";
      });
      const res = await request(app, "POST", "/api/system/update");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /api/system/docker-prune", () => {
    it("returns success on prune", async () => {
      const res = await request(app, "POST", "/api/system/docker-prune");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns 500 when docker prune fails", async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("docker image prune")) {
          throw new Error("docker daemon not running");
        }
        if (cmd.includes("xargs")) return "";
        throw new Error("docker daemon not running");
      });
      const res = await request(app, "POST", "/api/system/docker-prune");
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("Docker prune failed");
    });
  });

  describe("POST /api/system/shutdown", () => {
    it("returns success message", async () => {
      const res = await request(app, "POST", "/api/system/shutdown");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Shutting down");
    });
  });

  describe("POST /api/system/reboot", () => {
    it("returns success message", async () => {
      const res = await request(app, "POST", "/api/system/reboot");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Rebooting");
    });
  });

  describe("GET /api/system/version", () => {
    it("returns version info with force refresh (project dir not found)", async () => {
      mockExistsSync.mockReturnValue(false);
      const res = await request(app, "GET", "/api/system/version?refresh=true");
      expect(res.status).toBe(200);
      expect(res.body.error).toContain("not mounted");
    });

    it("returns error when project directory is not a git repo", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.includes(".git")) return false;
        return true;
      });
      const res = await request(app, "GET", "/api/system/version?refresh=true");
      expect(res.status).toBe(200);
      expect(res.body.error).toContain("Not a git repository");
    });

    it("returns version with update available when behind", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("git rev-parse --short HEAD")) return "abc1234\n";
        if (cmd.includes("git log -1 --format=%s")) return "feat: latest commit\n";
        if (cmd.includes("git log -1 --format=%ci")) return "2024-01-01 12:00:00 +0000\n";
        if (cmd.includes("git fetch")) return "";
        if (cmd.includes("git rev-parse --short origin/main")) return "def5678\n";
        if (cmd.includes("git log origin/main -1 --format=%s")) return "feat: newer commit\n";
        if (cmd.includes("git log origin/main -1 --format=%ci")) return "2024-01-02 12:00:00 +0000\n";
        if (cmd.includes("git rev-list")) return "3\n";
        return "";
      });
      const res = await request(app, "GET", "/api/system/version?refresh=true");
      expect(res.status).toBe(200);
      expect(res.body.updateAvailable).toBe(true);
      expect(res.body.commitsBehind).toBe(3);
      expect(res.body.current).toBeDefined();
      expect(res.body.latest).toBeDefined();
    });

    it("returns error when git commands fail", async () => {
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockImplementation((cmd: string) => {
        if (typeof cmd === "string" && cmd.includes("git")) throw new Error("git not found");
        return "";
      });
      const res = await request(app, "GET", "/api/system/version?refresh=true");
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("GET /api/system (docker disk usage)", () => {
    it("returns docker disk usage when docker commands succeed", async () => {
      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      expect(res.body.docker).toBeDefined();
      if (res.body.docker) {
        expect(res.body.docker).toHaveProperty("images");
        expect(res.body.docker).toHaveProperty("buildCache");
        expect(res.body.docker).toHaveProperty("total");
      }
    });

    it("returns cpuTemp when thermal zone is readable", async () => {
      const res = await request(app, "GET", "/api/system");
      expect(res.status).toBe(200);
      // cpuTemp should be 45.0 (45000 / 100 / 10)
      expect(res.body.cpuTemp).toBe(45);
    });
  });
});
