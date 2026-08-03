// scripts/seed/tabs/research-vessel.mjs — Oceanographic research vessel (simulated).
// Flagship: a CTD winch console. The visitor deploys/holds/retrieves a sensor
// package to a target depth; the engine owns the winch state (publishes the
// winch device over MQTT, records casts to the Data Store); the UI animates the
// cable payout and shows live temperature/salinity at depth.

const tab = { id: "tab-research-vessel", name: "Research Vessel", icon: "ship" };

const devices = [
  { topic: "sensor/vessel/winch", payload: { state: "stowed", depth: 0 } },
  { topic: "sensor/vessel/ctd", payload: { tempC: 18.4, salinityPsu: 35.1 } },
  { topic: "sensor/vessel/position", payload: { lat: -42.88, lon: 147.33 } },
];

const logic = `automation({
  actions: [
    function winch(context) {
      var evt = String(context.topic || "").split("/").pop();
      var publish = function (st) { mqtt.publish("sensor/vessel/winch", JSON.stringify({ state: st, depth: Number(state.get("depth")) || 0 })); };
      if (evt === "deploy") { state.set("mode", "deploying"); publish("deploying"); log.info("CTD deploying"); }
      else if (evt === "hold") { state.set("mode", "holding"); publish("holding"); log.info("CTD holding station"); }
      else if (evt === "retrieve") { state.set("mode", "retrieving"); publish("retrieving"); log.info("CTD retrieving"); }
      else if (evt === "set-target") {
        var d = Number(context.state && context.state.depth);
        if (!isNaN(d)) state.set("targetDepth", Math.max(0, Math.min(2000, Math.round(d))));
      } else if (evt === "log-cast") {
        var depth = Number(context.state && context.state.depth) || 0;
        var temp = Number(context.state && context.state.tempC) || 0;
        log.info("Cast logged at " + depth + " m");
        if (db) db.write("ctd-casts", { depth: depth, tempC: temp });
      }
    },
  ],
});`;

const ui = `import { useState, useEffect, useRef } from "react";
import type { CustomComponentProps } from "./types";

export default function CtdWinch(aeolus: CustomComponentProps) {
  const mode = (aeolus.read("mode") as string) ?? "stowed";
  const targetDepth = Number(aeolus.read("targetDepth") ?? 500);
  const [depth, setDepth] = useState<number>(() => Number(aeolus.read("depth") ?? 0));
  const logged = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setDepth((d) => {
        if (mode === "deploying") return Math.min(targetDepth, d + 12);
        if (mode === "retrieving") return Math.max(0, d - 14);
        return d;
      });
    }, 200);
    return () => clearInterval(id);
  }, [mode, targetDepth]);

  // At target while deploying → log a cast once and hold.
  useEffect(() => {
    if (mode === "deploying" && depth >= targetDepth && !logged.current) {
      logged.current = true;
      aeolus.save("depth", Math.round(depth));
      aeolus.fire("log-cast", { depth: Math.round(depth), tempC: Math.round(tempAt(depth) * 10) / 10 });
      aeolus.fire("hold");
    }
    if (mode !== "deploying") logged.current = false;
  }, [mode, depth, targetDepth]);

  const tempAt = (d: number) => 18.4 - Math.min(15, d / 90);
  const salAt = (d: number) => 35.1 + Math.min(1.4, d / 1400);
  const temp = tempAt(depth), sal = salAt(depth);
  const yOf = (d: number) => 14 + (d / 2000) * 150;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌊 CTD Winch — Cast Control</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: mode === "deploying" || mode === "retrieving" ? "#3BA4FF20" : "#6B778520", color: mode === "deploying" || mode === "retrieving" ? "#3BA4FF" : "#9AA6B2" }}>{mode}</span>
      </div>

      <div className="bg-[#070A0E] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="180" viewBox="0 0 360 178" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width="360" height="14" fill="#0B1220" />
          <rect x="0" y="14" width="360" height="150" fill="#071A2E" />
          <rect x="0" y={164} width="360" height="14" fill="#0A0F0A" />
          <line x1="180" y1="14" x2="180" y2={yOf(depth)} stroke="#5CE1E6" strokeWidth="1" strokeOpacity="0.6" />
          <g>
            <rect x="171" y={yOf(depth)} width="18" height="14" rx="2" fill="#1A2330" stroke="#5CE1E6" strokeWidth="1" />
            <circle cx="180" cy={yOf(depth) + 7} r="2.5" fill="#5CE1E6" className={mode === "deploying" || mode === "retrieving" ? "animate-pulse" : ""} />
          </g>
          <line x1="0" y1={yOf(targetDepth)} x2="360" y2={yOf(targetDepth)} stroke="#F59E0B" strokeWidth="0.75" strokeDasharray="4 3" strokeOpacity="0.7" />
          <text x="6" y={yOf(targetDepth) - 3} fill="#F59E0B" fontSize="7">target {targetDepth} m</text>
          <text x="340" y={yOf(depth) + 3} textAnchor="end" fill="#E6EDF3" fontSize="9" fontFamily="monospace">{Math.round(depth)} m</text>
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Depth" value={Math.round(depth) + " m"} color="#5CE1E6" />
        <Stat label="Temp" value={temp.toFixed(1) + "°C"} color="#3BA4FF" />
        <Stat label="Salinity" value={sal.toFixed(1) + " PSU"} color="#22C55E" />
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={() => aeolus.fire("deploy")} className="py-1.5 rounded-md text-[10px] font-medium bg-[#3BA4FF]/15 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/25">▼ Deploy</button>
        <button onClick={() => aeolus.fire("hold")} className="py-1.5 rounded-md text-[10px] font-medium bg-[#0B0F14] text-[#9AA6B2] border border-[#2A3441] hover:text-[#E6EDF3]">⏸ Hold</button>
        <button onClick={() => aeolus.fire("retrieve")} className="py-1.5 rounded-md text-[10px] font-medium bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 hover:bg-[#22C55E]/25">▲ Retrieve</button>
        <select value={targetDepth} onChange={(e) => aeolus.fire("set-target", { depth: Number(e.target.value) })} className="rounded-md text-[10px] bg-[#0B0F14] text-[#9AA6B2] border border-[#2A3441] px-1">
          {[200, 500, 1000, 2000].map((d) => <option key={d} value={d}>{d} m</option>)}
        </select>
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
      <span className="text-[12px] font-mono font-bold" style={{ color: props.color }}>{props.value}</span>
      <span className="text-[7px] text-[#6B7785]">{props.label}</span>
    </div>
  );
}`;

const automations = [
  {
    key: "winch",
    name: "CTD Winch",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      writableStateKeys: ["depth"],
      fireEvents: ["deploy", "hold", "retrieve", "set-target", "log-cast"],
    },
  },
];

const panes = [
  { kind: "automation", ref: "winch", x: 0, y: 0, w: 12, h: 15 },
  { kind: "device-grid", x: 0, y: 15, w: 12, h: 6 },
];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
