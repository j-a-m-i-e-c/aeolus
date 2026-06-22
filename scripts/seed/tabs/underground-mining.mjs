// scripts/seed/tabs/underground-mining.mjs — Underground mine operations demo.
//
// Gas safety, ventilation-on-demand, personnel muster, and dewatering — modelled
// on real industry systems (Howden/ABB ventilation, Newtrax/MST tag tracking).

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-mining", name: "Underground Mining", icon: "mountain" };

const devices = [
  { topic: "sensor/mine/gas-l3", payload: { ch4: 0.3, co: 12, o2: 20.8, no2: 1.2 } },
  { topic: "sensor/mine/gas-d7", payload: { ch4: 0.9, co: 28, o2: 20.6, no2: 2.1 } },
  { topic: "switch/mine/primary-fan", payload: { on: true, rpm: 1450, airflow: 280, mode: "auto" } },
  { topic: "switch/mine/booster-fan-l3", payload: { on: true, rpm: 980, airflow: 110 } },
  { topic: "sensor/mine/personnel", payload: { underground: 14, l1: 3, l2: 6, l3: 5 } },
  { topic: "sensor/mine/refuge", payload: { occupancy: 0, capacity: 20, sealed: false, o2: 20.9 } },
  { topic: "sensor/mine/sump-deep", payload: { level: 1.8, flow: 45, on: true } },
  { topic: "sensor/mine/sump-surface", payload: { level: 0.6, flow: 0, on: false } },
];

// ─── Atmospheric Monitoring — multi-gas safety with statutory thresholds ─────
const gasLogic = `automation({
  conditions: [
    function hasGas(context) {
      return context.state && context.state.ch4 !== undefined;
    },
  ],
  actions: [
    function monitor(context) {
      var s = context.state;
      var loc = context.topic.indexOf("d7") >= 0 ? "d7" : "l3";
      state.set(loc + "_ch4", s.ch4);
      state.set(loc + "_co", s.co);
      state.set(loc + "_o2", s.o2);
      state.set(loc + "_no2", s.no2);
      state.set("lastUpdate", Date.now());

      var ch4 = Math.max(state.get("l3_ch4") || 0, state.get("d7_ch4") || 0);
      var co = Math.max(state.get("l3_co") || 0, state.get("d7_co") || 0);
      var o2 = Math.min(state.get("l3_o2") || 21, state.get("d7_o2") || 21);
      var alarm = ch4 >= 1.0 || co >= 30 || o2 < 19.5;
      state.set("alarm", alarm);
      if (alarm) {
        mqtt.publish("switch/mine/primary-fan/command", JSON.stringify({ boost: true }));
        log.warn("Gas alarm — CH4 " + ch4 + "% / CO " + co + "ppm / O2 " + o2 + "%");
      }
    },
  ],
});`;

const gasUi = `import type { CustomComponentProps } from "./types";

export default function AtmosphericMonitoring(aeolus: CustomComponentProps) {
  const alarm = aeolus.read("alarm") as boolean ?? false;
  const locations = [
    { key: "l3", label: "Level 3" },
    { key: "d7", label: "Drift 7" },
  ];
  // gas: [value, warn, danger, max, unit, invert(O2 low is bad)]
  const gasDefs = [
    { k: "ch4", label: "CH₄", warn: 0.5, danger: 1.0, max: 1.5, unit: "%", invert: false, defs: { l3: 0.3, d7: 0.9 } },
    { k: "co", label: "CO", warn: 25, danger: 30, max: 50, unit: "ppm", invert: false, defs: { l3: 12, d7: 28 } },
    { k: "o2", label: "O₂", warn: 19.5, danger: 19.0, max: 21, unit: "%", invert: true, defs: { l3: 20.8, d7: 20.6 } },
    { k: "no2", label: "NO₂", warn: 3, danger: 5, max: 8, unit: "ppm", invert: false, defs: { l3: 1.2, d7: 2.1 } },
  ];

  const Bar = ({ value, def }: { value: number; def: any }) => {
    const pct = Math.max(0, Math.min(100, (value / def.max) * 100));
    const danger = def.invert ? value <= def.danger : value >= def.danger;
    const warn = def.invert ? value <= def.warn : value >= def.warn;
    const color = danger ? "#EF4444" : warn ? "#F59E0B" : "#22C55E";
    return (
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-[#9AA6B2]">{def.label}</span>
          <span className="text-[9px] font-mono font-bold" style={{ color }}>{value}{def.unit}</span>
        </div>
        <div className="h-2 bg-[#1A2330] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: pct + "%", background: color }} />
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">⛏️ Atmospheric Monitoring</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: alarm ? "#EF444420" : "#22C55E20", color: alarm ? "#EF4444" : "#22C55E" }}>
          {alarm ? "⚠ Gas Alarm" : "● Safe"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {locations.map((loc) => (
          <div key={loc.key} className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 space-y-2">
            <div className="text-[10px] font-semibold text-[#E6EDF3] mb-1">{loc.label}</div>
            {gasDefs.map((def) => (
              <Bar key={def.k} value={aeolus.read(loc.key + "_" + def.k) as number ?? def.defs[loc.key]} def={def} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}`;

// ─── Ventilation on Demand ⭐ — fans ramp to gas + crew location ──────────────
const ventLogic = `automation({
  conditions: [
    function hasGas(context) {
      return context.state && context.state.ch4 !== undefined;
    },
  ],
  actions: [
    function ventilate(context) {
      var s = context.state;
      var loc = context.topic.indexOf("d7") >= 0 ? "d7" : "l3";
      state.set(loc + "_ch4", s.ch4);

      var ch4 = Math.max(state.get("l3_ch4") || 0.3, state.get("d7_ch4") || 0.9);
      var demand = Math.min(100, Math.round((ch4 / 1.0) * 100));
      state.set("demand", demand);

      var primaryRpm = 800 + Math.round(demand * 7);
      var boosterRpm = 600 + Math.round(demand * 5);
      state.set("primaryRpm", primaryRpm);
      state.set("boosterRpm", boosterRpm);
      state.set("intakeFlow", Math.round(200 + demand * 1.2));
      state.set("returnFlow", Math.round(180 + demand * 1.1));
      state.set("lastUpdate", Date.now());

      mqtt.publish("switch/mine/primary-fan/command", JSON.stringify({ rpm: primaryRpm }));
      log.info("Ventilation demand " + demand + "% — primary fan " + primaryRpm + " rpm");
    },
  ],
});`;

const ventUi = `import type { CustomComponentProps } from "./types";

export default function VentilationOnDemand(aeolus: CustomComponentProps) {
  const demand = aeolus.read("demand") as number ?? 90;
  const primaryRpm = aeolus.read("primaryRpm") as number ?? 1430;
  const boosterRpm = aeolus.read("boosterRpm") as number ?? 1050;
  const intakeFlow = aeolus.read("intakeFlow") as number ?? 308;
  const returnFlow = aeolus.read("returnFlow") as number ?? 279;

  const flowColor = demand > 70 ? "#F59E0B" : demand > 40 ? "#5CE1E6" : "#3BA4FF";
  // intake (downcast) left shaft, return (upcast) right shaft, 3 levels between
  const levels = [
    { y: 86, label: "L1" },
    { y: 132, label: "L2" },
    { y: 178, label: "L3" },
  ];
  const dots = [0, 1, 2];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌬️ Ventilation on Demand</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: flowColor + "20", color: flowColor }}>
          Demand {demand}%
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="220" viewBox="0 0 280 220" preserveAspectRatio="xMidYMid meet">
          {/* Surface line */}
          <line x1="10" y1="40" x2="270" y2="40" stroke="#2A3441" strokeWidth="1" strokeDasharray="2 2" />
          <text x="14" y="34" fill="#6B7785" fontSize="7">surface</text>

          {/* Downcast (intake) + upcast (return) shafts */}
          <rect x="40" y="40" width="14" height="150" fill="#121821" stroke="#3BA4FF" strokeWidth="1" strokeOpacity="0.4" />
          <rect x="226" y="40" width="14" height="150" fill="#121821" stroke={flowColor} strokeWidth="1" strokeOpacity="0.5" />
          <text x="47" y="205" textAnchor="middle" fill="#3BA4FF" fontSize="7">intake</text>
          <text x="233" y="205" textAnchor="middle" fill={flowColor} fontSize="7">return</text>

          {/* Level tunnels */}
          {levels.map((lv, i) => (
            <g key={lv.label}>
              <line x1="54" y1={lv.y} x2="226" y2={lv.y} stroke="#1A2330" strokeWidth="8" />
              <line x1="54" y1={lv.y} x2="226" y2={lv.y} stroke={flowColor} strokeWidth="1.5" strokeOpacity="0.5" />
              <text x="140" y={lv.y - 6} textAnchor="middle" fill="#6B7785" fontSize="7">{lv.label}</text>
              {dots.map((d) => (
                <circle key={d} cx={70 + d * 55} cy={lv.y} r="2" fill={flowColor} className="animate-pulse" style={{ animationDelay: (i * 0.2 + d * 0.3) + "s" }} />
              ))}
            </g>
          ))}

          {/* Airflow direction arrows: down intake, up return */}
          <polygon points="47,150 43,142 51,142" fill="#3BA4FF" />
          <polygon points="233,80 229,88 237,88" fill={flowColor} />

          {/* Primary fan at return head */}
          <circle cx="233" cy="40" r="11" fill="#1A2330" stroke={flowColor} strokeWidth="1.5" />
          <g transform="translate(233 40)" className="animate-spin" style={{ transformOrigin: "233px 40px" }}>
            <line x1="-7" y1="0" x2="7" y2="0" stroke={flowColor} strokeWidth="1.5" />
            <line x1="0" y1="-7" x2="0" y2="7" stroke={flowColor} strokeWidth="1.5" />
          </g>
          {/* Booster fan at L3 */}
          <circle cx="140" cy="178" r="7" fill="#1A2330" stroke="#F59E0B" strokeWidth="1.2" />
          <text x="140" y="181" textAnchor="middle" fill="#F59E0B" fontSize="7">B</text>
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: flowColor }}>{primaryRpm}</span>
          <span className="text-[7px] text-[#6B7785]">Primary rpm</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#F59E0B]">{boosterRpm}</span>
          <span className="text-[7px] text-[#6B7785]">Booster rpm</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#3BA4FF]">{intakeFlow}</span>
          <span className="text-[7px] text-[#6B7785]">Intake m³/s</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: flowColor }}>{returnFlow}</span>
          <span className="text-[7px] text-[#6B7785]">Return m³/s</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Personnel Muster — tag tracking + refuge muster ─────────────────────────
const musterLogic = `automation({
  conditions: [
    function hasData(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function muster(context) {
      var s = context.state;
      if (s.underground !== undefined) {
        state.set("underground", s.underground);
        state.set("l1", s.l1);
        state.set("l2", s.l2);
        state.set("l3", s.l3);
      }
      if (context.topic && context.topic.indexOf("muster") >= 0) {
        state.set("mustering", true);
        state.set("musterStart", Date.now());
        mqtt.publish("sensor/mine/refuge/command", JSON.stringify({ muster: true }));
        log.warn("MUSTER initiated — all personnel to refuge chamber");
      }
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const musterUi = `import type { CustomComponentProps } from "./types";

export default function PersonnelMuster(aeolus: CustomComponentProps) {
  const underground = aeolus.read("underground") as number ?? 14;
  const l1 = aeolus.read("l1") as number ?? 3;
  const l2 = aeolus.read("l2") as number ?? 6;
  const l3 = aeolus.read("l3") as number ?? 5;
  const mustering = aeolus.read("mustering") as boolean ?? false;

  const levels = [
    { label: "Level 1", count: l1 },
    { label: "Level 2", count: l2 },
    { label: "Level 3", count: l3 },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">👷 Personnel Muster</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: mustering ? "#EF444420" : "#3BA4FF20", color: mustering ? "#EF4444" : "#3BA4FF" }}>
          {mustering ? "⚠ Mustering" : underground + " underground"}
        </span>
      </div>

      <div className="space-y-1.5">
        {levels.map((lv) => (
          <div key={lv.label} className="flex items-center gap-2 bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
            <span className="text-[10px] text-[#9AA6B2] w-16">{lv.label}</span>
            <div className="flex-1 flex gap-1">
              {Array.from({ length: lv.count }).map((_, i) => (
                <span key={i} className="text-[12px]">🧍</span>
              ))}
            </div>
            <span className="text-[11px] font-mono font-bold text-[#E6EDF3]">{lv.count}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
        <span className="text-[10px] text-[#9AA6B2]">Refuge Chamber</span>
        <span className="text-[10px] font-mono text-[#22C55E]">0 / 20</span>
      </div>

      <button
        onClick={() => aeolus.fire("muster", {})}
        className="w-full py-2.5 rounded-lg text-xs font-medium bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30 hover:bg-[#EF4444]/25 transition-all"
      >
        Trigger Emergency Muster
      </button>
    </div>
  );
}`;

// ─── Dewatering Cascade — stage pumps lift water deep→surface ────────────────
const dewaterLogic = `automation({
  conditions: [
    function hasSump(context) {
      return context.state && context.state.level !== undefined;
    },
  ],
  actions: [
    function dewater(context) {
      var s = context.state;
      var which = context.topic.indexOf("surface") >= 0 ? "surface" : "deep";
      state.set(which + "_level", s.level);
      state.set(which + "_flow", s.flow);

      var deepLevel = state.get("deep_level") || 1.8;
      var surfaceLevel = state.get("surface_level") || 0.6;
      var deepPump = deepLevel > 1.5;
      var surfacePump = surfaceLevel > 1.0;
      state.set("deepPump", deepPump);
      state.set("surfacePump", surfacePump);
      state.set("lastUpdate", Date.now());
      if (deepPump) mqtt.publish("switch/mine/sump-deep/command", JSON.stringify({ on: true }));
    },
  ],
});`;

const dewaterUi = `import type { CustomComponentProps } from "./types";

export default function DewateringCascade(aeolus: CustomComponentProps) {
  const deepLevel = aeolus.read("deep_level") as number ?? 1.8;
  const surfaceLevel = aeolus.read("surface_level") as number ?? 0.6;
  const deepFlow = aeolus.read("deep_flow") as number ?? 45;
  const deepPump = aeolus.read("deepPump") as boolean ?? true;
  const surfacePump = aeolus.read("surfacePump") as boolean ?? false;

  const sump = (level: number, max: number, active: boolean) => {
    const pct = Math.min(100, (level / max) * 100);
    const color = pct > 75 ? "#EF4444" : pct > 50 ? "#F59E0B" : "#3BA4FF";
    return { pct, color, active };
  };
  const deep = sump(deepLevel, 2.5, deepPump);
  const surf = sump(surfaceLevel, 2.0, surfacePump);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💧 Dewatering Cascade</div>
        <span className="text-[9px] px-2 py-0.5 rounded bg-[#3BA4FF]/15 text-[#3BA4FF] font-mono">{deepFlow} L/s</span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <svg width="100%" height="190" viewBox="0 0 240 190" preserveAspectRatio="xMidYMid meet">
          {/* Surface discharge */}
          <text x="120" y="14" textAnchor="middle" fill="#6B7785" fontSize="7">surface discharge</text>
          <polygon points="120,18 114,28 126,28" fill={surf.active ? "#22C55E" : "#2A3441"} />

          {/* Surface sump */}
          <rect x="80" y="40" width="80" height="40" rx="4" fill="#121821" stroke={surf.color} strokeWidth="1" strokeOpacity="0.5" />
          <rect x="80" y={80 - (surf.pct / 100) * 40} width="80" height={(surf.pct / 100) * 40} rx="2" fill={surf.color} fillOpacity="0.4" />
          <text x="120" y="64" textAnchor="middle" fill="#E6EDF3" fontSize="9" fontFamily="monospace">{surfaceLevel.toFixed(1)}m</text>
          <text x="166" y="62" fill="#6B7785" fontSize="6">surface sump</text>

          {/* Riser pipe deep→surface */}
          <line x1="120" y1="150" x2="120" y2="80" stroke={deep.active ? "#3BA4FF" : "#2A3441"} strokeWidth="3" strokeLinecap="round" />
          {deep.active && [0, 1, 2].map((d) => (
            <circle key={d} cx="120" cy={135 - d * 22} r="2" fill="#3BA4FF" className="animate-pulse" style={{ animationDelay: (d * 0.3) + "s" }} />
          ))}
          {/* Deep pump */}
          <circle cx="120" cy="150" r="9" fill="#1A2330" stroke={deep.active ? "#3BA4FF" : "#6B7785"} strokeWidth="1.5" />
          <text x="120" y="153" textAnchor="middle" fill={deep.active ? "#3BA4FF" : "#6B7785"} fontSize="8">⚙</text>

          {/* Deep sump */}
          <rect x="80" y="150" width="80" height="34" rx="4" fill="#121821" stroke={deep.color} strokeWidth="1" strokeOpacity="0.5" />
          <rect x="80" y={184 - (deep.pct / 100) * 34} width="80" height={(deep.pct / 100) * 34} rx="2" fill={deep.color} fillOpacity="0.4" />
          <text x="120" y="172" textAnchor="middle" fill="#E6EDF3" fontSize="9" fontFamily="monospace">{deepLevel.toFixed(1)}m</text>
          <text x="166" y="170" fill="#6B7785" fontSize="6">deep sump</text>
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center justify-center gap-1.5 bg-[#0B0F14] rounded-lg border border-[#2A3441] py-2 text-[10px]" style={{ color: deepPump ? "#3BA4FF" : "#6B7785" }}>
          <span className="w-2 h-2 rounded-full" style={{ background: deepPump ? "#3BA4FF" : "#6B7785" }} /> Deep Pump {deepPump ? "ON" : "OFF"}
        </div>
        <div className="flex items-center justify-center gap-1.5 bg-[#0B0F14] rounded-lg border border-[#2A3441] py-2 text-[10px]" style={{ color: surfacePump ? "#22C55E" : "#6B7785" }}>
          <span className="w-2 h-2 rounded-full" style={{ background: surfacePump ? "#22C55E" : "#6B7785" }} /> Surface Pump {surfacePump ? "ON" : "OFF"}
        </div>
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "gas", name: "Atmospheric Monitoring", triggerTopic: "sensor/mine/gas-+", scriptSource: gasLogic, uiSource: gasUi },
  { key: "vent", name: "Ventilation on Demand", triggerTopic: "sensor/mine/gas-+", scriptSource: ventLogic, uiSource: ventUi },
  { key: "muster", name: "Personnel Muster", triggerTopic: "sensor/mine/personnel", scriptSource: musterLogic, uiSource: musterUi },
  { key: "dewater", name: "Dewatering Cascade", triggerTopic: "sensor/mine/sump-+", scriptSource: dewaterLogic, uiSource: dewaterUi },
];

const panes = [
  { kind: "device-grid", x: 0, y: 0, w: 12, h: 5 },
  { kind: "automation", ref: "vent", x: 0, y: 5, w: 6, h: 12 },
  { kind: "automation", ref: "gas", x: 6, y: 5, w: 6, h: 10 },
  { kind: "automation", ref: "muster", x: 0, y: 17, w: 6, h: 10 },
  { kind: "automation", ref: "dewater", x: 6, y: 15, w: 6, h: 11 },
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
        ch4_l3: () => round(0.3 + noise(0.1), 2),
        ch4_d7: (i) => round(0.6 + Math.max(0, Math.sin(i / 10)) * 0.5 + noise(0.1), 2),
        co_d7: () => round(22 + noise(6), 0),
        o2_l3: () => round(20.8 + noise(0.15), 1),
      },
    }),
  },
  {
    name: "dewatering-log",
    description: "Deep sump pump cycles + volume pumped (72h)",
    retentionDays: 90,
    records: genSeries({
      count: 72,
      intervalMs: 3_600_000,
      fields: {
        deepLevel: (i) => round(1.2 + Math.abs(Math.sin(i / 6)) * 0.9 + noise(0.1), 2),
        flow: (i) => (Math.sin(i / 6) > 0 ? round(40 + noise(8), 0) : 0),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
