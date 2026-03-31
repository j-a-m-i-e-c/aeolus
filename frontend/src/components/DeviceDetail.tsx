// frontend/src/components/DeviceDetail.tsx — Expanded device detail view

import { motion } from "framer-motion";
import { X, Lightbulb, Thermometer, ToggleLeft, Wind, Clock } from "lucide-react";
import { sendAction } from "../lib/api-client";
import type { Device } from "../store/device-store";
import { useDeviceStore } from "../store/device-store";

const TYPE_ICONS = {
  light: Lightbulb,
  sensor: Thermometer,
  switch: ToggleLeft,
  climate: Wind,
};

interface DeviceDetailProps {
  deviceId: string;
  onClose: () => void;
}

export function DeviceDetail({ deviceId, onClose }: DeviceDetailProps) {
  const device = useDeviceStore((s) => s.devices[deviceId]);

  if (!device) return null;

  const Icon = TYPE_ICONS[device.type] || ToggleLeft;
  const isOn = device.state.on === true;
  const showToggle = device.type === "light" || device.type === "switch";
  const showBrightness = device.type === "light" && device.capabilities.includes("brightness");

  const handleToggle = async () => {
    try {
      await sendAction(device.id, "toggle");
    } catch (err) {
      console.error("Toggle failed:", err);
    }
  };

  const handleBrightness = async (value: number) => {
    try {
      await sendAction(device.id, "brightness", { brightness: value });
    } catch (err) {
      console.error("Brightness failed:", err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-surface border border-[#2A3441] rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isOn ? "bg-primary/20" : "bg-elevated"}`}>
              <Icon size={24} className={isOn ? "text-primary" : "text-[#6B7785]"} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#E6EDF3]">{device.name}</h2>
              <span className="text-xs text-[#6B7785] uppercase tracking-wider">{device.type} · {device.integration}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6B7785] hover:text-[#E6EDF3] transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* State */}
        <div className="bg-background rounded-xl p-4 mb-4">
          <h3 className="text-xs font-semibold text-[#6B7785] uppercase tracking-wider mb-3">Current State</h3>
          <div className="space-y-2">
            {Object.entries(device.state).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-[#9AA6B2]">{key}</span>
                <span className="text-sm font-mono text-accent">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Capabilities */}
        <div className="bg-background rounded-xl p-4 mb-4">
          <h3 className="text-xs font-semibold text-[#6B7785] uppercase tracking-wider mb-3">Capabilities</h3>
          <div className="flex flex-wrap gap-2">
            {device.capabilities.map((cap) => (
              <span key={cap} className="text-xs bg-elevated px-2 py-1 rounded text-[#9AA6B2] border border-[#2A3441]">
                {cap}
              </span>
            ))}
          </div>
        </div>

        {/* Controls */}
        {(showToggle || showBrightness) && (
          <div className="bg-background rounded-xl p-4 mb-4">
            <h3 className="text-xs font-semibold text-[#6B7785] uppercase tracking-wider mb-3">Controls</h3>
            <div className="space-y-3">
              {showToggle && (
                <button
                  onClick={handleToggle}
                  className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isOn
                      ? "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
                      : "bg-elevated text-[#9AA6B2] border border-[#2A3441] hover:text-[#E6EDF3]"
                  }`}
                >
                  {isOn ? "Turn Off" : "Turn On"}
                </button>
              )}
              {showBrightness && (
                <div>
                  <label className="text-xs text-[#6B7785] mb-1 block">Brightness</label>
                  <input
                    type="range"
                    min="0"
                    max="254"
                    value={Number(device.state.brightness ?? 127)}
                    onChange={(e) => handleBrightness(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-2 text-xs text-[#6B7785]">
          <Clock size={12} />
          Last seen: {new Date(device.lastSeen).toLocaleString()}
        </div>
      </motion.div>
    </motion.div>
  );
}
