// src/api/routes/system.routes.ts — Host system diagnostics

import { Router } from "express";
import os from "node:os";
import fs from "node:fs";
import { execSync, spawn } from "node:child_process";
import { getRecentLogs } from "../../log-buffer.js";
import logger from "../../logger.js";

function getCpuTemp(): number | null {
  try {
    // Raspberry Pi thermal zone
    const temp = fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf-8");
    return Math.round(Number(temp.trim()) / 100) / 10; // Convert millidegrees to °C
  } catch {
    return null;
  }
}

function getDiskUsage(): { total: number; used: number; free: number } | null {
  try {
    const output = execSync("df -B1 / | tail -1", { encoding: "utf-8" });
    const parts = output.trim().split(/\s+/);
    return {
      total: Number(parts[1]),
      used: Number(parts[2]),
      free: Number(parts[3]),
    };
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

    // CPU usage (average across cores)
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
        usagePercent: Math.round((usedMem / totalMem) * 100),
      },
      disk: disk ? {
        total: disk.total,
        used: disk.used,
        free: disk.free,
        usagePercent: Math.round((disk.used / disk.total) * 100),
      } : null,
      network: ips,
      uptime: os.uptime(),
    });
  });

  /** GET /api/system/logs — recent application logs */
  router.get("/logs", (req, res) => {
    const count = Math.min(Number(req.query.count) || 100, 200);
    const level = req.query.level as string | undefined;
    let logs = getRecentLogs(count);
    if (level) {
      logs = logs.filter((l) => l.levelLabel === level);
    }
    res.json(logs);
  });

  /** POST /api/system/update — pull latest code and rebuild containers */
  router.post("/update", (_req, res) => {
    const projectDir = process.env.AEOLUS_PROJECT_DIR || "/aeolus-host";

    if (!fs.existsSync(projectDir)) {
      res.status(400).json({ error: "Project directory not mounted — self-update only works on deployed Pi" });
      return;
    }

    logger.info("Self-update triggered from dashboard");
    res.json({ success: true, message: "Update started — the system will restart shortly" });

    // Run git pull + docker compose rebuild in the background
    // This is fire-and-forget — the container will be replaced during rebuild
    const child = spawn("sh", ["-c", `cd ${projectDir} && git pull && docker compose up -d --build`], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  });

  return router;
}