// frontend/src/components/LightingPage.tsx — Hue lighting management

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, Search, Link2, Unlink, RefreshCw, Sun, Palette, Info, Plus, Loader2, Trash2, GripVertical } from "lucide-react";

const API_URL = (import.meta as any).env?.VITE_API_URL || `http://${window.location.hostname}:3001`;

interface HueLight {
  id: string;
  name: string;
  on: boolean;
  brightness: number;
  hue?: number;
  saturation?: number;
  reachable: boolean;
  type: string;
}

interface Bridge {
  id: string;
  internalipaddress: string;
  port: number;
}

interface BridgeInfo {
  configured: boolean;
  name?: string;
  modelid?: string;
  bridgeid?: string;
  apiversion?: string;
  swversion?: string;
  mac?: string;
  zigbeechannel?: number;
  update?: {
    state: string;
    lastchange: string;
    autoinstall: boolean;
  } | null;
}

// Hue uses hue: 0-65535, sat: 0-254, bri: 1-254
// Convert to CSS hsl for preview
function hueToHsl(h: number, s: number, b: number): string {
  const hDeg = Math.round((h / 65535) * 360);
  const sPct = Math.round((s / 254) * 100);
  const lPct = Math.round((b / 254) * 50);
  return `hsl(${hDeg}, ${sPct}%, ${Math.max(lPct, 10)}%)`;
}

// Predefined colour swatches (hue value 0-65535)
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

function isColorLight(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("color") || t.includes("extended");
}

export function LightingPage() {
  const [status, setStatus] = useState<{ configured: boolean; bridgeIp: string | null }>({ configured: false, bridgeIp: null });
  const [lights, setLights] = useState<HueLight[]>([]);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [bridgeInfo, setBridgeInfo] = useState<BridgeInfo | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pairingIp, setPairingIp] = useState("");
  const [pairingMsg, setPairingMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ lights: { id: string; name: string }[]; lastscan: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null);
  const [localBri, setLocalBri] = useState<Record<string, number>>({});

  const fetchBridgeInfo = async () => {
    try {
      const res = await fetch(`${API_URL}/api/hue/bridge`);
      const data = await res.json();
      if (data.configured) setBridgeInfo(data);
    } catch {}
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/hue/status`);
      const data = await res.json();
      setStatus(data);
      if (data.configured) {
        fetchLights();
        fetchBridgeInfo();
      }
    } catch {}
    setLoading(false);
  }, []);

  const fetchLights = async () => {
    try {
      const res = await fetch(`${API_URL}/api/hue/lights`);
      const data = await res.json();
      if (data.lights) setLights(data.lights);
    } catch {}
  };

  const discoverBridges = async () => {
    try {
      const res = await fetch(`${API_URL}/api/hue/discover`);
      const data = await res.json();
      setBridges(data);
    } catch {}
  };

  const startPairing = async (ip: string) => {
    setPairingIp(ip);
    setPairing(true);
    setPairingMsg("Press the button on your Hue bridge, then click Pair...");
  };

  const attemptPair = async () => {
    setPairingMsg("Connecting...");
    try {
      const res = await fetch(`${API_URL}/api/hue/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bridgeIp: pairingIp }),
      });
      const data = await res.json();
      if (data.success) {
        setPairingMsg("Paired successfully!");
        setPairing(false);
        fetchStatus();
      } else if (data.errorType === 101) {
        setPairingMsg("Button not pressed yet — press the bridge button and try again");
      } else {
        setPairingMsg(data.error || "Pairing failed");
      }
    } catch (err) {
      setPairingMsg("Connection failed — check the bridge IP");
    }
  };

  const unpair = async () => {
    await fetch(`${API_URL}/api/hue/unpair`, { method: "DELETE" });
    setStatus({ configured: false, bridgeIp: null });
    setLights([]);
  };

  const setLightState = async (lightId: string, state: Record<string, unknown>) => {
    try {
      await fetch(`${API_URL}/api/hue/lights/${lightId}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      // Optimistic update
      setLights((prev) =>
        prev.map((l) => (l.id === lightId ? { ...l, ...state, on: state.on !== undefined ? Boolean(state.on) : l.on, brightness: state.bri !== undefined ? Number(state.bri) : l.brightness } : l))
      );
    } catch {}
  };

  const searchForLights = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      await fetch(`${API_URL}/api/hue/lights/search`, { method: "POST" });
      // Bridge scans for ~40s. Poll for new lights after a delay.
      setTimeout(async () => {
        try {
          const res = await fetch(`${API_URL}/api/hue/lights/new`);
          const data = await res.json();
          setScanResult(data);
          // Refresh the full lights list
          fetchLights();
        } catch {}
        setScanning(false);
      }, 45000);
    } catch {
      setScanning(false);
    }
  };

  const deleteLight = async (lightId: string, lightName: string) => {
    if (!confirm(`Remove "${lightName}" from the bridge? The bulb will need to be re-paired to use again.`)) return;
    try {
      await fetch(`${API_URL}/api/hue/lights/${lightId}`, { method: "DELETE" });
      setLights((prev) => prev.filter((l) => l.id !== lightId));
    } catch {}
  };

  const handleDragStart = (id: string) => setDragId(id);
  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    setLights((prev) => {
      const fromIdx = prev.findIndex((l) => l.id === dragId);
      const toIdx = prev.findIndex((l) => l.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };
  const handleDragEnd = () => setDragId(null);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (loading) {
    return <div className="text-center py-12 text-[#6B7785]">Loading...</div>;
  }

  // Not configured — show setup wizard
  if (!status.configured) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Lighting</h1>

        <div className="bg-surface border border-[#2A3441] rounded-xl p-6 max-w-lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-primary/20">
              <Lightbulb size={24} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#E6EDF3]">Connect Philips Hue</h2>
              <p className="text-xs text-[#6B7785]">Control your Hue lights from the dashboard</p>
            </div>
          </div>

          {!pairing ? (
            <div className="space-y-4">
              <button
                onClick={discoverBridges}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
              >
                <Search size={14} />
                Discover Bridges
              </button>

              {bridges.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-[#9AA6B2]">Found {bridges.length} bridge{bridges.length !== 1 ? "s" : ""}:</p>
                  {bridges.map((bridge) => (
                    <button
                      key={bridge.id}
                      onClick={() => startPairing(bridge.internalipaddress)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-elevated border border-[#2A3441] hover:border-primary/30 transition-colors"
                    >
                      <span className="text-sm text-[#E6EDF3] font-mono">{bridge.internalipaddress}</span>
                      <Link2 size={14} className="text-primary" />
                    </button>
                  ))}
                </div>
              )}

              <div className="text-center text-[10px] text-[#6B7785]">
                Or enter bridge IP manually:
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="192.168.1.x"
                  value={pairingIp}
                  onChange={(e) => setPairingIp(e.target.value)}
                  className="flex-1 text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] placeholder-[#6B7785] font-mono focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => startPairing(pairingIp)}
                  disabled={!pairingIp}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40"
                >
                  Connect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                  <Link2 size={24} className="text-primary" />
                </div>
                <p className="text-sm text-[#E6EDF3]">{pairingMsg}</p>
                <p className="text-xs text-[#6B7785] mt-1 font-mono">{pairingIp}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setPairing(false); setPairingMsg(""); }}
                  className="flex-1 py-2 text-xs font-medium rounded bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={attemptPair}
                  className="flex-1 py-2 text-xs font-medium rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
                >
                  Pair
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Configured — show lights
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Lighting</h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#6B7785] font-mono">{status.bridgeIp}</span>
          <button
            onClick={searchForLights}
            disabled={scanning}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50"
            title="Search for new Zigbee lights"
          >
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {scanning ? "Scanning..." : "Add Lights"}
          </button>
          <button onClick={fetchLights} className="text-[#6B7785] hover:text-primary transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button onClick={unpair} className="text-[#6B7785] hover:text-[#EF4444] transition-colors" title="Disconnect bridge">
            <Unlink size={14} />
          </button>
        </div>
      </div>

      {/* Bridge info card */}
      {bridgeInfo && (
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info size={14} className="text-primary" />
            <span className="text-sm font-semibold text-[#9AA6B2] uppercase tracking-wider">Bridge</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[10px] text-[#6B7785] uppercase">Name</div>
              <div className="text-[#E6EDF3] font-mono text-xs">{bridgeInfo.name || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#6B7785] uppercase">Model</div>
              <div className="text-[#E6EDF3] font-mono text-xs">{bridgeInfo.modelid || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#6B7785] uppercase">Firmware</div>
              <div className="text-[#E6EDF3] font-mono text-xs">{bridgeInfo.swversion || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#6B7785] uppercase">API Version</div>
              <div className="text-[#E6EDF3] font-mono text-xs">{bridgeInfo.apiversion || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#6B7785] uppercase">Zigbee Channel</div>
              <div className="text-[#E6EDF3] font-mono text-xs">{bridgeInfo.zigbeechannel ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#6B7785] uppercase">MAC</div>
              <div className="text-[#E6EDF3] font-mono text-xs">{bridgeInfo.mac || "—"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[10px] text-[#6B7785] uppercase">Firmware Update</div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono ${
                  bridgeInfo.update?.state === "noupdates" ? "text-[#22C55E]" :
                  bridgeInfo.update?.state === "transferring" ? "text-primary" :
                  bridgeInfo.update?.state === "installing" ? "text-primary" :
                  "text-[#F59E0B]"
                }`}>
                  {bridgeInfo.update?.state === "noupdates" ? "Up to date" :
                   bridgeInfo.update?.state === "transferring" ? "Downloading update..." :
                   bridgeInfo.update?.state === "installing" ? "Installing..." :
                   bridgeInfo.update?.state === "allreadytoinstall" ? "Update ready" :
                   bridgeInfo.update?.state === "anyreadytoinstall" ? "Update ready" :
                   bridgeInfo.update?.state || "Unknown"}
                </span>
                {bridgeInfo.update?.state && !["noupdates", "transferring", "installing"].includes(bridgeInfo.update.state) && (
                  <span className="text-[10px] text-[#6B7785]">Use the Hue app to install</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Scan status / results */}
      {scanning && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center gap-3">
          <Loader2 size={16} className="text-primary animate-spin" />
          <div>
            <div className="text-sm text-[#E6EDF3]">Scanning for new lights...</div>
            <div className="text-[10px] text-[#6B7785]">The bridge is searching for unpaired Zigbee devices. This takes about 40 seconds.</div>
          </div>
        </div>
      )}
      {scanResult && !scanning && (
        <div className="bg-surface border border-[#2A3441] rounded-xl p-4">
          <div className="text-sm text-[#E6EDF3] mb-1">
            {scanResult.lights.length > 0
              ? `Found ${scanResult.lights.length} new light${scanResult.lights.length !== 1 ? "s" : ""}:`
              : "No new lights found"}
          </div>
          {scanResult.lights.length > 0 && (
            <div className="space-y-1">
              {scanResult.lights.map((l) => (
                <div key={l.id} className="text-xs text-[#9AA6B2] font-mono">
                  #{l.id} — {l.name}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setScanResult(null)}
            className="mt-2 text-[10px] text-[#6B7785] hover:text-[#9AA6B2] transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {lights.length === 0 ? (
        <div className="text-center py-12 text-[#6B7785]">
          <p className="text-lg">No lights found</p>
          <p className="text-sm mt-1">Make sure your Hue lights are powered on</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {lights.map((light) => (
            <motion.div
              key={light.id}
              draggable
              onDragStart={() => handleDragStart(light.id)}
              onDragOver={(e) => handleDragOver(e as unknown as React.DragEvent, light.id)}
              onDragEnd={handleDragEnd}
              className={`bg-surface border rounded-xl p-4 space-y-3 cursor-grab active:cursor-grabbing ${
                dragId === light.id ? "border-primary/50 opacity-50" : "border-[#2A3441]"
              }`}
              whileHover={{ y: -2, boxShadow: "0 4px 20px rgba(59, 164, 255, 0.08)" }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GripVertical size={12} className="text-[#6B7785]/50 flex-shrink-0" />
                  <Lightbulb size={16} className={light.on ? "text-[#F59E0B]" : "text-[#6B7785]"} />
                  <span className="text-sm font-medium text-[#E6EDF3]">{light.name}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${light.reachable ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-[#EF4444]"}`}>
                    {light.reachable ? "online" : "offline"}
                  </span>
                  <button
                    onClick={() => deleteLight(light.id, light.name)}
                    className="p-1 text-[#6B7785]/40 hover:text-[#EF4444] transition-colors"
                    title="Remove light"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Toggle */}
              <button
                onClick={() => setLightState(light.id, { on: !light.on })}
                className={`w-full py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                  light.on
                    ? "bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/30"
                    : "bg-elevated text-[#6B7785] border border-[#2A3441] hover:text-[#9AA6B2]"
                }`}
              >
                {light.on ? "Turn Off" : "Turn On"}
              </button>

              {/* Brightness — local tracking, send on release */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-[#6B7785] flex items-center gap-1"><Sun size={10} /> Brightness</span>
                  <span className="text-[10px] text-[#9AA6B2] font-mono">{Math.round(((localBri[light.id] ?? light.brightness) / 254) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="254"
                  value={localBri[light.id] ?? light.brightness}
                  onChange={(e) => setLocalBri((prev) => ({ ...prev, [light.id]: Number(e.target.value) }))}
                  onMouseUp={(e) => {
                    const val = Number((e.target as HTMLInputElement).value);
                    setLightState(light.id, { bri: val });
                    setLocalBri((prev) => { const n = { ...prev }; delete n[light.id]; return n; });
                  }}
                  onTouchEnd={(e) => {
                    const val = Number((e.target as HTMLInputElement).value);
                    setLightState(light.id, { bri: val });
                    setLocalBri((prev) => { const n = { ...prev }; delete n[light.id]; return n; });
                  }}
                  className="w-full accent-[#F59E0B] h-1"
                />
              </div>

              {/* Colour picker for color-capable lights */}
              {isColorLight(light.type) && (
                <div className="relative">
                  <button
                    onClick={() => setColorPickerOpen(colorPickerOpen === light.id ? null : light.id)}
                    className="flex items-center gap-1.5 text-[10px] text-[#6B7785] hover:text-[#9AA6B2] transition-colors"
                  >
                    <div
                      className="w-3 h-3 rounded-full border border-[#2A3441]"
                      style={{ backgroundColor: hueToHsl(light.hue ?? 0, light.saturation ?? 0, light.brightness) }}
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
                                setLightState(light.id, { hue: swatch.hue, sat: swatch.sat });
                                setLights((prev) => prev.map((l) => l.id === light.id ? { ...l, hue: swatch.hue, saturation: swatch.sat } : l));
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

              <div className="text-[10px] text-[#6B7785] font-mono">{light.type}</div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}