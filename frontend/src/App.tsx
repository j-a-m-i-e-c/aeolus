// frontend/src/App.tsx — Main application component

import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { DeviceGrid } from "./components/DeviceGrid";
import { SensorPanel } from "./components/SensorPanel";
import { SystemHealth } from "./components/SystemHealth";
import { MqttInspector } from "./components/MqttInspector";
import { AutomationsPanel } from "./components/AutomationsPanel";
import { DeviceDetail } from "./components/DeviceDetail";
import { EventLog } from "./components/EventLog";
import { TopicTree } from "./components/TopicTree";
import { ToastContainer } from "./components/ToastContainer";
import { CommandPalette } from "./components/CommandPalette";
import { AutomationsPage } from "./components/AutomationsPage";
import { ConnectorsPage } from "./components/ConnectorsPage";
import { SystemPage } from "./components/SystemPage";
import { TabLayout } from "./components/TabLayout";
import { AnimatePresence } from "framer-motion";
import { connectWebSocket, disconnectWebSocket } from "./lib/ws-client";
import { fetchDevices } from "./lib/api-client";
import { useDeviceStore } from "./store/device-store";
import { useDashboardStore } from "./store/dashboard-store";
import type { Device } from "./store/device-store";

/** Map of pinned tab IDs to their dedicated page components */
const PINNED_PAGES: Record<string, string> = {
  "default-dashboard": "dashboard",
  "default-automations": "automations",
  "default-connectors": "connectors",
  "default-system": "system",
};

export default function App() {
  const setDevices = useDeviceStore((s) => s.setDevices);
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const tabs = useDashboardStore((s) => s.tabs);
  const initialized = useDashboardStore((s) => s.initialized);
  const initialize = useDashboardStore((s) => s.initialize);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    fetchDevices()
      .then((data) => {
        const devices: Record<string, Device> = {};
        for (const d of data as unknown as Device[]) {
          devices[d.id] = d;
        }
        setDevices(devices);
      })
      .catch(() => {});

    connectWebSocket();
    return () => { disconnectWebSocket(); };
  }, [setDevices]);

  if (!initialized) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full min-h-[60vh]">
          <div className="text-[#6B7785] text-sm animate-pulse">Loading dashboard…</div>
        </div>
      </Layout>
    );
  }

  // Determine if the active tab is a pinned system tab
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const pinnedPage = activeTabId ? PINNED_PAGES[activeTabId] : null;

  const renderContent = () => {
    // Pinned system tabs render their dedicated, styled components directly
    if (pinnedPage === "dashboard") {
      return (
        <div className="space-y-6">
          <h1 className="text-2xl font-bold text-[#E6EDF3]">Dashboard</h1>
          <SystemHealth />
          <AutomationsPanel />
          <SensorPanel />
          <DeviceGrid onSelectDevice={setSelectedDeviceId} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MqttInspector />
            <TopicTree />
          </div>
          <EventLog />
        </div>
      );
    }
    if (pinnedPage === "automations") return <AutomationsPage />;
    if (pinnedPage === "connectors") return <ConnectorsPage />;
    if (pinnedPage === "system") return <SystemPage />;

    // Custom (unpinned) tabs render via the modular pane grid
    if (activeTabId) return <TabLayout tabId={activeTabId} />;

    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-[#6B7785] text-sm">No tab selected</div>
      </div>
    );
  };

  return (
    <Layout>
      {renderContent()}

      <AnimatePresence>
        {selectedDeviceId && (
          <DeviceDetail
            deviceId={selectedDeviceId}
            onClose={() => setSelectedDeviceId(null)}
          />
        )}
      </AnimatePresence>

      <ToastContainer />
      <CommandPalette onSelectDevice={setSelectedDeviceId} />
    </Layout>
  );
}
