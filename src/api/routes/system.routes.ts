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

interface VersionInfo {
  commit: string;
  buildDate: string;
  updateAvailable: boolean;
  latestCommit: string | null;
  commitsBehind: number;
}

/** Cache the version/update-check response so the per-request GitHub call is throttled. */
const VERSION_CACHE_TTL_MS = 15 * 60 * 1000;

export function createSystemRoutes(): Router {
  const router = Router();

  // Cached version response (build info is process-stable; the update check is an
  // outbound GitHub call we don't want to make on every request).
  let versionCache: { at: number; data: VersionInfo } | null = null;

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

  /** GET /api/system/version — build-time version info + update check (cached) */
  router.get("/version", async (_req, res) => {
    // Serve a recent cached result to avoid an outbound GitHub call per request.
    if (versionCache && Date.now() - versionCache.at < VERSION_CACHE_TTL_MS) {
      res.json(versionCache.data);
      return;
    }

    // Read build info from file baked at container build time
    let commit = "unknown";
    let buildDate = "unknown";
    try {
      // In production: /app/dist/build-info.json. Locally: try relative to cwd.
      const candidates = [
        path.join(process.cwd(), "dist", "build-info.json"),
        path.join(process.cwd(), "build-info.json"),
      ];
      for (const candidate of candidates) {
        try {
          const raw = fs.readFileSync(candidate, "utf-8");
          const info = JSON.parse(raw) as { commit?: string; buildDate?: string };
          if (info.commit) commit = info.commit;
          if (info.buildDate) buildDate = info.buildDate;
          break;
        } catch { continue; }
      }
    } catch {
      // Fall back to env vars (for local dev without container)
      commit = process.env.BUILD_COMMIT || "unknown";
      buildDate = process.env.BUILD_DATE || "unknown";
    }

    // Check GitHub for latest commit on main
    let updateAvailable = false;
    let latestCommit: string | null = null;
    let commitsBehind = 0;

    if (commit !== "unknown") {
      try {
        const response = await fetch(
          "https://api.github.com/repos/j-a-m-i-e-c/aeolus/commits?sha=main&per_page=20",
          { headers: { "Accept": "application/vnd.github.v3+json" }, signal: AbortSignal.timeout(5000) }
        );
        if (response.ok) {
          const commits = await response.json() as Array<{ sha: string }>;
          latestCommit = commits[0]?.sha.slice(0, 7) ?? null;
          const currentIndex = commits.findIndex((c) => c.sha.startsWith(commit));
          if (currentIndex > 0) {
            updateAvailable = true;
            commitsBehind = currentIndex;
          } else if (currentIndex === -1 && latestCommit && latestCommit !== commit) {
            updateAvailable = true;
            commitsBehind = -1;
          }
        }
      } catch {
        // GitHub unreachable — skip update check silently
      }
    }

    const data: VersionInfo = { commit, buildDate, updateAvailable, latestCommit, commitsBehind };
    versionCache = { at: Date.now(), data };
    res.json(data);
  });

  return router;
}
