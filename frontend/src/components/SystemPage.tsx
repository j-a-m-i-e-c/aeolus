// frontend/src/components/SystemPage.tsx — Read-only host system diagnostics

import { useState, useEffect, useCallback } from "react";
import { Cpu, HardDrive, MemoryStick, Thermometer, Wifi, Server, RefreshCw, ScrollText, ChevronDown, Activity, Zap, Info } from "lucide-react";
import { useDeviceStore } from "../store/device-store";
import { fetchHealth } from "../lib/api-client";
import { authFetch } from "../lib/auth-fetch";
import type { HealthStatus } from "../store/device-store";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

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
  network: { name: string; address: string }[];
  uptime: number;
}

interface BuildVersionInfo {
  commit: string;
  buildDate: string;
  updateAvailable: boolean;
  latestCommit: string | null;
  commitsBehind: number;
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
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<BuildVersionInfo | null>(null);

  // Health polling (device count, rule count, uptime, MQTT status)
  const health = useDeviceStore((s) => s.health);
  const setHealth = useDeviceStore((s) => s.setHealth);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/system`);
      if (res.ok) {
        setInfo(await res.json());
        setError(null);
      } else {
        setError("Failed to load system information");
      }
    } catch {
      setError("Failed to load system information");
    }
    setLoading(false);
  }, []);

  const fetchVersion = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/system/version`);
      if (res.ok) {
        setVersion(await res.json());
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchInfo();
    fetchVersion();
    const interval = setInterval(fetchInfo, 30000);
    return () => clearInterval(interval);
  }, [fetchInfo, fetchVersion]);

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

  const formatHealthUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading) {
    return <div className="text-center py-12 text-[#6B7785]">Loading system info...</div>;
  }

  if (error && !info) {
    return (
      <div className="text-center py-12">
        <div className="text-[#EF4444] text-lg font-semibold mb-2">System Information Unavailable</div>
        <div className="text-[#6B7785] text-sm">{error}</div>
        <button
          onClick={fetchInfo}
          className="mt-4 px-4 py-2 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!info) {
    return <div className="text-center py-12 text-[#6B7785]">Loading system info...</div>;
  }

  const tempColor = info.cpuTemp && info.cpuTemp > 70 ? "#EF4444" : info.cpuTemp && info.cpuTemp > 55 ? "#F59E0B" : "#22C55E";
  const memColor = info.memory.usagePercent > 85 ? "#EF4444" : info.memory.usagePercent > 60 ? "#F59E0B" : "#3BA4FF";
  const diskColor = info.disk && info.disk.usagePercent > 85 ? "#EF4444" : "#3BA4FF";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">System</h1>
        {version && (
          <div className="flex items-center gap-2 text-xs text-[#6B7785]">
            <Info size={12} />
            <span className="font-mono">
              {version.commit !== "unknown" ? version.commit : "dev"}
            </span>
            {version.buildDate !== "unknown" && (
              <span className="hidden sm:inline">
                · {new Date(version.buildDate).toLocaleDateString()}
              </span>
            )}
            {version.updateAvailable && (
              <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30">
                Update available{version.commitsBehind > 0 ? ` (${version.commitsBehind} commit${version.commitsBehind > 1 ? "s" : ""} behind)` : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Health summary — device count, rule count, uptime, MQTT status */}
      {health && (
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Cpu size={18} className="text-primary" />
              <div>
                <div className="text-lg font-semibold text-[#E6EDF3]">{health.deviceCount}</div>
                <div className="text-[10px] text-[#6B7785] uppercase">Devices</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-accent" />
              <div>
                <div className="text-lg font-semibold text-[#E6EDF3]">{health.ruleCount}</div>
                <div className="text-[10px] text-[#6B7785] uppercase">Automations</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-[#22C55E]" />
              <div>
                <div className="text-lg font-semibold text-[#E6EDF3]">{formatHealthUptime(health.uptime)}</div>
                <div className="text-[10px] text-[#6B7785] uppercase">Uptime</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Wifi size={18} className={health.mqtt === "connected" ? "text-[#22C55E]" : "text-[#EF4444]"} />
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
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-primary" />
              <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">CPU</span>
            </div>
            <span className="text-[10px] text-[#6B7785] font-mono">{info.cpuCores} cores</span>
          </div>
          <div className="text-xs text-[#E6EDF3] font-mono mb-4">{info.cpuModel}</div>
          <div className="space-y-3">
            {([
              { label: "1m", value: info.loadAvg["1m"] },
              { label: "5m", value: info.loadAvg["5m"] },
              { label: "15m", value: info.loadAvg["15m"] },
            ] as const).map(({ label, value }) => {
              const percent = Math.min((value / info.cpuCores) * 100, 100);
              const color = percent > 85 ? "#EF4444" : percent > 60 ? "#F59E0B" : "#3BA4FF";
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[#6B7785]">{label} load</span>
                    <span className="font-mono font-semibold" style={{ color }}>{Math.round(percent)}%</span>
                  </div>
                  <UsageBar percent={percent} color={color} />
                </div>
              );
            })}
          </div>
        </div>

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
            <div className="text-center text-[#6B7785] text-sm py-4">Not available</div>
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
              <UsageBar percent={info.disk.usagePercent} color={diskColor} />
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
      const res = await authFetch(url);
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch {}
  }, [filter]);

  // Only poll when expanded
  useEffect(() => {
    if (!expanded) return;
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 10000);
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
