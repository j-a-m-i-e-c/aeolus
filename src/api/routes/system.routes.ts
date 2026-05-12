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

function getDockerDiskUsage(): { images: number; buildCache: number; containers: number; volumes: number; total: number; reclaimable: number } | null {
  try {
    // Get Aeolus-specific image sizes (aeolus-backend, aeolus-frontend, eclipse-mosquitto)
    let images = 0;
    let reclaimableImages = 0;
    try {
      // Size of currently used Aeolus images
      const imgOutput = execSync(
        "docker images --format '{{.Repository}}|{{.Size}}' | grep -E '^(aeolus|eclipse-mosquitto)'",
        { encoding: "utf-8", timeout: 10000 },
      );
      for (const line of imgOutput.trim().split("\n")) {
        if (!line) continue;
        const [, sizeStr] = line.split("|");
        images += parseDockerSize(sizeStr?.trim() ?? "0B");
      }
      // Dangling images from old Aeolus builds
      const danglingOutput = execSync(
        "docker images -f 'dangling=true' --format '{{.Size}}'",
        { encoding: "utf-8", timeout: 10000 },
      );
      for (const line of danglingOutput.trim().split("\n")) {
        if (!line) continue;
        reclaimableImages += parseDockerSize(line.trim());
      }
    } catch { /* no matching images */ }

    // Build cache (shared across all projects but mostly Aeolus on a dedicated Pi)
    let buildCache = 0;
    let reclaimableBuildCache = 0;
    try {
      const dfOutput = execSync(
        "docker system df --format '{{.Type}}|{{.Size}}|{{.Reclaimable}}'",
        { encoding: "utf-8", timeout: 15000 },
      );
      for (const line of dfOutput.trim().split("\n")) {
        const [type, sizeStr, reclaimStr] = line.split("|");
        if (type === "Build Cache") {
          buildCache = parseDockerSize(sizeStr?.trim() ?? "0B");
          reclaimableBuildCache = parseDockerSize((reclaimStr?.trim() ?? "0B").replace(/\s*\(.*\)/, ""));
        }
      }
    } catch { /* docker df failed */ }

    // Aeolus container sizes
    let containers = 0;
    try {
      const ctrOutput = execSync(
        "docker ps -s --format '{{.Names}}|{{.Size}}' | grep -E '^aeolus-'",
        { encoding: "utf-8", timeout: 10000 },
      );
      for (const line of ctrOutput.trim().split("\n")) {
        if (!line) continue;
        const [, sizeStr] = line.split("|");
        // Container size format: "0B (virtual 1.23GB)" — we want the first part
        const actualSize = sizeStr?.trim().split(" ")[0] ?? "0B";
        containers += parseDockerSize(actualSize);
      }
    } catch { /* no matching containers */ }

    // Aeolus volumes
    let volumes = 0;
    try {
      const volOutput = execSync(
        "docker system df -v --format '{{.Name}}|{{.Size}}' 2>/dev/null | grep -E 'aeolus' || true",
        { encoding: "utf-8", timeout: 10000 },
      );
      for (const line of volOutput.trim().split("\n")) {
        if (!line) continue;
        const [, sizeStr] = line.split("|");
        volumes += parseDockerSize(sizeStr?.trim() ?? "0B");
      }
    } catch { /* volume query failed */ }

    const total = images + buildCache + containers + volumes;
    const reclaimable = reclaimableImages + reclaimableBuildCache;

    return { images, buildCache, containers, volumes, total, reclaimable };
  } catch {
    return null;
  }
}

function parseDockerSize(str: string): number {
  const match = str.match(/^([\d.]+)\s*(B|kB|KB|MB|GB|TB)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "b": return value;
    case "kb": return value * 1000;
    case "mb": return value * 1000 * 1000;
    case "gb": return value * 1000 * 1000 * 1000;
    case "tb": return value * 1000 * 1000 * 1000 * 1000;
    default: return value;
  }
}

// ── Cached daily version check ──────────────────────────────────────────────

interface VersionInfo {
  current: { commit: string; message: string; date: string } | null;
  latest: { commit: string; message: string; date: string } | null;
  updateAvailable: boolean;
  commitsBehind: number;
  lastChecked: number;
  error?: string;
}

let cachedVersion: VersionInfo = {
  current: null,
  latest: null,
  updateAvailable: false,
  commitsBehind: 0,
  lastChecked: 0,
};

function checkVersion(): VersionInfo {
  const projectDir = process.env.AEOLUS_PROJECT_DIR || "/aeolus-host";

  if (!fs.existsSync(projectDir)) {
    return { ...cachedVersion, lastChecked: Date.now(), error: "Project directory not mounted" };
  }

  // Check if this is actually a git repo
  if (!fs.existsSync(`${projectDir}/.git`)) {
    return { ...cachedVersion, lastChecked: Date.now(), error: "Not a git repository" };
  }

  try {
    const currentCommit = execSync("git rev-parse --short HEAD", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim();
    const currentMessage = execSync("git log -1 --format=%s", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim();
    const currentDate = execSync("git log -1 --format=%ci", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim();

    execSync("git fetch origin --quiet", { cwd: projectDir, encoding: "utf-8", timeout: 15000 });

    const latestCommit = execSync("git rev-parse --short origin/main", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim();
    const latestMessage = execSync("git log origin/main -1 --format=%s", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim();
    const latestDate = execSync("git log origin/main -1 --format=%ci", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim();

    const behind = parseInt(execSync("git rev-list HEAD..origin/main --count", { cwd: projectDir, encoding: "utf-8", timeout: 5000 }).trim(), 10);

    cachedVersion = {
      current: { commit: currentCommit, message: currentMessage, date: currentDate },
      latest: { commit: latestCommit, message: latestMessage, date: latestDate },
      updateAvailable: behind > 0,
      commitsBehind: behind,
      lastChecked: Date.now(),
    };

    if (behind > 0) {
      logger.info({ commitsBehind: behind, latest: latestCommit }, "Aeolus update available");
    } else {
      logger.debug({ commit: currentCommit }, "Aeolus is up to date");
    }
  } catch (err) {
    logger.warn({ error: (err as Error).message }, "Daily version check failed");
    cachedVersion = { ...cachedVersion, lastChecked: Date.now(), error: (err as Error).message };
  }

  return cachedVersion;
}

// Run initial check after a short delay (let the server start first), then every 24h
const VERSION_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
setTimeout(() => {
  checkVersion();
  setInterval(checkVersion, VERSION_CHECK_INTERVAL);
}, 10_000); // 10s after startup

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
    const dockerDisk = getDockerDiskUsage();
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
      docker: dockerDisk,
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

  /** GET /api/system/version — check current vs latest version (cached, refreshes daily) */
  router.get("/version", (req, res) => {
    const forceRefresh = req.query.refresh === "true";

    if (forceRefresh) {
      const result = checkVersion();
      res.json(result);
    } else {
      // Return cached result; if never checked, trigger a check now
      if (cachedVersion.lastChecked === 0) {
        const result = checkVersion();
        res.json(result);
      } else {
        res.json(cachedVersion);
      }
    }
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

    // The project directory is bind-mounted from the host at /aeolus-host.
    // We run git pull directly on the mount (container has git + safe.directory configured in Dockerfile).
    // Then rebuild via the Docker socket (also mounted).
    // The project directory is bind-mounted from the host at /aeolus-host.
    // The original project name is "aeolus" (derived from the host folder name /home/aeolus/aeolus).
    // We must use -p aeolus so compose targets the correct existing containers.
    const updateCmd = [
      `git -C ${projectDir} pull origin main`,
      `docker compose -p aeolus -f ${projectDir}/docker-compose.yml down`,
      `docker compose -p aeolus -f ${projectDir}/docker-compose.yml up -d --build`,
      `docker image prune -f`,
      `docker builder prune -f`,
    ].join(" && ");

    const child = spawn("sh", ["-c", updateCmd], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Log output for debugging
    child.stdout?.on("data", (data: Buffer) => {
      logger.info({ source: "update" }, data.toString().trim());
    });
    child.stderr?.on("data", (data: Buffer) => {
      logger.warn({ source: "update" }, data.toString().trim());
    });

    child.unref();
  });

  /** POST /api/system/docker-prune — remove unused Aeolus Docker images and build cache */
  router.post("/docker-prune", async (_req, res) => {
    try {
      logger.info("Docker prune (Aeolus-scoped) triggered from dashboard");
      // Remove only Aeolus-related unused images (old build versions)
      // The label filter targets images built by compose for this project
      try {
        execSync(
          "docker images --filter 'reference=aeolus-*' --filter 'dangling=true' -q | xargs -r docker rmi -f",
          { encoding: "utf-8", timeout: 30000 },
        );
      } catch { /* no matching images */ }
      // Remove dangling images (untagged layers from Aeolus builds)
      execSync("docker image prune -f", { encoding: "utf-8", timeout: 30000 });
      // Prune build cache (on a dedicated Pi this is all Aeolus)
      execSync("docker builder prune -af", { encoding: "utf-8", timeout: 60000 });
      // Re-fetch docker disk usage after prune
      const docker = getDockerDiskUsage();
      res.json({ success: true, docker });
    } catch (err) {
      logger.error({ error: (err as Error).message }, "Docker prune failed");
      res.status(500).json({ error: "Docker prune failed", message: (err as Error).message });
    }
  });

  /** POST /api/system/shutdown — gracefully shut down the host Pi */
  router.post("/shutdown", (_req, res) => {
    logger.info("Host shutdown triggered from dashboard");
    res.json({ success: true, message: "Shutting down — the Pi will power off in a few seconds" });

    // Use docker to run shutdown on the host via a temporary privileged container
    setTimeout(() => {
      const child = spawn("docker", ["run", "--rm", "--privileged", "--pid=host", "alpine", "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "--", "shutdown", "-h", "now"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }, 1000);
  });

  /** POST /api/system/reboot — gracefully reboot the host Pi */
  router.post("/reboot", (_req, res) => {
    logger.info("Host reboot triggered from dashboard");
    res.json({ success: true, message: "Rebooting — the Pi will restart in a few seconds" });

    setTimeout(() => {
      const child = spawn("docker", ["run", "--rm", "--privileged", "--pid=host", "alpine", "nsenter", "-t", "1", "-m", "-u", "-i", "-n", "--", "shutdown", "-r", "now"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    }, 1000);
  });

  return router;
}