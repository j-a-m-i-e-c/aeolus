// scripts/seed/tabs/agriculture.mjs — Connected farm demo (flagship agritech tab).
//
// Water management (the irrigation hero, carried over + re-namespaced), virtual
// livestock fencing, crop health (NDVI), and frost protection. All simulated —
// no keys, works offline. Real-API irrigation (Open-Meteo ET₀) is documented as
// a hand-built extension in docs/guides/local-conditions-tab.md.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-agriculture", name: "Agriculture", icon: "sprout" };

const devices = [
  // Water / irrigation
  { topic: "sensor/farm/dam", payload: { value: 82 } },
  { topic: "sensor/farm/header-tank", payload: { value: 65 } },
  { topic: "switch/farm/dam-pump", payload: { on: true } },
  { topic: "sensor/farm/moisture-veggie-patch", payload: { value: 38 } },
  { topic: "sensor/farm/moisture-orchard", payload: { value: 55 } },
  { topic: "sensor/farm/moisture-herb-garden", payload: { value: 29 } },
  { topic: "sensor/farm/moisture-flower-beds", payload: { value: 62 } },
  { topic: "switch/farm/valve-veggie-patch", payload: { on: true } },
  { topic: "switch/farm/valve-orchard", payload: { on: false } },
  { topic: "switch/farm/valve-herb-garden", payload: { on: true } },
  { topic: "switch/farm/valve-flower-beds", payload: { on: false } },
  // Smart fencing
  { topic: "sensor/fence/energiser", payload: { voltage: 7.2, current: 0.4, fault: false } },
  { topic: "sensor/fence/zone-north", payload: { intact: true, voltage: 7.1 } },
  { topic: "sensor/fence/zone-east", payload: { intact: false, voltage: 2.1, breach: true } },
  { topic: "sensor/fence/zone-south", payload: { intact: true, voltage: 7.0 } },
  { topic: "sensor/fence/zone-west", payload: { intact: true, voltage: 6.9 } },
  { topic: "sensor/fence/collars", payload: { herd: 120, inZone: 118, strays: 2, avgBattery: 74 } },
  // Crop health
  { topic: "sensor/crop/field-north", payload: { ndvi: 0.72, stage: "flowering", canopyTemp: 24.1 } },
  { topic: "sensor/crop/field-east", payload: { ndvi: 0.54, stage: "vegetative", canopyTemp: 27.8 } },
  { topic: "sensor/crop/field-south", payload: { ndvi: 0.81, stage: "grain-fill", canopyTemp: 23.0 } },
  // Frost
  { topic: "sensor/frost/weather", payload: { airTemp: 3.2, dewPoint: 2.1, humidity: 88 } },
  { topic: "sensor/frost/sensor-low", payload: { temp: 1.4, leafWetness: 70 } },
];

// ─── Irrigation & Water Management ⭐ — Dam → Header Tank → Beds ──────────────
const irrigationLogic = `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function manageIrrigation(context) {
      const topic = context.topic;
      const value = context.state.value;

      if (topic === "sensor/farm/dam") state.set("damLevel", value);
      if (topic === "sensor/farm/header-tank") state.set("headerTankLevel", value);

      const beds = ["veggie-patch", "orchard", "herb-garden", "flower-beds"];
      for (const bed of beds) {
        if (topic === "sensor/farm/moisture-" + bed) state.set(bed + "_moisture", value);
      }

      state.set("lastUpdate", Date.now());

      const thresholds = {
        "veggie-patch": { low: 35 },
        "orchard": { low: 30 },
        "herb-garden": { low: 25 },
        "flower-beds": { low: 40 },
      };

      const headerLevel = state.get("headerTankLevel") || 0;
      const damLevel = state.get("damLevel") || 0;

      const shouldPumpDam = headerLevel < 50 && damLevel > 20;
      state.set("damPumpActive", shouldPumpDam);
      state.set("flowDamToHeader", shouldPumpDam);
      if (shouldPumpDam) mqtt.publish("switch/farm/dam-pump/command", JSON.stringify({ on: true }));

      let anyFlowing = false;
      for (const bed of beds) {
        const moisture = state.get(bed + "_moisture") || 50;
        const shouldWater = moisture < thresholds[bed].low && headerLevel > 15;
        state.set(bed + "_watering", shouldWater);
        if (shouldWater) {
          anyFlowing = true;
          mqtt.publish("switch/farm/valve-" + bed + "/command", JSON.stringify({ on: true, duration: 300 }));
        }
      }
      state.set("flowHeaderToBeds", anyFlowing);
    },
  ],
});`;

const irrigationUi = `import type { CustomComponentProps } from "./types";

export default function IrrigationController(aeolus: CustomComponentProps) {
  const damLevel = aeolus.read("damLevel") as number || 82;
  const headerLevel = aeolus.read("headerTankLevel") as number || 65;
  const damPumpActive = aeolus.read("damPumpActive") as boolean;
  const flowDamToHeader = aeolus.read("flowDamToHeader") as boolean;
  const flowHeaderToBeds = aeolus.read("flowHeaderToBeds") as boolean;

  const beds = [
    { key: "veggie-patch", label: "Veggie Patch", icon: "🥕", threshold: 35 },
    { key: "orchard", label: "Orchard", icon: "🍎", threshold: 30 },
    { key: "herb-garden", label: "Herb Garden", icon: "🌿", threshold: 25 },
    { key: "flower-beds", label: "Flower Beds", icon: "🌸", threshold: 40 },
  ];

  const getMoisture = (key: string) => aeolus.read(key + "_moisture") as number || 50;
  const isWatering = (key: string) => aeolus.read(key + "_watering") as boolean;
  const moistureColor = (v: number, threshold: number) => {
    if (v < threshold) return "#EF4444";
    if (v < threshold + 15) return "#F59E0B";
    return "#22C55E";
  };
  const tankColor = (level: number) => level > 60 ? "#3BA4FF" : level > 30 ? "#5CE1E6" : "#F59E0B";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💧 Irrigation & Water</div>
        <div className="flex items-center gap-1.5">
          {damPumpActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#3BA4FF]/15 text-[#3BA4FF] font-mono animate-pulse">Dam Pump Active</span>}
        </div>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <svg width="100%" height="180" viewBox="0 0 400 180" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="damWater" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#3BA4FF" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#3BA4FF" stopOpacity="0.15" />
            </linearGradient>
            <linearGradient id="headerWater" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#5CE1E6" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#5CE1E6" stopOpacity="0.15" />
            </linearGradient>
            <clipPath id="damClip"><rect x="20" y="30" width="80" height="100" rx="8" /></clipPath>
            <clipPath id="headerClip"><rect x="160" y="30" width="80" height="100" rx="8" /></clipPath>
          </defs>

          <rect x="20" y="30" width="80" height="100" rx="8" fill="#121821" stroke={tankColor(damLevel)} strokeWidth="1.5" strokeOpacity="0.4" />
          <rect x="20" y={130 - (damLevel / 100) * 100} width="80" height={(damLevel / 100) * 100} fill="url(#damWater)" clipPath="url(#damClip)" className="transition-all duration-700" />
          <path d={"M20," + (130 - (damLevel / 100) * 100) + " Q40," + (128 - (damLevel / 100) * 100) + " 60," + (130 - (damLevel / 100) * 100) + " T100," + (130 - (damLevel / 100) * 100)} fill="none" stroke="#3BA4FF" strokeWidth="1.5" strokeOpacity="0.6" clipPath="url(#damClip)" className="transition-all duration-700" />
          <text x="60" y="25" textAnchor="middle" fill="#9AA6B2" fontSize="9" fontWeight="600">DAM</text>
          <text x="60" y="85" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{damLevel}%</text>

          <line x1="100" y1="80" x2="160" y2="80" stroke={flowDamToHeader ? "#3BA4FF" : "#2A3441"} strokeWidth="3" strokeLinecap="round" className="transition-all duration-700" />
          {flowDamToHeader && (
            <>
              <circle cx="115" cy="80" r="2" fill="#3BA4FF" className="animate-pulse" />
              <circle cx="130" cy="80" r="2" fill="#3BA4FF" className="animate-pulse" style={{ animationDelay: "0.3s" }} />
              <circle cx="145" cy="80" r="2" fill="#3BA4FF" className="animate-pulse" style={{ animationDelay: "0.6s" }} />
            </>
          )}
          <circle cx="130" cy="70" r="8" fill={damPumpActive ? "#3BA4FF20" : "#1A2330"} stroke={damPumpActive ? "#3BA4FF" : "#2A3441"} strokeWidth="1" />
          <text x="130" y="73" textAnchor="middle" fill={damPumpActive ? "#3BA4FF" : "#6B7785"} fontSize="8">⚙</text>

          <rect x="160" y="30" width="80" height="100" rx="8" fill="#121821" stroke={tankColor(headerLevel)} strokeWidth="1.5" strokeOpacity="0.4" />
          <rect x="160" y={130 - (headerLevel / 100) * 100} width="80" height={(headerLevel / 100) * 100} fill="url(#headerWater)" clipPath="url(#headerClip)" className="transition-all duration-700" />
          <path d={"M160," + (130 - (headerLevel / 100) * 100) + " Q180," + (128 - (headerLevel / 100) * 100) + " 200," + (130 - (headerLevel / 100) * 100) + " T240," + (130 - (headerLevel / 100) * 100)} fill="none" stroke="#5CE1E6" strokeWidth="1.5" strokeOpacity="0.6" clipPath="url(#headerClip)" className="transition-all duration-700" />
          <text x="200" y="25" textAnchor="middle" fill="#9AA6B2" fontSize="9" fontWeight="600">HEADER TANK</text>
          <text x="200" y="85" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{headerLevel}%</text>

          <line x1="240" y1="60" x2="300" y2="40" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />
          <line x1="240" y1="73" x2="300" y2="70" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />
          <line x1="240" y1="87" x2="300" y2="105" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />
          <line x1="240" y1="100" x2="300" y2="140" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />

          {beds.map((bed, i) => {
            const y = 33 + i * 35;
            const moisture = getMoisture(bed.key);
            const active = isWatering(bed.key);
            const color = moistureColor(moisture, bed.threshold);
            return (
              <g key={bed.key}>
                <rect x="305" y={y - 8} width="80" height="26" rx="6" fill="#121821" stroke={active ? color : "#2A3441"} strokeWidth={active ? "1.5" : "1"} className="transition-all duration-700" />
                {active && <rect x="305" y={y - 8} width="80" height="26" rx="6" fill={color} fillOpacity="0.08" />}
                <text x="315" y={y + 5} fill="#E6EDF3" fontSize="8">{bed.icon}</text>
                <text x="328" y={y + 5} fill="#E6EDF3" fontSize="7.5" fontWeight="500">{bed.label}</text>
                <rect x="310" y={y + 10} width="50" height="3" rx="1.5" fill="#1A2330" />
                <rect x="310" y={y + 10} width={(moisture / 100) * 50} height="3" rx="1.5" fill={color} className="transition-all duration-700" />
                <text x="365" y={y + 13} fill={color} fontSize="7" fontFamily="monospace" fontWeight="bold">{moisture}%</text>
                {active && <circle cx="382" cy={y + 3} r="2.5" fill="#22C55E" className="animate-pulse" />}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {beds.map(bed => {
          const moisture = getMoisture(bed.key);
          const active = isWatering(bed.key);
          const color = moistureColor(moisture, bed.threshold);
          const pct = Math.min(100, (moisture / (bed.threshold + 30)) * 100);
          return (
            <div key={bed.key} className={"bg-[#0B0F14] rounded-lg border px-3 py-2 " + (active ? "border-[#22C55E]/40" : "border-[#2A3441]")}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs">{bed.icon} <span className="text-[#E6EDF3] text-[10px] font-medium">{bed.label}</span></span>
                {active && <span className="text-[8px] text-[#22C55E] font-semibold animate-pulse">WATERING</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-[#1A2330] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: pct + "%", background: "linear-gradient(90deg, " + color + "80, " + color + ")" }} />
                </div>
                <span className="text-[10px] font-mono font-bold w-8 text-right" style={{ color }}>{moisture}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => aeolus.fire("manual-water-all", { duration: 300 })}
        className="w-full py-2.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[#3BA4FF]/20 to-[#5CE1E6]/20 text-[#5CE1E6] border border-[#5CE1E6]/30 hover:from-[#3BA4FF]/30 hover:to-[#5CE1E6]/30 transition-all"
      >
        Manual Water All Beds (5 min)
      </button>
    </div>
  );
}`;

// ─── Smart Fencing — energiser + virtual-fence collar containment ────────────
const fenceLogic = `automation({
  conditions: [
    function has(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function fence(context) {
      var s = context.state, t = context.topic || "";
      if (t.indexOf("energiser") >= 0) {
        state.set("voltage", s.voltage);
        state.set("current", s.current);
        state.set("fault", s.fault);
      } else if (t.indexOf("collars") >= 0) {
        state.set("herd", s.herd);
        state.set("inZone", s.inZone);
        state.set("strays", s.strays);
        state.set("avgBattery", s.avgBattery);
      } else if (t.indexOf("zone-") >= 0) {
        var z = t.split("zone-")[1];
        state.set("zone_" + z + "_intact", s.intact);
        state.set("zone_" + z + "_voltage", s.voltage);
      }
      state.set("lastUpdate", Date.now());

      var zones = ["north", "east", "south", "west"];
      var breaches = 0;
      for (var i = 0; i < zones.length; i++) {
        if (state.get("zone_" + zones[i] + "_intact") === false) breaches++;
      }
      state.set("breaches", breaches);
      var v = state.get("voltage") || 7.2;
      state.set("fenceOk", v >= 5 && breaches === 0);
      if (breaches > 0) log.warn("Fence breach — " + breaches + " zone(s) down");
    },
  ],
});`;

const fenceUi = `import type { CustomComponentProps } from "./types";

export default function SmartFencing(aeolus: CustomComponentProps) {
  const voltage = aeolus.read("voltage") as number ?? 7.2;
  const herd = aeolus.read("herd") as number ?? 120;
  const inZone = aeolus.read("inZone") as number ?? 118;
  const strays = aeolus.read("strays") as number ?? 2;
  const avgBattery = aeolus.read("avgBattery") as number ?? 74;
  const breaches = aeolus.read("breaches") as number ?? 1;
  const fenceOk = aeolus.read("fenceOk") as boolean ?? false;

  const zones = [
    { key: "north", x: 70, y: 16, w: 80, h: 16 },
    { key: "east", x: 158, y: 40, w: 16, h: 70 },
    { key: "south", x: 70, y: 118, w: 80, h: 16 },
    { key: "west", x: 46, y: 40, w: 16, h: 70 },
  ];
  const intact = (k: string) => aeolus.read("zone_" + k + "_intact") as boolean ?? true;
  const vColor = voltage >= 6 ? "#22C55E" : voltage >= 4 ? "#F59E0B" : "#EF4444";
  const containment = Math.round((inZone / herd) * 100);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🐄 Smart Fencing</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: fenceOk ? "#22C55E20" : "#EF444420", color: fenceOk ? "#22C55E" : "#EF4444" }}>
          {breaches > 0 ? breaches + " breach" : "Secure"}
        </span>
      </div>

      {/* Paddock map */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2 flex justify-center">
        <svg width="200" height="150" viewBox="0 0 220 150">
          <rect x="62" y="32" width="96" height="86" rx="4" fill="#22C55E08" stroke="#2A3441" strokeWidth="0.8" />
          <text x="110" y="78" textAnchor="middle" fill="#6B7785" fontSize="8">paddock</text>
          {zones.map((z) => {
            const ok = intact(z.key);
            const col = ok ? "#22C55E" : "#EF4444";
            return (
              <g key={z.key}>
                <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="3" fill={col + "20"} stroke={col} strokeWidth="1.5" className="transition-all duration-500" />
                <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 3} textAnchor="middle" fill={col} fontSize="6" className="uppercase">{z.key}</text>
                {!ok && <circle cx={z.x + z.w / 2} cy={z.y + 4} r="2" fill="#EF4444" className="animate-pulse" />}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: vColor }}>{voltage.toFixed(1)}kV</span>
          <span className="text-[7px] text-[#6B7785]">Energiser</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: strays > 0 ? "#F59E0B" : "#22C55E" }}>{inZone}/{herd}</span>
          <span className="text-[7px] text-[#6B7785]">In Zone ({containment}%)</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#5CE1E6]">{avgBattery}%</span>
          <span className="text-[7px] text-[#6B7785]">Collar Batt</span>
        </div>
      </div>

      {strays > 0 && (
        <div className="rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B] text-[10px] text-center py-1.5">
          ⚠ {strays} head outside virtual boundary
        </div>
      )}
    </div>
  );
}`;

// ─── Crop Health — per-field NDVI, growth stage, canopy temp ─────────────────
const cropLogic = `automation({
  conditions: [
    function hasField(context) {
      return context.state && context.state.ndvi !== undefined;
    },
  ],
  actions: [
    function crop(context) {
      var s = context.state;
      var f = (context.topic || "").split("field-")[1] || "north";
      state.set(f + "_ndvi", s.ndvi);
      state.set(f + "_stage", s.stage);
      state.set(f + "_canopy", s.canopyTemp);
      var stressed = s.ndvi < 0.6 || s.canopyTemp > 27;
      state.set(f + "_stress", stressed);
      state.set("lastUpdate", Date.now());
      if (stressed) log.warn("Crop stress in field-" + f + " (NDVI " + s.ndvi + ")");
    },
  ],
});`;

const cropUi = `import type { CustomComponentProps } from "./types";

export default function CropHealth(aeolus: CustomComponentProps) {
  const fields = [
    { key: "north", label: "North Field", ndvi: 0.72, stage: "flowering", canopy: 24.1 },
    { key: "east", label: "East Field", ndvi: 0.54, stage: "vegetative", canopy: 27.8 },
    { key: "south", label: "South Field", ndvi: 0.81, stage: "grain-fill", canopy: 23.0 },
  ];
  // NDVI colour scale: red (bare/stressed) → yellow → green (vigorous)
  const ndviColor = (n: number) => n >= 0.7 ? "#22C55E" : n >= 0.6 ? "#84CC16" : n >= 0.45 ? "#F59E0B" : "#EF4444";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌾 Crop Health</div>
        <span className="text-[9px] text-[#6B7785]">NDVI · growth stage</span>
      </div>

      <div className="space-y-2">
        {fields.map((f) => {
          const ndvi = aeolus.read(f.key + "_ndvi") as number ?? f.ndvi;
          const stage = aeolus.read(f.key + "_stage") as string || f.stage;
          const canopy = aeolus.read(f.key + "_canopy") as number ?? f.canopy;
          const stress = aeolus.read(f.key + "_stress") as boolean ?? (ndvi < 0.6);
          const col = ndviColor(ndvi);
          return (
            <div key={f.key} className="bg-[#0B0F14] rounded-xl border px-3 py-2.5" style={{ borderColor: stress ? "#F59E0B4D" : "#2A3441" }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-[#E6EDF3] font-medium">{f.label}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono capitalize" style={{ background: col + "20", color: col }}>{stage}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-[#6B7785] w-8">NDVI</span>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "linear-gradient(90deg,#EF4444,#F59E0B,#84CC16,#22C55E)" }}>
                  <div className="h-full w-0.5 bg-white" style={{ marginLeft: (ndvi * 100) + "%" }} />
                </div>
                <span className="text-[10px] font-mono font-bold w-9 text-right" style={{ color: col }}>{ndvi.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between mt-1 text-[8px] text-[#6B7785]">
                <span>Canopy {canopy.toFixed(1)}°C</span>
                {stress && <span className="text-[#F59E0B]">⚠ stress detected</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}`;

// ─── Frost Guard — dew point + air temp → frost risk + protection ────────────
const frostLogic = `automation({
  conditions: [
    function has(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function frost(context) {
      var s = context.state, t = context.topic || "";
      if (t.indexOf("weather") >= 0) {
        state.set("airTemp", s.airTemp);
        state.set("dewPoint", s.dewPoint);
        state.set("humidity", s.humidity);
      } else if (t.indexOf("sensor-low") >= 0) {
        state.set("lowTemp", s.temp);
        state.set("leafWetness", s.leafWetness);
      }
      state.set("lastUpdate", Date.now());

      var air = state.get("airTemp");
      if (air === undefined) air = 3.2;
      var low = state.get("lowTemp");
      if (low === undefined) low = air;
      var minTemp = Math.min(air, low);

      var risk = minTemp <= 0 ? "severe" : minTemp <= 2 ? "warning" : minTemp <= 4 ? "watch" : "none";
      state.set("risk", risk);
      var protect = risk === "warning" || risk === "severe";
      state.set("protection", protect);
      if (protect) {
        mqtt.publish("switch/farm/frost-fans/command", JSON.stringify({ on: true }));
        log.warn("Frost " + risk + " — protection engaged (" + minTemp + "°C)");
      }
    },
  ],
});`;

const frostUi = `import type { CustomComponentProps } from "./types";

export default function FrostGuard(aeolus: CustomComponentProps) {
  const airTemp = aeolus.read("airTemp") as number ?? 3.2;
  const dewPoint = aeolus.read("dewPoint") as number ?? 2.1;
  const lowTemp = aeolus.read("lowTemp") as number ?? 1.4;
  const leafWetness = aeolus.read("leafWetness") as number ?? 70;
  const risk = aeolus.read("risk") as string || "warning";
  const protection = aeolus.read("protection") as boolean ?? true;

  const meta: Record<string, { color: string; label: string; deg: number }> = {
    none: { color: "#22C55E", label: "No Risk", deg: -75 },
    watch: { color: "#84CC16", label: "Watch", deg: -25 },
    warning: { color: "#F59E0B", label: "Warning", deg: 25 },
    severe: { color: "#EF4444", label: "Severe", deg: 75 },
  };
  const m = meta[risk] || meta.none;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">❄️ Frost Guard</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: m.color + "20", color: m.color }}>{m.label}</span>
      </div>

      {/* Risk dial */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex flex-col items-center">
        <svg width="150" height="86" viewBox="0 0 150 86">
          <path d="M15,80 A60,60 0 0 1 135,80" fill="none" stroke="#1A2330" strokeWidth="10" strokeLinecap="round" />
          <path d="M15,80 A60,60 0 0 1 45,28" fill="none" stroke="#22C55E" strokeWidth="10" strokeLinecap="round" opacity="0.5" />
          <path d="M45,28 A60,60 0 0 1 105,28" fill="none" stroke="#F59E0B" strokeWidth="10" opacity="0.5" />
          <path d="M105,28 A60,60 0 0 1 135,80" fill="none" stroke="#EF4444" strokeWidth="10" strokeLinecap="round" opacity="0.5" />
          <g transform={"rotate(" + m.deg + " 75 80)"}>
            <line x1="75" y1="80" x2="75" y2="32" stroke={m.color} strokeWidth="3" strokeLinecap="round" />
          </g>
          <circle cx="75" cy="80" r="4" fill={m.color} />
        </svg>
        <div className="text-[10px] text-[#6B7785] mt-1">forecast low <span className="font-mono font-bold" style={{ color: m.color }}>{lowTemp.toFixed(1)}°C</span></div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#E6EDF3]">{airTemp.toFixed(1)}°</span>
          <span className="text-[7px] text-[#6B7785]">Air Temp</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#5CE1E6]">{dewPoint.toFixed(1)}°</span>
          <span className="text-[7px] text-[#6B7785]">Dew Point</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: protection ? "#3BA4FF" : "#6B7785" }}>{protection ? "ON" : "OFF"}</span>
          <span className="text-[7px] text-[#6B7785]">Frost Fans</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "irrigation", name: "Irrigation & Water", triggerTopic: "sensor/farm/+", scriptSource: irrigationLogic, uiSource: irrigationUi },
  { key: "fence", name: "Smart Fencing", triggerTopic: "sensor/fence/+", scriptSource: fenceLogic, uiSource: fenceUi },
  { key: "crop", name: "Crop Health", triggerTopic: "sensor/crop/+", scriptSource: cropLogic, uiSource: cropUi },
  { key: "frost", name: "Frost Guard", triggerTopic: "sensor/frost/+", scriptSource: frostLogic, uiSource: frostUi },
];

const panes = [
  { kind: "automation", ref: "irrigation", x: 0, y: 0, w: 12, h: 13 },
  { kind: "automation", ref: "fence", x: 0, y: 13, w: 6, h: 11 },
  { kind: "automation", ref: "crop", x: 6, y: 13, w: 6, h: 11 },
  { kind: "automation", ref: "frost", x: 0, y: 24, w: 6, h: 10 },
];

const dataStore = [
  {
    name: "soil-moisture",
    description: "Soil moisture per zone (72h)",
    retentionDays: 90,
    records: genSeries({
      count: 72,
      intervalMs: 3_600_000,
      fields: {
        veggie: (i) => round(45 + Math.sin(i / 8) * 12 + noise(3), 0),
        orchard: (i) => round(52 + Math.sin(i / 10) * 8 + noise(3), 0),
        herb: (i) => round(35 + Math.sin(i / 6) * 10 + noise(3), 0),
      },
    }),
  },
  {
    name: "frost-log",
    description: "Overnight minimum temperatures (14 nights)",
    retentionDays: 365,
    records: genSeries({
      count: 14,
      intervalMs: 24 * 3_600_000,
      fields: {
        minTemp: () => round(1 + noise(4), 1),
        dewPoint: () => round(0 + noise(3), 1),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
