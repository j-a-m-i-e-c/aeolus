// scripts/seed/tabs/spacecraft.mjs — Crewed spacecraft life support (simulated).
// Flagship: the ECLSS (life support) console. The visitor runs the CO₂ scrubber
// and sets the O₂ setpoint (engine owns scrubber state, publishes it over MQTT,
// records events); the UI shows cabin atmosphere responding.

const tab = { id: "tab-spacecraft", name: "Spacecraft", icon: "orbit" };

const devices = [
  { topic: "switch/craft/scrubber", payload: { on: false } },
  { topic: "sensor/craft/atmo", payload: { o2: 20.9, co2: 0.4, pressureKpa: 101 } },
  { topic: "sensor/craft/power", payload: { busVolts: 28.1, arrayWatts: 1400 } },
];

const logic = `automation({
  actions: [
    function eclss(context) {
      var evt = String(context.topic || "").split("/").pop();
      if (evt === "scrubber-on") {
        state.set("scrubberOn", true);
        mqtt.publish("switch/craft/scrubber", JSON.stringify({ on: true }));
        log.info("CO2 scrubber online");
        if (db) db.write("eclss-events", { event: "scrubber-on" });
      } else if (evt === "scrubber-off") {
        state.set("scrubberOn", false);
        mqtt.publish("switch/craft/scrubber", JSON.stringify({ on: false }));
        log.info("CO2 scrubber offline");
        if (db) db.write("eclss-events", { event: "scrubber-off" });
      } else if (evt === "set-o2") {
        var p = Number(context.state && context.state.pct);
        if (!isNaN(p)) state.set("o2Setpoint", Math.max(19, Math.min(23, Math.round(p * 10) / 10)));
      }
    },
  ],
});`;

const ui = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

export default function Eclss(aeolus: CustomComponentProps) {
  const scrubberOn = Boolean(aeolus.read("scrubberOn"));
  const o2Setpoint = Number(aeolus.read("o2Setpoint") ?? 20.9);

  const [co2, setCo2] = useState(0.4);
  const [o2, setO2] = useState(20.9);
  useEffect(() => {
    const id = setInterval(() => {
      setCo2((v) => Math.max(0.2, Math.min(3.0, v + (scrubberOn ? -0.05 : 0.04))));
      setO2((v) => v + (o2Setpoint - v) * 0.08);
    }, 500);
    return () => clearInterval(id);
  }, [scrubberOn, o2Setpoint]);

  const co2Danger = co2 > 1.0;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🛰️ ECLSS — Life Support</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: scrubberOn ? "#22C55E20" : "#F59E0B20", color: scrubberOn ? "#22C55E" : "#F59E0B" }}>{scrubberOn ? "● Scrubber active" : "Scrubber idle"}</span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex items-center justify-around">
        <Ring label="O₂" value={o2.toFixed(1)} unit="%" pct={(o2 - 18) / 6} color="#3BA4FF" />
        <Ring label="CO₂" value={co2.toFixed(2)} unit="%" pct={co2 / 3} color={co2Danger ? "#EF4444" : "#22C55E"} />
        <Ring label="Cabin" value="101" unit="kPa" pct={0.72} color="#5CE1E6" />
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={() => aeolus.fire(scrubberOn ? "scrubber-off" : "scrubber-on")} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: scrubberOn ? "#EF444415" : "#22C55E15", color: scrubberOn ? "#EF4444" : "#22C55E", borderColor: scrubberOn ? "#EF44444D" : "#22C55E4D" }}>{scrubberOn ? "■ Scrubber Off" : "▶ Scrubber On"}</button>
        {[20.4, 20.9, 21.5].map((p) => (
          <button key={p} onClick={() => aeolus.fire("set-o2", { pct: p })} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: o2Setpoint === p ? "#3BA4FF20" : "#0B0F14", color: o2Setpoint === p ? "#3BA4FF" : "#9AA6B2", borderColor: o2Setpoint === p ? "#3BA4FF4D" : "#2A3441" }}>O₂ {p}%</button>
        ))}
      </div>
      {co2Danger && <div className="text-[9px] text-[#EF4444] text-center font-semibold">⚠ CO₂ elevated — enable the scrubber</div>}
    </div>
  );
}

function Ring(props: { label: string; value: string; unit: string; pct: number; color: string }) {
  const p = Math.max(0, Math.min(1, props.pct));
  const C = 2 * Math.PI * 26;
  return (
    <div className="flex flex-col items-center">
      <svg width="76" height="76" viewBox="0 0 76 76">
        <circle cx="38" cy="38" r="26" fill="none" stroke="#1A2330" strokeWidth="6" />
        <circle cx="38" cy="38" r="26" fill="none" stroke={props.color} strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 38 38)" className="transition-all duration-500" />
        <text x="38" y="36" textAnchor="middle" fill="#E6EDF3" fontSize="12" fontFamily="monospace" fontWeight="bold">{props.value}</text>
        <text x="38" y="48" textAnchor="middle" fill="#6B7785" fontSize="7">{props.unit}</text>
      </svg>
      <span className="text-[8px] text-[#9AA6B2]">{props.label}</span>
    </div>
  );
}`;

const automations = [
  {
    key: "eclss",
    name: "Life Support (ECLSS)",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: { fireEvents: ["scrubber-on", "scrubber-off", "set-o2"] },
  },
];

const panes = [
  { kind: "automation", ref: "eclss", x: 0, y: 0, w: 12, h: 14 },
  { kind: "device-grid", x: 0, y: 14, w: 12, h: 6 },
];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
