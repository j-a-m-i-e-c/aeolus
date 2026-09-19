// src/api/routes/system.routes.ts — Read-only host system diagnostics

import { Router } from "express";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getRecentLogs } from "../../log-buffer.js";
import { requireAdmin } from "../../auth/auth-middleware.js";

const VALID_LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];

function getCpuTemp(): number | null {
  try {
    const temp = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf-8");
    return Math.round(Number(temp.trim()) / 100) / 10;
  } catch {
    return null;
  }
}

function getDiskUsage(): { total: number; used: number; free: number; usagePercent: number } | null {
  try {
    const output = execSync("df -B1 / | tail -1", { encoding: "utf-8", timeout: 5000 });
    const parts = output.trim().split(/\s+/);
    const total = Number(parts[1]);
    const used = Number(parts[2]);
    const free = Number(parts[3]);
    const usagePercent = total > 0 ? Math.min(100, Math.max(0, Math.round((used / total) * 100))) : 0;
    return { total, used, free, usagePercent };
  } catch {
    return null;
  }
}

interface LocalVersionInfo {
  version: string;
  commit: string;
  buildDate: string;
}

interface ReleaseCheckInfo extends LocalVersionInfo {
  latestVersion: string | null;
  updateAvailable: boolean | null;
  checkedAt: string;
  error?: string;
}

function readLocalVersionInfo(): LocalVersionInfo {
  let version = process.env.AEOLUS_VERSION || "0.0.0-dev";
  let commit = process.env.BUILD_COMMIT || "unknown";
  let buildDate = process.env.BUILD_DATE || "unknown";

  for (const candidate of [
    path.join(process.cwd(), "dist", "build-info.json"),
    path.join(process.cwd(), "build-info.json"),
  ]) {
    try {
      const info = JSON.parse(fs.readFileSync(candidate, "utf-8")) as {
        version?: string; commit?: string; buildDate?: string;
      };
      if (info.version) version = info.version;
      if (info.commit) commit = info.commit;
      if (info.buildDate) buildDate = info.buildDate;
      break;
    } catch {
      // Try the next build-info location.
    }
  }

  if (version === "0.0.0-dev") {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")) as { version?: string };
      if (pkg.version) version = pkg.version;
    } catch {
      // Development/source checkouts may not have package metadata at cwd.
    }
  }

  return { version, commit, buildDate };
}

function normalizeSemver(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerSemver(latest: string, current: string): boolean | null {
  const a = normalizeSemver(latest);
  const b = normalizeSemver(current);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

export function createSystemRoutes(): Router {
  const router = Router();

  /**
   * GET /api/system — host diagnostics (admin only).
   * Exposes hostname, network addresses, CPU/memory/disk and runtime details, so
   * it is restricted to admins. The version/health endpoint below stays available
   * to any authenticated user.
   */
  router.get("/", requireAdmin, (_req, res) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsagePercent = totalMem > 0
      ? Math.min(100, Math.max(0, Math.round((usedMem / totalMem) * 100)))
      : 0;

    const cpuLoad = os.loadavg();
    const disk = getDiskUsage();
    const cpuTemp = getCpuTemp();

    const networkInterfaces = os.networkInterfaces();
    const ips: { name: string; address: string }[] = [];
    for (const [name, addrs] of Object.entries(networkInterfaces)) {
      for (const addr of addrs || []) {
        if (addr.family === "IPv4" && !addr.internal) {
          ips.push({ name, address: addr.address });
        }
      }
    }

    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpuModel: cpus[0]?.model || "Unknown",
      cpuCores: cpus.length,
      cpuTemp,
      loadAvg: {
        "1m": cpuLoad[0],
        "5m": cpuLoad[1],
        "15m": cpuLoad[2],
      },
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usagePercent: memoryUsagePercent,
      },
      disk,
      network: ips,
      uptime: os.uptime(),
    });
  });

  /** GET /api/system/logs — recent application logs (admin only) */
  router.get("/logs", requireAdmin, (req, res) => {
    const rawCount = Number(req.query.count);
    const count = Number.isFinite(rawCount) && rawCount >= 1 && rawCount <= 200
      ? Math.floor(rawCount)
      : 100;
    const level = req.query.level as string | undefined;

    if (level && !VALID_LOG_LEVELS.includes(level)) {
      res.json([]);
      return;
    }

    let logs = getRecentLogs(count);
    if (level) {
      logs = logs.filter((l) => l.levelLabel === level);
    }
    res.json(logs);
  });

  /** GET /api/system/version — local build information only; no network I/O. */
  router.get("/version", (_req, res) => {
    res.json(readLocalVersionInfo());
  });

  /**
   * POST /api/system/version/check — explicit, admin-only release lookup.
   * Update checks never run merely because somebody opened the System page.
   */
  router.post("/version/check", requireAdmin, async (_req, res) => {
    const local = readLocalVersionInfo();
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(
        "https://api.github.com/repos/j-a-m-i-e-c/aeolus/releases/latest",
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Aeolus-update-check",
          },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (response.status === 404) {
        const data: ReleaseCheckInfo = { ...local, latestVersion: null, updateAvailable: false, checkedAt };
        res.json(data);
        return;
      }
      if (!response.ok) {
        res.status(502).json({ ...local, latestVersion: null, updateAvailable: null, checkedAt, error: `GitHub returned HTTP ${response.status}` });
        return;
      }
      const release = await response.json() as { tag_name?: string };
      const latestVersion = release.tag_name ?? null;
      const updateAvailable = latestVersion ? isNewerSemver(latestVersion, local.version) : false;
      const data: ReleaseCheckInfo = { ...local, latestVersion, updateAvailable, checkedAt };
      if (updateAvailable === null) data.error = "Current or latest version is not valid semantic versioning";
      res.json(data);
    } catch (err) {
      res.status(502).json({
        ...local,
        latestVersion: null,
        updateAvailable: null,
        checkedAt,
        error: `Release check failed: ${(err as Error).message}`,
      });
    }
  });

  return router;
}
