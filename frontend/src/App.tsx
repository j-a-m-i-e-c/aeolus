// frontend/src/App.tsx — Main application component

import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { DeviceDetail } from "./components/DeviceDetail";
import { ToastContainer } from "./components/ToastContainer";
import { CommandPalette } from "./components/CommandPalette";
import { TabLayout } from "./components/TabLayout";
import { AnimatePresence } from "framer-motion";
import { connectWebSocket, disconnectWebSocket } from "./lib/ws-client";
import { fetchDevices } from "./lib/api-client";
import { useDeviceStore } from "./store/device-store";
import { useDashboardStore } from "./store/dashboard-store";
import type { Device } from "./store/device-store";

export default function App() {
  const setDevices = useDeviceStore((s) => s.setDevices);
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const initialized = useDashboardStore((s) => s.initialized);
  const initialize = useDashboardStore((s) => s.initialize);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Initialize Dashboard_Store on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Fetch devices and connect WebSocket
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

  // Show loading state while Dashboard_Store is initializing
  if (!initialized) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full min-h-[60vh]">
          <div className="text-[#6B7785] text-sm animate-pulse">Loading dashboard…</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {activeTabId ? (
        <TabLayout tabId={activeTabId} />
      ) : (
        <div className="flex items-center justify-center h-full min-h-[60vh]">
          <div className="text-[#6B7785] text-sm">No tab selected</div>
        </div>
      )}

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
