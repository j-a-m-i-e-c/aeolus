// frontend/src/components/SystemPage.tsx — Host system diagnostics

import { useState, useEffect, useCallback } from "react";
import { Cpu, HardDrive, MemoryStick, Thermometer, Wifi, Server, RefreshCw } from "lucide-react";

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

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/system`);
      setInfo(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchInfo();
    const interval = setInterval(fetchInfo, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchInfo]);

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
        <button onClick={fetchInfo} className="text-[#6B7785] hover:text-primary transition-colors" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

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
          <div className="flex items-center gap-2 mb-3">
            <Cpu size={14} className="text-primary" />
            <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">CPU</span>
          </div>
          <div className="text-xs text-[#E6EDF3] font-mono mb-2">{info.cpuModel}</div>
          <div className="text-xs text-[#6B7785] mb-2">{info.cpuCores} cores</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-semibold text-[#E6EDF3]">{info.loadAvg["1m"].toFixed(2)}</div>
              <div className="text-[10px] text-[#6B7785]">1m load</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-[#E6EDF3]">{info.loadAvg["5m"].toFixed(2)}</div>
              <div className="text-[10px] text-[#6B7785]">5m load</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-[#E6EDF3]">{info.loadAvg["15m"].toFixed(2)}</div>
              <div className="text-[10px] text-[#6B7785]">15m load</div>
            </div>
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
    </div>
  );
}