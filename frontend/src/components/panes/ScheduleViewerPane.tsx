// frontend/src/components/panes/ScheduleViewerPane.tsx — Schedule Viewer pane for cron-triggered automations

import { useState, useEffect, useCallback } from "react";
import { CalendarClock, Search, Loader2 } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { describeCron } from "../../lib/cron-utils";
import { authFetch } from "../../lib/auth-fetch";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface Automation {
  id: string;
  name: string;
  triggerType: string;
  cronExpression?: string | null;
  enabled: boolean;
}

type FilterMode = "all" | "enabled" | "disabled";

interface Props {
  config: PaneConfig;
}

export function ScheduleViewerPane({ config: _config }: Props) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [lastFiredMap, setLastFiredMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await authFetch(`${API_URL}/api/automations`);
      if (!res.ok) throw new Error("Failed to fetch automations");
      const data: Automation[] = await res.json();
      const cronAutomations = data.filter((a) => a.triggerType === "cron");
      setAutomations(cronAutomations);
      setError(null);

      // Fetch last fired time for each
      const historyMap: Record<string, string | null> = {};
      await Promise.all(
        cronAutomations.map(async (a) => {
          try {
            const hRes = await authFetch(`${API_URL}/api/automations/history?ruleId=${a.id}&limit=1`);
            if (hRes.ok) {
              const history = await hRes.json();
              historyMap[a.id] = Array.isArray(history) && history.length > 0
                ? history[0].firedAt || history[0].timestamp || null
                : null;
            } else {
              historyMap[a.id] = null;
            }
          } catch {
            historyMap[a.id] = null;
          }
        }),
      );
      setLastFiredMap(historyMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
    const interval = setInterval(fetchAutomations, 30_000);
    return () => clearInterval(interval);
  }, [fetchAutomations]);

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    setTogglingIds((prev) => new Set(prev).add(id));
    try {
      await authFetch(`${API_URL}/api/automations/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, enabled: !currentEnabled } : a)),
      );
    } catch {}
    setTogglingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const getCronExpression = (a: Automation): string => {
    return a.cronExpression || "";
  };

  const filtered = automations.filter((a) => {
    if (filter === "enabled" && !a.enabled) return false;
    if (filter === "disabled" && a.enabled) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#6B7785]">
        <Loader2 size={20} className="animate-spin mr-2" />
        <span className="text-sm">Loading schedules…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[#EF4444]">
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  if (automations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#6B7785] gap-2">
        <CalendarClock size={32} className="opacity-40" />
        <p className="text-sm">No scheduled automations.</p>
        <p className="text-xs">Create one with the Schedule trigger type.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3 p-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7785]" />
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#0B0F14] border border-[#2A3441] rounded-lg text-[#E6EDF3] placeholder-[#6B7785] focus:outline-none focus:border-[#3D8BFF]"
          />
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {(["all", "enabled", "disabled"] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full capitalize transition-colors ${
                filter === mode
                  ? "bg-[#3D8BFF]/20 text-[#3D8BFF]"
                  : "bg-[#0B0F14] text-[#6B7785] hover:text-[#9AA6B2]"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-[#6B7785] text-xs">
            No matching schedules found.
          </div>
        ) : (
          filtered.map((automation) => {
            const cron = getCronExpression(automation);
            const lastFired = lastFiredMap[automation.id];
            const isToggling = togglingIds.has(automation.id);

            return (
              <div
                key={automation.id}
                className="rounded-lg bg-[#0B0F14] border border-[#2A3441] p-3 flex items-center gap-3"
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-[#E6EDF3] truncate">
                      {automation.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        automation.enabled
                          ? "bg-[#22C55E]/20 text-[#22C55E]"
                          : "bg-[#6B7785]/20 text-[#6B7785]"
                      }`}
                    >
                      {automation.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <code className="font-mono text-[#9AA6B2] bg-[#1C2128] px-1.5 py-0.5 rounded">
                      {cron || "—"}
                    </code>
                    <span className="text-[#6B7785] truncate">
                      {cron ? describeCron(cron) : "No expression"}
                    </span>
                  </div>
                  {lastFired && (
                    <div className="text-[10px] text-[#6B7785] mt-1">
                      Last fired: {new Date(lastFired).toLocaleString()}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(automation.id, automation.enabled)}
                    disabled={isToggling}
                    className={`px-2 py-1 text-[10px] font-medium rounded-full transition-colors ${
                      automation.enabled
                        ? "bg-[#22C55E]/20 text-[#22C55E] hover:bg-[#22C55E]/30"
                        : "bg-[#6B7785]/20 text-[#6B7785] hover:bg-[#6B7785]/30"
                    } disabled:opacity-50`}
                  >
                    {automation.enabled ? "Disable" : "Enable"}
                  </button>

                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
