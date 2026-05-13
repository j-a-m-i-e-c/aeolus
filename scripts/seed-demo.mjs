#!/usr/bin/env node
/**
 * seed-demo.mjs — Populate Aeolus with a rich, realistic demo.
 *
 * Showcases deep customisation: custom UI components with live state,
 * interactive controls, multi-device orchestration, and polished dashboards.
 *
 * Run against a live Aeolus instance:
 *   node scripts/seed-demo.mjs http://192.168.0.40:3001
 *
 * Or locally:
 *   node scripts/seed-demo.mjs http://localhost:3001
 */

const API = process.argv[2] || "http://localhost:3001";
console.log(`\n🌬️  Seeding Aeolus demo → ${API}\n`);

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`  ✗ ${method} ${path} → ${res.status}`, data);
    return null;
  }
  return data;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. PUBLISH MOCK DEVICES
// ═══════════════════════════════════════════════════════════════════════
console.log("1. Publishing mock devices...");

const mqttDevices = [
  // ── Garden ──
  { topic: "sensor/garden/soil-moisture-zone1", payload: '{"value": 42}' },
  { topic: "sensor/garden/soil-moisture-zone2", payload: '{"value": 58}' },
  { topic: "sensor/garden/soil-moisture-zone3", payload: '{"value": 31}' },
  { topic: "sensor/tank/water-level-1", payload: '{"value": 78}' },
  { topic: "sensor/tank/water-level-2", payload: '{"value": 55}' },
  { topic: "switch/irrigation/zone-1", payload: '{"on": true}' },
  { topic: "switch/irrigation/zone-2", payload: '{"on": false}' },
  { topic: "switch/irrigation/zone-3", payload: '{"on": false}' },
  { topic: "sensor/greenhouse/temp", payload: '{"value": 28.3}' },
  { topic: "sensor/greenhouse/humidity", payload: '{"value": 72}' },
  { topic: "sensor/greenhouse/co2", payload: '{"value": 420}' },
  { topic: "switch/greenhouse/vent", payload: '{"on": true}' },
  { topic: "sensor/greenhouse/zone-tomato-moisture", payload: '{"value": 65}' },
  { topic: "sensor/greenhouse/zone-pepper-moisture", payload: '{"value": 52}' },
  { topic: "sensor/greenhouse/zone-lettuce-moisture", payload: '{"value": 78}' },
  { topic: "sensor/greenhouse/zone-herbs-moisture", payload: '{"value": 60}' },
  { topic: "sensor/greenhouse/zone-tomato-light", payload: '{"value": 850}' },
  { topic: "sensor/greenhouse/zone-pepper-light", payload: '{"value": 720}' },
  { topic: "sensor/greenhouse/zone-lettuce-light", payload: '{"value": 450}' },
  { topic: "sensor/greenhouse/zone-herbs-light", payload: '{"value": 380}' },

  // ── Home ──
  { topic: "sensor/energy/solar-production", payload: '{"value": 3.2}' },
  { topic: "sensor/energy/grid-consumption", payload: '{"value": 1.4}' },
  { topic: "sensor/energy/battery-level", payload: '{"value": 72}' },
  { topic: "motion/front-door", payload: '{"value": true}' },
  { topic: "motion/backyard", payload: '{"value": false}' },
  { topic: "motion/garage", payload: '{"value": false}' },
  { topic: "motion/driveway", payload: '{"value": false}' },

  // ── Aquarium ──
  { topic: "sensor/aquarium/ph", payload: '{"value": 8.2}' },
  { topic: "sensor/aquarium/temp", payload: '{"value": 25.5}' },
  { topic: "sensor/aquarium/tds", payload: '{"value": 450}' },
  { topic: "sensor/aquarium/water-level", payload: '{"value": 92}' },
  { topic: "switch/aquarium/pump", payload: '{"on": true}' },
  { topic: "sensor/aquarium/ammonia", payload: '{"value": 0.02}' },
  { topic: "sensor/aquarium/nitrite", payload: '{"value": 0.01}' },
  { topic: "sensor/aquarium/nitrate", payload: '{"value": 15}' },

  // ── Brewery ──
  { topic: "sensor/brewery/vessel1-temp", payload: '{"value": 18.5}' },
  { topic: "sensor/brewery/vessel1-gravity", payload: '{"value": 1.045}' },
  { topic: "sensor/brewery/vessel1-co2", payload: '{"value": 12}' },
  { topic: "sensor/brewery/vessel2-temp", payload: '{"value": 20.1}' },
  { topic: "sensor/brewery/vessel2-gravity", payload: '{"value": 1.012}' },
  { topic: "sensor/brewery/vessel2-co2", payload: '{"value": 8}' },
  { topic: "sensor/brewery/vessel3-temp", payload: '{"value": 4.2}' },
  { topic: "sensor/brewery/vessel3-gravity", payload: '{"value": 1.005}' },
  { topic: "sensor/brewery/vessel3-co2", payload: '{"value": 3}' },
  { topic: "sensor/brewery/mash-temp", payload: '{"value": 67}' },
  { topic: "sensor/brewery/boil-timer", payload: '{"value": 42}' },

  // ── Hydroponics ──
  { topic: "sensor/hydro/reservoir1-level", payload: '{"value": 85}' },
  { topic: "sensor/hydro/reservoir2-level", payload: '{"value": 62}' },
  { topic: "sensor/hydro/ph", payload: '{"value": 5.8}' },
  { topic: "sensor/hydro/ec", payload: '{"value": 1.4}' },
  { topic: "sensor/hydro/water-temp", payload: '{"value": 22}' },
  { topic: "switch/hydro/pump", payload: '{"on": true}' },
  { topic: "sensor/hydro/ppfd", payload: '{"value": 620}' },
  { topic: "sensor/hydro/dli", payload: '{"value": 28}' },
  { topic: "switch/hydro/lights", payload: '{"on": true, "mode": "full-spectrum"}' },

  // ── Pool & Spa ──
  { topic: "sensor/pool/temp", payload: '{"value": 28.5}' },
  { topic: "sensor/pool/chlorine", payload: '{"value": 1.8}' },
  { topic: "sensor/pool/ph", payload: '{"value": 7.4}' },
  { topic: "sensor/pool/orp", payload: '{"value": 720}' },
  { topic: "switch/pool/pump", payload: '{"on": true}' },
  { topic: "sensor/pool/filter-pressure", payload: '{"value": 12}' },
  { topic: "sensor/spa/temp", payload: '{"value": 38.5}' },
  { topic: "switch/spa/jets", payload: '{"on": false}' },
  { topic: "switch/spa/heater", payload: '{"on": true}' },
  { topic: "switch/spa/cover", payload: '{"open": false}' },

  // ── Server Room ──
  { topic: "sensor/rack/server1-temp", payload: '{"value": 42}' },
  { topic: "sensor/rack/server1-cpu", payload: '{"value": 67}' },
  { topic: "sensor/rack/server1-fan", payload: '{"value": 2400}' },
  { topic: "sensor/rack/server2-temp", payload: '{"value": 38}' },
  { topic: "sensor/rack/server2-cpu", payload: '{"value": 23}' },
  { topic: "sensor/rack/server2-fan", payload: '{"value": 1800}' },
  { topic: "sensor/rack/server3-temp", payload: '{"value": 55}' },
  { topic: "sensor/rack/server3-cpu", payload: '{"value": 89}' },
  { topic: "sensor/rack/server3-fan", payload: '{"value": 3200}' },
  { topic: "sensor/rack/server4-temp", payload: '{"value": 35}' },
  { topic: "sensor/rack/server4-cpu", payload: '{"value": 12}' },
  { topic: "sensor/rack/server4-fan", payload: '{"value": 1500}' },
  { topic: "sensor/ups/battery", payload: '{"value": 95}' },
  { topic: "sensor/ups/load", payload: '{"value": 62}' },
  { topic: "sensor/ups/input-voltage", payload: '{"value": 230}' },
  { topic: "sensor/ups/output-voltage", payload: '{"value": 230}' },
  { topic: "sensor/network/throughput-up", payload: '{"value": 245}' },
  { topic: "sensor/network/throughput-down", payload: '{"value": 890}' },
  { topic: "sensor/rack/uptime", payload: '{"value": 4320}' },

  // ── Weather ──
  { topic: "sensor/weather/outdoor-temp", payload: '{"value": 22.4}' },
  { topic: "sensor/weather/wind-speed", payload: '{"value": 12.5}' },
  { topic: "sensor/weather/wind-direction", payload: '{"value": 225}' },
  { topic: "sensor/weather/rain", payload: '{"value": 0}' },
  { topic: "sensor/weather/pressure", payload: '{"value": 1013}' },
  { topic: "sensor/weather/uv-index", payload: '{"value": 4}' },
  { topic: "sensor/room/kitchen-temp", payload: '{"value": 22.5}' },
  { topic: "sensor/room/living-room-temp", payload: '{"value": 21.6}' },
  { topic: "sensor/room/bedroom-temp", payload: '{"value": 19.8}' },
  { topic: "sensor/room/office-temp", payload: '{"value": 23.1}' },
  { topic: "sensor/room/bathroom-temp", payload: '{"value": 24.2}' },
];

for (const msg of mqttDevices) {
  await api("POST", "/api/mqtt/publish", msg);
}
await new Promise((r) => setTimeout(r, 1500));
console.log(`  ✓ Published ${mqttDevices.length} device messages`);


// ═══════════════════════════════════════════════════════════════════════
// 2. CREATE AUTOMATIONS (16 total — 2 per tab)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n2. Creating automations...");

// ─── Tab 1: Garden — Smart Irrigation ────────────────────────────────
const smartIrrigation = await api("POST", "/api/automations", {
  name: "Smart Irrigation",
  triggerTopic: "sensor/garden/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasMoisture(context) {
      return typeof context.state.value === "number";
    },
  ],
  actions: [
    function manageIrrigation(context) {
      const topic = context.topic;
      const value = context.state.value;

      if (topic.includes("soil-moisture")) {
        const zone = topic.includes("zone1") ? "zone1" : topic.includes("zone2") ? "zone2" : "zone3";
        state.set("moisture_" + zone, value);
      }
      if (topic.includes("water-level-1")) state.set("tank1Level", value);
      if (topic.includes("water-level-2")) state.set("tank2Level", value);

      state.set("lastUpdate", Date.now());

      // Auto-water logic
      const zones = ["zone1", "zone2", "zone3"];
      for (const z of zones) {
        const m = state.get("moisture_" + z) || 50;
        if (m < 35) {
          state.set(z + "_watering", true);
          state.set("totalCycles", (state.get("totalCycles") || 0) + 1);
          mqtt.publish("switch/irrigation/" + z + "/command", JSON.stringify({ action: "open", duration: 300 }));
        } else {
          state.set(z + "_watering", false);
        }
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function SmartIrrigation(props: CustomComponentProps) {
  const tank1 = props.state.get("tank1Level") as number || 0;
  const tank2 = props.state.get("tank2Level") as number || 0;
  const zones = ["zone1", "zone2", "zone3"];
  const totalCycles = props.state.get("totalCycles") as number || 0;

  const getMoisture = (z: string) => props.state.get("moisture_" + z) as number | undefined;
  const isWatering = (z: string) => props.state.get(z + "_watering") as boolean;

  const moistureColor = (v: number | undefined) => {
    if (v === undefined) return "#6B7785";
    if (v < 25) return "#EF4444";
    if (v < 40) return "#F59E0B";
    return "#22C55E";
  };

  const Tank = ({ level, label, id }: { level: number; label: string; id: string }) => {
    const fillY = 85 - (level / 100) * 60;
    const levelColor = level > 60 ? "#3BA4FF" : level > 30 ? "#5CE1E6" : "#F59E0B";
    return (
      <div className="flex-1 bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[#9AA6B2] font-medium uppercase">{label}</span>
          <span className="text-xs font-mono font-bold" style={{ color: levelColor }}>{level}%</span>
        </div>
        <svg width="100%" height="70" viewBox="0 0 120 90" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={"irrTank-" + id} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={levelColor} stopOpacity="0.7" />
              <stop offset="100%" stopColor={levelColor} stopOpacity="0.15" />
            </linearGradient>
            <clipPath id={"irrClip-" + id}>
              <rect x="10" y="5" width="100" height="80" rx="12" />
            </clipPath>
          </defs>
          {/* Tank shell */}
          <rect x="10" y="5" width="100" height="80" rx="12" fill="#121821" stroke={levelColor} strokeWidth="1" strokeOpacity="0.25" />
          {/* Water fill */}
          <rect x="10" y={fillY} width="100" height={85 - fillY} fill={"url(#irrTank-" + id + ")"} clipPath={"url(#irrClip-" + id + ")"} className="transition-all duration-700" />
          {/* Water surface wave */}
          <path d={"M10," + fillY + " Q35," + (fillY - 3) + " 60," + fillY + " T110," + fillY} fill="none" stroke={levelColor} strokeWidth="1.5" strokeOpacity="0.6" clipPath={"url(#irrClip-" + id + ")"} className="transition-all duration-700" />
          {/* Level markers */}
          <line x1="112" y1="25" x2="116" y2="25" stroke="#6B7785" strokeWidth="1" />
          <line x1="112" y1="45" x2="116" y2="45" stroke="#6B7785" strokeWidth="1" />
          <line x1="112" y1="65" x2="116" y2="65" stroke="#6B7785" strokeWidth="1" />
          <text x="118" y="28" fill="#6B7785" fontSize="6">75</text>
          <text x="118" y="48" fill="#6B7785" fontSize="6">50</text>
          <text x="118" y="68" fill="#6B7785" fontSize="6">25</text>
          {/* Outer stroke */}
          <rect x="10" y="5" width="100" height="80" rx="12" fill="none" stroke="#2A3441" strokeWidth="1" />
        </svg>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💧 Smart Irrigation</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#6B7785]">{totalCycles} cycles</span>
        </div>
      </div>

      {/* Tanks side by side */}
      <div className="grid grid-cols-2 gap-2">
        <Tank level={tank1} label="Tank A" id="a" />
        <Tank level={tank2} label="Tank B" id="b" />
      </div>

      {/* Moisture zones */}
      <div className="space-y-1.5">
        {zones.map(z => {
          const m = getMoisture(z);
          const active = isWatering(z);
          const color = moistureColor(m);
          return (
            <div key={z} className="flex items-center gap-3 bg-[#0B0F14] rounded-lg px-3 py-2 border border-[#2A3441]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color, boxShadow: active ? "0 0 6px " + color : "none" }} />
              <span className="text-[10px] text-[#9AA6B2] w-12">{z.replace("zone", "Zone ")}</span>
              <div className="flex-1 h-2.5 bg-[#1A2330] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: (m || 0) + "%", background: "linear-gradient(90deg, " + color + "80, " + color + ")" }} />
              </div>
              <span className="text-[10px] font-mono font-semibold w-8 text-right" style={{ color }}>{m ?? "—"}%</span>
              {active && <span className="text-[8px] text-[#22C55E] animate-pulse">●</span>}
            </div>
          );
        })}
      </div>

      <button
        onClick={() => props.mqttPublish("switch/irrigation/zone-1/command", JSON.stringify({ action: "open", duration: 300 }))}
        className="w-full py-2.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[#3BA4FF]/20 to-[#5CE1E6]/20 text-[#5CE1E6] border border-[#5CE1E6]/30 hover:from-[#3BA4FF]/30 hover:to-[#5CE1E6]/30 transition-all"
      >
        Manual Water All Zones (5 min)
      </button>
    </div>
  );
}`,
});
if (smartIrrigation) console.log("  ✓ Smart Irrigation:", smartIrrigation.id);


// ─── Tab 1: Garden — Greenhouse ──────────────────────────────────────
const greenhouse = await api("POST", "/api/automations", {
  name: "Greenhouse",
  triggerTopic: "sensor/greenhouse/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function manageGreenhouse(context) {
      const topic = context.topic;
      const value = context.state.value;
      const parts = topic.split("/");
      const metric = parts.slice(2).join("_").replace(/-/g, "_");

      // Map zone sensor topics to state keys
      if (topic.includes("zone-tomato-moisture")) state.set("zone_tomato_moisture", value);
      else if (topic.includes("zone-pepper-moisture")) state.set("zone_pepper_moisture", value);
      else if (topic.includes("zone-lettuce-moisture")) state.set("zone_lettuce_moisture", value);
      else if (topic.includes("zone-herbs-moisture")) state.set("zone_herbs_moisture", value);
      else if (topic.includes("zone-tomato-light")) state.set("zone_tomato_light", value);
      else if (topic.includes("zone-pepper-light")) state.set("zone_pepper_light", value);
      else if (topic.includes("zone-lettuce-light")) state.set("zone_lettuce_light", value);
      else if (topic.includes("zone-herbs-light")) state.set("zone_herbs_light", value);
      else {
        const simple = parts[2];
        state.set(simple, value);
      }

      state.set("lastUpdate", Date.now());

      const temp = state.get("temp") || 0;
      const humidity = state.get("humidity") || 0;
      const needsVent = temp > 28 || humidity > 80;
      state.set("ventActive", needsVent);

      if (needsVent) {
        mqtt.publish("switch/greenhouse/vent/command", JSON.stringify({ action: "open" }));
      }

      // Determine growth stages based on light + moisture
      const stages = ["seedling", "vegetative", "flowering", "fruiting"];
      const zones = ["tomato", "pepper", "lettuce", "herbs"];
      for (const z of zones) {
        if (!state.get("zone_" + z + "_stage")) {
          state.set("zone_" + z + "_stage", "vegetative");
        }
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function GreenhousePanel(props: CustomComponentProps) {
  const temp = props.state.get("temp") as number || 0;
  const humidity = props.state.get("humidity") as number || 0;
  const co2 = props.state.get("co2") as number || 0;
  const ventActive = props.state.get("ventActive") as boolean;

  const zones = [
    { key: "tomato", icon: "🍅", label: "Tomatoes" },
    { key: "pepper", icon: "🌶️", label: "Peppers" },
    { key: "lettuce", icon: "🥬", label: "Lettuce" },
    { key: "herbs", icon: "🌿", label: "Herbs" },
  ];

  const getMoisture = (z: string) => props.state.get("zone_" + z + "_moisture") as number || 0;
  const getLight = (z: string) => props.state.get("zone_" + z + "_light") as number || 0;
  const getStage = (z: string) => props.state.get("zone_" + z + "_stage") as string || "vegetative";

  const stageColor = (s: string) => s === "fruiting" ? "#EF4444" : s === "flowering" ? "#F59E0B" : s === "vegetative" ? "#22C55E" : "#3BA4FF";

  const lightIntensity = (lux: number) => lux > 700 ? 1 : lux > 400 ? 0.6 : 0.3;

  return (
    <div className="p-4 space-y-3">
      {/* Environment bar */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌱 Greenhouse</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#F59E0B] font-mono">{temp.toFixed(1)}°C</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#3BA4FF]/15 text-[#3BA4FF] font-mono">{humidity}%</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#22C55E]/15 text-[#22C55E] font-mono">{co2}ppm</span>
        </div>
      </div>

      {/* Vent/Fan + Grow Lights status */}
      <div className="flex items-center gap-2">
        <div className={"flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium border " + (ventActive ? "bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]" : "bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]")}>
          <svg width="12" height="12" viewBox="0 0 12 12" className={"transition-all duration-700 " + (ventActive ? "animate-spin" : "")}>
            <circle cx="6" cy="6" r="1.5" fill="currentColor" />
            <path d="M6,1.5 Q8,4 6,6 Q4,4 6,1.5" fill="currentColor" opacity="0.7" />
            <path d="M10.5,6 Q8,8 6,6 Q8,4 10.5,6" fill="currentColor" opacity="0.7" />
            <path d="M6,10.5 Q4,8 6,6 Q8,8 6,10.5" fill="currentColor" opacity="0.7" />
            <path d="M1.5,6 Q4,4 6,6 Q4,8 1.5,6" fill="currentColor" opacity="0.7" />
          </svg>
          {ventActive ? "Vent Open" : "Vent Sealed"}
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium border bg-[#F59E0B]/10 border-[#F59E0B]/30 text-[#F59E0B]">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="2" fill="#F59E0B" />
            {[0,45,90,135,180,225,270,315].map((a, i) => (
              <line key={i} x1={5 + 3 * Math.cos(a * Math.PI / 180)} y1={5 + 3 * Math.sin(a * Math.PI / 180)} x2={5 + 4.5 * Math.cos(a * Math.PI / 180)} y2={5 + 4.5 * Math.sin(a * Math.PI / 180)} stroke="#F59E0B" strokeWidth="0.8" strokeLinecap="round" />
            ))}
          </svg>
          Grow Lights · Full Spectrum
        </div>
      </div>

      {/* Plant zone cards */}
      <div className="grid grid-cols-2 gap-2">
        {zones.map(zone => {
          const moisture = getMoisture(zone.key);
          const light = getLight(zone.key);
          const stage = getStage(zone.key);
          const sColor = stageColor(stage);
          const lIntensity = lightIntensity(light);

          // Circular moisture gauge
          const radius = 14;
          const circumference = 2 * Math.PI * radius;
          const moistureArc = (moisture / 100) * circumference;
          const moistureColor = moisture > 70 ? "#3BA4FF" : moisture > 40 ? "#22C55E" : "#F59E0B";

          return (
            <div key={zone.key} className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{zone.icon}</span>
                <span className="text-[11px] text-[#E6EDF3] font-medium">{zone.label}</span>
              </div>

              <div className="flex items-center justify-between">
                {/* Circular moisture gauge */}
                <div className="relative flex items-center justify-center">
                  <svg width="38" height="38" viewBox="0 0 38 38">
                    <circle cx="19" cy="19" r={radius} fill="none" stroke="#1A2330" strokeWidth="3" />
                    <circle cx="19" cy="19" r={radius} fill="none" stroke={moistureColor} strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference - moistureArc} transform="rotate(-90 19 19)" className="transition-all duration-700" />
                    <text x="19" y="21" textAnchor="middle" fill="#E6EDF3" fontSize="8" fontFamily="monospace" fontWeight="bold">{moisture}</text>
                  </svg>
                  <div className="absolute -bottom-1 text-[7px] text-[#6B7785]">💧</div>
                </div>

                {/* Light indicator */}
                <div className="flex flex-col items-center gap-0.5">
                  <svg width="20" height="20" viewBox="0 0 20 20" style={{ opacity: lIntensity }} className="transition-all duration-700">
                    <circle cx="10" cy="10" r="4" fill="#F59E0B" />
                    {[0,45,90,135,180,225,270,315].map((a, i) => (
                      <line key={i} x1={10 + 5.5 * Math.cos(a * Math.PI / 180)} y1={10 + 5.5 * Math.sin(a * Math.PI / 180)} x2={10 + 7.5 * Math.cos(a * Math.PI / 180)} y2={10 + 7.5 * Math.sin(a * Math.PI / 180)} stroke="#F59E0B" strokeWidth="1.2" strokeLinecap="round" />
                    ))}
                  </svg>
                  <span className="text-[8px] font-mono text-[#9AA6B2]">{light} lux</span>
                </div>
              </div>

              {/* Growth stage badge */}
              <div className="mt-2 flex justify-center">
                <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold capitalize" style={{ backgroundColor: sColor + "20", color: sColor }}>{stage}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}`,
});
if (greenhouse) console.log("  ✓ Greenhouse:", greenhouse.id);

// ─── Tab 1: Garden — Tank Transfer ──────────────────────────────────
const tankTransfer = await api("POST", "/api/automations", {
  name: "Tank Transfer",
  triggerTopic: "sensor/tank/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasLevel(context) {
      return typeof context.state.value === "number";
    },
  ],
  actions: [
    function managePump(context) {
      const topic = context.topic;
      const level = context.state.value;

      if (topic.includes("water-level-1")) state.set("mainTankLevel", level);
      if (topic.includes("water-level-2")) state.set("feederTankLevel", level);

      const mainLevel = state.get("mainTankLevel") || 0;
      const feederLevel = state.get("feederTankLevel") || 0;

      // When main house tank drops below 40%, pump from feeder tank
      const shouldPump = mainLevel < 40 && feederLevel > 15;
      const wasPumping = state.get("pumpActive") || false;

      state.set("pumpActive", shouldPump);
      state.set("lastCheck", Date.now());
      state.set("totalTransfers", (state.get("totalTransfers") || 0) + (shouldPump && !wasPumping ? 1 : 0));

      if (shouldPump && !wasPumping) {
        mqtt.publish("switch/tank/transfer-pump/command", JSON.stringify({ on: true }));
        log.info("Transfer pump started — main tank at " + mainLevel + "%, feeder at " + feederLevel + "%");
      } else if (!shouldPump && wasPumping) {
        mqtt.publish("switch/tank/transfer-pump/command", JSON.stringify({ on: false }));
        log.info("Transfer pump stopped — main tank at " + mainLevel + "%");
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function TankTransfer(props: CustomComponentProps) {
  const mainLevel = props.state.get("mainTankLevel") as number || 0;
  const feederLevel = props.state.get("feederTankLevel") as number || 0;
  const pumpActive = props.state.get("pumpActive") as boolean || false;
  const totalTransfers = props.state.get("totalTransfers") as number || 0;

  const Tank = ({ level, label, id, subtitle }: { level: number; label: string; id: string; subtitle: string }) => {
    const fillY = 75 - (level / 100) * 55;
    const levelColor = level > 60 ? "#3BA4FF" : level > 30 ? "#5CE1E6" : "#F59E0B";
    const lowWarning = level < 40;
    return (
      <div className={"bg-[#0B0F14] rounded-xl border p-3 " + (lowWarning ? "border-[#F59E0B]/40" : "border-[#2A3441]")}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <div className="text-[10px] text-[#E6EDF3] font-semibold">{label}</div>
            <div className="text-[8px] text-[#6B7785]">{subtitle}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-mono font-bold" style={{ color: levelColor }}>{level}%</div>
            {lowWarning && <div className="text-[8px] text-[#F59E0B]">Low</div>}
          </div>
        </div>
        <svg width="100%" height="60" viewBox="0 0 200 75" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={"xfer-" + id} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={levelColor} stopOpacity="0.75" />
              <stop offset="100%" stopColor={levelColor} stopOpacity="0.1" />
            </linearGradient>
            <clipPath id={"xferC-" + id}>
              <rect x="5" y="5" width="190" height="65" rx="10" />
            </clipPath>
          </defs>
          <rect x="5" y="5" width="190" height="65" rx="10" fill="#121821" stroke={levelColor} strokeWidth="0.8" strokeOpacity="0.2" />
          <rect x="5" y={fillY} width="190" height={75 - fillY} fill={"url(#xfer-" + id + ")"} clipPath={"url(#xferC-" + id + ")"} className="transition-all duration-700" />
          {/* Surface wave */}
          <path d={"M5," + fillY + " Q50," + (fillY - 2.5) + " 100," + fillY + " T195," + fillY} fill="none" stroke={levelColor} strokeWidth="1.2" strokeOpacity="0.5" clipPath={"url(#xferC-" + id + ")"} className="transition-all duration-700" />
          <rect x="5" y="5" width="190" height="65" rx="10" fill="none" stroke="#2A3441" strokeWidth="1" />
        </svg>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🔄 Tank Transfer</div>
        <div className="text-[10px] text-[#6B7785]">{totalTransfers} transfers</div>
      </div>

      <Tank level={mainLevel} label="Main Tank" id="main" subtitle="Feeds house supply" />

      {/* Pump flow indicator */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-[#2A3441]" />
        <div className="flex flex-col items-center gap-0.5">
          <div className={"flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-semibold border " + (pumpActive ? "bg-[#3BA4FF]/15 text-[#3BA4FF] border-[#3BA4FF]/40" : "bg-[#1A2330] text-[#6B7785] border-[#2A3441]")}>
            {pumpActive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#3BA4FF] animate-pulse" />}
            {pumpActive ? "Transferring ↑" : "Pump Idle"}
          </div>
          {pumpActive && <div className="text-[8px] text-[#3BA4FF]/60">Feeder → Main</div>}
        </div>
        <div className="flex-1 h-px bg-[#2A3441]" />
      </div>

      <Tank level={feederLevel} label="Feeder Tank" id="feeder" subtitle="Rainwater collection" />

      <div className="bg-[#0B0F14] rounded-lg px-3 py-2 border border-[#2A3441]">
        <div className="text-[9px] text-[#6B7785] leading-relaxed">
          Auto-transfer activates when main tank drops below <span className="text-[#F59E0B] font-mono">40%</span> and feeder has water available (&gt;<span className="text-[#22C55E] font-mono">15%</span>).
        </div>
      </div>

      <button
        onClick={() => props.mqttPublish("switch/tank/transfer-pump/command", JSON.stringify({ on: true, duration: 300 }))}
        className="w-full py-2.5 rounded-lg text-xs font-medium bg-gradient-to-r from-[#3BA4FF]/20 to-[#5CE1E6]/20 text-[#5CE1E6] border border-[#5CE1E6]/30 hover:from-[#3BA4FF]/30 hover:to-[#5CE1E6]/30 transition-all"
      >
        Manual Transfer (5 min)
      </button>
    </div>
  );
}`,
});
if (tankTransfer) console.log("  ✓ Tank Transfer:", tankTransfer.id);


// ─── Tab 2: Home — Energy Monitor ────────────────────────────────────
const energyMonitor = await api("POST", "/api/automations", {
  name: "Energy Monitor",
  triggerTopic: "sensor/energy/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return typeof context.state.value === "number";
    },
  ],
  actions: [
    function trackEnergy(context) {
      const metric = context.topic.split("/")[2];
      const value = context.state.value;
      state.set(metric, value);

      const solar = state.get("solar-production") || 0;
      const grid = state.get("grid-consumption") || 0;
      state.set("net", solar - grid);
      state.set("selfSufficiency", solar > 0 ? Math.min(Math.round((solar / (solar + grid)) * 100), 100) : 0);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function EnergyMonitor(props: CustomComponentProps) {
  const solar = props.state.get("solar-production") as number || 0;
  const grid = props.state.get("grid-consumption") as number || 0;
  const battery = props.state.get("battery-level") as number || 0;
  const net = props.state.get("net") as number || 0;
  const selfSuff = props.state.get("selfSufficiency") as number || 0;

  const batteryColor = battery > 60 ? "#22C55E" : battery > 25 ? "#F59E0B" : "#EF4444";
  const batteryFill = (battery / 100) * 20;

  // Self-sufficiency arc
  const suffRadius = 40;
  const suffCircumference = 2 * Math.PI * suffRadius;
  const suffArc = (selfSuff / 100) * suffCircumference * 0.75;

  // Flow line animation
  const solarFlow = solar > 0;
  const gridFlow = grid > 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">⚡ Energy Monitor</div>
        <div className={"text-xs font-mono font-semibold px-2 py-0.5 rounded " + (net >= 0 ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-[#EF4444]")}>
          {net >= 0 ? "+" : ""}{net.toFixed(1)} kW net
        </div>
      </div>

      {/* Energy Flow Diagram */}
      <svg width="100%" height="100" viewBox="0 0 300 100" className="overflow-visible">
        {/* Sun icon */}
        <circle cx="40" cy="50" r="16" fill="#F59E0B" opacity="0.2" />
        <circle cx="40" cy="50" r="10" fill="#F59E0B" opacity="0.6" />
        <circle cx="40" cy="50" r="5" fill="#F59E0B" />
        {[0,45,90,135,180,225,270,315].map((angle, i) => (
          <line key={i} x1={40 + 13 * Math.cos(angle * Math.PI / 180)} y1={50 + 13 * Math.sin(angle * Math.PI / 180)} x2={40 + 18 * Math.cos(angle * Math.PI / 180)} y2={50 + 18 * Math.sin(angle * Math.PI / 180)} stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" />
        ))}
        <text x="40" y="78" textAnchor="middle" fill="#9AA6B2" fontSize="8">{solar.toFixed(1)} kW</text>

        {/* House icon */}
        <path d="M145,35 L150,30 L155,35 L155,55 L145,55 Z" fill="#1A2330" stroke="#5CE1E6" strokeWidth="1.5" />
        <path d="M140,37 L150,27 L160,37" fill="none" stroke="#5CE1E6" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="148" y="47" width="4" height="8" fill="#5CE1E6" opacity="0.5" />
        <text x="150" y="70" textAnchor="middle" fill="#9AA6B2" fontSize="8">Home</text>

        {/* Grid icon */}
        <rect x="245" y="36" width="20" height="28" rx="2" fill="#1A2330" stroke="#F59E0B" strokeWidth="1.5" />
        <line x1="250" y1="36" x2="250" y2="64" stroke="#F59E0B" strokeWidth="0.8" />
        <line x1="255" y1="36" x2="255" y2="64" stroke="#F59E0B" strokeWidth="0.8" />
        <line x1="260" y1="36" x2="260" y2="64" stroke="#F59E0B" strokeWidth="0.8" />
        <line x1="245" y1="44" x2="265" y2="44" stroke="#F59E0B" strokeWidth="0.8" />
        <line x1="245" y1="52" x2="265" y2="52" stroke="#F59E0B" strokeWidth="0.8" />
        <text x="255" y="78" textAnchor="middle" fill="#9AA6B2" fontSize="8">{grid.toFixed(1)} kW</text>

        {/* Solar flow line */}
        {solarFlow && (
          <line x1="62" y1="50" x2="140" y2="50" stroke="#22C55E" strokeWidth="2" strokeDasharray="6 4" className="transition-all duration-700" style={{ animation: "flowLeft 1.5s linear infinite" }} />
        )}

        {/* Grid flow line */}
        {gridFlow && (
          <line x1="165" y1="50" x2="242" y2="50" stroke="#F59E0B" strokeWidth="2" strokeDasharray="6 4" className="transition-all duration-700" style={{ animation: "flowRight 1.5s linear infinite" }} />
        )}
      </svg>

      <style>{\`
        @keyframes flowLeft { from { stroke-dashoffset: 20; } to { stroke-dashoffset: 0; } }
        @keyframes flowRight { from { stroke-dashoffset: -20; } to { stroke-dashoffset: 0; } }
      \`}</style>

      <div className="grid grid-cols-2 gap-4 px-2">
        {/* Battery SVG icon */}
        <div className="flex flex-col items-center justify-center bg-[#0B0F14] rounded-xl p-3 border border-[#2A3441]">
          <svg width="50" height="70" viewBox="0 0 50 70">
            <rect x="15" y="2" width="20" height="7" rx="3" fill="#1A2330" stroke="#2A3441" strokeWidth="1" />
            <rect x="7" y="9" width="36" height="52" rx="5" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
            <defs>
              <clipPath id="battClip">
                <rect x="9" y="11" width="32" height="48" rx="4" />
              </clipPath>
            </defs>
            <rect x="9" y={59 - batteryFill * 2.4} width="32" height={batteryFill * 2.4} fill={batteryColor} clipPath="url(#battClip)" className="transition-all duration-700" opacity="0.8" />
            <text x="25" y="40" textAnchor="middle" fill="#E6EDF3" fontSize="11" fontFamily="monospace" fontWeight="bold">{battery}%</text>
          </svg>
          <div className="text-[10px] text-[#6B7785] mt-1">Battery</div>
        </div>

        {/* Self-sufficiency gauge */}
        <div className="flex flex-col items-center justify-center bg-[#0B0F14] rounded-xl p-3 border border-[#2A3441]">
          <svg width="110" height="85" viewBox="0 0 110 85">
            <path d={\`M 10 75 A \${suffRadius} \${suffRadius} 0 1 1 100 75\`} fill="none" stroke="#1A2330" strokeWidth="9" strokeLinecap="round" />
            <path d={\`M 10 75 A \${suffRadius} \${suffRadius} 0 1 1 100 75\`} fill="none" stroke="#5CE1E6" strokeWidth="9" strokeLinecap="round" strokeDasharray={suffCircumference * 0.75} strokeDashoffset={suffCircumference * 0.75 - suffArc} className="transition-all duration-700" />
            <text x="55" y="58" textAnchor="middle" fill="#E6EDF3" fontSize="18" fontFamily="monospace" fontWeight="bold">{selfSuff}%</text>
            <text x="55" y="74" textAnchor="middle" fill="#6B7785" fontSize="8">Self-Sufficiency</text>
          </svg>
        </div>
      </div>
    </div>
  );
}`,
});
if (energyMonitor) console.log("  ✓ Energy Monitor:", energyMonitor.id);

// ─── Tab 2: Home — Security Monitor ─────────────────────────────────
const securityMonitor = await api("POST", "/api/automations", {
  name: "Security Monitor",
  triggerTopic: "motion/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function motionEvent(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function handleMotion(context) {
      const zone = context.topic.split("/")[1];
      const active = context.state.value === true;
      state.set("zone_" + zone, active);

      if (active) {
        const events = state.get("events") || [];
        events.unshift({ zone, time: context.timestamp });
        if (events.length > 8) events.pop();
        state.set("events", events);
        state.set("lastMotion", zone);
        state.set("lastMotionTime", context.timestamp);
        state.set("totalAlerts", (state.get("totalAlerts") || 0) + 1);
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function SecurityMonitor(props: CustomComponentProps) {
  const zones = ["front-door", "backyard", "garage", "driveway"];
  const events = props.state.get("events") as Array<{ zone: string; time: number }> || [];
  const totalAlerts = props.state.get("totalAlerts") as number || 0;

  const isActive = (z: string) => props.state.get("zone_" + z) as boolean;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🛡️ Security Monitor</div>
        <div className="text-[10px] text-[#6B7785]">{totalAlerts} total alerts</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {zones.map(zone => {
          const active = isActive(zone);
          return (
            <div key={zone} className={"rounded-lg p-2.5 border text-center " + (active ? "bg-[#EF4444]/10 border-[#EF4444]/30" : "bg-[#0B0F14] border-[#2A3441]")}>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <div className={"w-2 h-2 rounded-full " + (active ? "bg-[#EF4444] animate-pulse" : "bg-[#22C55E]")} />
                <span className="text-[10px] text-[#9AA6B2] uppercase font-medium">{zone.replace("-", " ")}</span>
              </div>
              <div className={"text-[10px] " + (active ? "text-[#EF4444]" : "text-[#6B7785]")}>
                {active ? "Motion Detected" : "Clear"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] overflow-hidden">
        <div className="px-3 py-1.5 border-b border-[#2A3441] text-[10px] text-[#6B7785] uppercase font-medium">Recent Activity</div>
        <div className="max-h-32 overflow-auto">
          {events.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-[#6B7785]">No motion events</div>
          ) : events.map((ev, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[10px] border-b border-[#2A3441]/50 last:border-0">
              <span className="text-[#E6EDF3] capitalize">{ev.zone.replace("-", " ")}</span>
              <span className="text-[#6B7785] font-mono">{new Date(ev.time).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`,
});
if (securityMonitor) console.log("  ✓ Security Monitor:", securityMonitor.id);


// ─── Tab 3: Aquarium — Reef Tank ─────────────────────────────────────
const reefTank = await api("POST", "/api/automations", {
  name: "Reef Tank",
  triggerTopic: "sensor/aquarium/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackReef(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());

      // Feeding schedule
      const lastFed = state.get("lastFedTime") || (Date.now() - 3600000 * 4);
      const nextFeed = lastFed + (3600000 * 8);
      state.set("nextFeedTime", nextFeed);
      state.set("feedCountdown", Math.max(0, Math.round((nextFeed - Date.now()) / 60000)));
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function ReefTank(props: CustomComponentProps) {
  const waterLevel = props.state.get("water-level") as number || 0;
  const ph = props.state.get("ph") as number || 0;
  const temp = props.state.get("temp") as number || 0;
  const tds = props.state.get("tds") as number || 0;
  const pumpOn = true;
  const feedCountdown = props.state.get("feedCountdown") as number || 0;
  const lastFedTime = props.state.get("lastFedTime") as number | undefined;

  const phColor = ph >= 8.0 && ph <= 8.4 ? "#22C55E" : ph >= 7.8 && ph <= 8.6 ? "#F59E0B" : "#EF4444";
  const fillHeight = (waterLevel / 100) * 70;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🐠 Reef Tank</div>
        <div className={"text-[10px] px-2 py-0.5 rounded " + (pumpOn ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-[#EF4444]")}>
          Pump {pumpOn ? "ON" : "OFF"}
        </div>
      </div>

      <div className="flex justify-center">
        <svg width="180" height="100" viewBox="0 0 180 100">
          <defs>
            <linearGradient id="reefWater" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#3BA4FF" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#5CE1E6" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#5CE1E6" stopOpacity="0.2" />
            </linearGradient>
            <clipPath id="reefClip">
              <rect x="10" y="10" width="160" height="75" rx="10" />
            </clipPath>
          </defs>
          <rect x="10" y="10" width="160" height="75" rx="10" fill="#0B0F14" stroke="#2A3441" strokeWidth="1.5" />
          <rect x="10" y={85 - fillHeight} width="160" height={fillHeight} fill="url(#reefWater)" clipPath="url(#reefClip)" className="transition-all duration-700" />
          <rect x="10" y="10" width="160" height="75" rx="10" fill="none" stroke="#2A3441" strokeWidth="1.5" />
          <text x="90" y="50" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{waterLevel}%</text>
          <text x="90" y="65" textAnchor="middle" fill="#6B7785" fontSize="9">Water Level</text>
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">pH</div>
          <div className="text-sm font-bold font-mono" style={{ color: phColor }}>{ph.toFixed(1)}</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Temp</div>
          <div className="text-sm font-bold font-mono text-[#5CE1E6]">{temp.toFixed(1)}°</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">TDS</div>
          <div className="text-sm font-bold font-mono text-[#9AA6B2]">{tds} ppm</div>
        </div>
      </div>

      <div className="flex justify-between bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441]">
        <div className="text-[10px]">
          <span className="text-[#6B7785]">Last fed: </span>
          <span className="text-[#9AA6B2] font-mono">{lastFedTime ? new Date(lastFedTime).toLocaleTimeString() : "4h ago"}</span>
        </div>
        <div className="text-[10px]">
          <span className="text-[#6B7785]">Next in: </span>
          <span className="text-[#5CE1E6] font-mono font-semibold">{feedCountdown}m</span>
        </div>
      </div>
    </div>
  );
}`,
});
if (reefTank) console.log("  ✓ Reef Tank:", reefTank.id);

// ─── Tab 3: Aquarium — Water Quality ────────────────────────────────
const waterQuality = await api("POST", "/api/automations", {
  name: "Water Quality",
  triggerTopic: "sensor/aquarium/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackQuality(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);

      // pH trend tracking
      const ph = state.get("ph") || 8.2;
      const prevPh = state.get("prevPh") || ph;
      const diff = ph - prevPh;
      state.set("phTrend", diff > 0.05 ? "up" : diff < -0.05 ? "down" : "stable");
      state.set("prevPh", ph);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function WaterQuality(props: CustomComponentProps) {
  const ph = props.state.get("ph") as number || 8.2;
  const ammonia = props.state.get("ammonia") as number || 0;
  const nitrite = props.state.get("nitrite") as number || 0;
  const nitrate = props.state.get("nitrate") as number || 0;
  const phTrend = props.state.get("phTrend") as string || "stable";

  const trendArrow = phTrend === "up" ? "↑" : phTrend === "down" ? "↓" : "→";
  const trendColor = phTrend === "stable" ? "#22C55E" : "#F59E0B";

  const QualityBar = ({ label, value, max, safe, warn }: { label: string; value: number; max: number; safe: number; warn: number }) => {
    const pct = Math.min((value / max) * 100, 100);
    const color = value <= safe ? "#22C55E" : value <= warn ? "#F59E0B" : "#EF4444";
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="text-[#9AA6B2]">{label}</span>
          <span className="font-mono font-semibold" style={{ color }}>{value} ppm</span>
        </div>
        <div className="relative w-full h-2.5 bg-[#1A2330] rounded-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500" style={{ width: pct + "%", backgroundColor: color }} />
          <div className="absolute inset-y-0 border-l border-[#6B7785]/50" style={{ left: (safe / max) * 100 + "%" }} />
          <div className="absolute inset-y-0 border-l border-[#EF4444]/50" style={{ left: (warn / max) * 100 + "%" }} />
        </div>
        <div className="flex justify-between text-[8px] text-[#6B7785]">
          <span>Safe</span>
          <span>Warning</span>
          <span>Danger</span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🧪 Water Quality</div>
        <div className="text-[10px] text-[#6B7785]">Live monitoring</div>
      </div>

      <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] flex items-center justify-between">
        <div>
          <div className="text-[10px] text-[#6B7785]">pH Level</div>
          <div className="text-2xl font-bold font-mono text-[#E6EDF3]">{ph.toFixed(2)}</div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-lg" style={{ color: trendColor }}>{trendArrow}</span>
          <span className="text-[10px]" style={{ color: trendColor }}>{phTrend}</span>
        </div>
      </div>

      <div className="space-y-3">
        <QualityBar label="Ammonia (NH₃)" value={ammonia} max={0.5} safe={0.02} warn={0.1} />
        <QualityBar label="Nitrite (NO₂)" value={nitrite} max={0.5} safe={0.02} warn={0.1} />
        <QualityBar label="Nitrate (NO₃)" value={nitrate} max={80} safe={20} warn={40} />
      </div>
    </div>
  );
}`,
});
if (waterQuality) console.log("  ✓ Water Quality:", waterQuality.id);


// ─── Tab 4: Brewery — Fermentation ──────────────────────────────────
const fermentation = await api("POST", "/api/automations", {
  name: "Fermentation",
  triggerTopic: "sensor/brewery/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackFermentation(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function Fermentation(props: CustomComponentProps) {
  const vessels = [
    { id: 1, stage: "primary", label: "IPA #47" },
    { id: 2, stage: "secondary", label: "Stout #12" },
    { id: 3, stage: "conditioning", label: "Lager #8" },
  ];

  const getTemp = (id: number) => props.state.get("vessel" + id + "-temp") as number || 0;
  const getGravity = (id: number) => props.state.get("vessel" + id + "-gravity") as number || 1.0;
  const getCo2 = (id: number) => props.state.get("vessel" + id + "-co2") as number || 0;

  const stageColor = (stage: string) => stage === "primary" ? "#F59E0B" : stage === "secondary" ? "#3BA4FF" : "#22C55E";
  const fillLevel = (id: number) => {
    const g = getGravity(id);
    return Math.min(Math.max((g - 1.0) / 0.06 * 100, 20), 95);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">🍺 Fermentation Vessels</div>

      <div className="flex justify-center gap-5">
        {vessels.map(v => {
          const temp = getTemp(v.id);
          const gravity = getGravity(v.id);
          const co2 = getCo2(v.id);
          const fill = fillLevel(v.id);
          const color = stageColor(v.stage);
          const fillH = (fill / 100) * 90;

          return (
            <div key={v.id} className="flex flex-col items-center gap-1">
              <svg width="70" height="130" viewBox="0 0 70 130">
                <defs>
                  <linearGradient id={"vesselGrad" + v.id} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.3" />
                  </linearGradient>
                  <clipPath id={"vesselClip" + v.id}>
                    <path d="M15,10 L55,10 Q60,10 60,15 L60,85 L55,105 Q35,115 35,115 Q15,105 15,105 L10,85 L10,15 Q10,10 15,10 Z" />
                  </clipPath>
                </defs>
                {/* Cylindroconical vessel shape */}
                <path d="M15,10 L55,10 Q60,10 60,15 L60,85 L55,105 Q35,115 35,115 Q15,105 15,105 L10,85 L10,15 Q10,10 15,10 Z" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
                {/* Liquid fill */}
                <rect x="10" y={115 - fillH} width="50" height={fillH} fill={"url(#vesselGrad" + v.id + ")"} clipPath={"url(#vesselClip" + v.id + ")"} className="transition-all duration-700" />
                {/* Bubble dots */}
                <circle cx="25" cy={115 - fillH + 15} r="2" fill={color} opacity="0.5" />
                <circle cx="40" cy={115 - fillH + 25} r="1.5" fill={color} opacity="0.4" />
                <circle cx="30" cy={115 - fillH + 35} r="2.5" fill={color} opacity="0.3" />
                <circle cx="45" cy={115 - fillH + 45} r="1.8" fill={color} opacity="0.45" />
                <circle cx="22" cy={115 - fillH + 55} r="2" fill={color} opacity="0.35" />
                {/* Vessel outline */}
                <path d="M15,10 L55,10 Q60,10 60,15 L60,85 L55,105 Q35,115 35,115 Q15,105 15,105 L10,85 L10,15 Q10,10 15,10 Z" fill="none" stroke="#2A3441" strokeWidth="1.5" />
                {/* Top cap */}
                <rect x="25" y="4" width="20" height="8" rx="3" fill="#1A2330" stroke="#2A3441" strokeWidth="1" />
                {/* Temperature indicator line on side */}
                <rect x="62" y="20" width="3" height="70" rx="1.5" fill="#1A2330" stroke="#2A3441" strokeWidth="0.5" />
                <rect x="62" y={90 - Math.min((temp / 30) * 70, 70)} width="3" height={Math.min((temp / 30) * 70, 70)} rx="1.5" fill={temp > 25 ? "#EF4444" : temp > 20 ? "#F59E0B" : "#3BA4FF"} className="transition-all duration-700" />
              </svg>
              {/* Stage badge */}
              <div className="px-2 py-0.5 rounded-full text-[9px] font-semibold" style={{ backgroundColor: color + "20", color: color }}>
                {v.stage}
              </div>
              <div className="text-[9px] text-[#6B7785]">{v.label}</div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        {vessels.map(v => {
          const temp = getTemp(v.id);
          const gravity = getGravity(v.id);
          const co2 = getCo2(v.id);
          const color = stageColor(v.stage);
          return (
            <div key={v.id} className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-6 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-[#9AA6B2]">{v.label}</span>
              </div>
              <div className="flex gap-3 text-[10px] font-mono">
                <span className="text-[#F59E0B]">{temp.toFixed(1)}°</span>
                <span className="text-[#3BA4FF]">{gravity.toFixed(3)} SG</span>
                <span className="text-[#9AA6B2]">{co2} psi</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}`,
});
if (fermentation) console.log("  ✓ Fermentation:", fermentation.id);

// ─── Tab 4: Brewery — Brew Day ───────────────────────────────────────
const brewDay = await api("POST", "/api/automations", {
  name: "Brew Day",
  triggerTopic: "sensor/brewery/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackBrewDay(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function BrewDay(props: CustomComponentProps) {
  const mashTemp = props.state.get("mash-temp") as number || 0;
  const boilTimer = props.state.get("boil-timer") as number || 0;
  const batchName = props.state.get("batchName") as string || "West Coast IPA #48";
  const batchStyle = props.state.get("batchStyle") as string || "American IPA";
  const targetOG = props.state.get("targetOG") as number || 1.065;

  const hopSchedule = [
    { time: 60, name: "Centennial", amount: "28g", done: true },
    { time: 30, name: "Cascade", amount: "14g", done: true },
    { time: 15, name: "Citra", amount: "28g", done: false },
    { time: 5, name: "Mosaic", amount: "14g", done: false },
    { time: 0, name: "Galaxy (whirlpool)", amount: "42g", done: false },
  ];

  const mashColor = mashTemp >= 64 && mashTemp <= 70 ? "#22C55E" : mashTemp > 70 ? "#EF4444" : "#F59E0B";

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">🍻 Brew Day</div>

      <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
        <div className="text-xs text-[#E6EDF3] font-semibold">{batchName}</div>
        <div className="text-[10px] text-[#6B7785] mt-0.5">{batchStyle} · Target OG: {targetOG}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Mash Temp</div>
          <div className="text-xl font-bold font-mono" style={{ color: mashColor }}>{mashTemp}°C</div>
          <div className="text-[9px] text-[#6B7785]">Target: 67°C</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Boil Timer</div>
          <div className="text-xl font-bold font-mono text-[#F59E0B]">{boilTimer}m</div>
          <div className="text-[9px] text-[#6B7785]">of 60 min</div>
        </div>
      </div>

      <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] overflow-hidden">
        <div className="px-3 py-1.5 border-b border-[#2A3441] text-[10px] text-[#6B7785] uppercase font-medium">Hop Schedule</div>
        {hopSchedule.map((hop, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-[#2A3441]/50 last:border-0">
            <div className={"w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] " + (hop.done ? "bg-[#22C55E]/20 border-[#22C55E] text-[#22C55E]" : "border-[#2A3441] text-[#6B7785]")}>
              {hop.done ? "✓" : ""}
            </div>
            <span className="text-[10px] text-[#6B7785] font-mono w-8">{hop.time}m</span>
            <span className={"text-[10px] flex-1 " + (hop.done ? "text-[#6B7785] line-through" : "text-[#E6EDF3]")}>{hop.name}</span>
            <span className="text-[10px] text-[#9AA6B2] font-mono">{hop.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}`,
});
if (brewDay) console.log("  ✓ Brew Day:", brewDay.id);


// ─── Tab 5: Hydroponics — Nutrient System ────────────────────────────
const nutrientSystem = await api("POST", "/api/automations", {
  name: "Nutrient System",
  triggerTopic: "sensor/hydro/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackNutrients(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function NutrientSystem(props: CustomComponentProps) {
  const res1 = props.state.get("reservoir1-level") as number || 0;
  const res2 = props.state.get("reservoir2-level") as number || 0;
  const ph = props.state.get("ph") as number || 0;
  const ec = props.state.get("ec") as number || 0;
  const waterTemp = props.state.get("water-temp") as number || 0;
  const pumpOn = props.state.get("pumpOn") as boolean ?? true;

  const phColor = ph >= 5.5 && ph <= 6.5 ? "#22C55E" : "#F59E0B";
  const ecColor = ec >= 1.0 && ec <= 2.0 ? "#22C55E" : "#F59E0B";

  const TankSVG = ({ level, label, color }: { level: number; label: string; color: string }) => {
    const fillH = (level / 100) * 55;
    return (
      <div className="flex flex-col items-center gap-1">
        <svg width="65" height="75" viewBox="0 0 65 75">
          <defs>
            <linearGradient id={"hydroTank-" + label} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0.85" />
              <stop offset="100%" stopColor={color} stopOpacity="0.3" />
            </linearGradient>
            <clipPath id={"hydroClip-" + label}>
              <rect x="7" y="10" width="51" height="55" rx="8" />
            </clipPath>
          </defs>
          <rect x="7" y="10" width="51" height="55" rx="8" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
          <rect x="7" y={65 - fillH} width="51" height={fillH} fill={"url(#hydroTank-" + label + ")"} clipPath={"url(#hydroClip-" + label + ")"} className="transition-all duration-700" />
          <rect x="7" y="10" width="51" height="55" rx="8" fill="none" stroke="#2A3441" strokeWidth="1.5" />
          <rect x="22" y="4" width="21" height="8" rx="3" fill="#1A2330" stroke="#2A3441" strokeWidth="1" />
          <text x="32.5" y="42" textAnchor="middle" fill="#E6EDF3" fontSize="11" fontFamily="monospace" fontWeight="bold">{level}%</text>
        </svg>
        <div className="text-[10px] text-[#6B7785]">{label}</div>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🧪 Nutrient System</div>
        <div className={"text-[10px] px-2 py-0.5 rounded " + (pumpOn ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#1A2330] text-[#6B7785]")}>
          Pump {pumpOn ? "ON" : "OFF"}
        </div>
      </div>

      <div className="flex justify-center gap-6">
        <TankSVG level={res1} label="Nutrient A" color="#22C55E" />
        <TankSVG level={res2} label="Nutrient B" color="#3BA4FF" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">pH</div>
          <div className="text-sm font-bold font-mono" style={{ color: phColor }}>{ph.toFixed(1)}</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">EC</div>
          <div className="text-sm font-bold font-mono" style={{ color: ecColor }}>{ec.toFixed(1)} mS</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Water °C</div>
          <div className="text-sm font-bold font-mono text-[#5CE1E6]">{waterTemp}°</div>
        </div>
      </div>
    </div>
  );
}`,
});
if (nutrientSystem) console.log("  ✓ Nutrient System:", nutrientSystem.id);

// ─── Tab 5: Hydroponics — Grow Lights ────────────────────────────────
const growLights = await api("POST", "/api/automations", {
  name: "Grow Lights",
  triggerType: "cron",
  cronExpression: "*/5 * * * *",
  ruleType: "script",
  scriptSource: `automation({
  actions: [
    function manageLights(context) {
      const hour = new Date().getHours();
      const onHour = 6;
      const offHour = 22;
      const shouldBeOn = hour >= onHour && hour < offHour;

      state.set("lightsOn", shouldBeOn);
      state.set("onHour", onHour);
      state.set("offHour", offHour);
      state.set("lastCheck", Date.now());

      // Read latest sensor values from devices
      const ppfdDevice = devices.get("sensor-hydro-ppfd");
      const dliDevice = devices.get("sensor-hydro-dli");
      if (ppfdDevice) state.set("ppfd", ppfdDevice.state.value);
      if (dliDevice) state.set("dli", dliDevice.state.value);

      if (shouldBeOn) {
        state.set("spectrumMode", "full-spectrum");
        mqtt.publish("switch/hydro/lights/command", JSON.stringify({ on: true, mode: "full-spectrum" }));
      } else {
        state.set("spectrumMode", "off");
        mqtt.publish("switch/hydro/lights/command", JSON.stringify({ on: false }));
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function GrowLights(props: CustomComponentProps) {
  const ppfd = props.state.get("ppfd") as number || 0;
  const dli = props.state.get("dli") as number || 0;
  const lightsOn = props.state.get("lightsOn") as boolean ?? true;
  const mode = props.state.get("spectrumMode") as string || "full-spectrum";
  const onHour = 6;
  const offHour = 22;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const currentHour = new Date().getHours();

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💡 Grow Lights</div>
        <div className={"text-[10px] px-2 py-0.5 rounded " + (lightsOn ? "bg-[#F59E0B]/20 text-[#F59E0B]" : "bg-[#1A2330] text-[#6B7785]")}>
          {lightsOn ? "● ON" : "○ OFF"}
        </div>
      </div>

      {/* 24h timeline bar */}
      <div className="space-y-1">
        <div className="text-[10px] text-[#6B7785]">Light Schedule (24h)</div>
        <div className="flex h-5 rounded-md overflow-hidden border border-[#2A3441]">
          {hours.map(h => {
            const isOn = h >= onHour && h < offHour;
            const isCurrent = h === currentHour;
            return (
              <div
                key={h}
                className={"flex-1 relative " + (isOn ? "bg-[#F59E0B]/30" : "bg-[#0B0F14]")}
                style={{ borderRight: "0.5px solid #2A3441" }}
              >
                {isCurrent && <div className="absolute inset-0 border-2 border-[#E6EDF3] rounded-sm" />}
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[8px] text-[#6B7785]">
          <span>0h</span>
          <span>6h</span>
          <span>12h</span>
          <span>18h</span>
          <span>24h</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">PPFD</div>
          <div className="text-xl font-bold font-mono text-[#F59E0B]">{ppfd}</div>
          <div className="text-[9px] text-[#6B7785]">μmol/m²/s</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">DLI</div>
          <div className="text-xl font-bold font-mono text-[#22C55E]">{dli}</div>
          <div className="text-[9px] text-[#6B7785]">mol/m²/day</div>
        </div>
      </div>

      <div className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441] flex items-center justify-between">
        <span className="text-[10px] text-[#6B7785]">Spectrum Mode</span>
        <span className="text-[10px] text-[#5CE1E6] font-medium capitalize">{mode}</span>
      </div>
    </div>
  );
}`,
});
if (growLights) console.log("  ✓ Grow Lights:", growLights.id);


// ─── Tab 6: Pool & Spa — Pool Monitor ────────────────────────────────
const poolMonitor = await api("POST", "/api/automations", {
  name: "Pool Monitor",
  triggerType: "cron",
  cronExpression: "*/15 * * * *",
  ruleType: "script",
  scriptSource: `automation({
  actions: [
    function checkPoolChemistry(context) {
      // Read latest sensor values from device registry
      const tempDev = devices.get("sensor-pool-temp");
      const chlorineDev = devices.get("sensor-pool-chlorine");
      const phDev = devices.get("sensor-pool-ph");
      const orpDev = devices.get("sensor-pool-orp");
      const filterDev = devices.get("sensor-pool-filter-pressure");

      if (tempDev) state.set("temp", tempDev.state.value);
      if (chlorineDev) state.set("chlorine", chlorineDev.state.value);
      if (phDev) state.set("ph", phDev.state.value);
      if (orpDev) state.set("orp", orpDev.state.value);
      if (filterDev) state.set("filter-pressure", filterDev.state.value);

      state.set("pumpOn", true);
      state.set("lastCheck", Date.now());
      state.set("checksToday", (state.get("checksToday") || 0) + 1);

      // Alert if chemistry is off
      const ph = state.get("ph") || 7.4;
      const chlorine = state.get("chlorine") || 1.5;
      if (ph < 7.2 || ph > 7.6) log.warn("Pool pH out of range: " + ph);
      if (chlorine < 1.0 || chlorine > 3.0) log.warn("Pool chlorine out of range: " + chlorine);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function PoolMonitor(props: CustomComponentProps) {
  const temp = props.state.get("temp") as number || 0;
  const chlorine = props.state.get("chlorine") as number || 0;
  const ph = props.state.get("ph") as number || 0;
  const orp = props.state.get("orp") as number || 0;
  const pumpOn = props.state.get("pumpOn") as boolean ?? true;
  const filterPressure = props.state.get("filter-pressure") as number || 0;

  const tempAngle = Math.min(Math.max((temp - 15) / 25 * 180, 0), 180);
  const chlorineOk = chlorine >= 1.0 && chlorine <= 3.0;
  const phOk = ph >= 7.2 && ph <= 7.6;

  // SVG arc for temperature gauge
  const arcPath = (angle: number) => {
    const rad = (angle - 90) * Math.PI / 180;
    const x = 60 + 40 * Math.cos(rad);
    const y = 60 + 40 * Math.sin(rad);
    const largeArc = angle > 180 ? 1 : 0;
    return "M 20 60 A 40 40 0 " + largeArc + " 1 " + x.toFixed(1) + " " + y.toFixed(1);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🏊 Pool Monitor</div>
        <div className={"text-[10px] px-2 py-0.5 rounded " + (pumpOn ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-[#EF4444]")}>
          Pump {pumpOn ? "ON" : "OFF"}
        </div>
      </div>

      {/* Temperature arc gauge */}
      <div className="flex justify-center">
        <svg width="120" height="75" viewBox="0 0 120 75">
          <path d={arcPath(180)} fill="none" stroke="#1A2330" strokeWidth="8" strokeLinecap="round" />
          <path d={arcPath(tempAngle)} fill="none" stroke="#5CE1E6" strokeWidth="8" strokeLinecap="round" className="transition-all duration-700" />
          <text x="60" y="55" textAnchor="middle" fill="#E6EDF3" fontSize="18" fontFamily="monospace" fontWeight="bold">{temp.toFixed(1)}°</text>
          <text x="60" y="68" textAnchor="middle" fill="#6B7785" fontSize="8">Pool Temperature</text>
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441]">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-[#6B7785]">Chlorine</span>
            <span className="font-mono font-semibold" style={{ color: chlorineOk ? "#22C55E" : "#F59E0B" }}>{chlorine.toFixed(1)} ppm</span>
          </div>
          <div className="w-full h-1.5 bg-[#1A2330] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: Math.min((chlorine / 5) * 100, 100) + "%", backgroundColor: chlorineOk ? "#22C55E" : "#F59E0B" }} />
          </div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441]">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-[#6B7785]">pH</span>
            <span className="font-mono font-semibold" style={{ color: phOk ? "#22C55E" : "#F59E0B" }}>{ph.toFixed(1)}</span>
          </div>
          <div className="w-full h-1.5 bg-[#1A2330] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: Math.min(((ph - 6) / 3) * 100, 100) + "%", backgroundColor: phOk ? "#22C55E" : "#F59E0B" }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">ORP</div>
          <div className="text-sm font-bold font-mono text-[#3BA4FF]">{orp} mV</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Filter PSI</div>
          <div className="text-sm font-bold font-mono text-[#9AA6B2]">{filterPressure}</div>
        </div>
      </div>
    </div>
  );
}`,
});
if (poolMonitor) console.log("  ✓ Pool Monitor:", poolMonitor.id);

// ─── Tab 6: Pool & Spa — Spa Controls ───────────────────────────────
const spaControls = await api("POST", "/api/automations", {
  name: "Spa Controls",
  triggerTopic: "sensor/spa/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackSpa(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function SpaControls(props: CustomComponentProps) {
  const temp = props.state.get("temp") as number || 38.5;
  const setpoint = props.state.get("setpoint") as number || 39;
  const jetsOn = props.state.get("jetsOn") as boolean || false;
  const heaterOn = props.state.get("heaterOn") as boolean ?? true;
  const coverOpen = props.state.get("coverOpen") as boolean || false;

  const adjustTemp = (delta: number) => {
    const newTemp = setpoint + delta;
    props.stateSet("setpoint", newTemp);
    props.mqttPublish("switch/spa/setpoint/command", JSON.stringify({ value: newTemp }));
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">♨️ Spa Controls</div>
        <div className={"text-[10px] px-2 py-0.5 rounded " + (coverOpen ? "bg-[#F59E0B]/20 text-[#F59E0B]" : "bg-[#22C55E]/20 text-[#22C55E]")}>
          Cover {coverOpen ? "Open" : "Closed"}
        </div>
      </div>

      {/* Temperature setpoint control */}
      <div className="bg-[#0B0F14] rounded-lg p-4 border border-[#2A3441] text-center">
        <div className="text-[10px] text-[#6B7785] mb-1">Temperature Setpoint</div>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => adjustTemp(-0.5)}
            className="w-8 h-8 rounded-full bg-[#1A2330] border border-[#2A3441] text-[#E6EDF3] text-lg font-bold hover:bg-[#2A3441] transition-colors"
          >−</button>
          <div className="text-3xl font-bold font-mono text-[#5CE1E6]">{setpoint.toFixed(1)}°</div>
          <button
            onClick={() => adjustTemp(0.5)}
            className="w-8 h-8 rounded-full bg-[#1A2330] border border-[#2A3441] text-[#E6EDF3] text-lg font-bold hover:bg-[#2A3441] transition-colors"
          >+</button>
        </div>
        <div className="text-[10px] text-[#6B7785] mt-1">Current: {temp.toFixed(1)}°C</div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => props.mqttPublish("switch/spa/jets/command", JSON.stringify({ on: !jetsOn }))}
          className={"rounded-lg p-3 border text-center transition-colors " + (jetsOn ? "bg-[#3BA4FF]/20 border-[#3BA4FF]/30" : "bg-[#0B0F14] border-[#2A3441]")}
        >
          <div className="text-[10px] text-[#6B7785]">Jets</div>
          <div className={"text-sm font-semibold " + (jetsOn ? "text-[#3BA4FF]" : "text-[#6B7785]")}>{jetsOn ? "ON" : "OFF"}</div>
        </button>
        <div className={"rounded-lg p-3 border text-center " + (heaterOn ? "bg-[#EF4444]/10 border-[#EF4444]/30" : "bg-[#0B0F14] border-[#2A3441]")}>
          <div className="text-[10px] text-[#6B7785]">Heater</div>
          <div className={"text-sm font-semibold " + (heaterOn ? "text-[#EF4444]" : "text-[#6B7785]")}>{heaterOn ? "Heating" : "OFF"}</div>
        </div>
      </div>
    </div>
  );
}`,
});
if (spaControls) console.log("  ✓ Spa Controls:", spaControls.id);


// ─── Tab 7: Server Room — Rack Monitor ───────────────────────────────
const rackMonitor = await api("POST", "/api/automations", {
  name: "Rack Monitor",
  triggerType: "cron",
  cronExpression: "* * * * *",
  ruleType: "script",
  scriptSource: `automation({
  actions: [
    function pollRackSensors(context) {
      // Poll all server sensors from device registry
      for (let i = 1; i <= 4; i++) {
        const tempDev = devices.get("sensor-rack-server" + i + "-temp");
        const cpuDev = devices.get("sensor-rack-server" + i + "-cpu");
        const fanDev = devices.get("sensor-rack-server" + i + "-fan");
        if (tempDev) state.set("server" + i + "-temp", tempDev.state.value);
        if (cpuDev) state.set("server" + i + "-cpu", cpuDev.state.value);
        if (fanDev) state.set("server" + i + "-fan", fanDev.state.value);
      }

      state.set("lastUpdate", Date.now());

      // Calculate overall rack temp
      const temps = [
        state.get("server1-temp") || 0,
        state.get("server2-temp") || 0,
        state.get("server3-temp") || 0,
        state.get("server4-temp") || 0,
      ];
      state.set("avgTemp", temps.reduce((a, b) => a + b, 0) / temps.length);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function RackMonitor(props: CustomComponentProps) {
  const servers = [
    { id: 1, name: "Web Server" },
    { id: 2, name: "Database" },
    { id: 3, name: "ML Worker" },
    { id: 4, name: "Storage" },
  ];

  const getTemp = (id: number) => props.state.get("server" + id + "-temp") as number || 0;
  const getCpu = (id: number) => props.state.get("server" + id + "-cpu") as number || 0;
  const getFan = (id: number) => props.state.get("server" + id + "-fan") as number || 0;
  const avgTemp = props.state.get("avgTemp") as number || 0;

  const tempColor = (t: number) => t > 50 ? "#EF4444" : t > 40 ? "#F59E0B" : "#22C55E";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🖥️ Rack Monitor</div>
        <div className={"text-[10px] px-2 py-0.5 rounded font-mono font-semibold " + (avgTemp > 50 ? "bg-[#EF4444]/20 text-[#EF4444]" : avgTemp > 40 ? "bg-[#F59E0B]/20 text-[#F59E0B]" : "bg-[#22C55E]/20 text-[#22C55E]")}>
          Avg: {avgTemp.toFixed(1)}°C
        </div>
      </div>

      {/* Rack enclosure */}
      <div className="relative border-2 border-[#2A3441] rounded-lg bg-[#0B0F14] p-1">
        {/* Rack rails */}
        <div className="absolute left-0 top-0 bottom-0 w-2 bg-[#1A2330] rounded-l-lg flex flex-col justify-around items-center py-2">
          {[0,1,2,3,4,5,6,7].map(i => <div key={i} className="w-1 h-1 rounded-full bg-[#2A3441]" />)}
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-2 bg-[#1A2330] rounded-r-lg flex flex-col justify-around items-center py-2">
          {[0,1,2,3,4,5,6,7].map(i => <div key={i} className="w-1 h-1 rounded-full bg-[#2A3441]" />)}
        </div>

        <div className="ml-3 mr-3 space-y-1.5 py-1">
          {servers.map(s => {
            const temp = getTemp(s.id);
            const cpu = getCpu(s.id);
            const fan = getFan(s.id);
            const color = tempColor(temp);

            // CPU arc gauge
            const cpuAngle = (cpu / 100) * 180;

            return (
              <div key={s.id} className="bg-[#121821] rounded-md p-2 border border-[#2A3441] flex items-center gap-2">
                {/* LED status dot */}
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: "0 0 4px " + color }} />

                {/* Server name */}
                <div className="flex-shrink-0 w-16">
                  <span className="text-[10px] text-[#9AA6B2] font-medium">{s.name}</span>
                </div>

                {/* Temp bar */}
                <div className="flex-1 flex items-center gap-1.5">
                  <div className="flex-1 h-3 bg-[#1A2330] rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: Math.min((temp / 70) * 100, 100) + "%", backgroundColor: color }} />
                  </div>
                  <span className="text-[9px] font-mono font-semibold w-8 text-right" style={{ color }}>{temp}°</span>
                </div>

                {/* CPU arc gauge */}
                <svg width="28" height="18" viewBox="0 0 28 18" className="flex-shrink-0">
                  <path d="M 4 16 A 10 10 0 0 1 24 16" fill="none" stroke="#1A2330" strokeWidth="3" strokeLinecap="round" />
                  <path d="M 4 16 A 10 10 0 0 1 24 16" fill="none" stroke="#3BA4FF" strokeWidth="3" strokeLinecap="round" strokeDasharray={Math.PI * 10} strokeDashoffset={Math.PI * 10 - (cpuAngle / 180) * Math.PI * 10} className="transition-all duration-700" />
                  <text x="14" y="15" textAnchor="middle" fill="#3BA4FF" fontSize="6" fontFamily="monospace">{cpu}%</text>
                </svg>

                {/* Fan RPM */}
                <span className="text-[8px] font-mono text-[#6B7785] w-12 text-right">{fan} RPM</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}`,
});
if (rackMonitor) console.log("  ✓ Rack Monitor:", rackMonitor.id);

// ─── Tab 7: Server Room — Power & Network ────────────────────────────
const powerNetwork = await api("POST", "/api/automations", {
  name: "Power & Network",
  triggerTopic: "sensor/ups/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackPower(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function PowerNetwork(props: CustomComponentProps) {
  const battery = props.state.get("battery") as number || 0;
  const load = props.state.get("load") as number || 0;
  const inputV = props.state.get("input-voltage") as number || 0;
  const outputV = props.state.get("output-voltage") as number || 0;
  const throughputUp = props.state.get("throughput-up") as number || 0;
  const throughputDown = props.state.get("throughput-down") as number || 0;
  const uptime = props.state.get("uptime") as number || 0;

  const batteryColor = battery > 70 ? "#22C55E" : battery > 30 ? "#F59E0B" : "#EF4444";
  const loadColor = load < 60 ? "#22C55E" : load < 80 ? "#F59E0B" : "#EF4444";
  const uptimeDays = Math.floor(uptime / 1440);
  const uptimeHours = Math.floor((uptime % 1440) / 60);

  const fillH = (battery / 100) * 45;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">⚡ Power & Network</div>
        <div className="text-[10px] text-[#6B7785]">Uptime: {uptimeDays}d {uptimeHours}h</div>
      </div>

      <div className="flex items-center gap-4">
        {/* UPS Battery tank */}
        <div className="flex flex-col items-center">
          <svg width="50" height="65" viewBox="0 0 50 65">
            <defs>
              <linearGradient id="upsGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={batteryColor} stopOpacity="0.9" />
                <stop offset="100%" stopColor={batteryColor} stopOpacity="0.4" />
              </linearGradient>
              <clipPath id="upsClip">
                <rect x="6" y="10" width="38" height="45" rx="6" />
              </clipPath>
            </defs>
            <rect x="6" y="10" width="38" height="45" rx="6" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
            <rect x="6" y={55 - fillH} width="38" height={fillH} fill="url(#upsGrad)" clipPath="url(#upsClip)" className="transition-all duration-700" />
            <rect x="6" y="10" width="38" height="45" rx="6" fill="none" stroke="#2A3441" strokeWidth="1.5" />
            <rect x="16" y="5" width="18" height="7" rx="2" fill="#1A2330" stroke="#2A3441" strokeWidth="1" />
            <text x="25" y="37" textAnchor="middle" fill="#E6EDF3" fontSize="10" fontFamily="monospace" fontWeight="bold">{battery}%</text>
          </svg>
          <div className="text-[9px] text-[#6B7785] mt-1">UPS</div>
        </div>

        <div className="flex-1 space-y-2">
          <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-[#6B7785]">Load</span>
              <span className="font-mono font-semibold" style={{ color: loadColor }}>{load}%</span>
            </div>
            <div className="w-full h-1.5 bg-[#1A2330] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: load + "%", backgroundColor: loadColor }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-[#0B0F14] rounded p-1.5 border border-[#2A3441] text-center">
              <div className="text-[8px] text-[#6B7785]">In</div>
              <div className="text-[10px] font-mono text-[#9AA6B2]">{inputV}V</div>
            </div>
            <div className="bg-[#0B0F14] rounded p-1.5 border border-[#2A3441] text-center">
              <div className="text-[8px] text-[#6B7785]">Out</div>
              <div className="text-[10px] font-mono text-[#9AA6B2]">{outputV}V</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
        <div className="text-[10px] text-[#6B7785] mb-2">Network Throughput</div>
        <div className="flex justify-between">
          <div className="text-center">
            <div className="text-[10px] text-[#22C55E]">↑ Upload</div>
            <div className="text-sm font-bold font-mono text-[#22C55E]">{throughputUp} Mbps</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-[#3BA4FF]">↓ Download</div>
            <div className="text-sm font-bold font-mono text-[#3BA4FF]">{throughputDown} Mbps</div>
          </div>
        </div>
      </div>
    </div>
  );
}`,
});
if (powerNetwork) console.log("  ✓ Power & Network:", powerNetwork.id);


// ─── Tab 8: Weather — Weather Station ────────────────────────────────
const weatherStation = await api("POST", "/api/automations", {
  name: "Weather Station",
  triggerTopic: "sensor/weather/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackWeather(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function WeatherStation(props: CustomComponentProps) {
  const temp = props.state.get("outdoor-temp") as number || 0;
  const windSpeed = props.state.get("wind-speed") as number || 0;
  const windDir = props.state.get("wind-direction") as number || 0;
  const rain = props.state.get("rain") as number || 0;
  const pressure = props.state.get("pressure") as number || 0;
  const uv = props.state.get("uv-index") as number || 0;

  const uvColor = uv <= 2 ? "#22C55E" : uv <= 5 ? "#F59E0B" : uv <= 7 ? "#EF4444" : "#9333EA";
  const uvLabel = uv <= 2 ? "Low" : uv <= 5 ? "Moderate" : uv <= 7 ? "High" : "Extreme";

  // Wind direction arrow rotation
  const arrowRotation = windDir;

  // Thermometer calculations
  const tempMin = -10;
  const tempMax = 50;
  const tempPct = Math.min(Math.max((temp - tempMin) / (tempMax - tempMin), 0), 1);
  const mercuryHeight = tempPct * 70;
  const tempColor = temp > 35 ? "#EF4444" : temp > 25 ? "#F59E0B" : temp > 10 ? "#22C55E" : "#3BA4FF";

  // Wind speed arc (max 100 km/h)
  const maxWind = 100;
  const windPct = Math.min(windSpeed / maxWind, 1);
  const windArcLength = windPct * Math.PI * 24;

  // Pressure trend (simplified)
  const prevPressure = 1013;
  const pressureTrend = pressure > prevPressure ? "up" : pressure < prevPressure ? "down" : "stable";

  // Rain bar chart (simulated hourly data)
  const rainBars = [rain * 0.2, rain * 0.5, rain * 0.8, rain * 1.0, rain * 0.6, rain * 0.3];

  // UV position on gradient bar
  const uvPct = Math.min((uv / 11) * 100, 100);

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">🌤️ Weather Station</div>

      <div className="grid grid-cols-2 gap-4">
        {/* Thermometer SVG */}
        <div className="flex flex-col items-center justify-center bg-[#0B0F14] rounded-xl p-3 border border-[#2A3441]">
          <svg width="50" height="120" viewBox="0 0 50 120">
            {/* Thermometer body */}
            <rect x="18" y="5" width="14" height="85" rx="7" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
            {/* Bulb */}
            <circle cx="25" cy="100" r="12" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
            {/* Mercury fill */}
            <rect x="21" y={90 - mercuryHeight} width="8" height={mercuryHeight} rx="4" fill={tempColor} className="transition-all duration-700" />
            <circle cx="25" cy="100" r="9" fill={tempColor} className="transition-all duration-700" />
            {/* Degree markings */}
            <line x1="33" y1="15" x2="38" y2="15" stroke="#6B7785" strokeWidth="0.8" />
            <text x="40" y="18" fill="#6B7785" fontSize="7">40°</text>
            <line x1="33" y1="35" x2="38" y2="35" stroke="#6B7785" strokeWidth="0.8" />
            <text x="40" y="38" fill="#6B7785" fontSize="7">25°</text>
            <line x1="33" y1="55" x2="38" y2="55" stroke="#6B7785" strokeWidth="0.8" />
            <text x="40" y="58" fill="#6B7785" fontSize="7">10°</text>
            <line x1="33" y1="75" x2="38" y2="75" stroke="#6B7785" strokeWidth="0.8" />
            <text x="40" y="78" fill="#6B7785" fontSize="7">-5°</text>
          </svg>
          <div className="text-xl font-bold font-mono text-[#E6EDF3] mt-2">{temp.toFixed(1)}°C</div>
          <div className="text-[9px] text-[#6B7785]">Outdoor</div>
        </div>

        {/* Wind compass with speed ring */}
        <div className="flex flex-col items-center justify-center bg-[#0B0F14] rounded-xl p-3 border border-[#2A3441]">
          <svg width="100" height="100" viewBox="0 0 100 100">
            {/* Speed ring background */}
            <circle cx="50" cy="50" r="45" fill="none" stroke="#1A2330" strokeWidth="5" />
            {/* Speed ring fill */}
            <circle cx="50" cy="50" r="45" fill="none" stroke="#5CE1E6" strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 45} strokeDashoffset={2 * Math.PI * 45 - windPct * 2 * Math.PI * 45} transform="rotate(-90 50 50)" className="transition-all duration-700" />
            {/* Compass circle */}
            <circle cx="50" cy="50" r="30" fill="none" stroke="#2A3441" strokeWidth="1.5" />
            {/* Cardinal directions */}
            <text x="50" y="24" textAnchor="middle" fill="#6B7785" fontSize="8" fontWeight="bold">N</text>
            <text x="50" y="81" textAnchor="middle" fill="#6B7785" fontSize="8">S</text>
            <text x="21" y="53" textAnchor="middle" fill="#6B7785" fontSize="8">W</text>
            <text x="79" y="53" textAnchor="middle" fill="#6B7785" fontSize="8">E</text>
            {/* Direction arrow */}
            <g transform={"rotate(" + arrowRotation + " 50 50)"}>
              <polygon points="50,24 55,60 50,55 45,60" fill="#5CE1E6" opacity="0.9" />
            </g>
            <circle cx="50" cy="50" r="4" fill="#5CE1E6" />
          </svg>
          <div className="text-lg font-bold font-mono text-[#E6EDF3] mt-2">{windSpeed.toFixed(1)} km/h</div>
          <div className="text-[9px] text-[#6B7785]">{windDir}° ({windDir >= 315 || windDir < 45 ? "N" : windDir < 135 ? "E" : windDir < 225 ? "S" : "W"})</div>
        </div>
      </div>

      {/* Rain mini bar chart */}
      <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] text-[#6B7785]">🌧️ Rain Accumulation</div>
          <div className="text-xs font-mono font-semibold text-[#3BA4FF]">{rain} mm</div>
        </div>
        <div className="flex items-end gap-1 h-8">
          {rainBars.map((val, i) => (
            <div key={i} className="flex-1 bg-[#3BA4FF] rounded-t-sm transition-all duration-700 opacity-70" style={{ height: Math.max((val / Math.max(...rainBars, 1)) * 100, 5) + "%" }} />
          ))}
        </div>
        <div className="flex justify-between text-[7px] text-[#6B7785] mt-1">
          <span>-6h</span><span>-5h</span><span>-4h</span><span>-3h</span><span>-2h</span><span>-1h</span>
        </div>
      </div>

      {/* Pressure with trend arrow */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441] flex items-center justify-between">
          <div>
            <div className="text-[10px] text-[#6B7785]">📊 Pressure</div>
            <div className="text-sm font-bold font-mono text-[#9AA6B2]">{pressure} hPa</div>
          </div>
          <svg width="20" height="20" viewBox="0 0 20 20">
            {pressureTrend === "up" && <path d="M10,4 L16,12 L12,12 L12,16 L8,16 L8,12 L4,12 Z" fill="#22C55E" />}
            {pressureTrend === "down" && <path d="M10,16 L16,8 L12,8 L12,4 L8,4 L8,8 L4,8 Z" fill="#EF4444" />}
            {pressureTrend === "stable" && <rect x="4" y="8" width="12" height="4" rx="2" fill="#F59E0B" />}
          </svg>
        </div>
      </div>

      {/* UV Index gradient bar */}
      <div className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441]">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] text-[#6B7785]">☀️ UV Index</div>
          <div className="text-xs font-mono font-semibold" style={{ color: uvColor }}>{uv} - {uvLabel}</div>
        </div>
        <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "linear-gradient(to right, #22C55E, #F59E0B, #EF4444, #9333EA)" }}>
          <div className="absolute top-0.5 w-2 h-2 rounded-full bg-[#E6EDF3] border border-[#0B0F14] transition-all duration-700" style={{ left: "calc(" + uvPct + "% - 4px)" }} />
        </div>
        <div className="flex justify-between text-[7px] text-[#6B7785] mt-0.5">
          <span>Low</span><span>Moderate</span><span>High</span><span>Extreme</span>
        </div>
      </div>
    </div>
  );
}`,
});
if (weatherStation) console.log("  ✓ Weather Station:", weatherStation.id);

// ─── Tab 8: Weather — Climate Overview ───────────────────────────────
const climateOverview = await api("POST", "/api/automations", {
  name: "Climate Overview",
  triggerTopic: "sensor/room/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return typeof context.state.value === "number";
    },
  ],
  actions: [
    function trackRooms(context) {
      const room = context.topic.split("/")[2].replace("-temp", "");
      const temp = context.state.value;
      state.set("temp_" + room, temp);
      state.set("lastUpdate", Date.now());

      // Track daily min/max per room
      const minKey = "min_" + room;
      const maxKey = "max_" + room;
      const prevMin = state.get(minKey);
      const prevMax = state.get(maxKey);
      if (prevMin === undefined || temp < prevMin) state.set(minKey, temp);
      if (prevMax === undefined || temp > prevMax) state.set(maxKey, temp);

      // Comfort assessment
      const comfort = temp >= 19 && temp <= 23 ? "comfortable" : temp < 19 ? "cool" : "warm";
      state.set("comfort_" + room, comfort);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function ClimateOverview(props: CustomComponentProps) {
  const rooms = [
    { id: "kitchen", label: "Kitchen" },
    { id: "living-room", label: "Living Room" },
    { id: "bedroom", label: "Bedroom" },
    { id: "office", label: "Office" },
    { id: "bathroom", label: "Bathroom" },
  ];

  const getTemp = (id: string) => props.state.get("temp_" + id) as number | undefined;
  const getMin = (id: string) => props.state.get("min_" + id) as number | undefined;
  const getMax = (id: string) => props.state.get("max_" + id) as number | undefined;
  const getComfort = (id: string) => props.state.get("comfort_" + id) as string || "—";

  const comfortColor = (c: string) => c === "comfortable" ? "#22C55E" : c === "cool" ? "#3BA4FF" : c === "warm" ? "#F59E0B" : "#6B7785";
  const comfortIcon = (c: string) => c === "comfortable" ? "✓" : c === "cool" ? "❄" : c === "warm" ? "☀" : "—";

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">🌡️ Climate Overview</div>

      <div className="space-y-2">
        {rooms.map(room => {
          const temp = getTemp(room.id);
          const min = getMin(room.id);
          const max = getMax(room.id);
          const comfort = getComfort(room.id);

          return (
            <div key={room.id} className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: comfortColor(comfort) }}>{comfortIcon(comfort)}</span>
                  <span className="text-xs text-[#9AA6B2]">{room.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-[9px] text-[#6B7785] font-mono">
                    {min !== undefined ? min.toFixed(1) + "°" : "—"} / {max !== undefined ? max.toFixed(1) + "°" : "—"}
                  </div>
                  <div className="text-sm font-bold font-mono text-[#E6EDF3]">
                    {temp !== undefined ? temp.toFixed(1) + "°" : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 bg-[#1A2330] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: temp ? Math.min(((temp - 15) / 15) * 100, 100) + "%" : "0%", backgroundColor: comfortColor(comfort) }} />
                </div>
                <span className="text-[8px] capitalize" style={{ color: comfortColor(comfort) }}>{comfort}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}`,
});
if (climateOverview) console.log("  ✓ Climate Overview:", climateOverview.id);

// ─── Tab 8: Weather — Weekly Forecast ────────────────────────────────
const weeklyForecast = await api("POST", "/api/automations", {
  name: "Weekly Forecast",
  triggerType: "cron",
  cronExpression: "0 */6 * * *",
  ruleType: "script",
  scriptSource: `automation({
  actions: [
    function fetchForecast(context) {
      // In a real setup this would use http.get to fetch weather API data.
      // For demo purposes we set hardcoded forecast data into state.
      state.set("today", { temp: 24, high: 27, low: 18, condition: "partly-cloudy", description: "Partly cloudy with afternoon sun" });
      state.set("forecast", [
        { day: "Mon", high: 27, low: 18, condition: "sunny", rainChance: 10 },
        { day: "Tue", high: 25, low: 17, condition: "partly-cloudy", rainChance: 20 },
        { day: "Wed", high: 22, low: 15, condition: "rainy", rainChance: 75 },
        { day: "Thu", high: 20, low: 14, condition: "stormy", rainChance: 90 },
        { day: "Fri", high: 23, low: 16, condition: "partly-cloudy", rainChance: 30 },
        { day: "Sat", high: 26, low: 18, condition: "sunny", rainChance: 5 },
        { day: "Sun", high: 28, low: 19, condition: "sunny", rainChance: 0 },
      ]);
      state.set("lastFetch", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function WeeklyForecast(props: CustomComponentProps) {
  const today = props.state.get("today") as { temp: number; high: number; low: number; condition: string; description: string } || { temp: 24, high: 27, low: 18, condition: "partly-cloudy", description: "Partly cloudy with afternoon sun" };
  const forecast = props.state.get("forecast") as Array<{ day: string; high: number; low: number; condition: string; rainChance: number }> || [];

  const conditionIcon = (c: string) => c === "sunny" ? "☀️" : c === "partly-cloudy" ? "⛅" : c === "rainy" ? "🌧️" : c === "stormy" ? "⛈️" : "☀️";
  const conditionColor = (c: string) => c === "sunny" ? "#F59E0B" : c === "partly-cloudy" ? "#9AA6B2" : c === "rainy" ? "#3BA4FF" : c === "stormy" ? "#EF4444" : "#F59E0B";

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">📅 Weekly Forecast</div>

      {/* Today's summary — larger and more prominent */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-5">
        <div className="flex items-center gap-5">
          <div className="text-5xl">{conditionIcon(today.condition)}</div>
          <div className="flex-1">
            <div className="text-3xl font-bold font-mono text-[#E6EDF3]">{today.temp}°C</div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-[#9AA6B2]">H: <span className="text-[#E6EDF3] font-mono font-semibold">{today.high}°</span></span>
              <span className="text-xs text-[#9AA6B2]">L: <span className="text-[#E6EDF3] font-mono font-semibold">{today.low}°</span></span>
            </div>
            <div className="text-xs text-[#6B7785] mt-2">{today.description}</div>
          </div>
        </div>
      </div>

      {/* 7-day forecast — horizontal row, properly sized and centered */}
      <div className="flex gap-2 justify-between">
        {forecast.map((day, i) => (
          <div key={i} className="flex-1 bg-[#0B0F14] rounded-lg border border-[#2A3441] p-3 flex flex-col items-center gap-2">
            <span className="text-[11px] text-[#9AA6B2] font-semibold">{day.day}</span>
            <span className="text-2xl">{conditionIcon(day.condition)}</span>
            <div className="text-center">
              <div className="text-xs font-mono font-bold text-[#E6EDF3]">{day.high}°</div>
              <div className="text-[10px] font-mono text-[#6B7785]">{day.low}°</div>
            </div>
            <div className="w-full">
              <div className="w-full h-2 bg-[#1A2330] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: day.rainChance + "%", backgroundColor: day.rainChance > 50 ? "#3BA4FF" : "#3BA4FF80" }} />
              </div>
              <div className="text-[8px] text-[#6B7785] text-center mt-0.5 font-mono">{day.rainChance}% rain</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}`,
});
if (weeklyForecast) console.log("  ✓ Weekly Forecast:", weeklyForecast.id);


// ═══════════════════════════════════════════════════════════════════════
// 3. SEED AUTOMATION STATE
// ═══════════════════════════════════════════════════════════════════════
console.log("\n3. Populating automation state...");

if (smartIrrigation) {
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "moisture_zone1", value: 42 });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "moisture_zone2", value: 58 });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "moisture_zone3", value: 31 });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "zone1_watering", value: true });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "zone2_watering", value: false });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "zone3_watering", value: true });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "tank1Level", value: 78 });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "tank2Level", value: 55 });
  await api("PUT", `/api/automations/${smartIrrigation.id}/state`, { key: "totalCycles", value: 147 });
  console.log("  ✓ Smart Irrigation state");
}

if (greenhouse) {
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "temp", value: 28.3 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "humidity", value: 72 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "co2", value: 420 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "ventActive", value: true });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_tomato_moisture", value: 65 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_pepper_moisture", value: 52 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_lettuce_moisture", value: 78 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_herbs_moisture", value: 60 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_tomato_light", value: 850 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_pepper_light", value: 720 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_lettuce_light", value: 450 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_herbs_light", value: 380 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_tomato_stage", value: "fruiting" });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_pepper_stage", value: "flowering" });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_lettuce_stage", value: "vegetative" });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "zone_herbs_stage", value: "vegetative" });
  console.log("  ✓ Greenhouse state");
}

if (tankTransfer) {
  await api("PUT", `/api/automations/${tankTransfer.id}/state`, { key: "mainTankLevel", value: 35 });
  await api("PUT", `/api/automations/${tankTransfer.id}/state`, { key: "feederTankLevel", value: 72 });
  await api("PUT", `/api/automations/${tankTransfer.id}/state`, { key: "pumpActive", value: true });
  await api("PUT", `/api/automations/${tankTransfer.id}/state`, { key: "totalTransfers", value: 23 });
  console.log("  ✓ Tank Transfer state");
}

if (energyMonitor) {
  await api("PUT", `/api/automations/${energyMonitor.id}/state`, { key: "solar-production", value: 3.2 });
  await api("PUT", `/api/automations/${energyMonitor.id}/state`, { key: "grid-consumption", value: 1.4 });
  await api("PUT", `/api/automations/${energyMonitor.id}/state`, { key: "battery-level", value: 72 });
  await api("PUT", `/api/automations/${energyMonitor.id}/state`, { key: "net", value: 1.8 });
  await api("PUT", `/api/automations/${energyMonitor.id}/state`, { key: "selfSufficiency", value: 70 });
  console.log("  ✓ Energy Monitor state");
}

if (securityMonitor) {
  const events = [
    { zone: "front-door", time: Date.now() - 300000 },
    { zone: "driveway", time: Date.now() - 1800000 },
    { zone: "garage", time: Date.now() - 7200000 },
    { zone: "backyard", time: Date.now() - 14400000 },
  ];
  await api("PUT", `/api/automations/${securityMonitor.id}/state`, { key: "events", value: events });
  await api("PUT", `/api/automations/${securityMonitor.id}/state`, { key: "zone_front-door", value: true });
  await api("PUT", `/api/automations/${securityMonitor.id}/state`, { key: "zone_backyard", value: false });
  await api("PUT", `/api/automations/${securityMonitor.id}/state`, { key: "zone_garage", value: false });
  await api("PUT", `/api/automations/${securityMonitor.id}/state`, { key: "zone_driveway", value: false });
  await api("PUT", `/api/automations/${securityMonitor.id}/state`, { key: "totalAlerts", value: 34 });
  console.log("  ✓ Security Monitor state");
}

if (reefTank) {
  await api("PUT", `/api/automations/${reefTank.id}/state`, { key: "water-level", value: 92 });
  await api("PUT", `/api/automations/${reefTank.id}/state`, { key: "ph", value: 8.2 });
  await api("PUT", `/api/automations/${reefTank.id}/state`, { key: "temp", value: 25.5 });
  await api("PUT", `/api/automations/${reefTank.id}/state`, { key: "tds", value: 450 });
  await api("PUT", `/api/automations/${reefTank.id}/state`, { key: "lastFedTime", value: Date.now() - 14400000 });
  await api("PUT", `/api/automations/${reefTank.id}/state`, { key: "feedCountdown", value: 240 });
  console.log("  ✓ Reef Tank state");
}

if (waterQuality) {
  await api("PUT", `/api/automations/${waterQuality.id}/state`, { key: "ph", value: 8.2 });
  await api("PUT", `/api/automations/${waterQuality.id}/state`, { key: "ammonia", value: 0.02 });
  await api("PUT", `/api/automations/${waterQuality.id}/state`, { key: "nitrite", value: 0.01 });
  await api("PUT", `/api/automations/${waterQuality.id}/state`, { key: "nitrate", value: 15 });
  await api("PUT", `/api/automations/${waterQuality.id}/state`, { key: "phTrend", value: "stable" });
  console.log("  ✓ Water Quality state");
}

if (fermentation) {
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel1-temp", value: 18.5 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel1-gravity", value: 1.045 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel1-co2", value: 12 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel2-temp", value: 20.1 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel2-gravity", value: 1.012 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel2-co2", value: 8 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel3-temp", value: 4.2 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel3-gravity", value: 1.005 });
  await api("PUT", `/api/automations/${fermentation.id}/state`, { key: "vessel3-co2", value: 3 });
  console.log("  ✓ Fermentation state");
}

if (brewDay) {
  await api("PUT", `/api/automations/${brewDay.id}/state`, { key: "mash-temp", value: 67 });
  await api("PUT", `/api/automations/${brewDay.id}/state`, { key: "boil-timer", value: 42 });
  await api("PUT", `/api/automations/${brewDay.id}/state`, { key: "batchName", value: "West Coast IPA #48" });
  await api("PUT", `/api/automations/${brewDay.id}/state`, { key: "batchStyle", value: "American IPA" });
  await api("PUT", `/api/automations/${brewDay.id}/state`, { key: "targetOG", value: 1.065 });
  console.log("  ✓ Brew Day state");
}

if (nutrientSystem) {
  await api("PUT", `/api/automations/${nutrientSystem.id}/state`, { key: "reservoir1-level", value: 85 });
  await api("PUT", `/api/automations/${nutrientSystem.id}/state`, { key: "reservoir2-level", value: 62 });
  await api("PUT", `/api/automations/${nutrientSystem.id}/state`, { key: "ph", value: 5.8 });
  await api("PUT", `/api/automations/${nutrientSystem.id}/state`, { key: "ec", value: 1.4 });
  await api("PUT", `/api/automations/${nutrientSystem.id}/state`, { key: "water-temp", value: 22 });
  await api("PUT", `/api/automations/${nutrientSystem.id}/state`, { key: "pumpOn", value: true });
  console.log("  ✓ Nutrient System state");
}

if (growLights) {
  await api("PUT", `/api/automations/${growLights.id}/state`, { key: "ppfd", value: 620 });
  await api("PUT", `/api/automations/${growLights.id}/state`, { key: "dli", value: 28 });
  await api("PUT", `/api/automations/${growLights.id}/state`, { key: "lightsOn", value: true });
  await api("PUT", `/api/automations/${growLights.id}/state`, { key: "spectrumMode", value: "full-spectrum" });
  console.log("  ✓ Grow Lights state");
}

if (poolMonitor) {
  await api("PUT", `/api/automations/${poolMonitor.id}/state`, { key: "temp", value: 28.5 });
  await api("PUT", `/api/automations/${poolMonitor.id}/state`, { key: "chlorine", value: 1.8 });
  await api("PUT", `/api/automations/${poolMonitor.id}/state`, { key: "ph", value: 7.4 });
  await api("PUT", `/api/automations/${poolMonitor.id}/state`, { key: "orp", value: 720 });
  await api("PUT", `/api/automations/${poolMonitor.id}/state`, { key: "pumpOn", value: true });
  await api("PUT", `/api/automations/${poolMonitor.id}/state`, { key: "filter-pressure", value: 12 });
  console.log("  ✓ Pool Monitor state");
}

if (spaControls) {
  await api("PUT", `/api/automations/${spaControls.id}/state`, { key: "temp", value: 38.5 });
  await api("PUT", `/api/automations/${spaControls.id}/state`, { key: "setpoint", value: 39 });
  await api("PUT", `/api/automations/${spaControls.id}/state`, { key: "jetsOn", value: false });
  await api("PUT", `/api/automations/${spaControls.id}/state`, { key: "heaterOn", value: true });
  await api("PUT", `/api/automations/${spaControls.id}/state`, { key: "coverOpen", value: false });
  console.log("  ✓ Spa Controls state");
}

if (rackMonitor) {
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server1-temp", value: 42 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server1-cpu", value: 67 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server1-fan", value: 2400 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server2-temp", value: 38 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server2-cpu", value: 23 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server2-fan", value: 1800 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server3-temp", value: 55 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server3-cpu", value: 89 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server3-fan", value: 3200 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server4-temp", value: 35 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server4-cpu", value: 12 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "server4-fan", value: 1500 });
  await api("PUT", `/api/automations/${rackMonitor.id}/state`, { key: "avgTemp", value: 42.5 });
  console.log("  ✓ Rack Monitor state");
}

if (powerNetwork) {
  await api("PUT", `/api/automations/${powerNetwork.id}/state`, { key: "battery", value: 95 });
  await api("PUT", `/api/automations/${powerNetwork.id}/state`, { key: "load", value: 62 });
  await api("PUT", `/api/automations/${powerNetwork.id}/state`, { key: "input-voltage", value: 230 });
  await api("PUT", `/api/automations/${powerNetwork.id}/state`, { key: "output-voltage", value: 230 });
  await api("PUT", `/api/automations/${powerNetwork.id}/state`, { key: "throughput-up", value: 245 });
  await api("PUT", `/api/automations/${powerNetwork.id}/state`, { key: "throughput-down", value: 890 });
  await api("PUT", `/api/automations/${powerNetwork.id}/state`, { key: "uptime", value: 4320 });
  console.log("  ✓ Power & Network state");
}

if (weatherStation) {
  await api("PUT", `/api/automations/${weatherStation.id}/state`, { key: "outdoor-temp", value: 22.4 });
  await api("PUT", `/api/automations/${weatherStation.id}/state`, { key: "wind-speed", value: 12.5 });
  await api("PUT", `/api/automations/${weatherStation.id}/state`, { key: "wind-direction", value: 225 });
  await api("PUT", `/api/automations/${weatherStation.id}/state`, { key: "rain", value: 0 });
  await api("PUT", `/api/automations/${weatherStation.id}/state`, { key: "pressure", value: 1013 });
  await api("PUT", `/api/automations/${weatherStation.id}/state`, { key: "uv-index", value: 4 });
  console.log("  ✓ Weather Station state");
}

if (climateOverview) {
  const roomTemps = { kitchen: 22.5, "living-room": 21.6, bedroom: 19.8, office: 23.1, bathroom: 24.2 };
  for (const [room, temp] of Object.entries(roomTemps)) {
    await api("PUT", `/api/automations/${climateOverview.id}/state`, { key: "temp_" + room, value: temp });
    await api("PUT", `/api/automations/${climateOverview.id}/state`, { key: "min_" + room, value: temp - 2.5 });
    await api("PUT", `/api/automations/${climateOverview.id}/state`, { key: "max_" + room, value: temp + 1.8 });
    const comfort = temp >= 19 && temp <= 23 ? "comfortable" : temp < 19 ? "cool" : "warm";
    await api("PUT", `/api/automations/${climateOverview.id}/state`, { key: "comfort_" + room, value: comfort });
  }
  console.log("  ✓ Climate Overview state");
}

if (weeklyForecast) {
  await api("PUT", `/api/automations/${weeklyForecast.id}/state`, { key: "today", value: { temp: 24, high: 27, low: 18, condition: "partly-cloudy", description: "Partly cloudy with afternoon sun" } });
  await api("PUT", `/api/automations/${weeklyForecast.id}/state`, { key: "forecast", value: [
    { day: "Mon", high: 27, low: 18, condition: "sunny", rainChance: 10 },
    { day: "Tue", high: 25, low: 17, condition: "partly-cloudy", rainChance: 20 },
    { day: "Wed", high: 22, low: 15, condition: "rainy", rainChance: 75 },
    { day: "Thu", high: 20, low: 14, condition: "stormy", rainChance: 90 },
    { day: "Fri", high: 23, low: 16, condition: "partly-cloudy", rainChance: 30 },
    { day: "Sat", high: 26, low: 18, condition: "sunny", rainChance: 5 },
    { day: "Sun", high: 28, low: 19, condition: "sunny", rainChance: 0 },
  ] });
  await api("PUT", `/api/automations/${weeklyForecast.id}/state`, { key: "lastFetch", value: Date.now() });
  console.log("  ✓ Weekly Forecast state");
}


// ═══════════════════════════════════════════════════════════════════════
// 4. CREATE DASHBOARD LAYOUT (8 tabs)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n4. Creating dashboard layout...");

const now = Date.now();

const tabs = [
  { id: "tab-garden", name: "Garden", icon: "leaf", order: 1, pinned: false, createdAt: now },
  { id: "tab-home", name: "Home", icon: "home", order: 2, pinned: false, createdAt: now },
  { id: "tab-aquarium", name: "Aquarium", icon: "fish", order: 3, pinned: false, createdAt: now },
  { id: "tab-brewery", name: "Brewery", icon: "beer", order: 4, pinned: false, createdAt: now },
  { id: "tab-hydroponics", name: "Hydroponics", icon: "sprout", order: 5, pinned: false, createdAt: now },
  { id: "tab-pool", name: "Pool & Spa", icon: "waves", order: 6, pinned: false, createdAt: now },
  { id: "tab-server", name: "Server Room", icon: "server", order: 7, pinned: false, createdAt: now },
  { id: "tab-weather", name: "Weather", icon: "cloud-sun", order: 8, pinned: false, createdAt: now },
];

const panes = [
  // Garden
  { id: "pane-irrigation", tabId: "tab-garden", paneType: "automation", config: { ruleId: smartIrrigation?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-greenhouse", tabId: "tab-garden", paneType: "automation", config: { ruleId: greenhouse?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-tank-transfer", tabId: "tab-garden", paneType: "automation", config: { ruleId: tankTransfer?.id || "" }, x: 0, y: 9, w: 6, h: 9, createdAt: now },

  // Home
  { id: "pane-energy", tabId: "tab-home", paneType: "automation", config: { ruleId: energyMonitor?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-security", tabId: "tab-home", paneType: "automation", config: { ruleId: securityMonitor?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },

  // Aquarium
  { id: "pane-reef", tabId: "tab-aquarium", paneType: "automation", config: { ruleId: reefTank?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-water-quality", tabId: "tab-aquarium", paneType: "automation", config: { ruleId: waterQuality?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },

  // Brewery
  { id: "pane-fermentation", tabId: "tab-brewery", paneType: "automation", config: { ruleId: fermentation?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-brew-day", tabId: "tab-brewery", paneType: "automation", config: { ruleId: brewDay?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },

  // Hydroponics
  { id: "pane-nutrients", tabId: "tab-hydroponics", paneType: "automation", config: { ruleId: nutrientSystem?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-grow-lights", tabId: "tab-hydroponics", paneType: "automation", config: { ruleId: growLights?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },

  // Pool & Spa
  { id: "pane-pool", tabId: "tab-pool", paneType: "automation", config: { ruleId: poolMonitor?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-spa", tabId: "tab-pool", paneType: "automation", config: { ruleId: spaControls?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },

  // Server Room
  { id: "pane-rack", tabId: "tab-server", paneType: "automation", config: { ruleId: rackMonitor?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-power-network", tabId: "tab-server", paneType: "automation", config: { ruleId: powerNetwork?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },

  // Weather
  { id: "pane-weather-station", tabId: "tab-weather", paneType: "automation", config: { ruleId: weatherStation?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-climate-overview", tabId: "tab-weather", paneType: "automation", config: { ruleId: climateOverview?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },
  { id: "pane-weekly-forecast", tabId: "tab-weather", paneType: "automation", config: { ruleId: weeklyForecast?.id || "" }, x: 0, y: 9, w: 12, h: 7, createdAt: now },
];

await api("PUT", "/api/layout", { tabs, panes });
console.log(`  ✓ Layout: ${tabs.length} tabs, ${panes.length} panes`);

// ═══════════════════════════════════════════════════════════════════════
// 5. FIRE AUTOMATIONS FOR EXECUTION HISTORY
// ═══════════════════════════════════════════════════════════════════════
console.log("\n5. Generating execution history...");

const allRules = [
  smartIrrigation, greenhouse, tankTransfer,
  energyMonitor, securityMonitor,
  reefTank, waterQuality,
  fermentation, brewDay,
  nutrientSystem, growLights,
  poolMonitor, spaControls,
  rackMonitor, powerNetwork,
  weatherStation, climateOverview, weeklyForecast,
].filter(Boolean);

for (const rule of allRules) {
  for (let i = 0; i < 5; i++) {
    await api("POST", `/api/automations/${rule.id}/fire`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
console.log(`  ✓ Fired ${allRules.length} automations × 5`);

// ═══════════════════════════════════════════════════════════════════════
// 6. DONE
// ═══════════════════════════════════════════════════════════════════════
console.log(`
✅ Demo seeding complete!

   Dashboard: ${API.replace(":3001", ":3000")}
   Tabs: Garden · Home · Aquarium · Brewery · Hydroponics · Pool & Spa · Server Room · Weather
   Automations: ${allRules.length} (all with custom UI components)
   Devices: ${mqttDevices.length} (via MQTT publish)

   Custom UI components render instantly — just refresh the page.
`);
