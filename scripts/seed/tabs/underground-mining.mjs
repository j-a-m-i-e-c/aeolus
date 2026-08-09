// scripts/seed/tabs/underground-mining.mjs — Underground mine operations demo.
//
// Public-demo flagship: atmospheric safety, ventilation-on-demand and personnel
// muster are presented as one live mine cross-section. Shared incident state is
// held by Aeolus; airflow particles, fan rotation and personnel movement are
// browser-side presentation derived from that shared state.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-mining", name: "Underground Mining", icon: "mountain" };

const devices = [
  { topic: "sensor/mine/gas-l3", payload: { ch4: 0.3, co: 12, o2: 20.8, no2: 1.2 } },
  { topic: "sensor/mine/gas-d7", payload: { ch4: 0.42, co: 16, o2: 20.7, no2: 1.6 } },
  { topic: "switch/mine/primary-fan", payload: { on: true, rpm: 1136, airflow: 258, mode: "auto" } },
  { topic: "switch/mine/booster-fan-l3", payload: { on: true, rpm: 820, airflow: 94 } },
  { topic: "sensor/mine/personnel", payload: { underground: 14, l1: 3, l2: 6, l3: 5 } },
  { topic: "sensor/mine/refuge", payload: { occupancy: 0, capacity: 20, sealed: false, o2: 20.9 } },
  { topic: "sensor/mine/sump-deep", payload: { level: 1.8, flow: 45, on: true } },
];

const logic = `automation({
  actions: [
    function mineops(context) {
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }

      init("ch4", 0.42);
      init("co", 16);
      init("o2", 20.7);
      init("no2", 1.6);
      init("demand", 48);
      init("primaryRpm", 1136);
      init("boosterRpm", 840);
      init("airflow", 258);
      init("gasIncident", false);
      init("alarm", false);
      init("mustering", false);
      init("musterStart", 0);
      init("ventOverride", false);
      init("lastAction", { label: "Mine operating normally", at: Date.now() });

      var evt = String(context.topic || "").split("/").pop();

      function publishAtmosphere() {
        mqtt.publish("sensor/mine/gas-d7", JSON.stringify({
          ch4: Number(state.get("ch4") || 0),
          co: Number(state.get("co") || 0),
          o2: Number(state.get("o2") || 20.9),
          no2: Number(state.get("no2") || 0)
        }));
      }

      function publishFan() {
        mqtt.publish("switch/mine/primary-fan", JSON.stringify({
          on: true,
          rpm: Number(state.get("primaryRpm") || 0),
          airflow: Number(state.get("airflow") || 0),
          mode: state.get("ventOverride") ? "boost" : "auto"
        }));
      }

      if (evt === "gas-rise") {
        state.set("ch4", 1.12);
        state.set("co", 34);
        state.set("o2", 20.3);
        state.set("no2", 3.1);
        state.set("demand", 100);
        state.set("primaryRpm", 1500);
        state.set("boosterRpm", 1100);
        state.set("airflow", 330);
        state.set("gasIncident", true);
        state.set("alarm", true);
        state.set("lastAction", { label: "CH4 threshold exceeded — ventilation boosted", at: Date.now() });
        publishAtmosphere();
        publishFan();
        log.warn("Demo gas incident: CH4 1.12% at Drift 7");
      } else if (evt === "clear-air") {
        state.set("ch4", 0.36);
        state.set("co", 13);
        state.set("o2", 20.8);
        state.set("no2", 1.3);
        state.set("demand", state.get("ventOverride") ? 100 : 42);
        state.set("primaryRpm", state.get("ventOverride") ? 1500 : 1094);
        state.set("boosterRpm", state.get("ventOverride") ? 1100 : 810);
        state.set("airflow", state.get("ventOverride") ? 330 : 250);
        state.set("gasIncident", false);
        state.set("alarm", false);
        state.set("lastAction", { label: "Atmosphere returned below alarm thresholds", at: Date.now() });
        publishAtmosphere();
        publishFan();
      } else if (evt === "vent-boost") {
        var nextBoost = !Boolean(state.get("ventOverride"));
        state.set("ventOverride", nextBoost);
        state.set("demand", nextBoost ? 100 : (state.get("gasIncident") ? 100 : 48));
        state.set("primaryRpm", nextBoost ? 1500 : (state.get("gasIncident") ? 1500 : 1136));
        state.set("boosterRpm", nextBoost ? 1100 : (state.get("gasIncident") ? 1100 : 840));
        state.set("airflow", nextBoost ? 330 : (state.get("gasIncident") ? 330 : 258));
        state.set("lastAction", { label: nextBoost ? "Manual ventilation boost enabled" : "Ventilation returned to automatic demand", at: Date.now() });
        publishFan();
      } else if (evt === "muster") {
        state.set("mustering", true);
        state.set("musterStart", Date.now());
        state.set("lastAction", { label: "Emergency muster initiated", at: Date.now() });
        mqtt.publish("sensor/mine/refuge", JSON.stringify({ occupancy: 0, capacity: 20, sealed: false, muster: true }));
        log.warn("MUSTER initiated — all personnel to refuge chamber");
      } else if (evt === "clear-muster") {
        state.set("mustering", false);
        state.set("musterStart", 0);
        state.set("lastAction", { label: "Muster cleared — personnel returned to work areas", at: Date.now() });
        mqtt.publish("sensor/mine/refuge", JSON.stringify({ occupancy: 0, capacity: 20, sealed: false, muster: false }));
      } else if (evt === "reset-mine") {
        state.set("ch4", 0.42);
        state.set("co", 16);
        state.set("o2", 20.7);
        state.set("no2", 1.6);
        state.set("demand", 48);
        state.set("primaryRpm", 1136);
        state.set("boosterRpm", 840);
        state.set("airflow", 258);
        state.set("gasIncident", false);
        state.set("alarm", false);
        state.set("mustering", false);
        state.set("musterStart", 0);
        state.set("ventOverride", false);
        state.set("lastAction", { label: "Mine reset to normal operations", at: Date.now() });
        publishAtmosphere();
        publishFan();
      }
    },
  ],
});`;

const ui = `import { useEffect, useMemo, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function MineOperations(aeolus: CustomComponentProps) {
  const ch4 = Number(aeolus.read("ch4") ?? 0.42);
  const co = Number(aeolus.read("co") ?? 16);
  const o2 = Number(aeolus.read("o2") ?? 20.7);
  const no2 = Number(aeolus.read("no2") ?? 1.6);
  const demand = clamp(Number(aeolus.read("demand") ?? 48), 0, 100);
  const primaryRpm = Number(aeolus.read("primaryRpm") ?? 1136);
  const boosterRpm = Number(aeolus.read("boosterRpm") ?? 840);
  const airflow = Number(aeolus.read("airflow") ?? 258);
  const gasIncident = Boolean(aeolus.read("gasIncident"));
  const alarm = Boolean(aeolus.read("alarm"));
  const mustering = Boolean(aeolus.read("mustering"));
  const musterStart = Number(aeolus.read("musterStart") ?? 0);
  const ventOverride = Boolean(aeolus.read("ventOverride"));
  const lastAction = aeolus.read("lastAction") as any;

  const [phase, setPhase] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => { setPhase((v) => (v + 1) % 100000); setNow(Date.now()); }, 90);
    return () => clearInterval(id);
  }, []);

  const personnel = useMemo(() => [
    { x: 177, y: 128 }, { x: 239, y: 129 }, { x: 318, y: 128 },
    { x: 173, y: 199 }, { x: 219, y: 199 }, { x: 270, y: 199 }, { x: 331, y: 199 }, { x: 384, y: 199 }, { x: 430, y: 199 },
    { x: 198, y: 270 }, { x: 250, y: 270 }, { x: 306, y: 270 }, { x: 369, y: 270 }, { x: 423, y: 270 },
  ], []);

  const rawMusterProgress = mustering && musterStart > 0 ? (now - musterStart) / 11000 : 0;
  const musterProgress = mustering ? clamp(rawMusterProgress, 0, 1) : 0;
  const inRefuge = mustering ? Math.min(14, Math.floor(musterProgress * 16)) : 0;
  const atmosphereColor = alarm ? "#FF5A52" : ch4 >= 0.5 ? "#F6A84B" : "#73E39A";
  const fanColor = demand >= 80 ? "#F0B44B" : "#63D5EF";
  const actionLabel = lastAction && lastAction.label ? String(lastAction.label) : "Mine operating normally";

  const airflowParticles = Array.from({ length: 18 });

  return (
    <div style={{ minHeight: "100%", padding: 14, color: "#E8EEF5", background: "linear-gradient(180deg,#0B0D10 0%,#080A0C 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 850, letterSpacing: "0.02em" }}>UNDERGROUND OPERATIONS</span>
            <span style={{ fontSize: 8, border: "1px solid #343A42", borderRadius: 999, padding: "2px 7px", color: "#818B97", letterSpacing: "0.1em" }}>LEVELS 1–3</span>
          </div>
          <div style={{ color: "#6D747E", fontSize: 9, marginTop: 3 }}>Atmosphere · ventilation-on-demand · personnel tracking</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: alarm ? "#FF7168" : "#75E29A", fontSize: 10, fontWeight: 850 }}>{alarm ? "GAS ALARM" : "ATMOSPHERE SAFE"}</div>
          <div style={{ color: "#656D76", fontSize: 8, marginTop: 2 }}>{actionLabel}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #2B3037", borderRadius: 14, overflow: "hidden", background: "#07090B" }}>
        <svg width="100%" height="400" viewBox="0 0 720 400" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1B1C1D"/><stop offset="1" stopColor="#0D0E0F"/></linearGradient>
            <radialGradient id="gas"><stop offset="0" stopColor="#FFB43A" stopOpacity="0.38"/><stop offset="1" stopColor="#FF7A31" stopOpacity="0"/></radialGradient>
            <filter id="fanGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          <rect width="720" height="400" fill="url(#rock)" />
          <rect x="0" y="0" width="720" height="55" fill="#111417" />
          <line x1="0" y1="55" x2="720" y2="55" stroke="#3A3E43" strokeWidth="1" />
          <text x="20" y="34" fill="#6E7780" fontSize="8" letterSpacing="1.5">SURFACE</text>

          {/* Shafts */}
          <rect x="82" y="55" width="34" height="290" fill="#10161A" stroke="#315765" strokeWidth="1.2" />
          <rect x="603" y="55" width="34" height="290" fill="#151313" stroke={alarm ? "#7B3934" : "#5C5140"} strokeWidth="1.2" />
          <text x="99" y="365" textAnchor="middle" fill="#53879B" fontSize="7">INTAKE</text>
          <text x="620" y="365" textAnchor="middle" fill={alarm ? "#BF6258" : "#928067"} fontSize="7">RETURN</text>

          {/* Mine levels */}
          {[{ y: 128, label: "LEVEL 1" }, { y: 199, label: "LEVEL 2" }, { y: 270, label: "LEVEL 3" }].map((lv) => (
            <g key={lv.label}>
              <path d={"M116 " + lv.y + " H603"} stroke="#202327" strokeWidth="24" />
              <path d={"M116 " + lv.y + " H603"} stroke="#353A40" strokeWidth="2" />
              <text x="128" y={lv.y - 15} fill="#717982" fontSize="7" letterSpacing="1">{lv.label}</text>
            </g>
          ))}

          {/* Production drift and refuge */}
          <path d="M448 270 H557 V323 H498" fill="none" stroke="#202327" strokeWidth="24" />
          <path d="M448 270 H557 V323 H498" fill="none" stroke="#3A3E43" strokeWidth="2" />
          <rect x="463" y="303" width="73" height="42" rx="6" fill={mustering ? "#12261A" : "#131719"} stroke={mustering ? "#52C777" : "#4B545A"} strokeWidth="1.2" />
          <text x="499" y="319" textAnchor="middle" fill="#98A4AA" fontSize="7">REFUGE CHAMBER</text>
          <text x="499" y="335" textAnchor="middle" fill={mustering ? "#6DE28F" : "#708087"} fontSize="11" fontFamily="monospace" fontWeight="700">{inRefuge} / 14</text>

          {/* Gas plume in Drift 7 */}
          {gasIncident && <g opacity={0.65 + Math.sin(phase * 0.1) * 0.12}>
            <ellipse cx="452" cy="270" rx="88" ry="48" fill="url(#gas)" />
            <ellipse cx="500" cy="270" rx="53" ry="31" fill="url(#gas)" />
          </g>}
          <text x="451" y="248" textAnchor="middle" fill={atmosphereColor} fontSize="8" fontWeight="700">DRIFT 7 · CH₄ {ch4.toFixed(2)}%</text>

          {/* Air particles: move down intake, across levels, up return. */}
          {airflowParticles.map((_, i) => {
            const t = ((phase * (0.005 + demand * 0.000055) + i / airflowParticles.length) % 1);
            let x = 99, y = 65;
            if (t < 0.28) {
              y = 65 + (t / 0.28) * 274;
            } else if (t < 0.8) {
              const p = (t - 0.28) / 0.52;
              x = 99 + p * 521;
              y = 270 - Math.sin(p * Math.PI * 3) * 71;
            } else {
              x = 620;
              y = 339 - ((t - 0.8) / 0.2) * 274;
            }
            return <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 2.2 : 1.5} fill={i % 3 === 0 ? "#81E4FA" : fanColor} opacity={0.4 + demand / 170} />;
          })}

          {/* Primary fan */}
          <circle cx="620" cy="55" r="23" fill="#121619" stroke={fanColor} strokeWidth="1.5" filter="url(#fanGlow)" />
          <g style={{ transform: "rotate(" + (phase * (4 + demand * 0.11)) + "deg)", transformOrigin: "620px 55px" }}>
            {[0, 90, 180, 270].map((a) => <path key={a} d="M620 55 C627 47 632 47 635 50 C632 56 627 59 620 55 Z" fill={fanColor} transform={"rotate(" + a + " 620 55)"} />)}
          </g>
          <text x="620" y="28" textAnchor="middle" fill="#A4ADB6" fontSize="7">PRIMARY {primaryRpm} RPM</text>

          {/* Booster fan */}
          <circle cx="345" cy="270" r="13" fill="#121619" stroke="#E7A844" strokeWidth="1.2" />
          <g style={{ transform: "rotate(" + (phase * (3 + demand * 0.08)) + "deg)", transformOrigin: "345px 270px" }}>
            <line x1="337" y1="270" x2="353" y2="270" stroke="#E7A844" strokeWidth="2" />
            <line x1="345" y1="262" x2="345" y2="278" stroke="#E7A844" strokeWidth="2" />
          </g>
          <text x="345" y="291" textAnchor="middle" fill="#7D725C" fontSize="6">BOOSTER {boosterRpm}</text>

          {/* Personnel interpolate toward refuge during muster. */}
          {personnel.map((p, i) => {
            const delay = (i % 5) * 0.06 + Math.floor(i / 5) * 0.035;
            const t = mustering ? clamp((musterProgress - delay) / 0.68, 0, 1) : 0;
            const eased = t * t * (3 - 2 * t);
            const targetX = 478 + (i % 5) * 9;
            const targetY = 324 + Math.floor(i / 5) * 7;
            const x = lerp(p.x, targetX, eased);
            const y = lerp(p.y, targetY, eased);
            return (
              <g key={i}>
                <circle cx={x} cy={y - 3.5} r="2.5" fill={mustering ? "#F5C24D" : "#D8E1E8"} />
                <line x1={x} y1={y - 1} x2={x} y2={y + 5} stroke={mustering ? "#F5C24D" : "#AEB8C0"} strokeWidth="1.5" />
                <line x1={x - 3} y1={y + 1} x2={x + 3} y2={y + 1} stroke={mustering ? "#F5C24D" : "#AEB8C0"} strokeWidth="1" />
              </g>
            );
          })}

          {/* Atmosphere card */}
          <g transform="translate(145 18)">
            <rect width="305" height="48" rx="8" fill="#0B0E10" stroke="#2E343A" />
            <text x="12" y="14" fill="#68717A" fontSize="7" letterSpacing="1">DRIFT 7 ATMOSPHERE</text>
            <text x="12" y="34" fill={atmosphereColor} fontSize="14" fontFamily="monospace" fontWeight="700">CH₄ {ch4.toFixed(2)}%</text>
            <text x="111" y="34" fill={co >= 30 ? "#FF7168" : "#D2DAE0"} fontSize="10" fontFamily="monospace">CO {Math.round(co)}ppm</text>
            <text x="188" y="34" fill={o2 < 19.5 ? "#FF7168" : "#D2DAE0"} fontSize="10" fontFamily="monospace">O₂ {o2.toFixed(1)}%</text>
            <text x="259" y="34" fill="#9AA3AA" fontSize="9" fontFamily="monospace">NO₂ {no2.toFixed(1)}</text>
          </g>

          <g transform="translate(468 18)">
            <rect width="120" height="48" rx="8" fill="#0B0E10" stroke="#2E343A" />
            <text x="12" y="14" fill="#68717A" fontSize="7">VENT DEMAND</text>
            <text x="12" y="35" fill={fanColor} fontSize="18" fontFamily="monospace" fontWeight="700">{Math.round(demand)}%</text>
            <text x="67" y="34" fill="#75818A" fontSize="8">{airflow} m³/s</text>
          </g>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr 1fr", gap: 8, marginTop: 9 }}>
        <div style={{ border: "1px solid " + (alarm ? "#67322E" : "#293036"), background: alarm ? "#17100F" : "#0C0F11", borderRadius: 11, padding: 10 }}>
          <div style={{ color: atmosphereColor, fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>ATMOSPHERE SCENARIO</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => aeolus.fire(gasIncident ? "clear-air" : "gas-rise")} style={{ flex: 1, background: gasIncident ? "#13251B" : "#2A1713", color: gasIncident ? "#83E3A1" : "#FF927E", border: "1px solid " + (gasIncident ? "#315C3E" : "#723B32"), borderRadius: 7, padding: "7px 8px", fontSize: 9, cursor: "pointer", fontWeight: 750 }}>{gasIncident ? "Clear atmosphere" : "Simulate CH₄ rise"}</button>
            <button onClick={() => aeolus.fire("vent-boost")} style={{ background: ventOverride ? "#322714" : "#15191C", color: ventOverride ? "#F5C65E" : "#92A0AA", border: "1px solid " + (ventOverride ? "#6B5428" : "#343B41"), borderRadius: 7, padding: "7px 9px", fontSize: 9, cursor: "pointer" }}>{ventOverride ? "Boost ON" : "Vent boost"}</button>
          </div>
          <div style={{ color: "#626A71", fontSize: 8, marginTop: 7 }}>Aeolus ramps ventilation from atmospheric demand and publishes fan targets locally.</div>
        </div>

        <div style={{ border: "1px solid " + (mustering ? "#654723" : "#293036"), background: mustering ? "#17130C" : "#0C0F11", borderRadius: 11, padding: 10 }}>
          <div style={{ color: mustering ? "#F0BD53" : "#8E99A2", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>PERSONNEL MUSTER</div>
          <button onClick={() => aeolus.fire(mustering ? "clear-muster" : "muster")} style={{ width: "100%", background: mustering ? "#1B211A" : "#2A1713", color: mustering ? "#B8D2BE" : "#FF8D79", border: "1px solid " + (mustering ? "#38463B" : "#6D382F"), borderRadius: 7, padding: "7px 8px", fontSize: 9, cursor: "pointer", fontWeight: 750 }}>{mustering ? "Clear muster" : "Emergency muster"}</button>
          <div style={{ color: "#626A71", fontSize: 8, marginTop: 7 }}>{mustering ? inRefuge + " of 14 moving to refuge" : "14 personnel underground · all tags online"}</div>
        </div>

        <div style={{ border: "1px solid #293036", background: "#0C0F11", borderRadius: 11, padding: 10 }}>
          <div style={{ color: "#7693A1", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>DEWATERING</div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}><span style={{ color: "#6FD2EA", fontFamily: "monospace", fontSize: 17, fontWeight: 750 }}>1.8 m</span><span style={{ color: "#6A747B", fontSize: 8 }}>deep sump</span></div>
          <div style={{ height: 4, background: "#182126", borderRadius: 99, marginTop: 6, overflow: "hidden" }}><div style={{ width: "72%", height: "100%", background: "#3CA9C9" }} /></div>
          <div style={{ color: "#626A71", fontSize: 8, marginTop: 7 }}>Pump ON · 45 L/s to surface</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 9, color: "#5E666C", fontSize: 8 }}>
        <span>Simulated mine · shared incident state · locally-rendered motion</span>
        <button onClick={() => aeolus.fire("reset-mine")} style={{ background: "transparent", border: 0, color: "#747D84", fontSize: 8, cursor: "pointer" }}>Reset mine</button>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "mine-ops",
    name: "Underground Operations",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      fireEvents: ["gas-rise", "clear-air", "vent-boost", "muster", "clear-muster", "reset-mine"],
    },
  },
];

const panes = [
  { kind: "automation", ref: "mine-ops", x: 0, y: 0, w: 12, h: 17 },
  { kind: "device-grid", x: 0, y: 17, w: 12, h: 6 },
];

const dataStore = [
  {
    name: "gas-readings",
    description: "Multi-gas atmospheric readings, both locations (48h)",
    retentionDays: 90,
    records: genSeries({
      count: 96,
      intervalMs: 30 * 60_000,
      fields: {
        location: (i) => (i % 2 === 0 ? "Level 3" : "Drift 7"),
        ch4: (i) => round(0.25 + Math.sin(i / 8) * 0.11 + noise(0.05), 2),
        co: (i) => round(13 + Math.sin(i / 11) * 6 + noise(2), 0),
        o2: () => round(20.8 + noise(0.08), 1),
        no2: (i) => round(1.4 + Math.sin(i / 13) * 0.6 + noise(0.18), 1),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
