// frontend/src/App.tsx — Main application component with client-side routing

import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DeviceGrid } from "./components/DeviceGrid";
import { DeviceDetail } from "./components/DeviceDetail";
import { ToastContainer } from "./components/ToastContainer";
import { CommandPalette } from "./components/CommandPalette";
import { ConnectorsPage } from "./components/ConnectorsPage";
import { SystemPage } from "./components/SystemPage";
import { TabLayout } from "./components/TabLayout";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { AnimatePresence } from "framer-motion";
import { connectWebSocket, disconnectWebSocket } from "./lib/ws-client";
import { fetchDevices } from "./lib/api-client";
import { useDeviceStore } from "./store/device-store";
import { useDashboardStore, tabNameToSlug } from "./store/dashboard-store";
import type { Device } from "./store/device-store";

// ---------------------------------------------------------------------------
// Dashboard page (pinned)
// ---------------------------------------------------------------------------

function DashboardPage({ onSelectDevice }: { onSelectDevice: (id: string) => void }) {
  const devices = useDeviceStore((s) => s.devices);
  const hasDevices = Object.keys(devices).length > 0;

  if (!hasDevices) {
    return <WelcomeScreen />;
  }

  return (
    <div className="space-y-6">
      <SystemPage />
      <DeviceGrid onSelectDevice={onSelectDevice} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom tab page — resolves slug from URL to tab ID
// ---------------------------------------------------------------------------

function CustomTabPage() {
  const { slug } = useParams<{ slug: string }>();
  const tabs = useDashboardStore((s) => s.tabs);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);

  const tab = tabs.find((t) => !t.pinned && tabNameToSlug(t.name) === slug);

  useEffect(() => {
    if (tab) setActiveTab(tab.id);
  }, [tab, setActiveTab]);

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="text-[#6B7785] text-sm">Tab not found</div>
      </div>
    );
  }

  return <TabLayout tabId={tab.id} />;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const setDevices = useDeviceStore((s) => s.setDevices);
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

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage onSelectDevice={setSelectedDeviceId} />} />
        <Route path="/connectors" element={<ConnectorsPage />} />
        <Route path="/system" element={<Navigate to="/dashboard" replace />} />
        <Route path="/tab/:slug" element={<CustomTabPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

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
