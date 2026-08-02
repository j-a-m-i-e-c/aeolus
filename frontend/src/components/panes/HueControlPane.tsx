// frontend/src/components/panes/HueControlPane.tsx — Hue light control pane (capability-driven)

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, Sun, Palette, Pencil, Trash2, Check, X } from "lucide-react";
import type { PaneConfig } from "../../types/dashboard";
import { useDeviceStore } from "../../store/device-store";
import { useAuthStore } from "../../store/auth-store";
import { sendAction, fetchEnabledConnectors } from "../../lib/api-client";
import { ColorTempSlider } from "./hue/ColorTempSlider";
import { SearchLightsButton } from "./hue/SearchLightsButton";
import { FirmwareUpdateBanner } from "./hue/FirmwareUpdateBanner";

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
  const lPct = Math.round((b / 100) * 50); // b is canonical brightness 0–100
  return `hsl(${hDeg}, ${sPct}%, ${Math.max(lPct, 10)}%)`;
}

function getTypeBadge(capabilities: string[]): { label: string; color: string } {
  if (capabilities.includes("color")) {
    return { label: "Color", color: "bg-[#8B5CF6]/20 text-[#8B5CF6]" };
  }
  if (capabilities.includes("color-temperature")) {
    return { label: "Tunable", color: "bg-[#F59E0B]/20 text-[#F59E0B]" };
  }
  if (capabilities.includes("brightness")) {
    return { label: "Dimmable", color: "bg-[#3B82F6]/20 text-[#3B82F6]" };
  }
  return { label: "On/Off", color: "bg-[#6B7785]/20 text-[#6B7785]" };
}

interface Props {
  config: PaneConfig;
}

export function HueControlPane({ config: _config }: Props) {
  const devices = useDeviceStore((s) => s.devices);
  const updateDevice = useDeviceStore((s) => s.updateDevice);
  // Rename/delete manage the light on the bridge and are admin-only, matching
  // the backend gate. Non-admins see operate-level controls only.
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const [localBri, setLocalBri] = useState<Record<string, number>>({});
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<{ updatesAvailable?: boolean; updateType?: string } | null>(null);

  useEffect(() => {
    fetchEnabledConnectors().then((connectors) => {
      const hueConnector = connectors.find(
        (c: Record<string, unknown>) => c.connectorType === "hue",
      ) as { id: string; health?: { updatesAvailable?: boolean; updateType?: string } } | undefined;
      if (hueConnector) {
        setConnectorId(hueConnector.id);
        if (hueConnector.health) {
          setHealthStatus(hueConnector.health);
        }
      }
    }).catch(() => {});
  }, []);

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
    // Brightness is the canonical 0–100 percentage end-to-end; the connector
    // translates to the Hue-native 0–254 scale at the API boundary (H6).
    const pct = Math.round(Math.min(100, Math.max(0, brightness)));
    try {
      await sendAction(deviceId, "brightness", { brightness: pct });
    } catch {}
  };

  const handleColor = async (deviceId: string, hue: number, saturation: number) => {
    updateDevice(deviceId, { hue, saturation });
    try {
      await sendAction(deviceId, "color", { hue, saturation });
    } catch {}
  };

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const removeDevice = useDeviceStore((s) => s.removeDevice);

  const handleRename = async (deviceId: string) => {
    if (!renameValue.trim()) return;
    try {
      await sendAction(deviceId, "rename", { name: renameValue.trim() });
      // Update the device name locally in the store immediately
      const store = useDeviceStore.getState();
      const device = store.devices[deviceId];
      if (device) {
        store.setDevices({
          ...store.devices,
          [deviceId]: { ...device, name: renameValue.trim() },
        });
      }
    } catch {}
    setRenamingId(null);
    setRenameValue("");
  };

  const handleDelete = async (deviceId: string) => {
    try {
      await sendAction(deviceId, "delete", {});
      // Remove from frontend store immediately
      removeDevice(deviceId);
    } catch {}
    setDeletingId(null);
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
    <div className="space-y-4">
      <FirmwareUpdateBanner
        updatesAvailable={healthStatus?.updatesAvailable ?? false}
        updateType={healthStatus?.updateType as "bridge" | "lights" | "both" | undefined}
      />

      {isAdmin && connectorId && (
        <div className="flex justify-end">
          <SearchLightsButton connectorId={connectorId} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {hueLights.map((light) => {
          const isOn = Boolean(light.state.on);
          const brightness = Number(light.state.brightness ?? 100);
          const reachable = light.state.reachable !== false && light.state.online !== false;
          const hueVal = Number(light.state.hue ?? 0);
          const satVal = Number(light.state.saturation ?? 0);
          const capabilities = (light.capabilities ?? []) as string[];
          const badge = getTypeBadge(capabilities);
          const modelId = (light.state.modelId as string) ?? "";
          const manufacturer = (light.state.manufacturer as string) ?? "";

          return (
            <div
              key={light.id}
              className={`bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3 transition-opacity ${
                !reachable ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Lightbulb size={16} className={isOn ? "text-[#F59E0B]" : "text-[#6B7785]"} />
                  <div className="min-w-0">
                    {renamingId === light.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRename(light.id); if (e.key === "Escape") setRenamingId(null); }}
                          autoFocus
                          className="text-sm bg-[#0D1117] border border-[#30363D] rounded px-1.5 py-0.5 text-[#E6EDF3] w-28 focus:outline-none focus:border-primary"
                        />
                        <button onClick={() => handleRename(light.id)} className="text-[#22C55E] hover:text-[#22C55E]/80"><Check size={12} /></button>
                        <button onClick={() => setRenamingId(null)} className="text-[#6B7785] hover:text-[#9AA6B2]"><X size={12} /></button>
                      </div>
                    ) : (
                      <span className="text-sm font-medium text-[#E6EDF3] block truncate">{light.name}</span>
                    )}
                    {(modelId || manufacturer) && renamingId !== light.id && (
                      <span className="text-[10px] text-[#6B7785] block truncate">
                        {manufacturer}{manufacturer && modelId ? " · " : ""}{modelId}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isAdmin && renamingId !== light.id && (
                    <>
                      <button
                        onClick={() => { setRenamingId(light.id); setRenameValue(light.name); }}
                        className="text-[#6B7785] hover:text-[#9AA6B2] p-0.5"
                        title="Rename"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => setDeletingId(light.id)}
                        className="text-[#6B7785] hover:text-[#EF4444] p-0.5"
                        title="Remove from bridge"
                      >
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.color}`}>
                    {badge.label}
                  </span>
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
              </div>

              {/* Delete confirmation */}
              {deletingId === light.id && (
                <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 rounded-lg p-2.5 space-y-2">
                  <p className="text-[11px] text-[#E6EDF3]">Remove <strong>{light.name}</strong> from the bridge?</p>
                  <p className="text-[10px] text-[#6B7785]">The light will need to be re-paired via Zigbee search.</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDelete(light.id)} className="text-[10px] px-2 py-1 rounded bg-[#EF4444] text-white hover:bg-[#EF4444]/90">Remove</button>
                    <button onClick={() => setDeletingId(null)} className="text-[10px] px-2 py-1 rounded border border-[#30363D] text-[#9AA6B2] hover:text-[#E6EDF3]">Cancel</button>
                  </div>
                </div>
              )}

              {/* Toggle — always shown */}
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

              {/* Brightness — if capability present */}
              {capabilities.includes("brightness") && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[#6B7785] flex items-center gap-1">
                      <Sun size={10} /> Brightness
                    </span>
                    <span className="text-[10px] text-[#9AA6B2] font-mono">
                      {Math.round(localBri[light.id] ?? brightness)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
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
              )}

              {/* Color Temperature — if capability present */}
              {capabilities.includes("color-temperature") && (
                <ColorTempSlider
                  deviceId={light.id}
                  currentCt={Number(light.state.ct ?? 300)}
                  ctMin={Number(light.state.ctMin ?? 153)}
                  ctMax={Number(light.state.ctMax ?? 500)}
                  disabled={!reachable}
                />
              )}

              {/* Color picker — if capability present */}
              {capabilities.includes("color") && (
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
    </div>
  );
}
