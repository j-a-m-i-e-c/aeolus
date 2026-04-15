// frontend/src/components/panes/HueControlPane.tsx — Hue light control pane

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, Sun, Palette } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { useDeviceStore } from "../../store/device-store";
import { sendAction } from "../../lib/api-client";

const COLOR_SWATCHES = [
  { label: "Red", hue: 0, sat: 254 },
  { label: "Orange", hue: 5000, sat: 254 },
  { label: "Yellow", hue: 10000, sat: 254 },
  { label: "Green", hue: 21845, sat: 254 },
  { label: "Cyan", hue: 32768, sat: 254 },
  { label: "Blue", hue: 43690, sat: 254 },
  { label: "Purple", hue: 49000, sat: 254 },
  { label: "Pink", hue: 56000, sat: 200 },
  { label: "Warm White", hue: 8000, sat: 120 },
  { label: "Cool White", hue: 34000, sat: 50 },
];

function hueToHsl(h: number, s: number, b: number): string {
  const hDeg = Math.round((h / 65535) * 360);
  const sPct = Math.round((s / 254) * 100);
  const lPct = Math.round((b / 254) * 50);
  return `hsl(${hDeg}, ${sPct}%, ${Math.max(lPct, 10)}%)`;
}

export function isColorLight(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("color") || t.includes("extended");
}

interface Props {
  config: PaneConfig;
}

export function HueControlPane({ config }: Props) {
  const devices = useDeviceStore((s) => s.devices);
  const updateDevice = useDeviceStore((s) => s.updateDevice);
  const [localBri, setLocalBri] = useState<Record<string, number>>({});
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);

  const hueLights = Object.values(devices).filter(
    (d) => d.integration === "hue" && d.type === "light",
  );

  const handleToggle = async (deviceId: string, currentOn: boolean) => {
    updateDevice(deviceId, { on: !currentOn });
    try {
      await sendAction(deviceId, "toggle");
    } catch {
      updateDevice(deviceId, { on: currentOn });
    }
  };

  const handleBrightness = async (deviceId: string, brightness: number) => {
    try {
      await sendAction(deviceId, "brightness", { brightness });
    } catch {}
  };

  const handleColor = async (deviceId: string, hue: number, saturation: number) => {
    updateDevice(deviceId, { hue, saturation });
    try {
      await sendAction(deviceId, "color", { hue, saturation });
    } catch {}
  };

  if (hueLights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[#6B7785]">
        <Lightbulb size={32} className="mb-3 opacity-40" />
        <p className="text-sm">No Hue lights found.</p>
        <p className="text-xs mt-1">Enable the Hue connector on the Connectors page.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {hueLights.map((light) => {
        const isOn = Boolean(light.state.on);
        const brightness = Number(light.state.brightness ?? 254);
        const reachable = light.state.reachable !== false && light.state.online !== false;
        const hueVal = Number(light.state.hue ?? 0);
        const satVal = Number(light.state.saturation ?? 0);

        return (
          <div
            key={light.id}
            className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lightbulb size={16} className={isOn ? "text-[#F59E0B]" : "text-[#6B7785]"} />
                <span className="text-sm font-medium text-[#E6EDF3]">{light.name}</span>
              </div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  reachable
                    ? "bg-[#22C55E]/20 text-[#22C55E]"
                    : "bg-[#EF4444]/20 text-[#EF4444]"
                }`}
              >
                {reachable ? "online" : "offline"}
              </span>
            </div>

            {/* Toggle */}
            <button
              onClick={() => handleToggle(light.id, isOn)}
              className={`w-full py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                isOn
                  ? "bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30"
                  : "bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2]"
              }`}
            >
              {isOn ? "Turn Off" : "Turn On"}
            </button>

            {/* Brightness */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#6B7785] flex items-center gap-1">
                  <Sun size={10} /> Brightness
                </span>
                <span className="text-[10px] text-[#9AA6B2] font-mono">
                  {Math.round(((localBri[light.id] ?? brightness) / 254) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="254"
                value={localBri[light.id] ?? brightness}
                onChange={(e) =>
                  setLocalBri((prev) => ({ ...prev, [light.id]: Number(e.target.value) }))
                }
                onMouseUp={(e) => {
                  const val = Number((e.target as HTMLInputElement).value);
                  handleBrightness(light.id, val);
                  setLocalBri((prev) => {
                    const n = { ...prev };
                    delete n[light.id];
                    return n;
                  });
                }}
                onTouchEnd={(e) => {
                  const val = Number((e.target as HTMLInputElement).value);
                  handleBrightness(light.id, val);
                  setLocalBri((prev) => {
                    const n = { ...prev };
                    delete n[light.id];
                    return n;
                  });
                }}
                className="w-full accent-[#F59E0B] h-1"
              />
            </div>

            {/* Colour picker for color-capable lights */}
            {isColorLight(light.type) && (
              <div className="relative">
                <button
                  onClick={() =>
                    setColorPickerOpen(colorPickerOpen === light.id ? null : light.id)
                  }
                  className="flex items-center gap-1.5 text-[10px] text-[#6B7785] hover:text-[#9AA6B2] transition-colors"
                >
                  <div
                    className="w-3 h-3 rounded-full border border-[#2A3441]"
                    style={{ backgroundColor: hueToHsl(hueVal, satVal, brightness) }}
                  />
                  <Palette size={10} />
                  Colour
                </button>
                <AnimatePresence>
                  {colorPickerOpen === light.id && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute z-10 mt-1 left-0 bg-elevated border border-[#2A3441] rounded-lg p-2 shadow-lg"
                    >
                      <div className="grid grid-cols-5 gap-1.5">
                        {COLOR_SWATCHES.map((swatch) => (
                          <button
                            key={swatch.label}
                            onClick={() => {
                              handleColor(light.id, swatch.hue, swatch.sat);
                              setColorPickerOpen(null);
                            }}
                            className="w-7 h-7 rounded-full border border-[#2A3441] hover:scale-110 transition-transform"
                            style={{ backgroundColor: hueToHsl(swatch.hue, swatch.sat, 200) }}
                            title={swatch.label}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
