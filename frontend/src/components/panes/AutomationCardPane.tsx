// frontend/src/components/panes/AutomationCardPane.tsx — Single automation control card pane

import { useState, useEffect, useCallback } from "react";
import { GitBranch, Power, PowerOff, Zap, Loader2 } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";

const API_URL = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface AutomationRule {
  id: string;
  name: string;
  topic: string;
  ruleType: string;
  enabled: boolean;
  source: string;
}

interface Props {
  config: PaneConfig;
}

export function AutomationCardPane({ config }: Props) {
  const ruleId = config.ruleId as string | undefined;
  const triggerName = config.triggerName as string | undefined;

  const [rule, setRule] = useState<AutomationRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [firing, setFiring] = useState(false);
  const [lastFired, setLastFired] = useState<number | null>(null);

  const fetchRule = useCallback(async () => {
    if (!ruleId) { setLoading(false); return; }
    try {
      const res = await fetch(`${API_URL}/api/automations`);
      const rules = await res.json() as AutomationRule[];
      const found = rules.find((r) => r.id === ruleId);
      setRule(found ?? null);
    } catch {}
    setLoading(false);
  }, [ruleId]);

  useEffect(() => { fetchRule(); }, [fetchRule]);

  const handleToggle = async () => {
    if (!rule) return;
    setToggling(true);
    try {
      await fetch(`${API_URL}/api/automations/${rule.id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      setRule({ ...rule, enabled: !rule.enabled });
    } catch {}
    setToggling(false);
  };

  const handleFire = async () => {
    const name = triggerName || rule?.name?.toLowerCase().replace(/\s+/g, "-") || "manual";
    setFiring(true);
    try {
      await fetch(`${API_URL}/api/services/trigger/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: rule?.id }),
      });
      setLastFired(Date.now());
    } catch {}
    setTimeout(() => setFiring(false), 600);
  };

  if (!ruleId) {
    return (
      <div className="h-full flex items-center justify-center text-[#6B7785] text-xs">
        Configure this pane with a rule ID
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={18} className="animate-spin text-[#6B7785]" />
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="h-full flex items-center justify-center text-[#6B7785] text-xs">
        Rule not found: {ruleId}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col justify-between p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <GitBranch size={16} className={rule.enabled ? "text-primary" : "text-[#6B7785]"} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#E6EDF3] truncate">{rule.name}</div>
          <div className="text-[10px] text-[#6B7785] font-mono truncate">
            when({rule.topic}) → {rule.ruleType}
          </div>
        </div>
        <div className={`w-2.5 h-2.5 rounded-full ${rule.enabled ? "bg-[#22C55E]" : "bg-[#6B7785]"}`} />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleToggle}
          disabled={toggling || rule.source === "file"}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            rule.enabled
              ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30 hover:bg-[#22C55E]/25"
              : "bg-elevated text-[#6B7785] border-[#2A3441] hover:text-[#9AA6B2]"
          } disabled:opacity-50`}
        >
          {rule.enabled ? <Power size={12} /> : <PowerOff size={12} />}
          {rule.enabled ? "Enabled" : "Disabled"}
        </button>

        <button
          onClick={handleFire}
          disabled={firing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
        >
          <Zap size={12} />
          Fire
        </button>
      </div>

      {/* Last fired */}
      {lastFired && (
        <div className="text-[10px] text-[#9AA6B2] mt-2">
          Manually fired {new Date(lastFired).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
