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
import { AnimatePresence } from "framer-motion";
import { connectWebSocket, disconnectWebSocket } from "./lib/ws-client";
import { fetchDevices } from "./lib/api-client";
import { useDeviceStore } from "./store/device-store";
import type { Device } from "./store/device-store";

export default function App() {
  const setDevices = useDeviceStore((s) => s.setDevices);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

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

  return (
    <Layout>
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