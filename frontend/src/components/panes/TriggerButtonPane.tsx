// frontend/src/components/panes/TriggerButtonPane.tsx — Configurable trigger button pane

import { useState } from "react";
import { Zap, Check } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { authFetch } from "../../lib/auth-fetch";

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface Props {
  config: PaneConfig;
}

export function TriggerButtonPane({ config }: Props) {
  const triggerName = (config.triggerName as string) || "my-trigger";
  const label = (config.label as string) || triggerName;
  const color = (config.color as string) || "primary";
  const payload = config.payload as Record<string, unknown> | undefined;

  const [firing, setFiring] = useState(false);
  const [lastFired, setLastFired] = useState<number | null>(null);

  const handleFire = async () => {
    setFiring(true);
    try {
      await authFetch(`${API_URL}/api/automations/trigger/${triggerName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      setLastFired(Date.now());
    } catch {}
    setTimeout(() => setFiring(false), 600);
  };

  const colorClasses = color === "accent"
    ? "bg-accent/20 text-accent border-accent/30 hover:bg-accent/30"
    : color === "red"
    ? "bg-[#EF4444]/20 text-[#EF4444] border-[#EF4444]/30 hover:bg-[#EF4444]/30"
    : color === "green"
    ? "bg-[#22C55E]/20 text-[#22C55E] border-[#22C55E]/30 hover:bg-[#22C55E]/30"
    : "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30";

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
      <button
        onClick={handleFire}
        disabled={firing}
        className={`flex items-center gap-3 px-8 py-4 text-lg font-semibold rounded-xl border transition-all duration-200 ${colorClasses} disabled:opacity-60`}
      >
        {firing ? (
          <Check size={22} className="animate-pulse" />
        ) : (
          <Zap size={22} />
        )}
        {label}
      </button>

      <div className="text-[10px] text-[#6B7785] font-mono">
        service/trigger/{triggerName}
      </div>

      {lastFired && (
        <div className="text-[10px] text-[#9AA6B2]">
          Last fired {new Date(lastFired).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
