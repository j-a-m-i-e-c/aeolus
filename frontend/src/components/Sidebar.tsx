// frontend/src/components/Sidebar.tsx — Left sidebar navigation

import { AeolusLogo } from "./AeolusLogo";
import { useDeviceStore } from "../store/device-store";
import { Cpu, Wifi, WifiOff } from "lucide-react";

export function Sidebar() {
  const wsConnected = useDeviceStore((s) => s.wsConnected);
  const health = useDeviceStore((s) => s.health);

  return (
    <aside className="w-64 min-h-screen bg-surface border-r border-[#2A3441] flex flex-col p-4 gap-6">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2">
        <AeolusLogo size={40} />
        <span className="text-xl font-semibold text-primary">Aeolus</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1">
        <a href="#" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated text-[#E6EDF3] text-sm font-medium">
          <Cpu size={16} />
          Dashboard
        </a>
      </nav>

      {/* System status */}
      <div className="mt-auto px-2 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          {health?.mqtt === "connected" ? (
            <Wifi size={14} className="text-[#22C55E]" />
          ) : (
            <WifiOff size={14} className="text-[#EF4444]" />
          )}
          <span className="text-[#9AA6B2]">
            MQTT {health?.mqtt === "connected" ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#6B7785]">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
          WebSocket {wsConnected ? "Live" : "Offline"}
        </div>
      </div>
    </aside>
  );
}
