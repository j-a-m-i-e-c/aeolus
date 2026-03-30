// frontend/src/components/SensorPanel.tsx — Live sensor data display

import { useDeviceStore } from "../store/device-store";

export function SensorPanel() {
  const devices = useDeviceStore((s) => s.devices);
  const sensors = Object.values(devices).filter((d) => d.type === "sensor");

  if (sensors.length === 0) return null;

  return (
    <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
      <h2 className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider mb-3">
        Live Sensors
      </h2>
      <div className="space-y-2">
        {sensors.map((sensor) => (
          <div key={sensor.id} className="flex items-center justify-between py-1.5 border-b border-[#2A3441] last:border-0">
            <span className="text-sm text-[#E6EDF3]">{sensor.name}</span>
            <div className="flex items-center gap-3">
              {Object.entries(sensor.state).map(([key, value]) => (
                <span key={key} className="font-mono text-sm text-accent">
                  {String(value)}
                </span>
              ))}
              <span className="text-[10px] text-[#6B7785]">
                {new Date(sensor.lastSeen).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
