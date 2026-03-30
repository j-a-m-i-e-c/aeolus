// frontend/src/components/SystemHealth.tsx — System health display

import { useEffect } from "react";
import { useDeviceStore } from "../store/device-store";
import { fetchHealth } from "../lib/api-client";
import type { HealthStatus } from "../store/device-store";
import { Activity, Cpu, Zap } from "lucide-react";

const POLL_INTERVAL = 30_000;

export function SystemHealth() {
  const health = useDeviceStore((s) => s.health);
  const setHealth = useDeviceStore((s) => s.setHealth);

  useEffect(() => {
    const poll = async () => {
      try {
        const data = (await fetchHealth()) as unknown as HealthStatus;
        setHealth(data);
      } catch {
        // Silently fail — health is non-critical
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [setHealth]);

  if (!health) return null;

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
      <h2 className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider mb-3">
        System Health
      </h2>
      <div className="grid grid-cols-3 gap-4">
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
            <div className="text-lg font-semibold text-[#E6EDF3]">{formatUptime(health.uptime)}</div>
            <div className="text-[10px] text-[#6B7785] uppercase">Uptime</div>
          </div>
        </div>
      </div>
    </div>
  );
}
