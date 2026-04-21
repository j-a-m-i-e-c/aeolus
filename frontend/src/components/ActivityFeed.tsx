// frontend/src/components/ActivityFeed.tsx — Recent execution feed for free-form automations

import { useState, useEffect } from "react";
import { CheckCircle, XCircle, Clock } from "lucide-react";

const API_URL = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface ActivityAction {
  type: string;
  target: string;
  success: boolean;
  error?: string;
}

interface ActivityEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  triggerTopic: string;
  actions: ActivityAction[];
  duration: number;
  timestamp: number;
}

interface ActivityFeedProps {
  ruleId: string;
}

export function ActivityFeed({ ruleId }: ActivityFeedProps) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_URL}/api/automations/history?ruleId=${ruleId}&limit=5`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();
        if (!cancelled) {
          setEntries(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHistory();

    // Poll every 10s for updates (v1 — simpler than WebSocket)
    const interval = setInterval(fetchHistory, 10_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ruleId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-[#6B7785] text-xs">
        <Clock size={14} className="animate-pulse mr-2" />
        Loading activity…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-6 text-[#6B7785] text-xs">
        Unable to load activity
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-6 text-[#6B7785] text-xs">
        No activity yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const allSuccess = entry.actions.every((a) => a.success);
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const date = new Date(entry.timestamp).toLocaleDateString();

        return (
          <div
            key={entry.id}
            className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[#0B0F14] border border-[#2A3441]"
          >
            {/* Success/failure indicator */}
            <div className="mt-0.5 shrink-0">
              {allSuccess ? (
                <CheckCircle size={14} className="text-[#22C55E]" />
              ) : (
                <XCircle size={14} className="text-[#EF4444]" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              {/* Timestamp */}
              <div className="text-[10px] text-[#6B7785]">
                {date} {time}
              </div>

              {/* Actions */}
              <div className="mt-1 space-y-0.5">
                {entry.actions.map((action, i) => (
                  <div key={i} className="text-xs text-[#E6EDF3] truncate">
                    <span className="text-[#9AA6B2]">{action.type}</span>
                    {" → "}
                    <span className="font-mono text-[#5CE1E6]">{action.target}</span>
                    {!action.success && action.error && (
                      <span className="text-[#EF4444] ml-1 text-[10px]">({action.error})</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
