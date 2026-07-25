// frontend/src/App.tsx — Main application component with client-side routing and auth guard

import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DeviceDetail } from "./components/DeviceDetail";
import { ToastContainer } from "./components/ToastContainer";
import { CommandPalette } from "./components/CommandPalette";
import { ConnectorsPage } from "./components/ConnectorsPage";
import { DataStorePage } from "./pages/DataStorePage";
import SecurityPage from "./pages/SecurityPage";
import { SystemPage } from "./components/SystemPage";
import { TabLayout } from "./components/TabLayout";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { AnimatePresence } from "framer-motion";
import { connectWebSocket, disconnectWebSocket } from "./lib/ws-client";
import { fetchDevices } from "./lib/api-client";
import { useDeviceStore } from "./store/device-store";
import { useDashboardStore, tabNameToSlug } from "./store/dashboard-store";
import { useAuthStore } from "./store/auth-store";
import { usePermissionsStore } from "./store/permissions-store";
import type { Device } from "./store/device-store";

// ---------------------------------------------------------------------------
// Dashboard page (pinned)
// ---------------------------------------------------------------------------

function DashboardPage() {
  const devices = useDeviceStore((s) => s.devices);
  const user = useAuthStore((s) => s.user);
  const hasDevices = Object.keys(devices).length > 0;

  // WelcomeScreen is an admin onboarding prompt — non-admins should see SystemPage
  if (!hasDevices && user?.role === "admin") {
    return <WelcomeScreen />;
  }

  return <SystemPage />;
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
// Authenticated App — shown when user is logged in
// ---------------------------------------------------------------------------

function AuthenticatedApp() {
  const setDevices = useDeviceStore((s) => s.setDevices);
  const initialized = useDashboardStore((s) => s.initialized);
  const initialize = useDashboardStore((s) => s.initialize);
  const fetchPermissions = usePermissionsStore((s) => s.fetchPermissions);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  useEffect(() => { initialize(); }, [initialize]);
  useEffect(() => { fetchPermissions(); }, [fetchPermissions]);

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
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/connectors" element={<ConnectorsPage />} />
        <Route path="/data-store" element={<DataStorePage />} />
        <Route path="/users" element={<Navigate to="/security" replace />} />
        <Route path="/mqtt-security" element={<Navigate to="/security" replace />} />
        <Route path="/security" element={<SecurityPage />} />
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

// ---------------------------------------------------------------------------
// App — auth routing guard
// ---------------------------------------------------------------------------

export default function App() {
  const loading = useAuthStore((s) => s.loading);
  const needsSetup = useAuthStore((s) => s.needsSetup);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const checkSetupNeeded = useAuthStore((s) => s.checkSetupNeeded);

  useEffect(() => {
    checkSetupNeeded();
  }, [checkSetupNeeded]);

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0F14]">
        <div className="text-[#6B7785] text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  // First-run setup — no admin exists
  if (needsSetup) {
    return <SetupPage />;
  }

  // Not authenticated — show login
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Authenticated — show the full dashboard
  return <AuthenticatedApp />;
}
