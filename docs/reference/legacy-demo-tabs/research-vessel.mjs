// scripts/seed/tabs/research-vessel.mjs — Oceanographic research vessel demo.
//
// Built around the instruments real vessels run: a CTD profiler (the iconic
// ocean instrument), dynamic positioning, underway flow-through monitoring,
// and ROV dive telemetry. See WHY_AEOLUS / spec for connectability notes.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-research-vessel", name: "Research Vessel", icon: "ship" };

// Initial device state (auto-registers via MQTT publish). Multi-field payloads
// become the device's state object, readable as context.state in automations.
const devices = [
  { topic: "sensor/ctd/sonde", payload: { conductivity: 4.21, temperature: 12.1, depth: 120, salinity: 35.1, oxygen: 5.8 } },
  { topic: "switch/vessel/ctd-winch", payload: { on: true, payOut: 120, rate: 0.5, tension: 220 } },
  { topic: "sensor/vessel/gnss", payload: { lat: -42.881, lon: 147.327, heading: 142, sog: 0.2 } },
  { topic: "switch/vessel/bow-thruster", payload: { on: true, thrust: 18, azimuth: 270 } },
  { topic: "switch/vessel/stern-thruster", payload: { on: true, thrust: 12, azimuth: 90 } },
  { topic: "sensor/underway/tsg", payload: { sst: 18.4, salinity: 35.2, flow: 2.1 } },
  { topic: "sensor/underway/fluorometer", payload: { chlorophyll: 1.8 } },
  { topic: "sensor/rov/telemetry", payload: { depth: 340, ambientPressure: 35.1, heading: 88, battery: 76 } },
];

// ─── CTD Profiler ⭐ — depth cast with the classic oceanographic profile plot ──
const ctdLogic = `automation({
  conditions: [
    function hasReading(context) {
      return context.state && context.state.depth !== undefined;
    },
  ],
  actions: [
    function profile(context) {
      var s = context.state;
      state.set("depth", s.depth);
      state.set("temperature", s.temperature);
      state.set("salinity", s.salinity);
      state.set("oxygen", s.oxygen);
      state.set("conductivity", s.conductivity);
      state.set("lastUpdate", Date.now());

      // Water-column model parameters that drive the profile plot.
      state.set("surfaceTemp", 18.5);
      state.set("deepTemp", 4.2);
      state.set("thermocline", 90);
      var phase = s.depth > 5 ? "descending" : "at surface";
      state.set("status", phase);
      log.info("CTD at " + s.depth + "m: " + s.temperature + " degC, " + s.salinity + " PSU");
    },
  ],
});`;

const ctdUi = `import type { CustomComponentProps } from "./types";

export default function CTDProfiler(aeolus: CustomComponentProps) {
  const depth = aeolus.read("depth") as number ?? 120;
  const temperature = aeolus.read("temperature") as number ?? 12.1;
  const salinity = aeolus.read("salinity") as number ?? 35.1;
  const oxygen = aeolus.read("oxygen") as number ?? 5.8;
  const status = aeolus.read("status") as string || "descending";

  const surfaceTemp = 18.5, deepTemp = 4.2, thermocline = 90;
  const surfaceSal = 35.0, deepSal = 34.6, maxDepth = 500;

  // Water-column model: sharp temperature drop through the thermocline.
  const tempAt = (d: number) => surfaceTemp - (surfaceTemp - deepTemp) / (1 + Math.exp(-(d - thermocline) / 18));
  const salAt = (d: number) => surfaceSal - (surfaceSal - deepSal) / (1 + Math.exp(-(d - thermocline) / 40));

  // Plot geometry
  const W = 240, H = 250, padL = 30, padT = 12, padB = 20;
  const plotH = H - padT - padB;
  const plotW = W - padL - 12;
  const tMin = 2, tMax = 20, sMin = 34.4, sMax = 35.2;
  const yOf = (d: number) => padT + (d / maxDepth) * plotH;
  const xTemp = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
  const xSal = (s: number) => padL + ((s - sMin) / (sMax - sMin)) * plotW;

  const samples: number[] = [];
  for (let d = 0; d <= maxDepth; d += 20) samples.push(d);
  const tempPath = samples.map((d, i) => (i === 0 ? "M" : "L") + xTemp(tempAt(d)).toFixed(1) + "," + yOf(d).toFixed(1)).join(" ");
  const salPath = samples.map((d, i) => (i === 0 ? "M" : "L") + xSal(salAt(d)).toFixed(1) + "," + yOf(d).toFixed(1)).join(" ");
  const depthMarks = [0, 100, 200, 300, 400, 500];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌊 CTD Profiler</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#3BA4FF]/15 text-[#3BA4FF] capitalize">{status}</span>
      </div>

      {/* Depth profile plot */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="250" viewBox={"0 0 " + W + " " + H} preserveAspectRatio="xMidYMid meet">
          {/* Depth gridlines + labels */}
          {depthMarks.map((d) => (
            <g key={d}>
              <line x1={padL} y1={yOf(d)} x2={W - 12} y2={yOf(d)} stroke="#1A2330" strokeWidth="0.5" />
              <text x={padL - 4} y={yOf(d) + 3} textAnchor="end" fill="#6B7785" fontSize="7" fontFamily="monospace">{d}</text>
            </g>
          ))}
          <text x={padL - 22} y={padT + plotH / 2} fill="#6B7785" fontSize="7" transform={"rotate(-90 " + (padL - 22) + " " + (padT + plotH / 2) + ")"} textAnchor="middle">Depth (m)</text>

          {/* Temperature curve */}
          <path d={tempPath} fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {/* Salinity curve */}
          <path d={salPath} fill="none" stroke="#5CE1E6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2" />

          {/* Thermocline band */}
          <rect x={padL} y={yOf(thermocline - 25)} width={plotW} height={yOf(thermocline + 25) - yOf(thermocline - 25)} fill="#F59E0B" fillOpacity="0.05" />
          <text x={W - 14} y={yOf(thermocline) - 2} textAnchor="end" fill="#F59E0B" fontSize="6.5" fillOpacity="0.7">thermocline</text>

          {/* Live sonde marker */}
          <line x1={padL} y1={yOf(depth)} x2={W - 12} y2={yOf(depth)} stroke="#22C55E" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={xTemp(temperature)} cy={yOf(depth)} r="3.5" fill="#F59E0B" stroke="#0B0F14" strokeWidth="1" />
          <circle cx={xSal(salinity)} cy={yOf(depth)} r="3.5" fill="#5CE1E6" stroke="#0B0F14" strokeWidth="1" />
          <text x={W - 14} y={yOf(depth) - 3} textAnchor="end" fill="#22C55E" fontSize="7" fontFamily="monospace">{depth}m</text>
        </svg>
      </div>

      {/* Legend + live readouts */}
      <div className="flex items-center gap-3 text-[8px]">
        <span className="flex items-center gap-1 text-[#F59E0B]"><span className="w-3 h-0.5 bg-[#F59E0B] inline-block" /> Temperature</span>
        <span className="flex items-center gap-1 text-[#5CE1E6]"><span className="w-3 h-0.5 bg-[#5CE1E6] inline-block" /> Salinity</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#F59E0B]">{temperature.toFixed(1)}°</span>
          <span className="text-[7px] text-[#6B7785]">Temp</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#5CE1E6]">{salinity.toFixed(2)}</span>
          <span className="text-[7px] text-[#6B7785]">PSU</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#3BA4FF]">{oxygen.toFixed(1)}</span>
          <span className="text-[7px] text-[#6B7785]">O₂ mL/L</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#22C55E]">{depth}</span>
          <span className="text-[7px] text-[#6B7785]">Depth m</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Dynamic Positioning — station-keeping with thruster vectors ─────────────
const dpLogic = `automation({
  conditions: [
    function hasFix(context) {
      return context.state && context.state.lat !== undefined;
    },
  ],
  actions: [
    function hold(context) {
      var s = context.state;
      var lat0 = -42.88103, lon0 = 147.32697;  // target fix
      var offsetN = (s.lat - lat0) * 111000;
      var offsetE = (s.lon - lon0) * 111000 * Math.cos(lat0 * Math.PI / 180);
      var drift = Math.sqrt(offsetN * offsetN + offsetE * offsetE);
      state.set("heading", s.heading);
      state.set("sog", s.sog);
      state.set("offsetN", Math.round(offsetN * 10) / 10);
      state.set("offsetE", Math.round(offsetE * 10) / 10);
      state.set("drift", Math.round(drift * 10) / 10);
      var holding = drift < 5;
      state.set("holding", holding);
      state.set("bowThrust", Math.min(100, Math.round(Math.abs(offsetE) * 8)));
      state.set("sternThrust", Math.min(100, Math.round(Math.abs(offsetN) * 8)));
      state.set("lastUpdate", Date.now());
      if (!holding) {
        mqtt.publish("switch/vessel/bow-thruster/command", JSON.stringify({ on: true }));
        log.warn("DP drift " + drift.toFixed(1) + "m — correcting");
      }
    },
  ],
});`;

const dpUi = `import type { CustomComponentProps } from "./types";

export default function DynamicPositioning(aeolus: CustomComponentProps) {
  const heading = aeolus.read("heading") as number ?? 142;
  const sog = aeolus.read("sog") as number ?? 0.2;
  const offsetN = aeolus.read("offsetN") as number ?? 3.3;
  const offsetE = aeolus.read("offsetE") as number ?? 2.4;
  const drift = aeolus.read("drift") as number ?? 4.1;
  const holding = aeolus.read("holding") as boolean ?? true;
  const bowThrust = aeolus.read("bowThrust") as number ?? 19;
  const sternThrust = aeolus.read("sternThrust") as number ?? 26;

  const cx = 110, cy = 110, mPx = 6;       // 1 metre = 6px
  const vx = cx + offsetE * mPx;            // vessel offset from target
  const vy = cy - offsetN * mPx;
  const statusColor = holding ? "#22C55E" : "#F59E0B";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🧭 Dynamic Positioning</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: statusColor + "20", color: statusColor }}>
          {holding ? "Holding Station" : "Correcting"}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2 flex justify-center">
        <svg width="220" height="220" viewBox="0 0 220 220">
          {/* Watch circles */}
          <circle cx={cx} cy={cy} r={5 * mPx} fill="none" stroke="#22C55E" strokeWidth="0.8" strokeOpacity="0.4" strokeDasharray="3 3" />
          <circle cx={cx} cy={cy} r={10 * mPx} fill="none" stroke="#2A3441" strokeWidth="0.8" />
          <circle cx={cx} cy={cy} r="2" fill="#6B7785" />
          <text x={cx + 5 * mPx + 3} y={cy - 2} fill="#22C55E" fontSize="6" fillOpacity="0.6">5m</text>

          {/* Compass ticks */}
          <text x={cx} y="14" textAnchor="middle" fill="#6B7785" fontSize="7">N</text>

          {/* Vessel hull (pointed bow), rotated to heading */}
          <g transform={"translate(" + vx.toFixed(1) + " " + vy.toFixed(1) + ") rotate(" + heading + ")"}>
            <path d="M0,-26 L9,-10 L9,22 L-9,22 L-9,-10 Z" fill="#1A2330" stroke={statusColor} strokeWidth="1.5" />
            {/* Bow thruster arrow (athwartships) */}
            <line x1="0" y1="-14" x2={bowThrust / 6} y2="-14" stroke="#3BA4FF" strokeWidth="2.5" strokeLinecap="round" />
            {/* Stern thruster arrow */}
            <line x1="0" y1="16" x2={-sternThrust / 6} y2="16" stroke="#3BA4FF" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#E6EDF3]">{heading}°</span>
          <span className="text-[7px] text-[#6B7785]">Heading</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#E6EDF3]">{sog.toFixed(1)}</span>
          <span className="text-[7px] text-[#6B7785]">SOG kn</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: statusColor }}>{drift.toFixed(1)}m</span>
          <span className="text-[7px] text-[#6B7785]">Drift</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#3BA4FF]">{bowThrust}%</span>
          <span className="text-[7px] text-[#6B7785]">Bow Thr</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Underway Seawater — continuous flow-through monitoring ──────────────────
const underwayLogic = `automation({
  conditions: [
    function hasReading(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function track(context) {
      var s = context.state;
      if (s.sst !== undefined) {
        state.set("sst", s.sst);
        state.set("salinity", s.salinity);
        state.set("flow", s.flow);
      }
      if (s.chlorophyll !== undefined) state.set("chlorophyll", s.chlorophyll);
      state.set("lastUpdate", Date.now());
      var chl = state.get("chlorophyll") || 0;
      state.set("frontDetected", chl > 3);
    },
  ],
});`;

const underwayUi = `import type { CustomComponentProps } from "./types";

export default function UnderwaySeawater(aeolus: CustomComponentProps) {
  const sst = aeolus.read("sst") as number ?? 18.4;
  const salinity = aeolus.read("salinity") as number ?? 35.2;
  const chlorophyll = aeolus.read("chlorophyll") as number ?? 1.8;
  const flow = aeolus.read("flow") as number ?? 2.1;
  const frontDetected = aeolus.read("frontDetected") as boolean ?? false;

  // Deterministic trailing series for the strip charts (cosmetic; the real
  // time-series lives in the underway-seawater Data Store collection).
  const series = (base: number, amp: number, freq: number) => {
    const pts: number[] = [];
    for (let i = 0; i < 40; i++) pts.push(base + Math.sin(i * freq) * amp + Math.sin(i * 0.7) * amp * 0.3);
    pts[39] = base;
    return pts;
  };
  const spark = (pts: number[], color: string) => {
    const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
    const path = pts.map((v, i) => (i === 0 ? "M" : "L") + (i / 39 * 100).toFixed(1) + "," + (20 - ((v - min) / range) * 18).toFixed(1)).join(" ");
    return (
      <svg width="100%" height="22" viewBox="0 0 100 22" preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  };

  const rows = [
    { label: "Sea Surface Temp", value: sst.toFixed(1) + " °C", color: "#F59E0B", pts: series(sst, 0.4, 0.5) },
    { label: "Salinity", value: salinity.toFixed(2) + " PSU", color: "#5CE1E6", pts: series(salinity, 0.06, 0.3) },
    { label: "Chlorophyll-a", value: chlorophyll.toFixed(1) + " µg/L", color: "#22C55E", pts: series(chlorophyll, 0.5, 0.8) },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🚰 Underway Seawater</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#3BA4FF]/15 text-[#3BA4FF] font-mono">{flow.toFixed(1)} L/min</span>
          {frontDetected && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] font-mono animate-pulse">Front!</span>}
        </div>
      </div>

      {rows.map((r) => (
        <div key={r.label} className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[#9AA6B2]">{r.label}</span>
            <span className="text-[11px] font-mono font-bold" style={{ color: r.color }}>{r.value}</span>
          </div>
          {spark(r.pts, r.color)}
        </div>
      ))}
    </div>
  );
}`;

// ─── ROV Dive Telemetry — depth ladder + attitude for a launched ROV ─────────
const rovLogic = `automation({
  conditions: [
    function hasTelemetry(context) {
      return context.state && context.state.depth !== undefined;
    },
  ],
  actions: [
    function telemetry(context) {
      var s = context.state;
      state.set("depth", s.depth);
      state.set("ambientPressure", s.ambientPressure);
      state.set("heading", s.heading);
      state.set("battery", s.battery);
      state.set("lastUpdate", Date.now());
      state.set("lowBattery", s.battery < 25);
      var zone = s.depth < 200 ? "Epipelagic" : s.depth < 1000 ? "Mesopelagic" : "Bathypelagic";
      state.set("zone", zone);
      if (s.battery < 25) log.warn("ROV battery low: " + s.battery + "%");
    },
  ],
});`;

const rovUi = `import type { CustomComponentProps } from "./types";

export default function RovTelemetry(aeolus: CustomComponentProps) {
  const depth = aeolus.read("depth") as number ?? 340;
  const ambientPressure = aeolus.read("ambientPressure") as number ?? 35.1;
  const heading = aeolus.read("heading") as number ?? 88;
  const battery = aeolus.read("battery") as number ?? 76;
  const zone = aeolus.read("zone") as string || "Mesopelagic";
  const lowBattery = aeolus.read("lowBattery") as boolean ?? false;

  const maxDepth = 1000, ladderH = 200, padT = 10;
  const yOf = (d: number) => padT + (d / maxDepth) * ladderH;
  const marks = [0, 200, 400, 600, 800, 1000];
  const battColor = battery > 50 ? "#22C55E" : battery > 25 ? "#F59E0B" : "#EF4444";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🤿 ROV Dive Telemetry</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#3BA4FF]/15 text-[#3BA4FF]">{zone}</span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex gap-4">
        {/* Depth ladder */}
        <svg width="90" height="225" viewBox="0 0 90 225">
          <line x1="34" y1={padT} x2="34" y2={padT + ladderH} stroke="#2A3441" strokeWidth="1.5" />
          {marks.map((d) => (
            <g key={d}>
              <line x1="30" y1={yOf(d)} x2="38" y2={yOf(d)} stroke="#2A3441" strokeWidth="1" />
              <text x="26" y={yOf(d) + 3} textAnchor="end" fill="#6B7785" fontSize="7" fontFamily="monospace">{d}</text>
            </g>
          ))}
          {/* ROV marker */}
          <g transform={"translate(34 " + yOf(depth).toFixed(1) + ")"}>
            <rect x="4" y="-6" width="34" height="12" rx="3" fill="#1A2330" stroke="#5CE1E6" strokeWidth="1.5" />
            <circle cx="10" cy="0" r="1.5" fill="#5CE1E6" />
            <text x="44" y="3" fill="#5CE1E6" fontSize="9" fontFamily="monospace" fontWeight="bold">{depth}m</text>
          </g>
        </svg>

        {/* Right column: heading compass + battery */}
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <svg width="56" height="56" viewBox="0 0 56 56">
              <circle cx="28" cy="28" r="24" fill="none" stroke="#2A3441" strokeWidth="1.5" />
              <text x="28" y="11" textAnchor="middle" fill="#6B7785" fontSize="6">N</text>
              <g transform={"rotate(" + heading + " 28 28)"}>
                <polygon points="28,8 24,30 32,30" fill="#5CE1E6" />
              </g>
              <circle cx="28" cy="28" r="2.5" fill="#5CE1E6" />
            </svg>
            <div>
              <div className="text-[11px] font-mono font-bold text-[#E6EDF3]">{heading}°</div>
              <div className="text-[8px] text-[#6B7785]">Heading</div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-[#9AA6B2]">Battery</span>
              <span className="text-[10px] font-mono font-bold" style={{ color: battColor }}>{battery}%{lowBattery ? " ⚠" : ""}</span>
            </div>
            <div className="h-2.5 bg-[#1A2330] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: battery + "%", background: battColor }} />
            </div>
          </div>

          <div className="bg-[#121821] rounded-lg p-2">
            <div className="text-[8px] text-[#6B7785]">Ambient Pressure</div>
            <div className="text-[12px] font-mono font-bold text-[#E6EDF3]">{ambientPressure.toFixed(1)} <span className="text-[8px] text-[#6B7785]">bar</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "ctd", name: "CTD Profiler", triggerTopic: "sensor/ctd/sonde", scriptSource: ctdLogic, uiSource: ctdUi },
  { key: "dp", name: "Dynamic Positioning", triggerTopic: "sensor/vessel/gnss", scriptSource: dpLogic, uiSource: dpUi },
  { key: "underway", name: "Underway Seawater", triggerTopic: "sensor/underway/+", scriptSource: underwayLogic, uiSource: underwayUi },
  { key: "rov", name: "ROV Dive Telemetry", triggerTopic: "sensor/rov/telemetry", scriptSource: rovLogic, uiSource: rovUi },
];

const panes = [
  { kind: "automation", ref: "ctd", x: 0, y: 0, w: 6, h: 12 },
  { kind: "automation", ref: "dp", x: 6, y: 0, w: 6, h: 12 },
  { kind: "automation", ref: "underway", x: 0, y: 12, w: 6, h: 11 },
  { kind: "automation", ref: "rov", x: 6, y: 12, w: 6, h: 10 },
];

const dataStore = [
  {
    name: "underway-seawater",
    description: "Continuous flow-through thermosalinograph + fluorometer (24h)",
    retentionDays: 30,
    records: genSeries({
      count: 144,
      intervalMs: 10 * 60_000,
      fields: {
        sst: (i) => round(18.4 + Math.sin(i / 12) * 0.6 + noise(0.15), 2),
        salinity: (i) => round(35.2 + Math.sin(i / 20) * 0.04 + noise(0.01), 3),
        chlorophyll: (i) => round(1.8 + Math.max(0, Math.sin(i / 8)) * 0.8 + noise(0.2), 2),
      },
    }),
  },
  {
    name: "ctd-casts",
    description: "CTD cast summaries (last 3 days)",
    retentionDays: 365,
    records: genSeries({
      count: 12,
      intervalMs: 6 * 3_600_000,
      end: Date.now(),
      fields: {
        maxDepth: () => Math.round(400 + Math.random() * 200),
        surfaceTemp: () => round(18 + noise(1), 1),
        bottomTemp: () => round(4 + noise(0.5), 1),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
