// src/api/routes/system.routes.ts — Read-only host system diagnostics

import { Router } from "express";
import os from "node:os";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { getRecentLogs } from "../../log-buffer.js";

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

export function createSystemRoutes(): Router {
  const router = Router();

  /** GET /api/system — host diagnostics */
  router.get("/", (_req, res) => {
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

  /** GET /api/system/logs — recent application logs */
  router.get("/logs", (req, res) => {
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

  /** GET /api/system/version — build-time version info + update check */
  router.get("/version", async (_req, res) => {
    const commit = process.env.BUILD_COMMIT || "unknown";
    const buildDate = process.env.BUILD_DATE || "unknown";

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
            // Current commit not found in recent 20 — likely far behind
            updateAvailable = true;
            commitsBehind = -1; // unknown how far behind
          }
        }
      } catch {
        // GitHub unreachable — skip update check silently
      }
    }

    res.json({ commit, buildDate, updateAvailable, latestCommit, commitsBehind });
  });

  return router;
}
