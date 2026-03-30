// frontend/src/components/DeviceGrid.tsx — Responsive grid of device cards

import { useDeviceStore } from "../store/device-store";
import { DeviceCard } from "./DeviceCard";

export function DeviceGrid() {
  const devices = useDeviceStore((s) => s.devices);
  const deviceList = Object.values(devices);

  if (deviceList.length === 0) {
    return (
      <div className="text-center py-12 text-[#6B7785]">
        <p className="text-lg">No devices found</p>
        <p className="text-sm mt-1">Connect devices via MQTT or configure an integration</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {deviceList.map((device) => (
        <DeviceCard key={device.id} device={device} />
      ))}
    </div>
  );
}
