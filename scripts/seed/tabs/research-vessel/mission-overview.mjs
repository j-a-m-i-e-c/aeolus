const logic = `automation({
  actions: [
    function missionOverview(context) {
      function init(key, value) { if (state.get(key) === undefined) state.set(key, value); }
      init("dpEngaged", true); init("dpMode", "holding"); init("driftM", 1.2); init("currentKn", 0.8); init("heading", 142);
      init("ctdDepth", 120); init("ctdStatus", "holding"); init("ctdTemperature", 12.1); init("ctdTension", 220);
      init("rovDepth", 310); init("rovMode", "holding"); init("rovBattery", 78); init("rovTether", 310);
      init("tsgPumpOn", true); init("tsgFlow", 2.1); init("sst", 18.4); init("surfaceSalinity", 35.2); init("frontDetected", false);
      init("lastMissionEvent", { label: "Science station established", at: Date.now() });

      var topic = String(context.topic || "");
      var s = context.state && typeof context.state === "object" ? context.state : {};
      function copy(name) { if (s[name] !== undefined) state.set(name, s[name]); }

      if (topic.indexOf("/vessel/summary/station") >= 0) {
        ["dpEngaged","dpMode","driftM","currentKn","heading","bowThrust","sternThrust"].forEach(copy);
        state.set("lastMissionEvent", { label: "Station keeping · " + String(s.dpMode || "updated"), at: Date.now() });
      } else if (topic.indexOf("/vessel/summary/ctd") >= 0) {
        ["ctdDepth","ctdStatus","ctdTemperature","ctdSalinity","ctdOxygen","ctdTension"].forEach(copy);
        state.set("lastMissionEvent", { label: "CTD · " + String(s.ctdStatus || "profile updated"), at: Date.now() });
      } else if (topic.indexOf("/vessel/summary/rov") >= 0) {
        ["rovDepth","rovMode","rovBattery","rovTether","rovHeading","rovAltitude"].forEach(copy);
        state.set("lastMissionEvent", { label: "ROV · " + String(s.rovMode || "telemetry updated"), at: Date.now() });
      } else if (topic.indexOf("/vessel/summary/underway") >= 0) {
        ["tsgPumpOn","tsgFlow","sst","surfaceSalinity","chlorophyll","frontDetected"].forEach(copy);
        state.set("lastMissionEvent", { label: s.frontDetected ? "Underway science · hydrographic front detected" : "Underway science · surface stream updated", at: Date.now() });
      }
    },
  ],
});`;

const ui = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

export default function MissionOverview(aeolus: CustomComponentProps) {
  const dpEngaged = aeolus.read("dpEngaged") !== false;
  const dpMode = String(aeolus.read("dpMode") || "holding");
  const drift = Number(aeolus.read("driftM") ?? 1.2);
  const current = Number(aeolus.read("currentKn") ?? .8);
  const heading = Number(aeolus.read("heading") ?? 142);
  const ctdDepth = Number(aeolus.read("ctdDepth") ?? 120);
  const ctdStatus = String(aeolus.read("ctdStatus") || "holding");
  const ctdTemp = Number(aeolus.read("ctdTemperature") ?? 12.1);
  const ctdTension = Number(aeolus.read("ctdTension") ?? 220);
  const rovDepth = Number(aeolus.read("rovDepth") ?? 310);
  const rovMode = String(aeolus.read("rovMode") || "holding");
  const rovBattery = Number(aeolus.read("rovBattery") ?? 78);
  const rovTether = Number(aeolus.read("rovTether") ?? 310);
  const flow = Number(aeolus.read("tsgFlow") ?? 2.1);
  const sst = Number(aeolus.read("sst") ?? 18.4);
  const front = Boolean(aeolus.read("frontDetected"));
  const last = aeolus.read("lastMissionEvent") as any;
  const [phase, setPhase] = useState(0);
  useEffect(() => { const id = setInterval(() => setPhase(v => (v + 1) % 100000), 90); return () => clearInterval(id); }, []);

  const ctdY = 102 + Math.min(500, Math.max(0, ctdDepth)) / 500 * 190;
  const rovY = 102 + Math.min(500, Math.max(0, rovDepth)) / 500 * 190;
  const vesselShift = Math.sin(phase * .035) * (dpEngaged ? Math.min(3, drift * .6) : Math.min(10, drift));
  const missionLabel = last?.label ? String(last.label) : "Science station established";
  const dpColor = !dpEngaged ? "#E48663" : drift > 4 ? "#F0B55F" : "#72D9A0";

  function Status(props: { label: string; value: string; detail: string; color: string }) {
    return <div style={{ border: "1px solid #1D3442", background: "#07131C", borderRadius: 9, padding: "7px 9px" }}>
      <div style={{ color: "#617887", fontSize: 6.5, letterSpacing: ".12em" }}>{props.label}</div>
      <div style={{ color: props.color, fontSize: 10, fontWeight: 800, marginTop: 2 }}>{props.value}</div>
      <div style={{ color: "#536A77", fontSize: 7, marginTop: 2 }}>{props.detail}</div>
    </div>;
  }

  return <div style={{ padding: 12, minHeight: "100%", background: "linear-gradient(180deg,#07121B,#050B11)", color: "#E8F0F5" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".02em" }}>MISSION OVERVIEW</span>
          <span style={{ border: "1px solid #22445A", background: "#0A1D29", color: "#69CAE9", borderRadius: 999, padding: "2px 7px", fontSize: 7, letterSpacing: ".1em" }}>READ-ONLY SUPERVISORY VIEW</span>
        </div>
        <div style={{ color: "#627887", fontSize: 8, marginTop: 3 }}>RV Aeolus · 42°52′S · four independent edge automations reporting over the event bus</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ color: dpColor, fontSize: 9, fontWeight: 850 }}>{dpEngaged ? (drift > 4 ? "STATION CORRECTION" : "ON STATION") : "DP DISENGAGED"}</div>
        <div style={{ color: "#566B77", fontSize: 7, marginTop: 2 }}>{missionLabel}</div>
      </div>
    </div>

    <div style={{ border: "1px solid #1A3343", borderRadius: 12, overflow: "hidden", background: "#03101A" }}>
      <svg width="100%" height="310" viewBox="0 0 760 310" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="mvOcean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B4360"/><stop offset=".36" stopColor="#082D46"/><stop offset="1" stopColor="#03101B"/></linearGradient>
          <linearGradient id="mvSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0D1F2B"/><stop offset="1" stopColor="#102F42"/></linearGradient>
          <filter id="mvGlow"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect width="760" height="72" fill="url(#mvSky)" />
        <rect y="72" width="760" height="238" fill="url(#mvOcean)" />
        {[0,1,2].map(i => <path key={i} d={"M0 " + (74+i*5) + " C120 " + (68+i*6) + " 220 " + (80+i*3) + " 350 " + (74+i*5) + " S620 " + (68+i*5) + " 760 " + (75+i*4)} fill="none" stroke="#4EA4C1" opacity={.18-i*.04} />)}
        {[100,200,300,400,500].map(d => <g key={d}><line x1="0" y1={102+d/500*190} x2="760" y2={102+d/500*190} stroke="#2B566D" opacity=".15"/><text x="8" y={105+d/500*190} fill="#547689" fontSize="6">{d}m</text></g>)}

        <g transform={"translate(" + (315 + vesselShift) + " 56)"}>
          <path d="M-105 5 L82 5 L65 29 L-75 29 L-113 16 Z" fill="#DCE5E8" stroke="#8799A0" />
          <rect x="-35" y="-20" width="61" height="25" rx="2" fill="#C9D4D8" stroke="#81949B" />
          <rect x="-25" y="-15" width="17" height="7" fill="#24475A"/><rect x="-4" y="-15" width="17" height="7" fill="#24475A"/>
          <line x1="45" y1="5" x2="45" y2="-34" stroke="#9BA9AD"/><line x1="45" y1="-30" x2="72" y2="-12" stroke="#9BA9AD"/>
          <circle cx="-88" cy="16" r="3" fill={dpColor}/><circle cx="69" cy="17" r="3" fill={dpColor}/>
          <text x="-5" y="19" textAnchor="middle" fill="#314750" fontSize="7" fontWeight="800">RV AEOLUS</text>
        </g>

        <line x1={270+vesselShift} y1="72" x2={270+vesselShift} y2={ctdY} stroke="#A4B3B9" strokeWidth="1" />
        {ctdStatus !== "holding" && Array.from({length:4}).map((_,i) => <circle key={i} cx={270+vesselShift} cy={90 + ((phase*2+i*43)%Math.max(30,ctdY-90))} r="1.6" fill="#75DFF7" opacity=".8"/>)}
        <g transform={"translate(" + (270+vesselShift) + " " + ctdY + ")"} filter="url(#mvGlow)"><circle r="9" fill="#E6A94F" stroke="#FFD58B"/><rect x="-6" y="-12" width="12" height="3" rx="1.5" fill="#CAD3D5"/></g>
        <text x={283+vesselShift} y={ctdY+3} fill="#F2C477" fontSize="7">CTD {Math.round(ctdDepth)}m</text>

        <path d={"M365 71 C382 135 399 190 414 " + rovY} fill="none" stroke="#647982" strokeDasharray="4 3" />
        <g transform={"translate(416 " + rovY + ")"}><rect x="-17" y="-8" width="34" height="16" rx="4" fill="#102C3A" stroke="#54D4F0"/><circle cx="-9" cy="0" r="3" fill="#8BEBFF"/><path d="M17 -3 L26 -8 M17 3 L26 8" stroke="#54D4F0"/></g>
        <text x="416" y={rovY+22} textAnchor="middle" fill="#68C9DD" fontSize="7">ROV {Math.round(rovDepth)}m · {rovBattery}%</text>

        <g transform="translate(540 94)">
          <rect width="190" height="158" rx="10" fill="#06131C" stroke="#1B3A4A" />
          <text x="14" y="20" fill="#658090" fontSize="7" letterSpacing="1.1">MISSION SYSTEMS</text>
          <text x="14" y="43" fill={dpColor} fontSize="8" fontWeight="800">DP {dpMode.toUpperCase()}</text><text x="176" y="43" textAnchor="end" fill="#AAB8BE" fontSize="8">{drift.toFixed(1)} m</text>
          <line x1="14" y1="52" x2="176" y2="52" stroke="#18303C" />
          <text x="14" y="72" fill="#F0C36D" fontSize="8" fontWeight="800">CTD {ctdStatus.toUpperCase()}</text><text x="176" y="72" textAnchor="end" fill="#AAB8BE" fontSize="8">{ctdTemp.toFixed(1)}°C · {Math.round(ctdTension)}N</text>
          <line x1="14" y1="81" x2="176" y2="81" stroke="#18303C" />
          <text x="14" y="101" fill="#68D7EC" fontSize="8" fontWeight="800">ROV {rovMode.toUpperCase()}</text><text x="176" y="101" textAnchor="end" fill="#AAB8BE" fontSize="8">tether {Math.round(rovTether)}N</text>
          <line x1="14" y1="110" x2="176" y2="110" stroke="#18303C" />
          <text x="14" y="130" fill={front ? "#A7E6A0" : "#72AFC6"} fontSize="8" fontWeight="800">UNDERWAY {front ? "FRONT" : "STREAM"}</text><text x="176" y="130" textAnchor="end" fill="#AAB8BE" fontSize="8">{sst.toFixed(1)}°C · {flow.toFixed(1)}L/m</text>
          <text x="14" y="149" fill="#506A78" fontSize="6.5">surface current {current.toFixed(1)} kn · heading {Math.round(heading)}°</text>
        </g>
      </svg>
    </div>
  </div>;
}`;

export const missionOverviewAutomation = {
  key: "vessel-mission-overview",
  name: "Mission Overview",
  triggerTopic: "aeolus/events/+/vessel/summary/#",
  scriptSource: logic,
  uiSource: ui,
};
