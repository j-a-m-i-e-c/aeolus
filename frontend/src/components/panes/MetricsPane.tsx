// frontend/src/components/panes/MetricsPane.tsx — Dashboard pane displaying key system metrics

import { useEffect } from "react";
import type { PaneConfig } from "../../types/dashboard";
import { useMetricsStore } from "../../store/metrics-store";

interface Props {
  config: PaneConfig;
  paneId?: string;
}

/** Format uptime seconds into a human-readable string (e.g., "2d 5h 30m") */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

interface MetricCardProps {
  label: string;
  value: string;
}

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="bg-[#121821] rounded-xl p-5 flex flex-col gap-1">
      <span className="text-[#9AA6B2] text-sm font-medium">{label}</span>
      <span className="text-[#3BA4FF] text-2xl font-semibold">{value}</span>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[#121821] rounded-xl p-5 flex flex-col gap-2 animate-pulse">
      <div className="h-4 w-24 bg-[#1a2332] rounded" />
      <div className="h-7 w-16 bg-[#1a2332] rounded" />
    </div>
  );
}

export function MetricsPane({ config: _config, paneId: _paneId }: Props) {
  const { summary, loading, error, startPolling, stopPolling } = useMetricsStore();

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // Loading state: show skeleton cards on initial fetch
  if (loading && summary === null) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
        {Array.from({ length: 9 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    );
  }

  // Error state
  if (error && summary === null) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="bg-[#121821] rounded-xl p-5 text-center">
          <p className="text-red-400 text-sm font-medium">Failed to load metrics</p>
          <p className="text-[#9AA6B2] text-xs mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
      <MetricCard
        label="MQTT Messages/sec"
        value={summary.mqtt.messagesReceivedRate.toFixed(1)}
      />
      <MetricCard
        label="MQTT Published/sec"
        value={summary.mqtt.messagesPublishedRate.toFixed(1)}
      />
      <MetricCard
        label="MQTT Connected"
        value={summary.mqtt.connected ? "Yes" : "No"}
      />
      <MetricCard
        label="Devices"
        value={String(summary.devices.registeredCount)}
      />
      <MetricCard
        label="Automations/sec"
        value={summary.automations.executionRate.toFixed(2)}
      />
      <MetricCard
        label="Active Rules"
        value={String(summary.automations.activeRules)}
      />
      <MetricCard
        label="WebSocket Clients"
        value={String(summary.websocket.activeConnections)}
      />
      <MetricCard
        label="Uptime"
        value={formatUptime(summary.system.uptimeSeconds)}
      />
      <MetricCard
        label="Memory"
        value={`${summary.system.memoryUsageMb.toFixed(1)} MB`}
      />
    </div>
  );
}
