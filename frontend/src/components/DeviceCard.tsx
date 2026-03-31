// frontend/src/components/DeviceCard.tsx — Individual device card

import { motion } from "framer-motion";
import { Lightbulb, Thermometer, ToggleLeft, Wind } from "lucide-react";
import { sendAction } from "../lib/api-client";
import type { Device } from "../store/device-store";

const TYPE_ICONS = {
  light: Lightbulb,
  sensor: Thermometer,
  switch: ToggleLeft,
  climate: Wind,
};

interface DeviceCardProps {
  device: Device;
  onClick?: () => void;
}

export function DeviceCard({ device, onClick }: DeviceCardProps) {
  const Icon = TYPE_ICONS[device.type] || ToggleLeft;
  const isOn = device.state.on === true;
  const showToggle = device.type === "light" || device.type === "switch";

  const handleToggle = async () => {
    try {
      await sendAction(device.id, "toggle");
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  return (
    <motion.div
      className="bg-surface border border-[#2A3441] rounded-xl p-4 flex flex-col gap-3 cursor-pointer"
      whileHover={{ y: -2, boxShadow: "0 4px 20px rgba(59, 164, 255, 0.08)" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon
            size={18}
            className={isOn ? "text-primary" : "text-[#6B7785]"}
          />
          <span className="text-sm font-medium text-[#E6EDF3]">{device.name}</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-[#6B7785]">
          {device.type}
        </span>
      </div>

      {/* State values */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(device.state).map(([key, value]) => (
          <div key={key} className="text-xs">
            <span className="text-[#6B7785]">{key}: </span>
            <span className="font-mono text-[#9AA6B2]">{String(value)}</span>
          </div>
        ))}
      </div>

      {/* Toggle control */}
      {showToggle && (
        <button
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
          className={`mt-auto self-start px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
            isOn
              ? "bg-primary/20 text-primary border border-primary/30"
              : "bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2]"
          }`}
        >
          {isOn ? "Turn Off" : "Turn On"}
        </button>
      )}
    </motion.div>
  );
}
