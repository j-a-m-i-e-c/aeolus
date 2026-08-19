const logic = `automation({
  actions: [
    function vesselMissionOverview(context) {
      function init(name, value) { if (state.get(name) === undefined) state.set(name, value); }
      init("ctdDepth", 120); init("ctdStatus", "holding"); init("ctdTemperature", 12.1); init("ctdSalinity", 35.1); init("ctdOxygen", 5.8); init("ctdTension", 220);
      init("rovDepth", 310); init("rovMode", "holding"); init("rovBattery", 78); init("rovTether", 310); init("rovHeading", 88); init("rovAltitude", 8.2);
      init("tsgPumpOn", true); init("tsgFlow", 2.1); init("sst", 18.4); init("surfaceSalinity", 35.2); init("chlorophyll", .8); init("frontDetected", false);
      init("lastMissionEvent", { label: "Science systems online", at: Date.now() });

      var topic = String(context.topic || "");
      var s = context.state && typeof context.state === "object" ? context.state : {};
      function copy(name) { if (s[name] !== undefined) state.set(name, s[name]); }

      if (topic.indexOf("/vessel/summary/ctd") >= 0) {
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
  const ctdDepth = Number(aeolus.read("ctdDepth") ?? 120);
  const ctdStatus = String(aeolus.read("ctdStatus") || "holding");
  const ctdTemp = Number(aeolus.read("ctdTemperature") ?? 12.1);
  const ctdSalinity = Number(aeolus.read("ctdSalinity") ?? 35.1);
  const ctdTension = Number(aeolus.read("ctdTension") ?? 220);
  const rovDepth = Number(aeolus.read("rovDepth") ?? 310);
  const rovMode = String(aeolus.read("rovMode") || "holding");
  const rovBattery = Number(aeolus.read("rovBattery") ?? 78);
  const rovTether = Number(aeolus.read("rovTether") ?? 310);
  const flow = Number(aeolus.read("tsgFlow") ?? 2.1);
  const sst = Number(aeolus.read("sst") ?? 18.4);
  const surfaceSalinity = Number(aeolus.read("surfaceSalinity") ?? 35.2);
  const chlorophyll = Number(aeolus.read("chlorophyll") ?? .8);
  const front = Boolean(aeolus.read("frontDetected"));
  const last = aeolus.read("lastMissionEvent") as any;
  const [phase, setPhase] = useState(0);
  useEffect(() => { const id = setInterval(() => setPhase(v => (v + 1) % 100000), 90); return () => clearInterval(id); }, []);

  const ctdY = 102 + Math.min(500, Math.max(0, ctdDepth)) / 500 * 190;
  const rovY = 102 + Math.min(500, Math.max(0, rovDepth)) / 500 * 190;
  const bob = Math.sin(phase * .045) * 1.8;
  const missionLabel = last?.label ? String(last.label) : "Science systems online";

  return <div style={{ padding: 14, minHeight: "100%", background: "linear-gradient(180deg,#07121B,#050B11)", color: "#E8F0F5" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 14 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: ".02em" }}>MISSION OVERVIEW</span>
          <span style={{ border: "1px solid #22445A", background: "#0A1D29", color: "#69CAE9", borderRadius: 999, padding: "3px 8px", fontSize: 11, letterSpacing: ".08em" }}>READ-ONLY SUPERVISORY VIEW</span>
        </div>
        <div style={{ color: "#7990A0", fontSize: 12, marginTop: 4 }}>RV Aeolus · CTD profiling · deep ROV · underway oceanography</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 210 }}>
        <div style={{ color: front ? "#9BE2A2" : "#7DD3EA", fontSize: 12, fontWeight: 850 }}>{front ? "HYDROGRAPHIC FRONT" : "SCIENCE STATION ACTIVE"}</div>
        <div style={{ color: "#6F8490", fontSize: 11, marginTop: 3 }}>{missionLabel}</div>
      </div>
    </div>

    <div style={{ border: "1px solid #1A3343", borderRadius: 14, overflow: "hidden", background: "#03101A" }}>
      <svg width="100%" height="330" viewBox="0 0 760 310" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="mvOcean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B4360"/><stop offset=".36" stopColor="#082D46"/><stop offset="1" stopColor="#03101B"/></linearGradient>
          <linearGradient id="mvSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0D1F2B"/><stop offset="1" stopColor="#102F42"/></linearGradient>
          <filter id="mvGlow"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect width="760" height="72" fill="url(#mvSky)" />
        <rect y="72" width="760" height="238" fill="url(#mvOcean)" />
        {[0,1,2].map(i => <path key={i} d={"M0 " + (74+i*5) + " C120 " + (68+i*6) + " 220 " + (80+i*3) + " 350 " + (74+i*5) + " S620 " + (68+i*5) + " 760 " + (75+i*4)} fill="none" stroke="#4EA4C1" opacity={.18-i*.04} />)}
        {[100,200,300,400,500].map(d => <g key={d}><line x1="0" y1={102+d/500*190} x2="760" y2={102+d/500*190} stroke="#2B566D" opacity=".15"/><text x="8" y={106+d/500*190} fill="#6D8A9B" fontSize="10">{d}m</text></g>)}

        <g transform={"translate(315 " + (56 + bob) + ")"}>
          <path d="M-105 5 L82 5 L65 29 L-75 29 L-113 16 Z" fill="#DCE5E8" stroke="#8799A0" />
          <rect x="-35" y="-20" width="61" height="25" rx="2" fill="#C9D4D8" stroke="#81949B" />
          <rect x="-25" y="-15" width="17" height="7" fill="#24475A"/><rect x="-4" y="-15" width="17" height="7" fill="#24475A"/>
          <line x1="45" y1="5" x2="45" y2="-34" stroke="#9BA9AD"/><line x1="45" y1="-30" x2="72" y2="-12" stroke="#9BA9AD"/>
          <text x="-5" y="19" textAnchor="middle" fill="#314750" fontSize="10" fontWeight="800">RV AEOLUS</text>
        </g>

        <line x1="270" y1="72" x2="270" y2={ctdY} stroke="#A4B3B9" strokeWidth="1.1" />
        {ctdStatus !== "holding" && Array.from({length:4}).map((_,i) => <circle key={i} cx="270" cy={90 + ((phase*2+i*43)%Math.max(30,ctdY-90))} r="1.8" fill="#75DFF7" opacity=".8"/>)}
        <g transform={"translate(270 " + ctdY + ")"} filter="url(#mvGlow)"><circle r="9" fill="#E6A94F" stroke="#FFD58B"/><rect x="-6" y="-12" width="12" height="3" rx="1.5" fill="#CAD3D5"/></g>
        <text x="284" y={ctdY+4} fill="#F2C477" fontSize="10">CTD {Math.round(ctdDepth)}m</text>

        <path d={"M365 71 C382 135 399 190 414 " + rovY} fill="none" stroke="#647982" strokeDasharray="4 3" />
        <g transform={"translate(416 " + rovY + ")"}><rect x="-17" y="-8" width="34" height="16" rx="4" fill="#102C3A" stroke="#54D4F0"/><circle cx="-9" cy="0" r="3" fill="#8BEBFF"/><path d="M17 -3 L26 -8 M17 3 L26 8" stroke="#54D4F0"/></g>
        <text x="416" y={rovY+23} textAnchor="middle" fill="#78D7E9" fontSize="10">ROV {Math.round(rovDepth)}m · {rovBattery}%</text>

        <g transform="translate(540 94)">
          <rect width="190" height="158" rx="10" fill="#06131C" stroke="#1B3A4A" />
          <text x="14" y="21" fill="#7894A4" fontSize="10" letterSpacing="1.1">SCIENCE SYSTEMS</text>
          <text x="14" y="50" fill="#F0C36D" fontSize="11" fontWeight="800">CTD {ctdStatus.toUpperCase()}</text><text x="176" y="50" textAnchor="end" fill="#B8C4CA" fontSize="10">{ctdTemp.toFixed(1)}°C · {Math.round(ctdTension)}N</text>
          <line x1="14" y1="61" x2="176" y2="61" stroke="#18303C" />
          <text x="14" y="85" fill="#68D7EC" fontSize="11" fontWeight="800">ROV {rovMode.toUpperCase()}</text><text x="176" y="85" textAnchor="end" fill="#B8C4CA" fontSize="10">tether {Math.round(rovTether)}N</text>
          <line x1="14" y1="96" x2="176" y2="96" stroke="#18303C" />
          <text x="14" y="120" fill={front ? "#A7E6A0" : "#72AFC6"} fontSize="11" fontWeight="800">UNDERWAY {front ? "FRONT" : "STREAM"}</text><text x="176" y="120" textAnchor="end" fill="#B8C4CA" fontSize="10">{sst.toFixed(1)}°C · {flow.toFixed(1)}L/m</text>
          <text x="14" y="143" fill="#6D8795" fontSize="10">SSS {surfaceSalinity.toFixed(2)} · Chl {chlorophyll.toFixed(1)} mg/m³</text>
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
