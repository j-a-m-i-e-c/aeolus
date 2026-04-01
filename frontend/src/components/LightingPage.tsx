// frontend/src/components/LightingPage.tsx — Hue lighting management

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Lightbulb, Search, Link2, Unlink, RefreshCw, Sun, Palette } from "lucide-react";

const API_URL = (import.meta as any).env?.VITE_API_URL || "http://localhost:3001";

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

export function LightingPage() {
  const [status, setStatus] = useState<{ configured: boolean; bridgeIp: string | null }>({ configured: false, bridgeIp: null });
  const [lights, setLights] = useState<HueLight[]>([]);
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [pairing, setPairing] = useState(false);
  const [pairingIp, setPairingIp] = useState("");
  const [pairingMsg, setPairingMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/hue/status`);
      const data = await res.json();
      setStatus(data);
      if (data.configured) fetchLights();
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
          <button onClick={fetchLights} className="text-[#6B7785] hover:text-primary transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button onClick={unpair} className="text-[#6B7785] hover:text-[#EF4444] transition-colors" title="Disconnect bridge">
            <Unlink size={14} />
          </button>
        </div>
      </div>

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
              className="bg-surface border border-[#2A3441] rounded-xl p-4 space-y-3"
              whileHover={{ y: -2, boxShadow: "0 4px 20px rgba(59, 164, 255, 0.08)" }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb size={16} className={light.on ? "text-[#F59E0B]" : "text-[#6B7785]"} />
                  <span className="text-sm font-medium text-[#E6EDF3]">{light.name}</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${light.reachable ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-[#EF4444]"}`}>
                  {light.reachable ? "online" : "offline"}
                </span>
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

              {/* Brightness */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-[#6B7785] flex items-center gap-1"><Sun size={10} /> Brightness</span>
                  <span className="text-[10px] text-[#9AA6B2] font-mono">{Math.round((light.brightness / 254) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="254"
                  value={light.brightness}
                  onChange={(e) => setLightState(light.id, { bri: Number(e.target.value) })}
                  className="w-full accent-[#F59E0B] h-1"
                />
              </div>

              <div className="text-[10px] text-[#6B7785] font-mono">{light.type}</div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}