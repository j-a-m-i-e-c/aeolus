// scripts/seed/tabs/off-grid-bunker.mjs — Off-grid power management (simulated).
// Flagship: a microgrid console. The visitor runs the backup generator and sheds
// load (engine owns the generator over MQTT, records events); the UI shows battery
// state-of-charge responding to solar, generator and load.

const tab = { id: "tab-off-grid-bunker", name: "Off-Grid Bunker", icon: "battery-charging" };

const devices = [
  { topic: "switch/bunker/generator", payload: { on: false } },
  { topic: "sensor/bunker/battery", payload: { soc: 72 } },
  { topic: "sensor/bunker/solar", payload: { watts: 1180 } },
];

const logic = `automation({
  actions: [
    function microgrid(context) {
      var evt = String(context.topic || "").split("/").pop();
      if (evt === "gen-on") {
        state.set("genOn", true);
        mqtt.publish("switch/bunker/generator", JSON.stringify({ on: true }));
        log.info("Backup generator started");
        if (db) db.write("power-events", { event: "gen-on" });
      } else if (evt === "gen-off") {
        state.set("genOn", false);
        mqtt.publish("switch/bunker/generator", JSON.stringify({ on: false }));
        log.info("Backup generator stopped");
        if (db) db.write("power-events", { event: "gen-off" });
      } else if (evt === "shed-load") {
        var lvl = String((context.state && context.state.level) || "normal");
        state.set("loadShed", lvl);
        log.info("Load profile: " + lvl);
      }
    },
  ],
});`;

const ui = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

const LOADS = { normal: 1400, essential: 700, critical: 300 };

export default function Microgrid(aeolus: CustomComponentProps) {
  const genOn = Boolean(aeolus.read("genOn"));
  const shed = (aeolus.read("loadShed") as keyof typeof LOADS) ?? "normal";
  const load = LOADS[shed] ?? 1400;

  const [soc, setSoc] = useState(72);
  const [solar, setSolar] = useState(1180);
  useEffect(() => {
    const id = setInterval(() => {
      setSolar((w) => Math.max(200, Math.min(1800, w + (Math.random() - 0.5) * 180)));
      setSoc((s) => {
        const genW = genOn ? 2200 : 0;
        const net = solar + genW - load; // watts
        return Math.max(0, Math.min(100, s + net / 6000));
      });
    }, 700);
    return () => clearInterval(id);
  }, [genOn, load, solar]);

  const socColor = soc < 20 ? "#EF4444" : soc < 45 ? "#F59E0B" : "#22C55E";
  const C = 2 * Math.PI * 40;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🔋 Microgrid — Power Management</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: genOn ? "#F59E0B20" : "#22C55E20", color: genOn ? "#F59E0B" : "#22C55E" }}>{genOn ? "● Generator running" : "Solar + battery"}</span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex items-center justify-around">
        <svg width="108" height="108" viewBox="0 0 108 108">
          <circle cx="54" cy="54" r="40" fill="none" stroke="#1A2330" strokeWidth="9" />
          <circle cx="54" cy="54" r="40" fill="none" stroke={socColor} strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - soc / 100)} transform="rotate(-90 54 54)" className="transition-all duration-500" />
          <text x="54" y="52" textAnchor="middle" fill="#E6EDF3" fontSize="18" fontFamily="monospace" fontWeight="bold">{Math.round(soc)}%</text>
          <text x="54" y="66" textAnchor="middle" fill="#6B7785" fontSize="7">battery</text>
        </svg>
        <div className="space-y-1.5">
          <Flow label="Solar" value={Math.round(solar) + " W"} color="#F59E0B" />
          <Flow label="Generator" value={genOn ? "2200 W" : "0 W"} color={genOn ? "#F59E0B" : "#6B7785"} />
          <Flow label="Load" value={load + " W"} color="#3BA4FF" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => aeolus.fire(genOn ? "gen-off" : "gen-on")} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: genOn ? "#EF444415" : "#F59E0B15", color: genOn ? "#EF4444" : "#F59E0B", borderColor: genOn ? "#EF44444D" : "#F59E0B4D" }}>{genOn ? "■ Stop Generator" : "▶ Start Generator"}</button>
        <div className="grid grid-cols-3 gap-1">
          {(["normal", "essential", "critical"] as const).map((l) => (
            <button key={l} onClick={() => aeolus.fire("shed-load", { level: l })} className="py-1.5 rounded-md text-[9px] font-medium border transition-all capitalize" style={{ background: shed === l ? "#3BA4FF20" : "#0B0F14", color: shed === l ? "#3BA4FF" : "#9AA6B2", borderColor: shed === l ? "#3BA4FF4D" : "#2A3441" }}>{l}</button>
          ))}
        </div>
      </div>
      {soc < 20 && !genOn && <div className="text-[9px] text-[#EF4444] text-center font-semibold">⚠ Battery low — start the generator or shed load</div>}
    </div>
  );
}

function Flow(props: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full" style={{ background: props.color }} />
      <span className="text-[9px] text-[#9AA6B2] w-16">{props.label}</span>
      <span className="text-[10px] font-mono font-bold" style={{ color: props.color }}>{props.value}</span>
    </div>
  );
}`;

const automations = [
  {
    key: "microgrid",
    name: "Microgrid",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: { fireEvents: ["gen-on", "gen-off", "shed-load"] },
  },
];

const panes = [
  { kind: "automation", ref: "microgrid", x: 0, y: 0, w: 12, h: 14 },
  { kind: "device-grid", x: 0, y: 14, w: 12, h: 6 },
];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
