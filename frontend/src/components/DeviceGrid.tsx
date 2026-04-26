// frontend/src/components/DeviceGrid.tsx — Flat responsive grid of device cards

import { useDeviceStore } from "../store/device-store";
import { DeviceCard } from "./DeviceCard";
import { WelcomeScreen } from "./WelcomeScreen";

interface DeviceGridProps {
  onSelectDevice?: (deviceId: string) => void;
}

export function DeviceGrid({ onSelectDevice }: DeviceGridProps) {
  const devices = useDeviceStore((s) => s.devices);
  const deviceList = Object.values(devices);

  if (deviceList.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {deviceList.map((device) => (
        <DeviceCard
          key={device.id}
          device={device}
          onClick={() => onSelectDevice?.(device.id)}
        />
      ))}
    </div>
  );
}
