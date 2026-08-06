// scripts/seed/tabs/off-grid-bunker.mjs — Off-grid survival bunker demo.
//
// The "zombie apocalypse" framing is flavour — every system is a legit off-grid
// concern (generator telemetry, NBC overpressure filtration, supply burn-down,
// Meshtastic-style comms are all genuinely connectable).

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-bunker", name: "Off-Grid Bunker", icon: "shield" };

const devices = [
  { topic: "sensor/bunker/perimeter-north", payload: { motion: false } },
  { topic: "sensor/bunker/perimeter-east", payload: { motion: true } },
  { topic: "sensor/bunker/perimeter-south", payload: { motion: false } },
  { topic: "sensor/bunker/perimeter-west", payload: { motion: false } },
  { topic: "light/bunker/floodlights", payload: { on: true, brightness: 100, mode: "motion-activated" } },
  { topic: "sensor/bunker/generator", payload: { on: true, fuel: 62, co: 8 } },
  { topic: "sensor/bunker/power", payload: { solar: 1800, battery: 74, load: 1200 } },
  { topic: "switch/bunker/nbc-filter", payload: { overpressure: 12, filterLife: 78, sealed: false } },
  { topic: "sensor/bunker/supplies", payload: { food: 64, water: 80, meds: 45, ammo: 90 } },
  { topic: "sensor/bunker/radio", payload: { frequency: 146.52, contacts: 3 } },
];

// ─── Perimeter Defence — motion sensors trigger floodlights + breach log ─────
const perimeterLogic = `automation({
  conditions: [
    function hasSensor(context) {
      return context.state && context.state.motion !== undefined;
    },
  ],
  actions: [
    function perimeter(context) {
      var topic = context.topic || "";
      var s = context.state;
      var sector = topic.indexOf("north") >= 0 ? "north" : topic.indexOf("east") >= 0 ? "east" : topic.indexOf("south") >= 0 ? "south" : "west";
      state.set(sector, s.motion);
      if (s.motion) {
        state.set("lastBreach", sector);
        state.set("lastBreachAt", Date.now());
        mqtt.publish("light/bunker/floodlights/command", JSON.stringify({ on: true }));
        log.warn("Perimeter breach — " + sector + " sector");
      }
      var sectors = ["north", "east", "south", "west"];
      var active = 0;
      for (var i = 0; i < sectors.length; i++) if (state.get(sectors[i])) active++;
      state.set("activeBreaches", active);
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const perimeterUi = `import type { CustomComponentProps } from "./types";

export default function PerimeterDefence(aeolus: CustomComponentProps) {
  const north = aeolus.read("north") as boolean ?? false;
  const east = aeolus.read("east") as boolean ?? true;
  const south = aeolus.read("south") as boolean ?? false;
  const west = aeolus.read("west") as boolean ?? false;
  const lastBreach = aeolus.read("lastBreach") as string || "east";
  const activeBreaches = aeolus.read("activeBreaches") as number ?? 1;

  const sectors = [
    { key: "north", breach: north, x: 90, y: 18, w: 60, h: 28 },
    { key: "east", breach: east, x: 158, y: 56, w: 28, h: 60 },
    { key: "south", breach: south, x: 90, y: 126, w: 60, h: 28 },
    { key: "west", breach: west, x: 54, y: 56, w: 28, h: 60 },
  ];
  const col = (b: boolean) => (b ? "#EF4444" : "#22C55E");

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🛡️ Perimeter Defence</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: activeBreaches > 0 ? "#EF444420" : "#22C55E20", color: activeBreaches > 0 ? "#EF4444" : "#22C55E" }}>
          {activeBreaches > 0 ? activeBreaches + " breach" : "Secure"}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2 flex justify-center">
        <svg width="200" height="172" viewBox="0 0 240 172">
          {/* Bunker core */}
          <rect x="92" y="58" width="56" height="56" rx="6" fill="#1A2330" stroke="#5CE1E6" strokeWidth="1.5" />
          <text x="120" y="90" textAnchor="middle" fill="#5CE1E6" fontSize="9">BUNKER</text>
          {/* Sector zones */}
          {sectors.map((s) => (
            <g key={s.key}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="4" fill={col(s.breach) + "15"} stroke={col(s.breach)} strokeWidth="1.5" className="transition-all duration-500" />
              <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 3} textAnchor="middle" fill={col(s.breach)} fontSize="7" className="uppercase">{s.key}</text>
              {s.breach && <circle cx={s.x + s.w / 2} cy={s.y + 6} r="2.5" fill="#EF4444" className="animate-pulse" />}
            </g>
          ))}
        </svg>
      </div>

      <div className="flex items-center justify-between bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
        <span className="text-[10px] text-[#9AA6B2]">Last breach</span>
        <span className="text-[10px] font-mono capitalize" style={{ color: activeBreaches > 0 ? "#EF4444" : "#6B7785" }}>{lastBreach} sector</span>
      </div>
    </div>
  );
}`;

// ─── Off-Grid Power ⭐ — generator + solar + battery, days-of-power ───────────
const powerLogic = `automation({
  conditions: [
    function hasPower(context) {
      return context.state && (context.state.fuel !== undefined || context.state.battery !== undefined);
    },
  ],
  actions: [
    function power(context) {
      var s = context.state;
      if (s.fuel !== undefined) { state.set("fuel", s.fuel); state.set("co", s.co); }
      if (s.battery !== undefined) { state.set("solar", s.solar); state.set("battery", s.battery); state.set("load", s.load); }

      var fuel = state.get("fuel") || 62;
      var battery = state.get("battery") || 74;
      var solar = state.get("solar") || 1800;
      var load = state.get("load") || 1200;

      // 100% fuel = 200 L tank; generator burns ~2 L/h
      var fuelHours = (fuel / 100 * 200) / 2;
      state.set("fuelHours", Math.round(fuelHours));
      state.set("daysOfPower", Math.round(fuelHours / 24 * 10) / 10);
      state.set("net", solar - load);
      state.set("loadShed", battery < 30);
      state.set("coWarn", (state.get("co") || 0) > 50);
      state.set("lastUpdate", Date.now());
      if (battery < 30) log.warn("Bunker battery low — shedding non-essential loads");
    },
  ],
});`;

const powerUi = `import type { CustomComponentProps } from "./types";

export default function OffGridPower(aeolus: CustomComponentProps) {
  const fuel = aeolus.read("fuel") as number ?? 62;
  const battery = aeolus.read("battery") as number ?? 74;
  const solar = aeolus.read("solar") as number ?? 1800;
  const load = aeolus.read("load") as number ?? 1200;
  const daysOfPower = aeolus.read("daysOfPower") as number ?? 2.5;
  const net = aeolus.read("net") as number ?? 600;
  const loadShed = aeolus.read("loadShed") as boolean ?? false;
  const coWarn = aeolus.read("coWarn") as boolean ?? false;

  const fuelColor = fuel > 50 ? "#22C55E" : fuel > 25 ? "#F59E0B" : "#EF4444";
  const battColor = battery > 50 ? "#22C55E" : battery > 30 ? "#F59E0B" : "#EF4444";
  const fuelFill = (fuel / 100) * 70;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🔌 Off-Grid Power</div>
        {coWarn
          ? <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#EF4444]/20 text-[#EF4444] animate-pulse">⚠ CO High</span>
          : <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#22C55E]/20 text-[#22C55E]">Generator OK</span>}
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex items-center gap-4">
        {/* Fuel tank */}
        <svg width="64" height="90" viewBox="0 0 64 90">
          <rect x="14" y="12" width="36" height="74" rx="6" fill="#121821" stroke={fuelColor} strokeWidth="1.5" strokeOpacity="0.5" />
          <rect x="14" y={86 - fuelFill} width="36" height={fuelFill} rx="3" fill={fuelColor} fillOpacity="0.45" className="transition-all duration-700" />
          <text x="32" y="52" textAnchor="middle" fill="#E6EDF3" fontSize="11" fontFamily="monospace" fontWeight="bold">{fuel}%</text>
          <text x="32" y="64" textAnchor="middle" fill="#6B7785" fontSize="6">diesel</text>
        </svg>

        {/* Days of power */}
        <div className="flex-1 text-center">
          <div className="text-4xl font-mono font-bold" style={{ color: fuelColor }}>{daysOfPower}</div>
          <div className="text-[9px] text-[#6B7785] mt-1">days of power remaining</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#F59E0B]">{solar}W</span>
          <span className="text-[7px] text-[#6B7785]">Solar</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: battColor }}>{battery}%</span>
          <span className="text-[7px] text-[#6B7785]">Battery</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: loadShed ? "#EF4444" : "#5CE1E6" }}>{load}W</span>
          <span className="text-[7px] text-[#6B7785]">{loadShed ? "Shedding" : "Load"}</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Air Filtration (NBC) — positive overpressure + filter life ──────────────
const nbcLogic = `automation({
  conditions: [
    function ready(context) {
      return true;
    },
  ],
  actions: [
    function nbc(context) {
      var s = context.state || {};
      var t = context.topic || "";
      if (s.overpressure !== undefined) {
        state.set("overpressure", s.overpressure);
        state.set("filterLife", s.filterLife);
        state.set("sealed", s.sealed);
      }
      if (t.indexOf("seal") >= 0) {
        var sealed = !state.get("sealed");
        state.set("sealed", sealed);
        mqtt.publish("switch/bunker/nbc-filter/command", JSON.stringify({ sealed: sealed }));
        log.warn(sealed ? "Bunker SEALED — NBC mode" : "Bunker unsealed");
      }
      var op = state.get("overpressure") || 12;
      state.set("positivePressure", op >= 5);
      state.set("filterLow", (state.get("filterLife") || 78) < 20);
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const nbcUi = `import type { CustomComponentProps } from "./types";

export default function AirFiltration(aeolus: CustomComponentProps) {
  const overpressure = aeolus.read("overpressure") as number ?? 12;
  const filterLife = aeolus.read("filterLife") as number ?? 78;
  const sealed = aeolus.read("sealed") as boolean ?? false;
  const positivePressure = aeolus.read("positivePressure") as boolean ?? true;
  const filterLow = aeolus.read("filterLow") as boolean ?? false;

  const r = 26, circ = 2 * Math.PI * r;
  const filterColor = filterLife > 50 ? "#22C55E" : filterLife > 20 ? "#F59E0B" : "#EF4444";
  const dash = (filterLife / 100) * circ;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">☣️ Air Filtration (NBC)</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: positivePressure ? "#22C55E20" : "#EF444420", color: positivePressure ? "#22C55E" : "#EF4444" }}>
          {positivePressure ? "+" + overpressure + " Pa" : "Pressure Low"}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex items-center gap-4">
        {/* Airflow schematic */}
        <svg width="120" height="70" viewBox="0 0 120 70">
          <text x="14" y="30" textAnchor="middle" fill="#6B7785" fontSize="6">outside</text>
          <line x1="4" y1="40" x2="34" y2="40" stroke="#6B7785" strokeWidth="2" />
          <polygon points="34,40 28,36 28,44" fill="#6B7785" />
          {/* Filter box */}
          <rect x="36" y="28" width="26" height="24" rx="3" fill="#121821" stroke={filterColor} strokeWidth="1.5" />
          <text x="49" y="43" textAnchor="middle" fill={filterColor} fontSize="6">HEPA</text>
          {/* Into bunker */}
          <line x1="62" y1="40" x2="92" y2="40" stroke={positivePressure ? "#22C55E" : "#6B7785"} strokeWidth="2" />
          <polygon points="92,40 86,36 86,44" fill={positivePressure ? "#22C55E" : "#6B7785"} />
          <rect x="92" y="26" width="24" height="28" rx="3" fill="#1A2330" stroke="#5CE1E6" strokeWidth="1" />
          <text x="104" y="43" textAnchor="middle" fill="#5CE1E6" fontSize="6">bunker</text>
        </svg>

        {/* Filter life ring */}
        <div className="flex flex-col items-center">
          <svg width="64" height="64" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r={r} fill="none" stroke="#1A2330" strokeWidth="5" />
            <circle cx="32" cy="32" r={r} fill="none" stroke={filterColor} strokeWidth="5" strokeLinecap="round" strokeDasharray={dash + " " + (circ - dash)} transform="rotate(-90 32 32)" className="transition-all duration-700" />
            <text x="32" y="36" textAnchor="middle" fill="#E6EDF3" fontSize="12" fontFamily="monospace" fontWeight="bold">{filterLife}%</text>
          </svg>
          <span className="text-[7px] text-[#6B7785] mt-0.5">filter life{filterLow ? " ⚠" : ""}</span>
        </div>
      </div>

      <button
        onClick={() => aeolus.fire("seal", {})}
        className="w-full py-2.5 rounded-lg text-xs font-medium border transition-all"
        style={{ background: sealed ? "#EF444420" : "#0B0F14", color: sealed ? "#EF4444" : "#9AA6B2", borderColor: sealed ? "#EF44444D" : "#2A3441" }}
      >
        {sealed ? "🔒 Bunker Sealed (NBC Mode)" : "Seal Bunker"}
      </button>
    </div>
  );
}`;

// ─── Supply Inventory — burn-down + depletion projection ─────────────────────
const supplyLogic = `automation({
  conditions: [
    function hasSupplies(context) {
      return context.state && context.state.food !== undefined;
    },
  ],
  actions: [
    function supplies(context) {
      var s = context.state;
      state.set("food", s.food);
      state.set("water", s.water);
      state.set("meds", s.meds);
      state.set("ammo", s.ammo);

      // burn rates as %/day
      var rates = { food: 3, water: 4, meds: 1, ammo: 2 };
      var items = ["food", "water", "meds", "ammo"];
      var minDays = 999, critical = "";
      for (var i = 0; i < items.length; i++) {
        var k = items[i];
        var days = (s[k] || 0) / rates[k];
        if (days < minDays) { minDays = days; critical = k; }
      }
      state.set("daysRemaining", Math.round(minDays));
      state.set("critical", critical);
      state.set("lastUpdate", Date.now());
    },
  ],
});`;

const supplyUi = `import type { CustomComponentProps } from "./types";

export default function SupplyInventory(aeolus: CustomComponentProps) {
  const food = aeolus.read("food") as number ?? 64;
  const water = aeolus.read("water") as number ?? 80;
  const meds = aeolus.read("meds") as number ?? 45;
  const ammo = aeolus.read("ammo") as number ?? 90;
  const daysRemaining = aeolus.read("daysRemaining") as number ?? 11;
  const critical = aeolus.read("critical") as string || "meds";

  const items = [
    { key: "food", label: "Food", icon: "🥫", value: food, rate: 3 },
    { key: "water", label: "Water", icon: "💧", value: water, rate: 4 },
    { key: "meds", label: "Medical", icon: "💊", value: meds, rate: 1 },
    { key: "ammo", label: "Ammo", icon: "🔫", value: ammo, rate: 2 },
  ];
  const col = (v: number) => (v > 50 ? "#22C55E" : v > 25 ? "#F59E0B" : "#EF4444");

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">📦 Supply Inventory</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#F59E0B]/20 text-[#F59E0B]">{daysRemaining}d left</span>
      </div>

      <div className="space-y-2">
        {items.map((it) => {
          const days = Math.round(it.value / it.rate);
          const isCritical = it.key === critical;
          return (
            <div key={it.key} className="bg-[#0B0F14] rounded-lg border px-3 py-2" style={{ borderColor: isCritical ? "#EF44444D" : "#2A3441" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#E6EDF3]">{it.icon} {it.label}{isCritical ? " ⚠" : ""}</span>
                <span className="text-[9px] font-mono text-[#6B7785]">~{days}d · {it.value}%</span>
              </div>
              <div className="h-2 bg-[#1A2330] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: it.value + "%", background: col(it.value) }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "perimeter", name: "Perimeter Defence", triggerTopic: "sensor/bunker/perimeter-+", scriptSource: perimeterLogic, uiSource: perimeterUi },
  { key: "power", name: "Off-Grid Power", triggerTopic: "sensor/bunker/+", scriptSource: powerLogic, uiSource: powerUi },
  { key: "nbc", name: "Air Filtration (NBC)", triggerTopic: "switch/bunker/nbc-filter", scriptSource: nbcLogic, uiSource: nbcUi },
  { key: "supply", name: "Supply Inventory", triggerTopic: "sensor/bunker/supplies", scriptSource: supplyLogic, uiSource: supplyUi },
];

const panes = [
  { kind: "automation", ref: "power", x: 0, y: 0, w: 6, h: 10 },
  { kind: "automation", ref: "perimeter", x: 6, y: 0, w: 6, h: 10 },
  { kind: "automation", ref: "nbc", x: 0, y: 10, w: 6, h: 10 },
  { kind: "automation", ref: "supply", x: 6, y: 10, w: 6, h: 10 },
];

const dataStore = [
  {
    name: "perimeter-events",
    description: "Motion detections by sector (72h)",
    retentionDays: 30,
    records: genSeries({
      count: 60,
      intervalMs: 72 * 60_000,
      fields: {
        sector: () => Math.floor(Math.random() * 4),
        confirmed: () => (Math.random() > 0.6 ? 1 : 0),
      },
    }),
  },
  {
    name: "supply-history",
    description: "Supply levels burning down over 7 days",
    retentionDays: 90,
    records: genSeries({
      count: 84,
      intervalMs: 2 * 3_600_000,
      fields: {
        food: (i) => round(85 - i * 0.25 + noise(1), 0),
        water: (i) => round(95 - i * 0.18 + noise(1), 0),
        meds: (i) => round(55 - i * 0.12 + noise(0.5), 0),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
