// frontend/src/App.tsx — Main application component

import { useEffect } from "react";
import { Layout } from "./components/Layout";
import { DeviceGrid } from "./components/DeviceGrid";
import { SensorPanel } from "./components/SensorPanel";
import { SystemHealth } from "./components/SystemHealth";
import { MqttInspector } from "./components/MqttInspector";
import { connectWebSocket, disconnectWebSocket } from "./lib/ws-client";
import { fetchDevices } from "./lib/api-client";
import { useDeviceStore } from "./store/device-store";
import type { Device } from "./store/device-store";

export default function App() {
  const setDevices = useDeviceStore((s) => s.setDevices);

  useEffect(() => {
    // Fetch initial device list via REST
    fetchDevices()
      .then((data) => {
        const devices: Record<string, Device> = {};
        for (const d of data as unknown as Device[]) {
          devices[d.id] = d;
        }
        setDevices(devices);
      })
      .catch(() => {
        // Will be populated by WebSocket snapshot
      });

    // Connect WebSocket for real-time updates
    connectWebSocket();

    return () => {
      disconnectWebSocket();
    };
  }, [setDevices]);

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Dashboard</h1>
        <SystemHealth />
        <SensorPanel />
        <DeviceGrid />
        <MqttInspector />
      </div>
    </Layout>
  );
}
