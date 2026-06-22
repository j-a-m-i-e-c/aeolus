// scripts/seed/tabs/spacecraft.mjs — Satellite / crewed-station operations demo.
//
// Real spacecraft subsystems: life support (ECLSS), power (EPS), attitude
// (ADCS), and ground-station comms (TT&C). A dev could genuinely wire the
// comms pass timeline to SatNOGS / an SDR today.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-spacecraft", name: "Spacecraft", icon: "satellite" };

const devices = [
  { topic: "sensor/spacecraft/atmosphere", payload: { o2: 20.9, co2: 0.4, n2: 78.1, pressure: 101.3 } },
  { topic: "switch/spacecraft/co2-scrubber", payload: { on: true, efficiency: 94 } },
  { topic: "switch/spacecraft/o2-generator", payload: { on: true, rate: 100 } },
  { topic: "sensor/spacecraft/eps", payload: { solar: 12400, battery: 87, load: 9800, voltage: 48.2, inEclipse: false } },
  { topic: "sensor/spacecraft/adcs", payload: { rwX: 2400, rwY: -1800, rwZ: 600, saturation: 38, pointingError: 0.4, locked: true } },
  { topic: "sensor/spacecraft/comms", payload: { station: "Svalbard", signal: -82, queued: 142, nextPassMin: 12, inContact: false } },
];

// ─── Life Support (ECLSS) — atmospheric regulation ───────────────────────────
const eclsLogic = `automation({
  conditions: [
    function hasAtmo(context) {
      return context.state && context.state.o2 !== undefined;
    },
  ],
  actions: [
    function regulate(context) {
      var s = context.state;
      state.set("o2", s.o2);
      state.set("co2", s.co2);
      state.set("n2", s.n2);
      state.set("pressure", s.pressure);
      state.set("lastUpdate", Date.now());

      var o2low = s.o2 < 20.5, o2high = s.o2 > 21.5, co2high = s.co2 > 0.5;
      state.set("o2Status", o2low ? "low" : o2high ? "high" : "nominal");
      state.set("scrubberDemand", co2high ? 100 : 80);
      state.set("genDemand", o2low ? 100 : 70);
      var caution = o2low || o2high || co2high;
      state.set("status", caution ? "caution" : "nominal");

      if (context.topic && context.topic.indexOf("eva-prep") >= 0) {
        state.set("evaPrep", true);
        log.info("EVA prep — pre-breathe protocol engaged");
      }
      if (o2low) mqtt.publish("switch/spacecraft/o2-generator/command", JSON.stringify({ rate: 100 }));
    },
  ],
});`;

const eclsUi = `import type { CustomComponentProps } from "./types";

export default function LifeSupport(aeolus: CustomComponentProps) {
  const o2 = aeolus.read("o2") as number ?? 20.9;
  const co2 = aeolus.read("co2") as number ?? 0.4;
  const n2 = aeolus.read("n2") as number ?? 78.1;
  const pressure = aeolus.read("pressure") as number ?? 101.3;
  const status = aeolus.read("status") as string || "nominal";
  const scrubberDemand = aeolus.read("scrubberDemand") as number ?? 80;
  const evaPrep = aeolus.read("evaPrep") as boolean ?? false;

  const ok = status === "nominal";
  const gases = [
    { label: "N₂", pct: n2, color: "#3BA4FF" },
    { label: "O₂", pct: o2, color: "#22C55E" },
    { label: "CO₂", pct: co2 * 10, color: co2 > 0.5 ? "#EF4444" : "#F59E0B", raw: co2 },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🫁 Life Support</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold capitalize" style={{ backgroundColor: ok ? "#22C55E20" : "#F59E0B20", color: ok ? "#22C55E" : "#F59E0B" }}>
          {status}
        </span>
      </div>

      {/* Atmospheric composition bar */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[10px] text-[#9AA6B2] mb-2">Cabin Atmosphere</div>
        <div className="flex h-6 rounded-lg overflow-hidden">
          <div className="flex items-center justify-center" style={{ width: n2 + "%", background: "#3BA4FF40" }}>
            <span className="text-[8px] text-[#3BA4FF] font-mono">N₂ {n2}%</span>
          </div>
          <div className="flex items-center justify-center" style={{ width: o2 + "%", background: "#22C55E40" }}>
            <span className="text-[8px] text-[#22C55E] font-mono">O₂ {o2}%</span>
          </div>
          <div className="flex items-center justify-center flex-1" style={{ background: "#F59E0B40" }}>
            <span className="text-[8px] text-[#F59E0B] font-mono">CO₂</span>
          </div>
        </div>
        <div className="flex justify-between mt-2 text-[9px] text-[#6B7785]">
          <span>Pressure <span className="text-[#E6EDF3] font-mono">{pressure} kPa</span></span>
          <span>CO₂ <span className="font-mono" style={{ color: co2 > 0.5 ? "#EF4444" : "#22C55E" }}>{co2}%</span></span>
        </div>
      </div>

      <div className="flex items-center justify-between bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
        <span className="text-[10px] text-[#9AA6B2]">CO₂ Scrubber</span>
        <span className="text-[10px] font-mono text-[#5CE1E6]">{scrubberDemand}%</span>
      </div>

      <button
        onClick={() => aeolus.fire("eva-prep", {})}
        className="w-full py-2.5 rounded-lg text-xs font-medium border transition-all"
        style={{ background: evaPrep ? "#5CE1E620" : "#3BA4FF15", color: evaPrep ? "#5CE1E6" : "#3BA4FF", borderColor: "#3BA4FF4D" }}
      >
        {evaPrep ? "EVA Pre-Breathe Active" : "Begin EVA Prep"}
      </button>
    </div>
  );
}`;

// ─── Power System (EPS) — solar/battery budget + load shedding ───────────────
const epsLogic = `automation({
  conditions: [
    function hasPower(context) {
      return context.state && context.state.battery !== undefined;
    },
  ],
  actions: [
    function budget(context) {
      var s = context.state;
      state.set("solar", s.solar);
      state.set("battery", s.battery);
      state.set("load", s.load);
      state.set("inEclipse", s.inEclipse);
      state.set("lastUpdate", Date.now());

      var net = s.solar - s.load;
      state.set("net", net);
      var shed = s.battery < 40 || (s.inEclipse && s.battery < 60);
      state.set("loadShed", shed);

      var capacityWh = 5000;
      var storedWh = capacityWh * (s.battery / 100);
      var hrs = net < 0 ? storedWh / Math.abs(net) : 99;
      state.set("autonomyHrs", Math.round(hrs * 10) / 10);
      if (shed) log.warn("EPS load shed — battery " + s.battery + "%");
    },
  ],
});`;

const epsUi = `import type { CustomComponentProps } from "./types";

export default function PowerSystem(aeolus: CustomComponentProps) {
  const solar = aeolus.read("solar") as number ?? 12400;
  const battery = aeolus.read("battery") as number ?? 87;
  const load = aeolus.read("load") as number ?? 9800;
  const net = aeolus.read("net") as number ?? 2600;
  const inEclipse = aeolus.read("inEclipse") as boolean ?? false;
  const loadShed = aeolus.read("loadShed") as boolean ?? false;
  const autonomyHrs = aeolus.read("autonomyHrs") as number ?? 99;

  const battColor = battery > 60 ? "#22C55E" : battery > 40 ? "#F59E0B" : "#EF4444";
  const charging = net > 0;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">⚡ Power System</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: inEclipse ? "#6B778520" : "#F59E0B20", color: inEclipse ? "#9AA6B2" : "#F59E0B" }}>
          {inEclipse ? "🌑 Eclipse" : "☀ Sunlit"}
        </span>
      </div>

      {/* Flow: solar → battery → loads */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <svg width="100%" height="90" viewBox="0 0 260 90" preserveAspectRatio="xMidYMid meet">
          {/* Solar */}
          <rect x="6" y="30" width="56" height="32" rx="5" fill="#121821" stroke="#F59E0B" strokeWidth="1" />
          <text x="34" y="44" textAnchor="middle" fill="#F59E0B" fontSize="8">☀ Solar</text>
          <text x="34" y="56" textAnchor="middle" fill="#E6EDF3" fontSize="8" fontFamily="monospace">{(solar/1000).toFixed(1)}kW</text>
          {/* Battery */}
          <rect x="102" y="26" width="56" height="40" rx="5" fill="#121821" stroke={battColor} strokeWidth="1" />
          <text x="130" y="40" textAnchor="middle" fill={battColor} fontSize="8">🔋 {battery}%</text>
          <rect x="110" y="48" width="40" height="6" rx="3" fill="#1A2330" />
          <rect x="110" y="48" width={40 * battery / 100} height="6" rx="3" fill={battColor} />
          {/* Loads */}
          <rect x="198" y="30" width="56" height="32" rx="5" fill="#121821" stroke="#5CE1E6" strokeWidth="1" />
          <text x="226" y="44" textAnchor="middle" fill="#5CE1E6" fontSize="8">Loads</text>
          <text x="226" y="56" textAnchor="middle" fill="#E6EDF3" fontSize="8" fontFamily="monospace">{(load/1000).toFixed(1)}kW</text>
          {/* Connectors */}
          <line x1="62" y1="46" x2="102" y2="46" stroke="#F59E0B" strokeWidth="2" />
          <line x1="158" y1="46" x2="198" y2="46" stroke="#5CE1E6" strokeWidth="2" />
          <circle cx="82" cy="46" r="2" fill="#F59E0B" className="animate-pulse" />
          <circle cx="178" cy="46" r="2" fill="#5CE1E6" className="animate-pulse" />
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: charging ? "#22C55E" : "#F59E0B" }}>{charging ? "+" : ""}{(net/1000).toFixed(1)}kW</span>
          <span className="text-[7px] text-[#6B7785]">Net</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#E6EDF3]">{autonomyHrs >= 99 ? "∞" : autonomyHrs + "h"}</span>
          <span className="text-[7px] text-[#6B7785]">Autonomy</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: loadShed ? "#EF4444" : "#22C55E" }}>{loadShed ? "SHED" : "FULL"}</span>
          <span className="text-[7px] text-[#6B7785]">Loads</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Attitude Control (ADCS) — reaction wheels + sun pointing ────────────────
const adcsLogic = `automation({
  conditions: [
    function hasAttitude(context) {
      return context.state && context.state.saturation !== undefined;
    },
  ],
  actions: [
    function attitude(context) {
      var s = context.state;
      state.set("rwX", s.rwX);
      state.set("rwY", s.rwY);
      state.set("rwZ", s.rwZ);
      state.set("saturation", s.saturation);
      state.set("pointingError", s.pointingError);
      state.set("locked", s.locked);
      state.set("lastUpdate", Date.now());

      var desat = s.saturation > 70;
      state.set("desatNeeded", desat);
      state.set("mode", s.locked ? "Sun-Pointing" : "Slewing");
      if (desat) log.warn("Reaction wheels near saturation (" + s.saturation + "%) — schedule desaturation");
    },
  ],
});`;

const adcsUi = `import type { CustomComponentProps } from "./types";

export default function AttitudeControl(aeolus: CustomComponentProps) {
  const rwX = aeolus.read("rwX") as number ?? 2400;
  const rwY = aeolus.read("rwY") as number ?? -1800;
  const rwZ = aeolus.read("rwZ") as number ?? 600;
  const saturation = aeolus.read("saturation") as number ?? 38;
  const pointingError = aeolus.read("pointingError") as number ?? 0.4;
  const locked = aeolus.read("locked") as boolean ?? true;
  const desatNeeded = aeolus.read("desatNeeded") as boolean ?? false;
  const mode = aeolus.read("mode") as string || "Sun-Pointing";

  const wheels = [
    { axis: "X", rpm: rwX, color: "#EF4444" },
    { axis: "Y", rpm: rwY, color: "#22C55E" },
    { axis: "Z", rpm: rwZ, color: "#3BA4FF" },
  ];
  const maxRpm = 6000;
  const Dial = ({ axis, rpm, color }: { axis: string; rpm: number; color: string }) => {
    const frac = Math.max(-1, Math.min(1, rpm / maxRpm));
    const angle = frac * 140;
    return (
      <div className="flex flex-col items-center">
        <svg width="56" height="46" viewBox="0 0 56 46">
          <path d="M8,40 A22,22 0 0 1 48,40" fill="none" stroke="#1A2330" strokeWidth="4" strokeLinecap="round" />
          <g transform={"rotate(" + angle + " 28 40)"}>
            <line x1="28" y1="40" x2="28" y2="20" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <circle cx="28" cy="40" r="2.5" fill={color} />
        </svg>
        <span className="text-[9px] font-mono font-bold" style={{ color }}>{rpm}</span>
        <span className="text-[7px] text-[#6B7785]">RW-{axis} rpm</span>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🛰️ Attitude Control</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: locked ? "#22C55E20" : "#F59E0B20", color: locked ? "#22C55E" : "#F59E0B" }}>
          {mode}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex justify-around">
        {wheels.map((w) => <Dial key={w.axis} {...w} />)}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#5CE1E6]">{pointingError.toFixed(2)}°</span>
          <span className="text-[7px] text-[#6B7785]">Pointing Err</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: saturation > 70 ? "#EF4444" : "#22C55E" }}>{saturation}%</span>
          <span className="text-[7px] text-[#6B7785]">Wheel Sat</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: desatNeeded ? "#F59E0B" : "#22C55E" }}>{desatNeeded ? "DESAT" : "OK"}</span>
          <span className="text-[7px] text-[#6B7785]">Momentum</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Ground Station Comms (TT&C) ⭐ — AOS/LOS pass schedule + downlink queue ──
const commsLogic = `automation({
  conditions: [
    function hasComms(context) {
      return context.state && context.state.signal !== undefined;
    },
  ],
  actions: [
    function comms(context) {
      var s = context.state;
      state.set("station", s.station);
      state.set("signal", s.signal);
      state.set("queued", s.queued);
      state.set("nextPassMin", s.nextPassMin);
      state.set("inContact", s.inContact);
      state.set("lastUpdate", Date.now());

      var quality = s.signal > -80 ? "strong" : s.signal > -95 ? "fair" : "weak";
      state.set("linkQuality", quality);
      state.set("downlinkActive", !!s.inContact);
      if (s.inContact) log.info("Downlinking telemetry — " + s.queued + " frames queued");
    },
  ],
});`;

const commsUi = `import type { CustomComponentProps } from "./types";

export default function GroundStationComms(aeolus: CustomComponentProps) {
  const station = aeolus.read("station") as string || "Svalbard";
  const signal = aeolus.read("signal") as number ?? -82;
  const queued = aeolus.read("queued") as number ?? 142;
  const nextPassMin = aeolus.read("nextPassMin") as number ?? 12;
  const inContact = aeolus.read("inContact") as boolean ?? false;
  const linkQuality = aeolus.read("linkQuality") as string || "fair";

  // Upcoming ground-station passes over the next 120 min
  const passes = [
    { station: "Svalbard", start: nextPassMin, dur: 9, color: "#5CE1E6" },
    { station: "Troll", start: 64, dur: 7, color: "#3BA4FF" },
    { station: "Svalbard", start: 108, dur: 8, color: "#5CE1E6" },
  ];
  const span = 120, x0 = 24, x1 = 252;
  const xOf = (min: number) => x0 + (min / span) * (x1 - x0);
  const qColor = linkQuality === "strong" ? "#22C55E" : linkQuality === "fair" ? "#F59E0B" : "#EF4444";
  // signal -120..-60 dBm → 0..100%
  const sigPct = Math.max(0, Math.min(100, ((signal + 120) / 60) * 100));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">📡 Ground Station Comms</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: inContact ? "#22C55E20" : "#6B778520", color: inContact ? "#22C55E" : "#9AA6B2" }}>
          {inContact ? "● In Contact" : "Next AOS " + nextPassMin + "m"}
        </span>
      </div>

      {/* Pass timeline */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[10px] text-[#9AA6B2] mb-2">Pass Schedule — next {span} min</div>
        <svg width="100%" height="78" viewBox="0 0 270 78" preserveAspectRatio="xMidYMid meet">
          {/* Axis */}
          <line x1={x0} y1="58" x2={x1} y2="58" stroke="#2A3441" strokeWidth="1" />
          {[0, 30, 60, 90, 120].map((m) => (
            <g key={m}>
              <line x1={xOf(m)} y1="55" x2={xOf(m)} y2="61" stroke="#2A3441" strokeWidth="1" />
              <text x={xOf(m)} y="72" textAnchor="middle" fill="#6B7785" fontSize="6">+{m}</text>
            </g>
          ))}
          {/* Pass windows (AOS→LOS) */}
          {passes.map((p, i) => (
            <g key={i}>
              <rect x={xOf(p.start)} y="26" width={xOf(p.start + p.dur) - xOf(p.start)} height="20" rx="3" fill={p.color} fillOpacity="0.25" stroke={p.color} strokeWidth="1" />
              <text x={(xOf(p.start) + xOf(p.start + p.dur)) / 2} y="20" textAnchor="middle" fill={p.color} fontSize="6.5">{p.station}</text>
              <text x={(xOf(p.start) + xOf(p.start + p.dur)) / 2} y="40" textAnchor="middle" fill="#E6EDF3" fontSize="6" fontFamily="monospace">{p.dur}m</text>
            </g>
          ))}
          {/* Now marker */}
          <line x1={x0} y1="20" x2={x0} y2="58" stroke="#22C55E" strokeWidth="1.5" />
          <text x={x0} y="14" textAnchor="middle" fill="#22C55E" fontSize="6">now</text>
        </svg>
      </div>

      {/* Signal + downlink */}
      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-[#9AA6B2]">Signal — {station}</span>
            <span className="text-[10px] font-mono font-bold" style={{ color: qColor }}>{signal} dBm</span>
          </div>
          <div className="h-2 bg-[#1A2330] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: sigPct + "%", background: qColor }} />
          </div>
        </div>
        <div className="flex items-center justify-between bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
          <span className="text-[10px] text-[#9AA6B2]">Downlink Queue</span>
          <span className="text-[10px] font-mono font-bold text-[#5CE1E6]">{queued} frames</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "ecls", name: "Life Support (ECLSS)", triggerTopic: "sensor/spacecraft/atmosphere", scriptSource: eclsLogic, uiSource: eclsUi },
  { key: "eps", name: "Power System (EPS)", triggerTopic: "sensor/spacecraft/eps", scriptSource: epsLogic, uiSource: epsUi },
  { key: "adcs", name: "Attitude Control (ADCS)", triggerTopic: "sensor/spacecraft/adcs", scriptSource: adcsLogic, uiSource: adcsUi },
  { key: "comms", name: "Ground Station Comms", triggerTopic: "sensor/spacecraft/comms", scriptSource: commsLogic, uiSource: commsUi },
];

const panes = [
  { kind: "device-grid", x: 0, y: 0, w: 12, h: 5 },
  { kind: "automation", ref: "comms", x: 0, y: 5, w: 6, h: 11 },
  { kind: "automation", ref: "eps", x: 6, y: 5, w: 6, h: 10 },
  { kind: "automation", ref: "ecls", x: 0, y: 16, w: 6, h: 10 },
  { kind: "automation", ref: "adcs", x: 6, y: 15, w: 6, h: 10 },
];

const dataStore = [
  {
    name: "power-history",
    description: "Solar input vs load + battery SoC across orbits (24h)",
    retentionDays: 30,
    records: genSeries({
      count: 96,
      intervalMs: 15 * 60_000,
      fields: {
        // ~92-min orbit → eclipse dips
        solar: (i) => Math.max(0, Math.round(12000 * Math.max(0, Math.sin(i / 3)) + noise(400))),
        battery: (i) => round(70 + Math.sin(i / 3) * 18 + noise(2), 0),
        load: () => Math.round(9500 + noise(600)),
      },
    }),
  },
  {
    name: "telemetry-downlink",
    description: "Frames downlinked per ground-station pass (3 days)",
    retentionDays: 90,
    records: genSeries({
      count: 30,
      intervalMs: 2.5 * 3_600_000,
      fields: {
        frames: () => Math.round(800 + Math.random() * 1200),
        station: (i) => (i % 2 === 0 ? 1 : 2),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
