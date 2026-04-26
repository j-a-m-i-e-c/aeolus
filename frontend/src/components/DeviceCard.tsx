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

  // Pick the primary display value
  const primaryValue = device.state.value ?? device.state.brightness ?? device.state.on;
  const primaryLabel = device.state.value !== undefined ? "value"
    : device.state.brightness !== undefined ? "brightness"
    : device.state.on !== undefined ? "on" : null;

  return (
    <motion.div
      className="bg-surface border border-[#2A3441] rounded-xl p-3 flex flex-col gap-2 cursor-pointer"
      whileHover={{ y: -1, boxShadow: "0 4px 20px rgba(59, 164, 255, 0.08)" }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon
          size={16}
          className={isOn ? "text-primary" : "text-[#6B7785]"}
        />
        <span className="text-xs font-medium text-[#E6EDF3] truncate flex-1">{device.name}</span>
        <span className="text-[9px] uppercase tracking-wider text-[#6B7785] shrink-0">
          {device.type}
        </span>
      </div>

      {/* Primary value */}
      {primaryLabel && (
        <div className="text-lg font-mono font-semibold text-[#E6EDF3]">
          {String(primaryValue)}
          {primaryLabel === "brightness" && <span className="text-xs text-[#6B7785] ml-1">bri</span>}
        </div>
      )}

      {/* Toggle control */}
      {showToggle && (
        <button
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
          className={`self-start px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200 ${
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
