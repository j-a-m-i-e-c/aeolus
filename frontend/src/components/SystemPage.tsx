// frontend/src/components/SystemPage.tsx — Host system diagnostics

import { useState, useEffect, useCallback, useRef } from "react";
import { Cpu, HardDrive, MemoryStick, Thermometer, Wifi, Server, RefreshCw, ScrollText, ChevronDown, Download, Loader2, Activity, Zap, Power, RotateCcw, Trash2 } from "lucide-react";
import { useDeviceStore } from "../store/device-store";
import { fetchHealth } from "../lib/api-client";
import type { HealthStatus } from "../store/device-store";

const API_URL = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  cpuModel: string;
  cpuCores: number;
  cpuTemp: number | null;
  loadAvg: { "1m": number; "5m": number; "15m": number };
  memory: { total: number; used: number; free: number; usagePercent: number };
  disk: { total: number; used: number; free: number; usagePercent: number } | null;
  docker: { images: number; buildCache: number; containers: number; volumes: number; total: number; reclaimable: number } | null;
  network: { name: string; address: string }[];
  uptime: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function UsageBar({ percent, color = "#3BA4FF" }: { percent: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-background rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>
  );
}

export function SystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState("");

  // Health polling (device count, rule count, uptime, MQTT status)
  const health = useDeviceStore((s) => s.health);
  const setHealth = useDeviceStore((s) => s.setHealth);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/system`);
      setInfo(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInfo();
    const interval = setInterval(fetchInfo, 30000);
    return () => clearInterval(interval);
  }, [fetchInfo]);

  // Poll health alongside system info
  useEffect(() => {
    const poll = async () => {
      try {
        const data = (await fetchHealth()) as unknown as HealthStatus;
        setHealth(data);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [setHealth]);

  const triggerUpdate = async () => {
    if (!confirm("Pull latest code and rebuild? The system will restart automatically.")) return;
    setUpdating(true);
    setUpdateMsg("");
    try {
      const res = await fetch(`${API_URL}/api/system/update`, { method: "POST" });
      const data = await res.json();
      setUpdateMsg(data.message || "Update started — waiting for restart...");

      // Poll until the backend comes back, then auto-refresh
      const pollStart = Date.now();
      const maxWait = 180_000; // 3 minutes max
      const pollInterval = 3_000; // check every 3 seconds

      const poll = async () => {
        if (Date.now() - pollStart > maxWait) {
          setUpdateMsg("Update is taking longer than expected. Try refreshing manually.");
          setUpdating(false);
          return;
        }

        try {
          const healthRes = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
          if (healthRes.ok) {
            // Backend is back — reload the page
            window.location.reload();
            return;
          }
        } catch {
          // Still down — keep polling
        }
        setTimeout(poll, pollInterval);
      };

      // Wait a few seconds for the rebuild to start before polling
      setTimeout(poll, 10_000);
    } catch (err) {
      setUpdateMsg("Failed to trigger update");
      setUpdating(false);
    }
  };

  const triggerShutdown = async () => {
    if (!confirm("Shut down the Pi? You will need physical access to turn it back on.")) return;
    try {
      await fetch(`${API_URL}/api/system/shutdown`, { method: "POST" });
      setUpdateMsg("Shutting down — the Pi will power off in a few seconds");
    } catch {
      setUpdateMsg("Failed to trigger shutdown");
    }
  };

  const triggerReboot = async () => {
    if (!confirm("Reboot the Pi? The dashboard will be unavailable for about a minute.")) return;
    try {
      await fetch(`${API_URL}/api/system/reboot`, { method: "POST" });
      setUpdateMsg("Rebooting — refresh the page in about a minute");
    } catch {
      setUpdateMsg("Failed to trigger reboot");
    }
  };

  const formatHealthUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading || !info) {
    return <div className="text-center py-12 text-[#6B7785]">Loading system info...</div>;
  }

  const tempColor = info.cpuTemp && info.cpuTemp > 70 ? "#EF4444" : info.cpuTemp && info.cpuTemp > 55 ? "#F59E0B" : "#22C55E";
  const memColor = info.memory.usagePercent > 85 ? "#EF4444" : info.memory.usagePercent > 60 ? "#F59E0B" : "#3BA4FF";
  const diskColor = info.disk && info.disk.usagePercent > 85 ? "#EF4444" : "#3BA4FF";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">System</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={triggerUpdate}
            disabled={updating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
            title="Pull latest code and rebuild"
          >
            {updating ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {updating ? "Updating..." : "Update & Restart"}
          </button>
          <button
            onClick={triggerReboot}
            className="group flex items-center gap-0 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/20 hover:gap-1.5 hover:px-3 transition-all duration-200 overflow-hidden"
            title="Reboot the Pi"
          >
            <RotateCcw size={14} className="shrink-0" />
            <span className="max-w-0 group-hover:max-w-[4rem] overflow-hidden whitespace-nowrap transition-all duration-200">Reboot</span>
          </button>
          <button
            onClick={triggerShutdown}
            className="group flex items-center gap-0 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444]/20 hover:gap-1.5 hover:px-3 transition-all duration-200 overflow-hidden"
            title="Shut down the Pi"
          >
            <Power size={14} className="shrink-0" />
            <span className="max-w-0 group-hover:max-w-[5rem] overflow-hidden whitespace-nowrap transition-all duration-200">Shutdown</span>
          </button>
        </div>
      </div>

      {updateMsg && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl px-4 py-3 text-sm text-primary">
          {updateMsg}
          {updating && <span className="text-[10px] text-[#6B7785] ml-2">The page will refresh automatically when ready</span>}
        </div>
      )}

      {/* Health summary — device count, rule count, uptime, MQTT status */}
      {health && (
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-primary" />
              <div>
                <div className="text-lg font-semibold text-[#E6EDF3]">{health.deviceCount}</div>
                <div className="text-[10px] text-[#6B7785] uppercase">Devices</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-accent" />
              <div>
                <div className="text-lg font-semibold text-[#E6EDF3]">{health.ruleCount}</div>
                <div className="text-[10px] text-[#6B7785] uppercase">Rules</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-[#22C55E]" />
              <div>
                <div className="text-lg font-semibold text-[#E6EDF3]">{formatHealthUptime(health.uptime)}</div>
                <div className="text-[10px] text-[#6B7785] uppercase">Uptime</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Wifi size={14} className={health.mqtt === "connected" ? "text-[#22C55E]" : "text-[#EF4444]"} />
              <div>
                <div className="text-lg font-semibold text-[#E6EDF3] capitalize">{health.mqtt}</div>
                <div className="text-[10px] text-[#6B7785] uppercase">MQTT</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Host info */}
      <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Server size={14} className="text-primary" />
          <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Host</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-[10px] text-[#6B7785] uppercase">Hostname</div>
            <div className="text-[#E6EDF3] font-mono">{info.hostname}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#6B7785] uppercase">Platform</div>
            <div className="text-[#E6EDF3] font-mono">{info.platform} / {info.arch}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#6B7785] uppercase">Node.js</div>
            <div className="text-[#E6EDF3] font-mono">{info.nodeVersion}</div>
          </div>
          <div>
            <div className="text-[10px] text-[#6B7785] uppercase">Uptime</div>
            <div className="text-[#E6EDF3] font-mono">{formatUptime(info.uptime)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CPU */}
        <CpuChart info={info} />

        {/* Temperature */}
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Thermometer size={14} style={{ color: tempColor }} />
            <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Temperature</span>
          </div>
          {info.cpuTemp !== null ? (
            <div className="text-center">
              <div className="text-4xl font-bold" style={{ color: tempColor }}>{info.cpuTemp}°C</div>
              <div className="text-xs text-[#6B7785] mt-1">
                {info.cpuTemp < 50 ? "Cool" : info.cpuTemp < 65 ? "Normal" : info.cpuTemp < 75 ? "Warm" : "Hot"}
              </div>
            </div>
          ) : (
            <div className="text-center text-[#6B7785] text-sm py-4">Not available (non-Pi host)</div>
          )}
        </div>

        {/* Memory */}
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <MemoryStick size={14} className="text-primary" />
            <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Memory</span>
          </div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[#6B7785]">{formatBytes(info.memory.used)} / {formatBytes(info.memory.total)}</span>
            <span style={{ color: memColor }} className="font-semibold">{info.memory.usagePercent}%</span>
          </div>
          <UsageBar percent={info.memory.usagePercent} color={memColor} />
        </div>

        {/* Disk */}
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive size={14} className="text-primary" />
            <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Disk</span>
          </div>
          {info.disk ? (
            <>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-[#6B7785]">{formatBytes(info.disk.used)} / {formatBytes(info.disk.total)}</span>
                <span style={{ color: diskColor }} className="font-semibold">{info.disk.usagePercent}%</span>
              </div>
              {/* Stacked bar showing Docker vs other usage */}
              {info.docker ? (
                <div className="w-full h-2 bg-background rounded-full overflow-hidden flex">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${Math.round(((info.disk.used - info.docker.total) / info.disk.total) * 100)}%`,
                      backgroundColor: diskColor,
                    }}
                    title={`System: ${formatBytes(info.disk.used - info.docker.total)}`}
                  />
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${Math.round((info.docker.total / info.disk.total) * 100)}%`,
                      backgroundColor: "#F59E0B",
                    }}
                    title={`Docker: ${formatBytes(info.docker.total)}`}
                  />
                </div>
              ) : (
                <UsageBar percent={info.disk.usagePercent} color={diskColor} />
              )}
              {/* Docker breakdown */}
              {info.docker && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-[10px] text-[#6B7785]">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: diskColor }} />
                    System: {formatBytes(info.disk.used - info.docker.total)}
                    <span className="inline-block w-2 h-2 rounded-full ml-2" style={{ backgroundColor: "#F59E0B" }} />
                    Aeolus Docker: {formatBytes(info.docker.total)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-[#6B7785]">Images</span>
                      <span className="text-[#9AA6B2] font-mono">{formatBytes(info.docker.images)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6B7785]">Build Cache</span>
                      <span className="text-[#9AA6B2] font-mono">{formatBytes(info.docker.buildCache)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6B7785]">Containers</span>
                      <span className="text-[#9AA6B2] font-mono">{formatBytes(info.docker.containers)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6B7785]">Volumes</span>
                      <span className="text-[#9AA6B2] font-mono">{formatBytes(info.docker.volumes)}</span>
                    </div>
                  </div>
                  {info.docker.reclaimable > 1024 * 1024 && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Free up ${formatBytes(info.docker!.reclaimable)} by removing unused Docker images and build cache?`)) return;
                        try {
                          const res = await fetch(`${API_URL}/api/system/docker-prune`, { method: "POST" });
                          const data = await res.json();
                          if (data.docker) {
                            // Update the info with fresh docker stats
                            setInfo((prev) => prev ? { ...prev, docker: data.docker } : prev);
                          }
                          fetchInfo(); // Refresh disk stats too
                        } catch {}
                      }}
                      className="flex items-center gap-1.5 text-[10px] text-[#F59E0B] hover:text-[#E6EDF3] transition-colors"
                    >
                      <Trash2 size={10} />
                      {formatBytes(info.docker.reclaimable)} reclaimable — clean up
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-center text-[#6B7785] text-sm py-2">Not available</div>
          )}
        </div>
      </div>

      {/* Network */}
      <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wifi size={14} className="text-primary" />
          <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Network</span>
        </div>
        <div className="space-y-1">
          {info.network.map((iface) => (
            <div key={iface.name + iface.address} className="flex items-center justify-between text-xs">
              <span className="text-[#6B7785]">{iface.name}</span>
              <span className="text-[#E6EDF3] font-mono">{iface.address}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Application Logs */}
      <LogViewer />
    </div>
  );
}


// ---------------------------------------------------------------------------
// CPU Line Chart
// ---------------------------------------------------------------------------

function CpuChart({ info }: { info: SystemInfo }) {
  const cpuHistory = useRef<Array<{ time: number; load: number }>>([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const load1m = Math.min((info.loadAvg["1m"] / info.cpuCores) * 100, 100);
    cpuHistory.current.push({ time: Date.now(), load: load1m });
    // Keep last 20 data points (10 minutes at 30s intervals)
    if (cpuHistory.current.length > 20) {
      cpuHistory.current = cpuHistory.current.slice(-20);
    }
    forceRender((n) => n + 1);
  }, [info]);

  const history = cpuHistory.current;
  const currentLoad = history.length > 0 ? history[history.length - 1].load : 0;

  // Chart dimensions
  const chartWidth = 240;
  const chartHeight = 140;
  const padX = 0;
  const padY = 4;

  // Build polyline points
  const points = history.map((entry, i) => {
    const x = padX + (history.length > 1 ? (i / (history.length - 1)) * (chartWidth - padX * 2) : (chartWidth - padX * 2) / 2);
    const y = padY + (chartHeight - padY * 2) - (entry.load / 100) * (chartHeight - padY * 2);
    return { x, y };
  });

  const polylineStr = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Area fill path (closed polygon under the line)
  const areaPath = points.length > 0
    ? `M ${points[0].x},${chartHeight - padY} ` +
      points.map((p) => `L ${p.x},${p.y}`).join(" ") +
      ` L ${points[points.length - 1].x},${chartHeight - padY} Z`
    : "";

  // Grid lines at 25%, 50%, 75%
  const gridLines = [25, 50, 75].map((pct) => ({
    pct,
    y: padY + (chartHeight - padY * 2) - (pct / 100) * (chartHeight - padY * 2),
  }));

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-primary" />
          <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">CPU</span>
        </div>
        <span className="text-[10px] text-[#6B7785] font-mono">{info.cpuCores} cores</span>
      </div>
      <div className="text-xs text-[#E6EDF3] font-mono mb-4">{info.cpuModel}</div>

      <div className="flex items-start gap-4">
        {/* SVG Chart */}
        <div className="flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full"
            style={{ height: "140px" }}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="cpuFillGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3BA4FF" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#3BA4FF" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {gridLines.map(({ pct, y }) => (
              <line
                key={pct}
                x1={padX}
                y1={y}
                x2={chartWidth - padX}
                y2={y}
                stroke="#2A3441"
                strokeWidth="0.5"
                strokeDasharray="3,3"
              />
            ))}

            {/* Area fill */}
            {points.length > 1 && (
              <path d={areaPath} fill="url(#cpuFillGradient)" />
            )}

            {/* Line */}
            {points.length > 1 && (
              <polyline
                points={polylineStr}
                fill="none"
                stroke="#3BA4FF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Current point dot */}
            {points.length > 0 && (
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="3"
                fill="#3BA4FF"
              />
            )}
          </svg>
        </div>

        {/* Current values */}
        <div className="shrink-0 text-right">
          <div className="text-3xl font-bold text-[#E6EDF3]">{Math.round(currentLoad)}%</div>
          <div className="text-[10px] text-[#6B7785]">CPU Load</div>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Log Viewer
// ---------------------------------------------------------------------------

interface LogEntry {
  level: number;
  levelLabel: string;
  msg: string;
  time: string;
  [key: string]: unknown;
}

const LEVEL_COLORS: Record<string, string> = {
  trace: "text-[#6B7785]",
  debug: "text-[#6B7785]",
  info: "text-[#3BA4FF]",
  warn: "text-[#F59E0B]",
  error: "text-[#EF4444]",
  fatal: "text-[#EF4444]",
};

const LEVEL_BG: Record<string, string> = {
  warn: "bg-[#F59E0B]/5",
  error: "bg-[#EF4444]/5",
  fatal: "bg-[#EF4444]/10",
};

function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const url = filter === "all"
        ? `${API_URL}/api/system/logs?count=100`
        : `${API_URL}/api/system/logs?count=100&level=${filter}`;
      const res = await fetch(url);
      setLogs(await res.json());
    } catch {}
  }, [filter]);

  // Only poll when expanded
  useEffect(() => {
    if (!expanded) return;
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000); // 10s refresh
    return () => clearInterval(interval);
  }, [fetchLogs, autoRefresh, expanded]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  // Extract extra context fields (not level/msg/time/levelLabel)
  const getContext = (entry: LogEntry): string => {
    const skip = new Set(["level", "levelLabel", "msg", "time", "v"]);
    const ctx: string[] = [];
    for (const [k, v] of Object.entries(entry)) {
      if (!skip.has(k) && v !== undefined) {
        ctx.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }
    return ctx.join(" ");
  };

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ScrollText size={14} className="text-primary" />
          <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Application Logs</span>
          <ChevronDown size={14} className={`text-[#6B7785] transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
        {expanded && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-[10px] bg-background border border-[#2A3441] rounded px-2 py-1 text-[#E6EDF3] focus:outline-none focus:border-primary"
            >
              <option value="all">All levels</option>
              <option value="error">Error</option>
              <option value="warn">Warn</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
            <label className="flex items-center gap-1 text-[10px] text-[#6B7785] cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-primary"
              />
              Auto
            </label>
            <button onClick={fetchLogs} className="text-[#6B7785] hover:text-primary transition-colors" title="Refresh">
              <RefreshCw size={12} />
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="max-h-80 overflow-auto rounded-lg bg-background border border-[#2A3441] mt-3">
        {logs.length === 0 ? (
          <div className="text-center py-6 text-[#6B7785] text-xs">No logs</div>
        ) : (
          <div className="divide-y divide-[#2A3441]/50">
            {logs.map((entry, i) => {
              const ctx = getContext(entry);
              return (
                <div
                  key={`${entry.time}-${i}`}
                  className={`px-3 py-1.5 text-[11px] font-mono flex gap-3 ${LEVEL_BG[entry.levelLabel] || ""}`}
                >
                  <span className="text-[#6B7785] shrink-0 w-16">{formatTime(entry.time)}</span>
                  <span className={`shrink-0 w-10 uppercase font-semibold ${LEVEL_COLORS[entry.levelLabel] || "text-[#6B7785]"}`}>
                    {entry.levelLabel}
                  </span>
                  <span className="text-[#E6EDF3] flex-1 break-all">
                    {entry.msg}
                    {ctx && <span className="text-[#6B7785] ml-2">{ctx}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
