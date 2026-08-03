// scripts/seed/tabs/underground-mining.mjs — Underground mine ventilation (simulated).
// Flagship: a primary ventilation console. The visitor runs the main fan and sets
// airflow (engine owns fan state, publishes the fan device over MQTT, records
// events); the UI shows gas concentrations clearing as air moves through the drive.

const tab = { id: "tab-underground-mining", name: "Underground Mining", icon: "pickaxe" };

const devices = [
  { topic: "switch/mine/vent-fan", payload: { on: false, rpm: 0 } },
  { topic: "sensor/mine/gas", payload: { ch4: 0.9, co: 14 } },
  { topic: "sensor/mine/airflow", payload: { value: 0 } },
];

const logic = `automation({
  actions: [
    function ventilation(context) {
      var evt = String(context.topic || "").split("/").pop();
      var rpm = function () { return state.get("fanOn") ? Math.round((Number(state.get("airflow")) || 60) * 42) : 0; };
      if (evt === "fan-on") {
        state.set("fanOn", true);
        if (state.get("airflow") == null) state.set("airflow", 60);
        mqtt.publish("switch/mine/vent-fan", JSON.stringify({ on: true, rpm: rpm() }));
        log.info("Primary fan started");
        if (db) db.write("vent-events", { event: "fan-on" });
      } else if (evt === "fan-off") {
        state.set("fanOn", false);
        mqtt.publish("switch/mine/vent-fan", JSON.stringify({ on: false, rpm: 0 }));
        log.info("Primary fan stopped");
        if (db) db.write("vent-events", { event: "fan-off" });
      } else if (evt === "set-airflow") {
        var p = Number(context.state && context.state.pct);
        if (!isNaN(p)) {
          state.set("airflow", Math.max(20, Math.min(100, Math.round(p))));
          if (state.get("fanOn")) mqtt.publish("switch/mine/vent-fan", JSON.stringify({ on: true, rpm: rpm() }));
        }
      }
    },
  ],
});`;

const ui = `import { useState, useEffect } from "react";
import type { CustomComponentProps } from "./types";

export default function Ventilation(aeolus: CustomComponentProps) {
  const fanOn = Boolean(aeolus.read("fanOn"));
  const airflow = Number(aeolus.read("airflow") ?? 60);

  // Gas clears when the fan runs, accumulates when it stops (local visual sim).
  const [ch4, setCh4] = useState(0.9);
  const [co, setCo] = useState(14);
  useEffect(() => {
    const id = setInterval(() => {
      const rate = fanOn ? airflow / 100 : -0.25;
      setCh4((v) => Math.max(0.1, Math.min(2.5, v - rate * 0.06)));
      setCo((v) => Math.max(2, Math.min(40, v - rate * 0.8)));
    }, 400);
    return () => clearInterval(id);
  }, [fanOn, airflow]);

  const ch4Danger = ch4 > 1.25, coDanger = co > 25;
  const rpm = fanOn ? Math.round(airflow * 42) : 0;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">⛏️ Primary Ventilation</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: fanOn ? "#22C55E20" : "#EF444420", color: fanOn ? "#22C55E" : "#EF4444" }}>{fanOn ? "● Fan running · " + rpm + " rpm" : "Fan stopped"}</span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="96" viewBox="0 0 360 88" preserveAspectRatio="xMidYMid meet">
          <rect x="10" y="30" width="340" height="30" rx="3" fill="#0A0F0A" stroke="#2A3441" strokeWidth="1" />
          <circle cx="40" cy="45" r="16" fill={fanOn ? "#22C55E20" : "#1A2330"} stroke={fanOn ? "#22C55E" : "#2A3441"} strokeWidth="1.5" />
          <g className={fanOn ? "animate-spin" : ""} style={{ transformOrigin: "40px 45px" }}>
            {[0, 60, 120, 180, 240, 300].map((a) => <line key={a} x1="40" y1="45" x2={40 + 13 * Math.cos((a * Math.PI) / 180)} y2={45 + 13 * Math.sin((a * Math.PI) / 180)} stroke={fanOn ? "#22C55E" : "#6B7785"} strokeWidth="2" strokeLinecap="round" />)}
          </g>
          {fanOn && [0, 1, 2, 3, 4, 5].map((d) => <circle key={d} cx={70 + d * 46} cy="45" r="2" fill="#3BA4FF" className="animate-pulse" style={{ animationDelay: (d * 0.15) + "s" }} />)}
          <text x="330" y="49" textAnchor="end" fill="#9AA6B2" fontSize="8">→ to workings</text>
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Gauge label="CH₄" value={ch4.toFixed(2) + "%"} danger={ch4Danger} />
        <Gauge label="CO" value={Math.round(co) + " ppm"} danger={coDanger} />
        <Gauge label="Airflow" value={airflow + "%"} danger={false} />
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={() => aeolus.fire(fanOn ? "fan-off" : "fan-on")} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: fanOn ? "#EF444415" : "#22C55E15", color: fanOn ? "#EF4444" : "#22C55E", borderColor: fanOn ? "#EF44444D" : "#22C55E4D" }}>{fanOn ? "■ Stop Fan" : "▶ Start Fan"}</button>
        {[40, 70, 100].map((p) => (
          <button key={p} onClick={() => aeolus.fire("set-airflow", { pct: p })} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: airflow === p ? "#3BA4FF20" : "#0B0F14", color: airflow === p ? "#3BA4FF" : "#9AA6B2", borderColor: airflow === p ? "#3BA4FF4D" : "#2A3441" }}>{p}%</button>
        ))}
      </div>
      {(ch4Danger || coDanger) && <div className="text-[9px] text-[#EF4444] text-center font-semibold">⚠ Gas above threshold — increase ventilation</div>}
    </div>
  );
}

function Gauge(props: { label: string; value: string; danger: boolean }) {
  return (
    <div className="bg-[#0B0F14] rounded-lg border p-2 flex flex-col items-center" style={{ borderColor: props.danger ? "#EF44444D" : "#2A3441" }}>
      <span className="text-[13px] font-mono font-bold" style={{ color: props.danger ? "#EF4444" : "#22C55E" }}>{props.value}</span>
      <span className="text-[7px] text-[#6B7785]">{props.label}</span>
    </div>
  );
}`;

const automations = [
  {
    key: "vent",
    name: "Mine Ventilation",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: { fireEvents: ["fan-on", "fan-off", "set-airflow"] },
  },
];

const panes = [
  { kind: "automation", ref: "vent", x: 0, y: 0, w: 12, h: 14 },
  { kind: "device-grid", x: 0, y: 14, w: 12, h: 6 },
];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
