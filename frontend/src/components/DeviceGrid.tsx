// frontend/src/components/DeviceGrid.tsx — Responsive grid of device cards

import { useDeviceStore } from "../store/device-store";
import { DeviceCard } from "./DeviceCard";
import { WelcomeScreen } from "./WelcomeScreen";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface DeviceGridProps {
  onSelectDevice?: (deviceId: string) => void;
}

function groupByRoom(devices: Record<string, { id: string; name: string; type: string }>) {
  const rooms = new Map<string, string[]>();
  for (const device of Object.values(devices)) {
    // Extract room from device ID: "sensor-kitchen-temp" → "kitchen"
    const parts = device.id.split("-");
    const room = parts.length >= 2 ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : "Other";
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room)!.push(device.id);
  }
  return rooms;
}

export function DeviceGrid({ onSelectDevice }: DeviceGridProps) {
  const devices = useDeviceStore((s) => s.devices);
  const deviceList = Object.values(devices);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (deviceList.length === 0) {
    return <WelcomeScreen />;
  }

  const rooms = groupByRoom(devices);

  const toggleRoom = (room: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(room)) next.delete(room);
      else next.add(room);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {Array.from(rooms.entries()).map(([room, deviceIds]) => (
        <div key={room}>
          <button
            onClick={() => toggleRoom(room)}
            className="flex items-center gap-2 mb-3 text-xs font-semibold text-[#9AA6B2] uppercase tracking-wider hover:text-[#E6EDF3] transition-colors"
          >
            {collapsed.has(room) ? <ChevronRight size={12} className="text-[#6B7785]" /> : <ChevronDown size={12} className="text-[#6B7785]" />}
            {room}
            <span className="text-[10px] text-[#6B7785] font-normal">({deviceIds.length})</span>
          </button>
          {!collapsed.has(room) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {deviceIds.map((id) => {
                const device = devices[id];
                return device ? (
                  <DeviceCard key={id} device={device} onClick={() => onSelectDevice?.(id)} />
                ) : null;
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
