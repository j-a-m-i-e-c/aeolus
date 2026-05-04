// frontend/src/components/panes/StateHistoryPane.tsx — Dashboard pane for device state history

import { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart, RefreshCw } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { useDeviceStore } from "../../store/device-store";
import { fetchDeviceHistory, type HistoryEntry } from "../../lib/api-client";
import { StateHistoryChart } from "../StateHistoryChart";

interface StateHistoryPaneConfig {
  deviceId?: string;
  timeRange?: "15m" | "1h" | "6h" | "24h";
}

const TIME_RANGES: { label: string; value: StateHistoryPaneConfig["timeRange"] }[] = [
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
];

function timeRangeToLimit(range: StateHistoryPaneConfig["timeRange"]): number {
  switch (range) {
    case "15m": return 30;
    case "1h": return 60;
    case "6h": return 100;
    case "24h": return 200;
    default: return 60;
  }
}

interface Props {
  config: PaneConfig;
  paneId?: string;
}

export function StateHistoryPane({ config }: Props) {
  const paneConfig = config as PaneConfig & StateHistoryPaneConfig;
  const devices = useDeviceStore((s) => s.devices);
  const deviceList = useMemo(() => Object.values(devices), [devices]);

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
    paneConfig.deviceId ?? "",
  );
  const [timeRange, setTimeRange] = useState<StateHistoryPaneConfig["timeRange"]>(
    paneConfig.timeRange ?? "1h",
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select first device if none selected
  useEffect(() => {
    if (!selectedDeviceId && deviceList.length > 0) {
      setSelectedDeviceId(deviceList[0].id);
    }
  }, [selectedDeviceId, deviceList]);

  // Fetch history data
  const loadHistory = useCallback(async () => {
    if (!selectedDeviceId) return;
    setLoading(true);
    setError(null);
    try {
      const limit = timeRangeToLimit(timeRange);
      const data = await fetchDeviceHistory(selectedDeviceId, limit);
      setHistory(data);
    } catch (err) {
      setError((err as Error).message);
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDeviceId, timeRange]);

  // Load on mount and when selection changes
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!selectedDeviceId) return;
    const interval = setInterval(loadHistory, 30_000);
    return () => clearInterval(interval);
  }, [selectedDeviceId, loadHistory]);

  const selectedDevice = selectedDeviceId ? devices[selectedDeviceId] : null;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Controls bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Device selector */}
        <select
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
          className="bg-[#1A2330] text-[#E6EDF3] text-sm border border-[#2A3441] rounded-lg px-3 py-1.5 outline-none focus:border-[#3BA4FF] transition-colors duration-200"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          <option value="">Select device…</option>
          {deviceList.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {/* Time range selector */}
        <div className="flex items-center rounded-lg border border-[#2A3441] overflow-hidden">
          {TIME_RANGES.map((tr) => (
            <button
              key={tr.value}
              onClick={() => setTimeRange(tr.value)}
              className="px-3 py-1.5 text-xs font-medium transition-all duration-200"
              style={{
                fontFamily: "Inter, sans-serif",
                background: timeRange === tr.value ? "#3BA4FF" : "transparent",
                color: timeRange === tr.value ? "#0B0F14" : "#9AA6B2",
              }}
            >
              {tr.label}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          onClick={loadHistory}
          disabled={loading}
          className="p-1.5 rounded-lg border border-[#2A3441] text-[#9AA6B2] hover:text-[#E6EDF3] hover:border-[#3BA4FF] transition-all duration-200 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>

        {/* Device type badge */}
        {selectedDevice && (
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-[#2A3441]"
            style={{ color: "#6B7785", fontFamily: "Inter, sans-serif" }}
          >
            {selectedDevice.type}
          </span>
        )}
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0 relative">
        {!selectedDeviceId ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 rounded-xl" style={{ background: "#0B0F14" }}>
            <LineChart size={32} className="text-[#6B7785]" />
            <span className="text-sm text-[#6B7785]">Select a device to view history</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full rounded-xl" style={{ background: "#0B0F14" }}>
            <span className="text-sm text-[#EF4444]">{error}</span>
          </div>
        ) : (
          <StateHistoryChart data={history} height={240} />
        )}
      </div>
    </div>
  );
}