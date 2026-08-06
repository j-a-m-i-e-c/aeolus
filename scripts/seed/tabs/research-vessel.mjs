// scripts/seed/tabs/research-vessel.mjs — Oceanographic research operations demo.
//
// Public-demo flagship: a vessel/ocean cross-section and live CTD profile tell a
// coherent deployment story. Shared cast targets and DP state live in Aeolus;
// cable motion, profile drawing and sea animation are local presentation.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-research-vessel", name: "Research Vessel", icon: "ship" };

const devices = [
  { topic: "sensor/ctd/sonde", payload: { conductivity: 4.21, temperature: 12.1, depth: 120, salinity: 35.1, oxygen: 5.8 } },
  { topic: "switch/vessel/ctd-winch", payload: { on: false, payOut: 120, rate: 0, tension: 220 } },
  { topic: "sensor/vessel/gnss", payload: { lat: -42.881, lon: 147.327, heading: 142, sog: 0.2 } },
  { topic: "switch/vessel/bow-thruster", payload: { on: true, thrust: 18, azimuth: 270 } },
  { topic: "switch/vessel/stern-thruster", payload: { on: true, thrust: 12, azimuth: 90 } },
  { topic: "sensor/underway/tsg", payload: { sst: 18.4, salinity: 35.2, flow: 2.1 } },
  { topic: "sensor/rov/telemetry", payload: { depth: 340, ambientPressure: 35.1, heading: 88, battery: 76 } },
];

const logic = `automation({
  actions: [
    function researchops(context) {
      function init(key, value) {
        if (state.get(key) === undefined) state.set(key, value);
      }

      init("ctdDepth", 120);
      init("ctdTarget", 120);
      init("ctdStatus", "holding");
      init("temperature", 12.1);
      init("salinity", 35.1);
      init("oxygen", 5.8);
      init("dpDrift", 1.8);
      init("dpHolding", true);
      init("bowThrust", 18);
      init("sternThrust", 12);
      init("rovDepth", 340);
      init("rovBattery", 76);
      init("lastAction", { label: "CTD holding at 120 m", at: Date.now() });

      var evt = String(context.topic || "").split("/").pop();

      function setDepth(depth, status) {
        var safe = Math.min(500, Math.max(0, Number(depth || 0)));
        state.set("ctdDepth", safe);
        state.set("ctdTarget", safe);
        state.set("ctdStatus", status);
        var temp = 18.5 - 14.3 / (1 + Math.exp(-(safe - 90) / 18));
        var sal = 35.0 - 0.4 / (1 + Math.exp(-(safe - 90) / 40));
        var oxy = 6.3 - Math.min(2.0, safe / 420);
        state.set("temperature", Math.round(temp * 10) / 10);
        state.set("salinity", Math.round(sal * 100) / 100);
        state.set("oxygen", Math.round(oxy * 10) / 10);
        mqtt.publish("sensor/ctd/sonde", JSON.stringify({ depth: safe, temperature: temp, salinity: sal, oxygen: oxy, conductivity: 4.21 }));
        mqtt.publish("switch/vessel/ctd-winch", JSON.stringify({ on: status !== "holding", payOut: safe, rate: status === "descending" ? 0.8 : status === "recovering" ? -0.9 : 0, tension: 220 }));
      }

      if (evt === "ctd-deploy") {
        setDepth(420, "descending");
        state.set("lastAction", { label: "CTD cast commanded to 420 m", at: Date.now() });
        log.info("CTD deployment to 420 m");
      } else if (evt === "ctd-hold") {
        var current = Number(context.state && context.state.depth);
        if (isNaN(current)) current = Number(state.get("ctdDepth") || 120);
        current = Math.min(500, Math.max(0, current));
        setDepth(current, "holding");
        state.set("lastAction", { label: "CTD winch holding at " + Math.round(current) + " m", at: Date.now() });
      } else if (evt === "ctd-recover") {
        setDepth(5, "recovering");
        state.set("lastAction", { label: "CTD recovery started", at: Date.now() });
      } else if (evt === "dp-drift") {
        state.set("dpDrift", 7.6);
        state.set("dpHolding", false);
        state.set("bowThrust", 64);
        state.set("sternThrust", 53);
        state.set("lastAction", { label: "Current pushed vessel 7.6 m off station", at: Date.now() });
        mqtt.publish("switch/vessel/bow-thruster", JSON.stringify({ on: true, thrust: 64, azimuth: 270 }));
        mqtt.publish("switch/vessel/stern-thruster", JSON.stringify({ on: true, thrust: 53, azimuth: 90 }));
      } else if (evt === "dp-recover") {
        state.set("dpDrift", 1.4);
        state.set("dpHolding", true);
        state.set("bowThrust", 16);
        state.set("sternThrust", 11);
        state.set("lastAction", { label: "Dynamic positioning recovered station", at: Date.now() });
        mqtt.publish("switch/vessel/bow-thruster", JSON.stringify({ on: true, thrust: 16, azimuth: 270 }));
        mqtt.publish("switch/vessel/stern-thruster", JSON.stringify({ on: true, thrust: 11, azimuth: 90 }));
      } else if (evt === "reset-vessel") {
        setDepth(120, "holding");
        state.set("dpDrift", 1.8);
        state.set("dpHolding", true);
        state.set("bowThrust", 18);
        state.set("sternThrust", 12);
        state.set("lastAction", { label: "Research station reset", at: Date.now() });
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export default function ResearchOperations(aeolus: CustomComponentProps) {
  const sharedDepth = clamp(Number(aeolus.read("ctdDepth") ?? 120), 0, 500);
  const status = String(aeolus.read("ctdStatus") || "holding");
  const temperature = Number(aeolus.read("temperature") ?? 12.1);
  const salinity = Number(aeolus.read("salinity") ?? 35.1);
  const oxygen = Number(aeolus.read("oxygen") ?? 5.8);
  const dpDrift = Number(aeolus.read("dpDrift") ?? 1.8);
  const dpHolding = Boolean(aeolus.read("dpHolding") ?? true);
  const bowThrust = Number(aeolus.read("bowThrust") ?? 18);
  const sternThrust = Number(aeolus.read("sternThrust") ?? 12);
  const rovDepth = Number(aeolus.read("rovDepth") ?? 340);
  const rovBattery = Number(aeolus.read("rovBattery") ?? 76);
  const lastAction = aeolus.read("lastAction") as any;

  const [depth, setDepth] = useState(sharedDepth);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const from = depth;
    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      const t = Math.min(1, frame / 42);
      const eased = t * t * (3 - 2 * t);
      setDepth(lerp(from, sharedDepth, eased));
      if (t >= 1) clearInterval(id);
    }, 55);
    return () => clearInterval(id);
  }, [sharedDepth]);
  useEffect(() => {
    const id = setInterval(() => setPhase((v) => (v + 1) % 100000), 90);
    return () => clearInterval(id);
  }, []);

  const tempAt = (d: number) => 18.5 - 14.3 / (1 + Math.exp(-(d - 90) / 18));
  const salAt = (d: number) => 35.0 - 0.4 / (1 + Math.exp(-(d - 90) / 40));
  const yOfDepth = (d: number) => 77 + (d / 500) * 264;
  const vesselX = 224 + Math.sin(phase * 0.025) * (dpHolding ? 2 : 7);
  const ctdY = yOfDepth(depth);
  const actionLabel = lastAction && lastAction.label ? String(lastAction.label) : "Research station online";

  const samples: number[] = [];
  for (let d = 0; d <= Math.max(20, depth); d += 14) samples.push(d);
  if (samples[samples.length - 1] !== depth) samples.push(depth);
  const profileX = (t: number) => 500 + ((t - 3) / 16) * 155;
  const profileY = (d: number) => 76 + (d / 500) * 267;
  const tempPath = samples.map((d, i) => (i === 0 ? "M" : "L") + profileX(tempAt(d)).toFixed(1) + "," + profileY(d).toFixed(1)).join(" ");
  const salPath = samples.map((d, i) => (i === 0 ? "M" : "L") + (500 + ((salAt(d) - 34.55) / 0.55) * 155).toFixed(1) + "," + profileY(d).toFixed(1)).join(" ");

  return (
    <div style={{ minHeight: "100%", padding: 14, color: "#E7EFF5", background: "linear-gradient(180deg,#07101A 0%,#07101A 38%,#050A10 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 850, letterSpacing: "0.02em" }}>RESEARCH OPERATIONS</span>
            <span style={{ border: "1px solid #224359", color: "#65C7ED", background: "#0A1B27", borderRadius: 999, padding: "2px 7px", fontSize: 8, letterSpacing: "0.1em" }}>STATION 42°52′S</span>
          </div>
          <div style={{ color: "#687C8B", fontSize: 9, marginTop: 3 }}>CTD profiling · dynamic positioning · ROV telemetry</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: dpHolding ? "#6DDEA1" : "#F4B65A", fontSize: 10, fontWeight: 800 }}>{dpHolding ? "DP HOLDING" : "DP CORRECTING"} · {dpDrift.toFixed(1)} m</div>
          <div style={{ color: "#61727E", fontSize: 8, marginTop: 2 }}>{actionLabel}</div>
        </div>
      </div>

      <div style={{ border: "1px solid #1E3445", borderRadius: 14, overflow: "hidden", background: "#04101A" }}>
        <svg width="100%" height="405" viewBox="0 0 720 405" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0A3854"/><stop offset="0.34" stopColor="#08253C"/><stop offset="1" stopColor="#03101D"/></linearGradient>
            <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B2940" stopOpacity="0"/><stop offset="1" stopColor="#020812" stopOpacity="0.9"/></linearGradient>
            <filter id="sondeGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          <rect width="720" height="405" fill="#08131C" />
          <rect x="0" y="53" width="470" height="352" fill="url(#ocean)" />
          <rect x="0" y="53" width="470" height="352" fill="url(#deep)" />
          <rect x="470" y="53" width="250" height="352" fill="#071018" />
          <line x1="470" y1="53" x2="470" y2="405" stroke="#1F3443" />

          {/* Sea surface */}
          <path d={"M0 54 C40 " + (50 + Math.sin(phase * .08) * 3) + " 80 " + (58 + Math.cos(phase * .06) * 2) + " 120 53 C170 47 215 59 260 53 C315 46 365 59 420 53 C442 51 456 52 470 53"} fill="none" stroke="#71CFF0" strokeWidth="1.5" opacity="0.75" />
          <text x="18" y="31" fill="#687C8B" fontSize="7" letterSpacing="1.4">SOUTHERN OCEAN · CTD STATION 04</text>

          {/* Vessel */}
          <g transform={"translate(" + vesselX + " 54)"}>
            <path d="M-70 -4 L61 -4 L78 9 L52 18 L-52 18 L-78 7 Z" fill="#B7C4CA" stroke="#E8EFF2" strokeWidth="1" />
            <rect x="-16" y="-31" width="48" height="27" rx="3" fill="#DCE5E8" stroke="#EEF5F6" />
            <rect x="-4" y="-25" width="25" height="8" fill="#1E5168" />
            <line x1="18" y1="-31" x2="18" y2="-48" stroke="#B5C7CE" />
            <line x1="18" y1="-46" x2="37" y2="-40" stroke="#B5C7CE" />
            <circle cx="-42" cy="6" r="4" fill="#17384A" />
            <text x="0" y="11" textAnchor="middle" fill="#22343B" fontSize="7" fontWeight="700">RV AEOLUS</text>
            {!dpHolding && <g opacity={0.65 + Math.sin(phase * .3) * .2}><path d="M-68 13 l-18 7" stroke="#63D9F5" strokeWidth="2"/><path d="M62 13 l19 7" stroke="#63D9F5" strokeWidth="2"/></g>}
          </g>

          {/* CTD cable and sonde */}
          <line x1={vesselX - 42} y1="62" x2={vesselX - 42} y2={ctdY} stroke="#A5B5BB" strokeWidth="1" />
          {status !== "holding" && Array.from({ length: 5 }).map((_, i) => <circle key={i} cx={vesselX - 42} cy={80 + ((phase * 2 + i * 52) % Math.max(30, ctdY - 80))} r="1.7" fill="#72DFF7" opacity="0.75" />)}
          <g transform={"translate(" + (vesselX - 42) + " " + ctdY + ")"} filter="url(#sondeGlow)">
            <circle cx="0" cy="0" r="10" fill="#E6A84D" stroke="#FFD180" strokeWidth="1.2" />
            <rect x="-7" y="-13" width="14" height="4" rx="2" fill="#B9C6CC" />
            <line x1="-7" y1="9" x2="-5" y2="17" stroke="#B9C6CC"/><line x1="7" y1="9" x2="5" y2="17" stroke="#B9C6CC"/>
          </g>
          <text x={vesselX - 27} y={ctdY + 3} fill="#FFCD7B" fontSize="8" fontFamily="monospace">{Math.round(depth)} m</text>

          {/* ROV vehicle deeper and offset */}
          <path d={"M332 66 C340 150 350 223 361 " + yOfDepth(rovDepth)} fill="none" stroke="#536A75" strokeWidth="0.8" strokeDasharray="3 3" />
          <g transform={"translate(363 " + yOfDepth(rovDepth) + ")"}>
            <rect x="-17" y="-8" width="34" height="16" rx="4" fill="#122B37" stroke="#52CDEB" />
            <circle cx="-9" cy="0" r="3" fill="#77E7FF" />
            <path d="M17 -3 L27 -9 M17 3 L27 9" stroke="#52CDEB" />
          </g>
          <text x="363" y={yOfDepth(rovDepth) + 23} textAnchor="middle" fill="#65BFD3" fontSize="7">ROV · {rovDepth} m · {rovBattery}%</text>

          {/* Depth marks */}
          {[0,100,200,300,400,500].map((d) => <g key={d}><line x1="10" y1={yOfDepth(d)} x2="460" y2={yOfDepth(d)} stroke="#31536A" strokeOpacity="0.2"/><text x="8" y={yOfDepth(d)+3} textAnchor="end" fill="#547084" fontSize="6">{d}</text></g>)}
          <rect x="0" y={yOfDepth(65)} width="470" height={yOfDepth(125)-yOfDepth(65)} fill="#E6A84D" opacity="0.035" />
          <text x="18" y={yOfDepth(93)} fill="#B68A52" fontSize="7">THERMOCLINE</text>

          {/* Live profile panel */}
          <text x="494" y="34" fill="#778A98" fontSize="7" letterSpacing="1.3">LIVE WATER COLUMN PROFILE</text>
          {[0,100,200,300,400,500].map((d) => <g key={d}><line x1="500" y1={profileY(d)} x2="688" y2={profileY(d)} stroke="#1B2D39"/><text x="493" y={profileY(d)+3} textAnchor="end" fill="#536774" fontSize="6">{d}</text></g>)}
          <rect x="500" y={profileY(65)} width="188" height={profileY(125)-profileY(65)} fill="#D18B3C" opacity="0.05" />
          <path d={tempPath} fill="none" stroke="#F2AE50" strokeWidth="2" strokeLinecap="round" />
          <path d={salPath} fill="none" stroke="#54D7EF" strokeWidth="1.6" strokeDasharray="4 3" />
          <line x1="500" y1={profileY(depth)} x2="688" y2={profileY(depth)} stroke="#6CDD98" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={profileX(temperature)} cy={profileY(depth)} r="3" fill="#F2AE50" />
          <text x="508" y="374" fill="#F2AE50" fontSize="7">TEMP {temperature.toFixed(1)}°C</text>
          <text x="582" y="374" fill="#54D7EF" fontSize="7">SAL {salinity.toFixed(2)} PSU</text>
          <text x="508" y="389" fill="#7C8D99" fontSize="7">O₂ {oxygen.toFixed(1)} mL/L</text>
        </svg>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 1fr", gap: 8, marginTop: 9 }}>
        <div style={{ border: "1px solid #203A4C", background: "#07131C", borderRadius: 11, padding: 10 }}>
          <div style={{ color: "#6DCDEB", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>CTD WINCH</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => aeolus.fire("ctd-deploy")} style={{ flex: 1, background: "#0B2635", color: "#74DDF7", border: "1px solid #245E76", borderRadius: 7, padding: "7px", fontSize: 9, cursor: "pointer", fontWeight: 700 }}>Deploy 420 m</button>
            <button onClick={() => aeolus.fire("ctd-hold", { depth: Math.round(depth) })} style={{ background: "#171B1E", color: "#9AA8B0", border: "1px solid #343B40", borderRadius: 7, padding: "7px 9px", fontSize: 9, cursor: "pointer" }}>Hold</button>
            <button onClick={() => aeolus.fire("ctd-recover")} style={{ background: "#172319", color: "#89D79B", border: "1px solid #36523A", borderRadius: 7, padding: "7px 9px", fontSize: 9, cursor: "pointer" }}>Recover</button>
          </div>
          <div style={{ color: "#607481", fontSize: 8, marginTop: 7 }}>Winch {status} · sonde {Math.round(depth)} m · profile draws with the cast</div>
        </div>

        <div style={{ border: "1px solid " + (dpHolding ? "#254537" : "#5C4526"), background: "#07110F", borderRadius: 11, padding: 10 }}>
          <div style={{ color: dpHolding ? "#79D99D" : "#EAB85D", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>DYNAMIC POSITIONING</div>
          <button onClick={() => aeolus.fire(dpHolding ? "dp-drift" : "dp-recover")} style={{ width: "100%", background: dpHolding ? "#1B1E20" : "#13231A", color: dpHolding ? "#A5ADB3" : "#85E1A3", border: "1px solid " + (dpHolding ? "#394047" : "#365D41"), borderRadius: 7, padding: "7px", fontSize: 9, cursor: "pointer", fontWeight: 700 }}>{dpHolding ? "Simulate current drift" : "Recover station"}</button>
          <div style={{ color: "#60706B", fontSize: 8, marginTop: 7 }}>Bow {bowThrust}% · stern {sternThrust}% · drift {dpDrift.toFixed(1)} m</div>
        </div>

        <div style={{ border: "1px solid #203A4C", background: "#07131C", borderRadius: 11, padding: 10 }}>
          <div style={{ color: "#6DCDEB", fontSize: 8, letterSpacing: "0.12em", marginBottom: 7 }}>UNDERWAY / ROV</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            <div><div style={{ color: "#647985", fontSize: 7 }}>SEA TEMP</div><div style={{ color: "#E5A94D", fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>18.4°C</div></div>
            <div><div style={{ color: "#647985", fontSize: 7 }}>ROV</div><div style={{ color: "#63D4ED", fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{rovDepth} m</div></div>
          </div>
          <div style={{ color: "#607481", fontSize: 8, marginTop: 7 }}>Flow-through 2.1 L/min · ROV battery {rovBattery}%</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#596A75", fontSize: 8, marginTop: 9 }}>
        <span>Simulated vessel · shared operational targets · local fluid animation</span>
        <button onClick={() => aeolus.fire("reset-vessel")} style={{ background: "transparent", border: 0, color: "#70818B", fontSize: 8, cursor: "pointer" }}>Reset station</button>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "research-ops",
    name: "Research Operations",
    triggerTopic: "none",
    scriptSource: logic,
    uiSource: ui,
    demoAccess: {
      fireEvents: ["ctd-deploy", "ctd-hold", "ctd-recover", "dp-drift", "dp-recover", "reset-vessel"],
    },
  },
];

const panes = [
  { kind: "automation", ref: "research-ops", x: 0, y: 0, w: 12, h: 17 },
  { kind: "device-grid", x: 0, y: 17, w: 12, h: 6 },
];

const dataStore = [
  {
    name: "ctd-casts",
    description: "CTD cast samples: depth, temperature, salinity, dissolved oxygen",
    retentionDays: 180,
    records: genSeries({
      count: 110,
      intervalMs: 12_000,
      fields: {
        depth: (i) => Math.min(500, i * 4.6),
        temperature: (i) => round(18.5 - 14.3 / (1 + Math.exp(-((i * 4.6) - 90) / 18)) + noise(0.08), 2),
        salinity: (i) => round(35.0 - 0.4 / (1 + Math.exp(-((i * 4.6) - 90) / 40)) + noise(0.015), 3),
        oxygen: (i) => round(6.3 - Math.min(2, (i * 4.6) / 420) + noise(0.06), 2),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
