// frontend/src/components/Sidebar.tsx — Left sidebar navigation

import { AeolusLogo } from "./AeolusLogo";
import { useDeviceStore } from "../store/device-store";
import { Cpu, Wifi, WifiOff, Play, Square, Lightbulb } from "lucide-react";
import { useState, useEffect } from "react";
import { fetchSimulatorStatus, startSimulator, stopSimulator } from "../lib/api-client";

export function Sidebar() {
  const wsConnected = useDeviceStore((s) => s.wsConnected);
  const health = useDeviceStore((s) => s.health);
  const [simRunning, setSimRunning] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const currentPage = useDeviceStore((s) => s.currentPage);
  const setCurrentPage = useDeviceStore((s) => s.setCurrentPage);

  useEffect(() => {
    fetchSimulatorStatus().then((s) => setSimRunning(s.running)).catch(() => {});
  }, []);

  const toggleSimulator = async () => {
    setSimLoading(true);
    try {
      if (simRunning) {
        await stopSimulator();
        setSimRunning(false);
      } else {
        await startSimulator();
        setSimRunning(true);
      }
    } catch {}
    setSimLoading(false);
  };

  return (
    <aside className="w-64 min-h-screen bg-surface border-r border-[#2A3441] flex flex-col p-4 gap-6">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2">
        <AeolusLogo size={40} />
        <span className="text-xl font-semibold text-primary">Aeolus</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1">
        <button
          onClick={() => setCurrentPage("dashboard")}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            currentPage === "dashboard" ? "bg-elevated text-[#E6EDF3]" : "text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50"
          }`}
        >
          <Cpu size={16} />
          Dashboard
        </button>
        <button
          onClick={() => setCurrentPage("lighting")}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            currentPage === "lighting" ? "bg-elevated text-[#E6EDF3]" : "text-[#6B7785] hover:text-[#9AA6B2] hover:bg-elevated/50"
          }`}
        >
          <Lightbulb size={16} />
          Lighting
        </button>
      </nav>

      {/* Simulator toggle */}
      <div className="px-2">
        <button
          onClick={toggleSimulator}
          disabled={simLoading}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
            simRunning
              ? "bg-accent/15 text-accent border border-accent/30"
              : "bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2]"
          }`}
        >
          {simRunning ? <Square size={12} /> : <Play size={12} />}
          {simLoading ? "..." : simRunning ? "Stop Simulator" : "Start Simulator"}
        </button>
      </div>

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
