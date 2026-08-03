// scripts/seed/tabs/agriculture.mjs — Connected farm demo (flagship agritech tab).
//
// DEMO-NATIVE MODEL (public-demo-mode):
//   visitor → bounded fire() event → trusted seeded Logic → engine effect (state,
//   log, Data Store) → WebSocket → UI re-render.
//
// The irrigation console's *decisions* (pump on/off, target) run through the
// automation engine via aeolus.fire() — each is a real rule execution that logs,
// records to the Data Store, and broadcasts state. The UI interpolates tank
// levels locally for a live feel and persists them with bounded aeolus.save()
// writes. Every interactive key/event is declared in `demoAccess` so the public
// demo guard allows exactly these and nothing else.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-agriculture", name: "Agriculture", icon: "sprout" };

const devices = [
  { topic: "sensor/farm/dam", payload: { value: 82 } },
  { topic: "sensor/farm/header-tank", payload: { value: 65 } },
  { topic: "sensor/farm/shed-tank", payload: { value: 78 } },
  { topic: "switch/farm/dam-pump", payload: { on: false } },
  { topic: "sensor/fence/energiser", payload: { voltage: 7.2, current: 0.4, fault: false } },
];

// ─── Seeded Logic — the engine owns every irrigation decision ────────────────
// Reacts to the UI's bounded fire() events (topic = ui/{ruleId}/{eventName}).
// Written in sandbox-safe ES (no imports; `automation`, `state`, `log`, `db` are
// globals). `db` is present because the seed enables the Data Store first.
const irrigationLogic = `automation({
  actions: [
    function irrigation(context) {
      var evt = String(context.topic || "").split("/").pop();
      if (evt === "start-pump") {
        state.set("pumpOn", true);
        state.set("status", "Pumping to header tank");
        log.info("Irrigation: dam pump started");
        // Real MQTT round-trip: publish the device's new state to the internal
        // broker so the device registry ingests it and the device-grid pane
        // reflects the pump turning on (visitor → event → Logic → MQTT → device).
        mqtt.publish("switch/farm/dam-pump", JSON.stringify({ on: true }));
        if (db) db.write("irrigation-events", { event: "pump-start", target: Number(state.get("headerTarget")) || 80 }, { tags: { pump: "dam" } });
      } else if (evt === "stop-pump") {
        state.set("pumpOn", false);
        state.set("status", "Idle");
        log.info("Irrigation: dam pump stopped");
        mqtt.publish("switch/farm/dam-pump", JSON.stringify({ on: false }));
        if (db) db.write("irrigation-events", { event: "pump-stop" }, { tags: { pump: "dam" } });
      } else if (evt === "set-target") {
        var t = Number(context.state && context.state.target);
        if (!isNaN(t)) {
          var clamped = Math.max(20, Math.min(100, Math.round(t)));
          state.set("headerTarget", clamped);
          log.info("Irrigation: header target set to " + clamped + "%");
        }
      }
    },
  ],
});`;

// ─── Custom UI — reads engine state, drives decisions through fire() ─────────
const irrigationUi = `import { useState, useEffect, useRef } from "react";
import type { CustomComponentProps } from "./types";

export default function Irrigation(aeolus: CustomComponentProps) {
  // Engine-owned truth. These update reactively via the automation-state WebSocket
  // whenever the seeded Logic runs, so the console reflects real engine decisions.
  const pumpOn = Boolean(aeolus.read("pumpOn"));
  const status = (aeolus.read("status") as string) ?? "Idle";
  const target = Number(aeolus.read("headerTarget") ?? 80);

  // Smooth local level animation, seeded from persisted state.
  const [dam, setDam] = useState<number>(() => Number(aeolus.read("damPct") ?? 82));
  const [header, setHeader] = useState<number>(() => Number(aeolus.read("headerPct") ?? 65));
  const stopping = useRef(false);

  // Interpolate while the engine reports the pump is on.
  useEffect(() => {
    if (!pumpOn) { stopping.current = false; return; }
    const id = setInterval(() => {
      setHeader((h) => Math.min(target, h + 1.2));
      setDam((d) => Math.max(0, d - 0.35));
    }, 220);
    return () => clearInterval(id);
  }, [pumpOn, target]);

  // On reaching target, ask the engine to stop (once) and persist final levels
  // with bounded saves (both keys are declared in demoAccess.writableStateKeys).
  useEffect(() => {
    if (pumpOn && header >= target && !stopping.current) {
      stopping.current = true;
      aeolus.save("damPct", Math.round(dam));
      aeolus.save("headerPct", Math.round(header));
      aeolus.fire("stop-pump");
    }
  }, [pumpOn, header, target, dam]);

  const toggle = () => {
    if (pumpOn) {
      aeolus.save("damPct", Math.round(dam));
      aeolus.save("headerPct", Math.round(header));
      aeolus.fire("stop-pump");
    } else {
      aeolus.fire("start-pump");
    }
  };
  const setTarget = (t: number) => aeolus.fire("set-target", { target: t });

  const damL = Math.round((dam / 100) * 60000);
  const headerL = Math.round((header / 100) * 5000);
  const fh = (pct: number) => (pct / 100) * 72;
  const damFill = dam < 20 ? "#F59E0B" : "#3BA4FF";
  const headerFill = header < 15 ? "#F59E0B" : "#22C55E";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💧 Irrigation — Dam → Header Tank</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: pumpOn ? "#3BA4FF20" : "#6B778520", color: pumpOn ? "#3BA4FF" : "#9AA6B2" }}>
          {pumpOn ? "● " + status : status}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2.5">
        <svg width="100%" height="112" viewBox="0 0 360 96" preserveAspectRatio="xMidYMid meet">
          <rect x="18" y="12" width="86" height="72" rx="5" fill="#121821" stroke={damFill} strokeWidth="1" strokeOpacity="0.4" />
          <rect x="18" y={84 - fh(dam)} width="86" height={fh(dam)} rx="2" fill={damFill} fillOpacity="0.35" className="transition-all duration-300" />
          <text x="61" y="44" textAnchor="middle" fill="#E6EDF3" fontSize="12" fontFamily="monospace" fontWeight="bold">{Math.round(dam)}%</text>
          <text x="61" y="57" textAnchor="middle" fill="#6B7785" fontSize="6.5" fontFamily="monospace">{damL.toLocaleString()} L</text>
          <text x="61" y="78" textAnchor="middle" fill="#9AA6B2" fontSize="7">DAM</text>

          <line x1="104" y1="48" x2="150" y2="48" stroke={pumpOn ? "#3BA4FF" : "#2A3441"} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="210" y1="48" x2="256" y2="48" stroke={pumpOn ? "#22C55E" : "#2A3441"} strokeWidth="2.5" strokeLinecap="round" />
          {pumpOn && [0, 1, 2].map((d) => <circle key={"a" + d} cx={112 + d * 13} cy="48" r="1.8" fill="#3BA4FF" className="animate-pulse" style={{ animationDelay: (d * 0.2) + "s" }} />)}
          {pumpOn && [0, 1, 2].map((d) => <circle key={"b" + d} cx={218 + d * 13} cy="48" r="1.8" fill="#22C55E" className="animate-pulse" style={{ animationDelay: (d * 0.2) + "s" }} />)}
          <circle cx="180" cy="48" r="15" fill={pumpOn ? "#3BA4FF20" : "#1A2330"} stroke={pumpOn ? "#3BA4FF" : "#2A3441"} strokeWidth="1.5" />
          <g className={pumpOn ? "animate-spin" : ""} style={{ transformOrigin: "180px 48px" }}>
            <line x1="173" y1="48" x2="187" y2="48" stroke={pumpOn ? "#3BA4FF" : "#6B7785"} strokeWidth="2" />
            <line x1="180" y1="41" x2="180" y2="55" stroke={pumpOn ? "#3BA4FF" : "#6B7785"} strokeWidth="2" />
          </g>

          <rect x="256" y="12" width="86" height="72" rx="5" fill="#121821" stroke={headerFill} strokeWidth="1" strokeOpacity="0.4" />
          <rect x="256" y={84 - fh(header)} width="86" height={fh(header)} rx="2" fill={headerFill} fillOpacity="0.35" className="transition-all duration-300" />
          <line x1="256" y1={84 - fh(target)} x2="342" y2={84 - fh(target)} stroke="#E6EDF3" strokeWidth="0.75" strokeDasharray="3 2" strokeOpacity="0.6" />
          <text x="299" y="44" textAnchor="middle" fill="#E6EDF3" fontSize="12" fontFamily="monospace" fontWeight="bold">{Math.round(header)}%</text>
          <text x="299" y="57" textAnchor="middle" fill="#6B7785" fontSize="6.5" fontFamily="monospace">{headerL.toLocaleString()} L</text>
          <text x="299" y="78" textAnchor="middle" fill="#9AA6B2" fontSize="7">HEADER</text>
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <button onClick={toggle} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: pumpOn ? "#EF444415" : "#22C55E15", color: pumpOn ? "#EF4444" : "#22C55E", borderColor: pumpOn ? "#EF44444D" : "#22C55E4D" }}>{pumpOn ? "■ Stop Pump" : "▶ Start Pump"}</button>
        {[80, 90, 100].map((t) => (
          <button key={t} onClick={() => setTarget(t)} className="py-1.5 rounded-md text-[10px] font-medium border transition-all" style={{ background: target === t ? "#3BA4FF20" : "#0B0F14", color: target === t ? "#3BA4FF" : "#9AA6B2", borderColor: target === t ? "#3BA4FF4D" : "#2A3441" }}>Target {t}%</button>
        ))}
      </div>
      <div className="text-[8px] text-[#6B7785] text-center">Pump decisions run through the automation engine · levels persist across the nightly reset</div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  {
    key: "irrigation",
    name: "Irrigation Control",
    triggerTopic: "none",
    scriptSource: irrigationLogic,
    uiSource: irrigationUi,
    // Public-demo allowlist: exactly the events/keys the UI uses. Anything else
    // is denied by the public demo guard.
    demoAccess: {
      writableStateKeys: ["damPct", "headerPct"],
      fireEvents: ["start-pump", "stop-pump", "set-target"],
    },
  },
];

const panes = [
  { kind: "automation", ref: "irrigation", x: 0, y: 0, w: 12, h: 15 },
  { kind: "device-grid", x: 0, y: 15, w: 12, h: 6 },
];

const dataStore = [
  {
    name: "tank-levels",
    description: "Dam & header tank levels (72h)",
    retentionDays: 90,
    records: genSeries({
      count: 72,
      intervalMs: 3_600_000,
      fields: {
        dam: (i) => round(80 - i * 0.08 + noise(1.5), 0),
        header: (i) => round(55 + Math.sin(i / 5) * 25 + noise(3), 0),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
