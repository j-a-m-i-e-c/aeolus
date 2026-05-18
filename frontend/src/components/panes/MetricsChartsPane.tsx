// frontend/src/components/panes/MetricsChartsPane.tsx — Dashboard pane displaying metrics history sparkline charts

import { useEffect } from "react";
import { BarChart3, Database } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { useMetricsHistoryStore } from "../../store/metrics-history-store";
import { useDataStoreStore } from "../../store/data-store-store";
import { TimeRangeSelector } from "../TimeRangeSelector";
import { MetricSparkline } from "../MetricSparkline";

interface Props {
  config: PaneConfig;
  paneId?: string;
}

/** Chart definitions mapping metric keys to display labels and units */
const CHART_DEFS = [
  { key: "mqttMessageRate", label: "MQTT Message Rate", unit: "msg/s" },
  { key: "memoryUsageMb", label: "Memory Usage", unit: "MB" },
  { key: "eventLoopLagMs", label: "Event Loop Lag", unit: "ms" },
  { key: "automationExecutionRate", label: "Automation Execution Rate", unit: "/s" },
  { key: "httpRequestRate", label: "HTTP Request Rate", unit: "req/s" },
] as const;

export function MetricsChartsPane({ config, paneId }: Props) {
  const { timeRange, chartData, loading, error, setTimeRange, startPolling, stopPolling } =
    useMetricsHistoryStore();

  const dataStoreEnabled = useDataStoreStore((s) => s.enabled);
  const fetchDataStoreConfig = useDataStoreStore((s) => s.fetchConfig);

  // Fetch DataStore config on mount to know if it's enabled
  useEffect(() => {
    fetchDataStoreConfig();
  }, [fetchDataStoreConfig]);

  // Auto-start/stop polling on mount/unmount
  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // DataStore disabled state
  if (!dataStoreEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
        <Database size={32} className="text-[#6B7785]" />
        <span
          className="text-sm text-[#9AA6B2] text-center"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Metrics history requires Data Store
        </span>
      </div>
    );
  }

  // Loading state (initial fetch only)
  if (loading && Object.keys(chartData).length === 0) {
    return (
      <div className="flex flex-col h-full gap-4 p-4">
        {/* Time range selector */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-[#9AA6B2]" />
            <span
              className="text-sm font-medium text-[#E6EDF3]"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Metrics History
            </span>
          </div>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>

        {/* Skeleton grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {CHART_DEFS.map((def) => (
            <div
              key={def.key}
              className="bg-[#121821] rounded-lg border border-[#1E2A3A] p-4 animate-pulse"
            >
              <div className="h-4 w-32 bg-[#1a2332] rounded mb-3" />
              <div className="h-[80px] bg-[#1a2332] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error && Object.keys(chartData).length === 0) {
    return (
      <div className="flex flex-col h-full gap-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-[#9AA6B2]" />
            <span
              className="text-sm font-medium text-[#E6EDF3]"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              Metrics History
            </span>
          </div>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>
        <div className="flex items-center justify-center flex-1">
          <div className="bg-[#121821] rounded-xl p-5 text-center">
            <p className="text-red-400 text-sm font-medium">Failed to load metrics history</p>
            <p className="text-[#9AA6B2] text-xs mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-[#9AA6B2]" />
          <span
            className="text-sm font-medium text-[#E6EDF3]"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            Metrics History
          </span>
        </div>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {/* Responsive chart grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CHART_DEFS.map((def) => {
          const data = chartData[def.key];
          return (
            <MetricSparkline
              key={def.key}
              label={def.label}
              data={data?.points ?? []}
              peakData={data?.peakPoints}
              spikes={data?.spikes}
              currentValue={data?.currentValue}
              unit={def.unit}
            />
          );
        })}
      </div>
    </div>
  );
}
