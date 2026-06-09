#!/usr/bin/env node
/**
 * seed-demo.mjs — Populate Aeolus with a rich, realistic demo.
 *
 * Showcases the custom UI component system across 5 themed tabs:
 *   1. Garden (hero) — Dam → Header Tank → Garden Beds irrigation
 *   2. Aquarium — Reef monitor + Lighting controller
 *   3. Brewery — Fermentation tracker + Brew day timer
 *   4. Energy — Solar dashboard + Battery manager
 *   5. Weather — Weather station + Indoor climate
 *
 * Usage:
 *   node scripts/seed-demo.mjs [url] [username] [password]
 *
 * Examples:
 *   node scripts/seed-demo.mjs http://localhost:3001 admin mypass
 *   node scripts/seed-demo.mjs http://192.168.0.40:3001 admin mypass
 *
 * Prerequisites:
 *   1. Aeolus must be running (docker compose up)
 *   2. An admin account must be created via the dashboard first
 */

const API = process.argv[2] || "http://localhost:3001";
const SEED_USER = process.argv[3] || "admin";
const SEED_PASS = process.argv[4] || "aeolus-demo-2026";
console.log(`\n🌬️  Seeding Aeolus demo → ${API}\n`);

let authToken = null;

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const opts = { method, headers };
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
// 0. AUTHENTICATE
// ═══════════════════════════════════════════════════════════════════════
console.log("0. Authenticating...");

// Check if setup is needed
const statusRes = await fetch(`${API}/api/auth/status`);
const status = await statusRes.json().catch(() => ({}));

if (status.needsSetup) {
  console.error("  ✗ Admin account not set up yet.");
  console.error("    Visit the dashboard first to create your admin account,");
  console.error("    then run this script with your credentials:");
  console.error(`    node scripts/seed-demo.mjs ${API} <username> <password>`);
  process.exit(1);
}

// Login
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: SEED_USER, password: SEED_PASS }),
});
const loginData = await loginRes.json().catch(() => ({}));
if (loginRes.ok) {
  authToken = loginData.accessToken;
  console.log(`  ✓ Logged in as ${SEED_USER}`);
} else {
  console.error(`  ✗ Login failed for "${SEED_USER}".`);
  console.error(`    Usage: node scripts/seed-demo.mjs [url] [username] [password]`);
  console.error(`    Example: node scripts/seed-demo.mjs http://localhost:3001 admin mypassword`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════
// 0b. CLEAN EXISTING DATA
// ═══════════════════════════════════════════════════════════════════════
console.log("\n   Cleaning existing data...");

// Delete all existing automations
const existingRules = await api("GET", "/api/automations");
if (Array.isArray(existingRules)) {
  for (const rule of existingRules) {
    await api("DELETE", `/api/automations/${rule.id}`);
  }
  if (existingRules.length > 0) console.log(`  ✓ Deleted ${existingRules.length} existing automations`);
}

// Clear layout
await api("PUT", "/api/layout", { tabs: [], panes: [] });
console.log("  ✓ Cleared dashboard layout");

// ═══════════════════════════════════════════════════════════════════════
// 1. CLEAN EXISTING DATA
// ═══════════════════════════════════════════════════════════════════════
console.log("\n1. Cleaning existing automations and layout...");

// Delete all existing automations
const existing = await api("GET", "/api/automations");
if (existing && Array.isArray(existing)) {
  for (const rule of existing) {
    await api("DELETE", `/api/automations/${rule.id}`);
  }
  console.log(`  ✓ Deleted ${existing.length} existing automations`);
}

// Clear layout
await api("PUT", "/api/layout", { tabs: [], panes: [] });
console.log("  ✓ Cleared dashboard layout");

// ═══════════════════════════════════════════════════════════════════════
// 2. PUBLISH MOCK DEVICES
// ═══════════════════════════════════════════════════════════════════════
console.log("\n2. Publishing mock devices...");

const mqttDevices = [
  // ── Garden ──
  { topic: "sensor/dam/level", payload: '{"value": 82}' },
  { topic: "sensor/header-tank/level", payload: '{"value": 65}' },
  { topic: "switch/dam/pump", payload: '{"on": true}' },
  { topic: "sensor/garden/veggie-patch-moisture", payload: '{"value": 38}' },
  { topic: "sensor/garden/orchard-moisture", payload: '{"value": 55}' },
  { topic: "sensor/garden/herb-garden-moisture", payload: '{"value": 29}' },
  { topic: "sensor/garden/flower-beds-moisture", payload: '{"value": 62}' },
  { topic: "switch/irrigation/veggie-patch", payload: '{"on": true}' },
  { topic: "switch/irrigation/orchard", payload: '{"on": false}' },
  { topic: "switch/irrigation/herb-garden", payload: '{"on": true}' },
  { topic: "switch/irrigation/flower-beds", payload: '{"on": false}' },
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

  // ── Aquarium ──
  { topic: "sensor/aquarium/ph", payload: '{"value": 8.2}' },
  { topic: "sensor/aquarium/temp", payload: '{"value": 25.5}' },
  { topic: "sensor/aquarium/salinity", payload: '{"value": 35.2}' },
  { topic: "sensor/aquarium/water-level", payload: '{"value": 92}' },
  { topic: "switch/aquarium/dosing-pump", payload: '{"on": false}' },
  { topic: "sensor/aquarium/light-phase", payload: '{"value": "day"}' },
  { topic: "sensor/aquarium/light-intensity", payload: '{"value": 85}' },
  { topic: "sensor/aquarium/moonlight", payload: '{"value": 0}' },

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
  { topic: "sensor/brewery/brew-stage", payload: '{"value": "boil"}' },

  // ── Energy ──
  { topic: "sensor/energy/solar-production", payload: '{"value": 4.8}' },
  { topic: "sensor/energy/consumption", payload: '{"value": 2.1}' },
  { topic: "sensor/energy/battery-level", payload: '{"value": 72}' },
  { topic: "sensor/energy/battery-rate", payload: '{"value": 1.2}' },
  { topic: "sensor/energy/grid-export", payload: '{"value": 1.5}' },
  { topic: "sensor/energy/grid-import", payload: '{"value": 0}' },
  { topic: "sensor/energy/tou-rate", payload: '{"value": "off-peak"}' },

  // ── Weather ──
  { topic: "sensor/weather/outdoor-temp", payload: '{"value": 22.4}' },
  { topic: "sensor/weather/wind-speed", payload: '{"value": 12.5}' },
  { topic: "sensor/weather/wind-direction", payload: '{"value": 225}' },
  { topic: "sensor/weather/rain-today", payload: '{"value": 2.4}' },
  { topic: "sensor/weather/pressure", payload: '{"value": 1013}' },
  { topic: "sensor/weather/uv-index", payload: '{"value": 6}' },
  { topic: "sensor/weather/humidity", payload: '{"value": 58}' },
  { topic: "sensor/weather/temp-high", payload: '{"value": 26.8}' },
  { topic: "sensor/weather/temp-low", payload: '{"value": 14.2}' },
  { topic: "sensor/room/kitchen-temp", payload: '{"value": 22.5}' },
  { topic: "sensor/room/living-room-temp", payload: '{"value": 21.6}' },
  { topic: "sensor/room/bedroom-temp", payload: '{"value": 19.8}' },
  { topic: "sensor/room/office-temp", payload: '{"value": 23.1}' },
  { topic: "sensor/room/bathroom-temp", payload: '{"value": 24.2}' },
  { topic: "sensor/room/garage-temp", payload: '{"value": 18.3}' },
];

for (const msg of mqttDevices) {
  await api("POST", "/api/mqtt/publish", msg);
}
await new Promise((r) => setTimeout(r, 1500));
console.log(`  ✓ Published ${mqttDevices.length} device messages`);


// ═══════════════════════════════════════════════════════════════════════
// 3. CREATE AUTOMATIONS
// ═══════════════════════════════════════════════════════════════════════
console.log("\n3. Creating automations...");

// ─────────────────────────────────────────────────────────────────────
// TAB 1: GARDEN — Irrigation Controller (Hero)
// ─────────────────────────────────────────────────────────────────────
const irrigationController = await api("POST", "/api/automations", {
  name: "Irrigation Controller",
  triggerTopic: "sensor/+/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function manageIrrigation(context) {
      const topic = context.topic;
      const value = context.state.value;

      // Dam + header tank levels
      if (topic === "sensor/dam/level") state.set("damLevel", value);
      if (topic === "sensor/header-tank/level") state.set("headerTankLevel", value);

      // Garden bed moisture
      const beds = ["veggie-patch", "orchard", "herb-garden", "flower-beds"];
      for (const bed of beds) {
        if (topic === "sensor/garden/" + bed + "-moisture") {
          state.set(bed + "_moisture", value);
        }
      }

      state.set("lastUpdate", Date.now());

      // Crop-appropriate thresholds
      const thresholds = {
        "veggie-patch": { low: 35, target: 60, crop: "Vegetables" },
        "orchard": { low: 30, target: 50, crop: "Fruit Trees" },
        "herb-garden": { low: 25, target: 45, crop: "Herbs" },
        "flower-beds": { low: 40, target: 65, crop: "Flowers" },
      };

      const headerLevel = state.get("headerTankLevel") || 0;
      const damLevel = state.get("damLevel") || 0;

      // Dam pump logic: fill header tank when below 50%
      const shouldPumpDam = headerLevel < 50 && damLevel > 20;
      state.set("damPumpActive", shouldPumpDam);

      if (shouldPumpDam) {
        mqtt.publish("switch/dam/pump/command", JSON.stringify({ on: true }));
        state.set("flowDamToHeader", true);
      } else {
        state.set("flowDamToHeader", false);
      }

      // Bed watering logic
      let anyFlowing = false;
      for (const bed of beds) {
        const moisture = state.get(bed + "_moisture") || 50;
        const threshold = thresholds[bed];
        const shouldWater = moisture < threshold.low && headerLevel > 15;
        state.set(bed + "_watering", shouldWater);
        if (shouldWater) {
          anyFlowing = true;
          mqtt.publish("switch/irrigation/" + bed + "/command", JSON.stringify({ on: true, duration: 300 }));
        }
      }
      state.set("flowHeaderToBeds", anyFlowing);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💧 Irrigation Controller</div>
        <div className="flex items-center gap-1.5">
          {damPumpActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#3BA4FF]/15 text-[#3BA4FF] font-mono animate-pulse">Dam Pump Active</span>}
        </div>
      </div>

      {/* SVG Flow Diagram: Dam → Header Tank → Beds */}
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

          {/* Dam */}
          <rect x="20" y="30" width="80" height="100" rx="8" fill="#121821" stroke={tankColor(damLevel)} strokeWidth="1.5" strokeOpacity="0.4" />
          <rect x="20" y={130 - (damLevel / 100) * 100} width="80" height={(damLevel / 100) * 100} fill="url(#damWater)" clipPath="url(#damClip)" className="transition-all duration-700" />
          {/* Dam wave */}
          <path d={"M20," + (130 - (damLevel / 100) * 100) + " Q40," + (128 - (damLevel / 100) * 100) + " 60," + (130 - (damLevel / 100) * 100) + " T100," + (130 - (damLevel / 100) * 100)} fill="none" stroke="#3BA4FF" strokeWidth="1.5" strokeOpacity="0.6" clipPath="url(#damClip)" className="transition-all duration-700" />
          <text x="60" y="25" textAnchor="middle" fill="#9AA6B2" fontSize="9" fontWeight="600">DAM</text>
          <text x="60" y="85" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{damLevel}%</text>

          {/* Pipe: Dam → Header */}
          <line x1="100" y1="80" x2="160" y2="80" stroke={flowDamToHeader ? "#3BA4FF" : "#2A3441"} strokeWidth="3" strokeLinecap="round" className="transition-all duration-700" />
          {flowDamToHeader && (
            <>
              <circle cx="115" cy="80" r="2" fill="#3BA4FF" className="animate-pulse" />
              <circle cx="130" cy="80" r="2" fill="#3BA4FF" className="animate-pulse" style={{ animationDelay: "0.3s" }} />
              <circle cx="145" cy="80" r="2" fill="#3BA4FF" className="animate-pulse" style={{ animationDelay: "0.6s" }} />
            </>
          )}
          {/* Pump icon */}
          <circle cx="130" cy="70" r="8" fill={damPumpActive ? "#3BA4FF20" : "#1A2330"} stroke={damPumpActive ? "#3BA4FF" : "#2A3441"} strokeWidth="1" />
          <text x="130" y="73" textAnchor="middle" fill={damPumpActive ? "#3BA4FF" : "#6B7785"} fontSize="8">⚙</text>

          {/* Header Tank */}
          <rect x="160" y="30" width="80" height="100" rx="8" fill="#121821" stroke={tankColor(headerLevel)} strokeWidth="1.5" strokeOpacity="0.4" />
          <rect x="160" y={130 - (headerLevel / 100) * 100} width="80" height={(headerLevel / 100) * 100} fill="url(#headerWater)" clipPath="url(#headerClip)" className="transition-all duration-700" />
          <path d={"M160," + (130 - (headerLevel / 100) * 100) + " Q180," + (128 - (headerLevel / 100) * 100) + " 200," + (130 - (headerLevel / 100) * 100) + " T240," + (130 - (headerLevel / 100) * 100)} fill="none" stroke="#5CE1E6" strokeWidth="1.5" strokeOpacity="0.6" clipPath="url(#headerClip)" className="transition-all duration-700" />
          <text x="200" y="25" textAnchor="middle" fill="#9AA6B2" fontSize="9" fontWeight="600">HEADER TANK</text>
          <text x="200" y="85" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{headerLevel}%</text>

          {/* Distribution pipes to beds */}
          <line x1="240" y1="60" x2="300" y2="40" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />
          <line x1="240" y1="73" x2="300" y2="70" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />
          <line x1="240" y1="87" x2="300" y2="105" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />
          <line x1="240" y1="100" x2="300" y2="140" stroke={flowHeaderToBeds ? "#5CE1E6" : "#2A3441"} strokeWidth="2" className="transition-all duration-700" />

          {/* Bed indicators */}
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
                {/* Mini moisture bar */}
                <rect x="310" y={y + 10} width="50" height="3" rx="1.5" fill="#1A2330" />
                <rect x="310" y={y + 10} width={(moisture / 100) * 50} height="3" rx="1.5" fill={color} className="transition-all duration-700" />
                <text x="365" y={y + 13} fill={color} fontSize="7" fontFamily="monospace" fontWeight="bold">{moisture}%</text>
                {active && <circle cx="382" cy={y + 3} r="2.5" fill="#22C55E" className="animate-pulse" />}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Bed detail cards */}
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
              <div className="text-[8px] text-[#6B7785] mt-0.5">Threshold: {bed.threshold}%</div>
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
}`,
});
if (irrigationController) console.log("  ✓ Irrigation Controller:", irrigationController.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 1: GARDEN — Greenhouse
// ─────────────────────────────────────────────────────────────────────
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

      if (topic.includes("zone-tomato-moisture")) state.set("zone_tomato_moisture", value);
      else if (topic.includes("zone-pepper-moisture")) state.set("zone_pepper_moisture", value);
      else if (topic.includes("zone-lettuce-moisture")) state.set("zone_lettuce_moisture", value);
      else if (topic.includes("zone-herbs-moisture")) state.set("zone_herbs_moisture", value);
      else if (topic.includes("zone-tomato-light")) state.set("zone_tomato_light", value);
      else if (topic.includes("zone-pepper-light")) state.set("zone_pepper_light", value);
      else if (topic.includes("zone-lettuce-light")) state.set("zone_lettuce_light", value);
      else if (topic.includes("zone-herbs-light")) state.set("zone_herbs_light", value);
      else {
        const metric = topic.split("/")[2];
        state.set(metric, value);
      }

      state.set("lastUpdate", Date.now());

      const temp = state.get("temp") || 0;
      const humidity = state.get("humidity") || 0;
      const needsVent = temp > 28 || humidity > 80;
      state.set("ventActive", needsVent);

      if (needsVent) {
        mqtt.publish("switch/greenhouse/vent/command", JSON.stringify({ action: "open" }));
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function GreenhousePanel(aeolus: CustomComponentProps) {
  const temp = aeolus.read("temp") as number || 0;
  const humidity = aeolus.read("humidity") as number || 0;
  const co2 = aeolus.read("co2") as number || 0;
  const ventActive = aeolus.read("ventActive") as boolean;

  const zones = [
    { key: "tomato", icon: "🍅", label: "Tomatoes" },
    { key: "pepper", icon: "🌶️", label: "Peppers" },
    { key: "lettuce", icon: "🥬", label: "Lettuce" },
    { key: "herbs", icon: "🌿", label: "Herbs" },
  ];

  const getMoisture = (z: string) => aeolus.read("zone_" + z + "_moisture") as number || 0;
  const getLight = (z: string) => aeolus.read("zone_" + z + "_light") as number || 0;

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

      {/* Vent status */}
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
          const lIntensity = lightIntensity(light);

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
            </div>
          );
        })}
      </div>
    </div>
  );
}`,
});
if (greenhouse) console.log("  ✓ Greenhouse:", greenhouse.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 2: AQUARIUM — Reef Monitor
// ─────────────────────────────────────────────────────────────────────
const reefMonitor = await api("POST", "/api/automations", {
  name: "Reef Monitor",
  triggerTopic: "sensor/aquarium/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function monitorReef(context) {
      const topic = context.topic;
      const value = context.state.value;
      const metric = topic.split("/")[2];
      state.set(metric, value);
      state.set("lastUpdate", Date.now());

      // Dosing logic
      const ph = state.get("ph") || 8.2;
      const temp = state.get("temp") || 25.5;
      const salinity = state.get("salinity") || 35;

      const needsDosing = ph < 8.0 || ph > 8.4;
      state.set("dosingActive", needsDosing);
      state.set("phSafe", ph >= 8.0 && ph <= 8.4);
      state.set("tempSafe", temp >= 24 && temp <= 27);
      state.set("salinitySafe", salinity >= 33 && salinity <= 36);

      if (needsDosing) {
        mqtt.publish("switch/aquarium/dosing-pump/command", JSON.stringify({ on: true, amount: 2 }));
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function ReefMonitor(aeolus: CustomComponentProps) {
  const ph = aeolus.read("ph") as number || 8.2;
  const temp = aeolus.read("temp") as number || 25.5;
  const salinity = aeolus.read("salinity") as number || 35.2;
  const waterLevel = aeolus.read("water-level") as number || 92;
  const dosingActive = aeolus.read("dosingActive") as boolean;
  const phSafe = aeolus.read("phSafe") as boolean ?? true;
  const tempSafe = aeolus.read("tempSafe") as boolean ?? true;
  const salinitySafe = aeolus.read("salinitySafe") as boolean ?? true;

  // Circular gauge component
  const Gauge = ({ value, min, max, label, unit, safe, color }: { value: number; min: number; max: number; label: string; unit: string; safe: boolean; color: string }) => {
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    const range = max - min;
    const normalized = Math.max(0, Math.min(1, (value - min) / range));
    const arc = normalized * circumference * 0.75;
    const safeColor = safe ? color : "#EF4444";

    return (
      <div className="flex flex-col items-center">
        <svg width="80" height="80" viewBox="0 0 80 80">
          {/* Background arc */}
          <circle cx="40" cy="40" r={radius} fill="none" stroke="#1A2330" strokeWidth="5" strokeDasharray={circumference * 0.75 + " " + circumference * 0.25} strokeLinecap="round" transform="rotate(135 40 40)" />
          {/* Value arc */}
          <circle cx="40" cy="40" r={radius} fill="none" stroke={safeColor} strokeWidth="5" strokeDasharray={arc + " " + (circumference - arc)} strokeLinecap="round" transform="rotate(135 40 40)" className="transition-all duration-700" />
          {/* Safe zone indicator */}
          <circle cx="40" cy="40" r="22" fill={safeColor + "10"} stroke={safeColor} strokeWidth="0.5" strokeOpacity="0.3" />
          {/* Value text */}
          <text x="40" y="38" textAnchor="middle" fill="#E6EDF3" fontSize="12" fontFamily="monospace" fontWeight="bold">{typeof value === "number" ? value.toFixed(1) : value}</text>
          <text x="40" y="50" textAnchor="middle" fill="#6B7785" fontSize="7">{unit}</text>
        </svg>
        <span className="text-[10px] font-medium mt-1" style={{ color: safeColor }}>{label}</span>
        <span className={"text-[8px] mt-0.5 " + (safe ? "text-[#22C55E]" : "text-[#EF4444]")}>{safe ? "● Normal" : "● Warning"}</span>
      </div>
    );
  };

  // Water level tank
  const levelFill = (waterLevel / 100) * 60;
  const levelColor = waterLevel > 80 ? "#3BA4FF" : waterLevel > 50 ? "#5CE1E6" : "#F59E0B";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🐠 Reef Monitor</div>
        <div className="flex items-center gap-1.5">
          {dosingActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#F59E0B]/15 text-[#F59E0B] font-mono animate-pulse">Dosing Active</span>}
        </div>
      </div>

      {/* Gauges row */}
      <div className="flex justify-around bg-[#0B0F14] rounded-xl border border-[#2A3441] py-4 px-2">
        <Gauge value={ph} min={7.5} max={8.8} label="pH" unit="pH" safe={phSafe} color="#5CE1E6" />
        <Gauge value={temp} min={20} max={30} label="Temp" unit="°C" safe={tempSafe} color="#F59E0B" />
        <Gauge value={salinity} min={30} max={40} label="Salinity" unit="ppt" safe={salinitySafe} color="#3BA4FF" />
      </div>

      {/* Water level + dosing */}
      <div className="grid grid-cols-2 gap-2">
        {/* Water level tank */}
        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
          <div className="text-[10px] text-[#9AA6B2] font-medium mb-2">Water Level</div>
          <svg width="100%" height="65" viewBox="0 0 120 70" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="reefTank" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={levelColor} stopOpacity="0.7" />
                <stop offset="100%" stopColor={levelColor} stopOpacity="0.15" />
              </linearGradient>
              <clipPath id="reefClip"><rect x="10" y="5" width="100" height="60" rx="8" /></clipPath>
            </defs>
            <rect x="10" y="5" width="100" height="60" rx="8" fill="#121821" stroke={levelColor} strokeWidth="1" strokeOpacity="0.3" />
            <rect x="10" y={65 - levelFill} width="100" height={levelFill} fill="url(#reefTank)" clipPath="url(#reefClip)" className="transition-all duration-700" />
            <path d={"M10," + (65 - levelFill) + " Q35," + (63 - levelFill) + " 60," + (65 - levelFill) + " T110," + (65 - levelFill)} fill="none" stroke={levelColor} strokeWidth="1.2" strokeOpacity="0.5" clipPath="url(#reefClip)" className="transition-all duration-700" />
            <text x="60" y="40" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{waterLevel}%</text>
          </svg>
        </div>

        {/* Dosing schedule */}
        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
          <div className="text-[10px] text-[#9AA6B2] font-medium mb-2">Dosing Schedule</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[#E6EDF3]">Alk Buffer</span>
              <span className="text-[8px] text-[#22C55E] font-mono">08:00</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[#E6EDF3]">Calcium</span>
              <span className="text-[8px] text-[#3BA4FF] font-mono">12:00</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[#E6EDF3]">Magnesium</span>
              <span className="text-[8px] text-[#5CE1E6] font-mono">18:00</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[#E6EDF3]">Trace Elements</span>
              <span className="text-[8px] text-[#F59E0B] font-mono">22:00</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}`,
});
if (reefMonitor) console.log("  ✓ Reef Monitor:", reefMonitor.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 2: AQUARIUM — Lighting Controller
// ─────────────────────────────────────────────────────────────────────
const lightingController = await api("POST", "/api/automations", {
  name: "Lighting Controller",
  triggerTopic: "sensor/aquarium/light-+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function manageLighting(context) {
      const topic = context.topic;
      const value = context.state.value;

      if (topic.includes("light-phase")) state.set("phase", value);
      if (topic.includes("light-intensity")) state.set("intensity", value);
      if (topic.includes("moonlight")) state.set("moonlight", value);

      state.set("lastUpdate", Date.now());

      // Determine time-based phase
      const hour = new Date().getHours();
      let autoPhase = "night";
      if (hour >= 6 && hour < 8) autoPhase = "dawn";
      else if (hour >= 8 && hour < 17) autoPhase = "day";
      else if (hour >= 17 && hour < 19) autoPhase = "dusk";
      else if (hour >= 21 || hour < 6) autoPhase = "moonlight";

      state.set("autoPhase", autoPhase);
      state.set("currentHour", hour);

      // Intensity per phase
      const intensityMap = { dawn: 30, day: 85, dusk: 40, moonlight: 10, night: 0 };
      state.set("targetIntensity", intensityMap[autoPhase] || 0);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function LightingController(aeolus: CustomComponentProps) {
  const phase = aeolus.read("autoPhase") as string || "day";
  const intensity = aeolus.read("intensity") as number || 85;
  const moonlight = aeolus.read("moonlight") as number || 0;
  const targetIntensity = aeolus.read("targetIntensity") as number || 85;
  const currentHour = aeolus.read("currentHour") as number || 12;

  const phases = [
    { key: "dawn", label: "Dawn", color: "#F59E0B", hours: "6–8" },
    { key: "day", label: "Day", color: "#3BA4FF", hours: "8–17" },
    { key: "dusk", label: "Dusk", color: "#EF4444", hours: "17–19" },
    { key: "moonlight", label: "Moon", color: "#5CE1E6", hours: "21–6" },
    { key: "night", label: "Night", color: "#6B7785", hours: "19–21" },
  ];

  const activePhase = phases.find(p => p.key === phase) || phases[1];

  // Spectrum bar colors for each phase
  const spectrumGradient = phase === "dawn" ? "linear-gradient(90deg, #1A2330, #F59E0B40, #F59E0B80, #3BA4FF40)"
    : phase === "day" ? "linear-gradient(90deg, #3BA4FF40, #3BA4FF, #5CE1E680, #22C55E40)"
    : phase === "dusk" ? "linear-gradient(90deg, #F59E0B80, #EF444480, #6B778540, #1A2330)"
    : phase === "moonlight" ? "linear-gradient(90deg, #1A2330, #5CE1E620, #5CE1E640, #1A2330)"
    : "linear-gradient(90deg, #1A2330, #1A2330)";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💡 Lighting Controller</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: activePhase.color + "20", color: activePhase.color }}>
          {activePhase.label} Phase
        </span>
      </div>

      {/* Light spectrum bar */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[10px] text-[#9AA6B2] font-medium mb-2">Light Spectrum</div>
        <div className="h-6 rounded-full overflow-hidden border border-[#2A3441]" style={{ background: spectrumGradient }}>
          <div className="h-full flex items-center justify-center">
            <span className="text-[9px] font-mono font-bold text-white/80">{intensity}% Intensity</span>
          </div>
        </div>
      </div>

      {/* Phase timeline */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[10px] text-[#9AA6B2] font-medium mb-3">Daily Schedule</div>
        <div className="flex items-center gap-1">
          {phases.map(p => {
            const isActive = p.key === phase;
            return (
              <div key={p.key} className={"flex-1 flex flex-col items-center gap-1 py-2 rounded-lg border transition-all duration-700 " + (isActive ? "border-" + "current" + " bg-opacity-10" : "border-transparent")}>
                <div className="w-3 h-3 rounded-full transition-all duration-700" style={{ backgroundColor: isActive ? p.color : p.color + "40", boxShadow: isActive ? "0 0 8px " + p.color : "none" }} />
                <span className="text-[8px] font-medium" style={{ color: isActive ? p.color : "#6B7785" }}>{p.label}</span>
                <span className="text-[7px] text-[#6B7785]">{p.hours}</span>
              </div>
            );
          })}
        </div>
        {/* Time progress indicator */}
        <div className="mt-3 relative">
          <div className="h-1 bg-[#1A2330] rounded-full">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: ((currentHour / 24) * 100) + "%", background: "linear-gradient(90deg, " + activePhase.color + "80, " + activePhase.color + ")" }} />
          </div>
          <div className="absolute top-2 text-[8px] text-[#6B7785]" style={{ left: ((currentHour / 24) * 100) + "%" }}>
            {currentHour}:00
          </div>
        </div>
      </div>

      {/* Moonlight control */}
      <div className="flex items-center justify-between bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">🌙</span>
          <div>
            <div className="text-[10px] text-[#E6EDF3] font-medium">Moonlight Mode</div>
            <div className="text-[8px] text-[#6B7785]">Simulated lunar cycle</div>
          </div>
        </div>
        <div className="text-[10px] font-mono" style={{ color: moonlight > 0 ? "#5CE1E6" : "#6B7785" }}>
          {moonlight > 0 ? moonlight + "%" : "Off"}
        </div>
      </div>
    </div>
  );
}`,
});
if (lightingController) console.log("  ✓ Lighting Controller:", lightingController.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 3: BREWERY — Fermentation Tracker
// ─────────────────────────────────────────────────────────────────────
const fermentationTracker = await api("POST", "/api/automations", {
  name: "Fermentation Tracker",
  triggerTopic: "sensor/brewery/vessel+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackFermentation(context) {
      const topic = context.topic;
      const value = context.state.value;

      // Parse vessel number and metric
      const match = topic.match(/vessel(\\d+)-(\\w+)/);
      if (match) {
        const vessel = "vessel" + match[1];
        const metric = match[2];
        state.set(vessel + "_" + metric, value);
      }

      state.set("lastUpdate", Date.now());

      // Calculate completion for each vessel (OG → FG progress)
      const vessels = [
        { key: "vessel1", og: 1.060, fg: 1.010, name: "Pale Ale" },
        { key: "vessel2", og: 1.052, fg: 1.008, name: "IPA" },
        { key: "vessel3", og: 1.048, fg: 1.004, name: "Lager" },
      ];

      for (const v of vessels) {
        const gravity = state.get(v.key + "_gravity") || v.og;
        const range = v.og - v.fg;
        const progress = Math.max(0, Math.min(100, ((v.og - gravity) / range) * 100));
        state.set(v.key + "_progress", Math.round(progress));
        state.set(v.key + "_name", v.name);

        // ABV estimate
        const abv = ((v.og - gravity) * 131.25).toFixed(1);
        state.set(v.key + "_abv", parseFloat(abv));
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function FermentationTracker(aeolus: CustomComponentProps) {
  const vessels = [
    { key: "vessel1", defaultName: "Pale Ale", targetTemp: 18, color: "#F59E0B" },
    { key: "vessel2", defaultName: "IPA", targetTemp: 20, color: "#3BA4FF" },
    { key: "vessel3", defaultName: "Lager", targetTemp: 4, color: "#22C55E" },
  ];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🍺 Fermentation Tracker</div>
        <span className="text-[10px] text-[#6B7785]">3 Active Vessels</span>
      </div>

      <div className="space-y-2">
        {vessels.map(vessel => {
          const temp = aeolus.read(vessel.key + "_temp") as number || 0;
          const gravity = aeolus.read(vessel.key + "_gravity") as number || 1.050;
          const co2 = aeolus.read(vessel.key + "_co2") as number || 0;
          const progress = aeolus.read(vessel.key + "_progress") as number || 0;
          const name = aeolus.read(vessel.key + "_name") as string || vessel.defaultName;
          const abv = aeolus.read(vessel.key + "_abv") as number || 0;

          // Progress ring
          const radius = 28;
          const circumference = 2 * Math.PI * radius;
          const progressArc = (progress / 100) * circumference;

          // Temp deviation from target
          const tempDev = Math.abs(temp - vessel.targetTemp);
          const tempColor = tempDev <= 1 ? "#22C55E" : tempDev <= 3 ? "#F59E0B" : "#EF4444";

          return (
            <div key={vessel.key} className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
              <div className="flex items-center gap-3">
                {/* Circular progress ring */}
                <div className="relative flex-shrink-0">
                  <svg width="70" height="70" viewBox="0 0 70 70">
                    <circle cx="35" cy="35" r={radius} fill="none" stroke="#1A2330" strokeWidth="5" />
                    <circle cx="35" cy="35" r={radius} fill="none" stroke={vessel.color} strokeWidth="5" strokeLinecap="round" strokeDasharray={progressArc + " " + (circumference - progressArc)} transform="rotate(-90 35 35)" className="transition-all duration-700" />
                    <text x="35" y="32" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{progress}%</text>
                    <text x="35" y="44" textAnchor="middle" fill="#6B7785" fontSize="7">complete</text>
                  </svg>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-[#E6EDF3] font-semibold">{name}</span>
                    <span className="text-[9px] font-mono text-[#9AA6B2]">{abv}% ABV</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {/* Temp badge */}
                    <div className="flex flex-col items-center bg-[#121821] rounded-md py-1.5">
                      <span className="text-[8px] text-[#6B7785]">Temp</span>
                      <span className="text-[11px] font-mono font-bold" style={{ color: tempColor }}>{temp.toFixed(1)}°</span>
                      <span className="text-[7px]" style={{ color: tempColor }}>{tempDev <= 1 ? "●" : "▲"} {vessel.targetTemp}° target</span>
                    </div>

                    {/* Gravity badge */}
                    <div className="flex flex-col items-center bg-[#121821] rounded-md py-1.5">
                      <span className="text-[8px] text-[#6B7785]">Gravity</span>
                      <span className="text-[11px] font-mono font-bold text-[#E6EDF3]">{gravity.toFixed(3)}</span>
                      <span className="text-[7px] text-[#6B7785]">SG</span>
                    </div>

                    {/* CO2 badge */}
                    <div className="flex flex-col items-center bg-[#121821] rounded-md py-1.5">
                      <span className="text-[8px] text-[#6B7785]">CO₂</span>
                      <span className="text-[11px] font-mono font-bold text-[#5CE1E6]">{co2}</span>
                      <span className="text-[7px] text-[#6B7785]">vol</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}`,
});
if (fermentationTracker) console.log("  ✓ Fermentation Tracker:", fermentationTracker.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 3: BREWERY — Brew Day Timer
// ─────────────────────────────────────────────────────────────────────
const brewDayTimer = await api("POST", "/api/automations", {
  name: "Brew Day Timer",
  triggerTopic: "sensor/brewery/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function manageBrew(context) {
      const topic = context.topic;
      const value = context.state.value;

      if (topic.includes("mash-temp")) state.set("mashTemp", value);
      if (topic.includes("boil-timer")) state.set("boilMinutes", value);
      if (topic.includes("brew-stage")) state.set("currentStage", value);

      state.set("lastUpdate", Date.now());

      // Brew day steps with hop additions
      const stages = [
        { id: "mash-in", label: "Mash In", duration: 10, complete: true },
        { id: "mash", label: "Mash Rest", duration: 60, complete: true },
        { id: "sparge", label: "Sparge", duration: 20, complete: true },
        { id: "boil", label: "Boil", duration: 60, complete: false },
        { id: "whirlpool", label: "Whirlpool", duration: 15, complete: false },
        { id: "chill", label: "Chill", duration: 20, complete: false },
        { id: "transfer", label: "Transfer", duration: 10, complete: false },
      ];

      state.set("stages", JSON.stringify(stages));

      // Hop schedule
      const hops = [
        { time: 60, name: "Columbus", amount: "25g", added: true },
        { time: 30, name: "Centennial", amount: "15g", added: true },
        { time: 15, name: "Cascade", amount: "20g", added: false },
        { time: 5, name: "Citra", amount: "30g", added: false },
        { time: 0, name: "Mosaic", amount: "25g", added: false },
      ];
      state.set("hops", JSON.stringify(hops));
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function BrewDayTimer(aeolus: CustomComponentProps) {
  const mashTemp = aeolus.read("mashTemp") as number || 67;
  const boilMinutes = aeolus.read("boilMinutes") as number || 42;
  const currentStage = aeolus.read("currentStage") as string || "boil";

  const stages = [
    { id: "mash-in", label: "Mash In", duration: 10, complete: true },
    { id: "mash", label: "Mash", duration: 60, complete: true },
    { id: "sparge", label: "Sparge", duration: 20, complete: true },
    { id: "boil", label: "Boil", duration: 60, complete: false },
    { id: "whirlpool", label: "Whirlpool", duration: 15, complete: false },
    { id: "chill", label: "Chill", duration: 20, complete: false },
    { id: "transfer", label: "Transfer", duration: 10, complete: false },
  ];

  const hops = [
    { time: 60, name: "Columbus", amount: "25g", added: true },
    { time: 30, name: "Centennial", amount: "15g", added: true },
    { time: 15, name: "Cascade", amount: "20g", added: false },
    { time: 5, name: "Citra", amount: "30g", added: false },
    { time: 0, name: "Mosaic", amount: "25g", added: false },
  ];

  const currentIdx = stages.findIndex(s => s.id === currentStage);
  const totalDuration = stages.reduce((sum, s) => sum + s.duration, 0);
  const elapsed = stages.slice(0, currentIdx).reduce((sum, s) => sum + s.duration, 0) + (stages[currentIdx]?.duration || 0) - boilMinutes;

  // Temperature gauge
  const tempMin = 60;
  const tempMax = 100;
  const tempPct = Math.max(0, Math.min(100, ((mashTemp - tempMin) / (tempMax - tempMin)) * 100));
  const tempColor = mashTemp >= 65 && mashTemp <= 70 ? "#22C55E" : mashTemp > 70 ? "#EF4444" : "#F59E0B";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🍻 Brew Day</div>
        <div className="text-[10px] font-mono text-[#F59E0B]">
          Stage: <span className="text-[#E6EDF3] font-semibold capitalize">{currentStage}</span>
        </div>
      </div>

      {/* Step timeline */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[10px] text-[#9AA6B2] font-medium mb-2">Brew Timeline</div>
        <div className="flex items-center gap-0.5">
          {stages.map((stage, i) => {
            const isCurrent = stage.id === currentStage;
            const isComplete = i < currentIdx;
            const width = (stage.duration / totalDuration) * 100;
            const color = isComplete ? "#22C55E" : isCurrent ? "#3BA4FF" : "#1A2330";
            return (
              <div key={stage.id} className="flex flex-col items-center" style={{ width: width + "%" }}>
                <div className={"h-3 w-full rounded-sm transition-all duration-700 " + (isCurrent ? "animate-pulse" : "")} style={{ backgroundColor: color, border: isCurrent ? "1px solid #3BA4FF" : "none" }} />
                <span className={"text-[7px] mt-1 " + (isCurrent ? "text-[#3BA4FF] font-semibold" : isComplete ? "text-[#22C55E]" : "text-[#6B7785]")}>{stage.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Temperature + Timer row */}
      <div className="grid grid-cols-2 gap-2">
        {/* Temperature gauge */}
        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
          <div className="text-[10px] text-[#9AA6B2] font-medium mb-1">Mash Temp</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-3 bg-[#1A2330] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: tempPct + "%", background: "linear-gradient(90deg, " + tempColor + "80, " + tempColor + ")" }} />
            </div>
            <span className="text-sm font-mono font-bold" style={{ color: tempColor }}>{mashTemp}°C</span>
          </div>
          <div className="text-[8px] text-[#6B7785] mt-1">Target: 65–70°C</div>
        </div>

        {/* Countdown timer */}
        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex flex-col items-center justify-center">
          <div className="text-[10px] text-[#9AA6B2] font-medium mb-1">Boil Remaining</div>
          <div className="text-2xl font-mono font-bold text-[#F59E0B]">{boilMinutes}</div>
          <div className="text-[8px] text-[#6B7785]">minutes</div>
        </div>
      </div>

      {/* Hop additions */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[10px] text-[#9AA6B2] font-medium mb-2">Hop Schedule</div>
        <div className="space-y-1.5">
          {hops.map((hop, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={"w-2 h-2 rounded-full " + (hop.added ? "bg-[#22C55E]" : "bg-[#2A3441] border border-[#6B7785]")} />
              <span className="text-[9px] text-[#6B7785] font-mono w-8">{hop.time}m</span>
              <span className={"text-[9px] flex-1 " + (hop.added ? "text-[#9AA6B2] line-through" : "text-[#E6EDF3] font-medium")}>{hop.name}</span>
              <span className="text-[9px] font-mono text-[#6B7785]">{hop.amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`,
});
if (brewDayTimer) console.log("  ✓ Brew Day Timer:", brewDayTimer.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 4: ENERGY — Solar Dashboard
// ─────────────────────────────────────────────────────────────────────
const solarDashboard = await api("POST", "/api/automations", {
  name: "Solar Dashboard",
  triggerTopic: "sensor/energy/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackSolar(context) {
      const topic = context.topic;
      const value = context.state.value;
      const metric = topic.split("/")[2];
      state.set(metric, value);
      state.set("lastUpdate", Date.now());

      const solar = state.get("solar-production") || 0;
      const consumption = state.get("consumption") || 0;
      const gridExport = state.get("grid-export") || 0;
      const gridImport = state.get("grid-import") || 0;
      const battery = state.get("battery-level") || 0;

      // Flow directions
      state.set("solarToHouse", Math.min(solar, consumption));
      state.set("solarToBattery", Math.max(0, solar - consumption - gridExport));
      state.set("solarToGrid", gridExport);
      state.set("gridToHouse", gridImport);

      // Self-sufficiency
      const selfPowered = solar >= consumption;
      state.set("selfPowered", selfPowered);
      state.set("selfSufficiency", solar > 0 ? Math.min(100, Math.round((solar / (solar + gridImport)) * 100)) : 0);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function SolarDashboard(aeolus: CustomComponentProps) {
  const solar = aeolus.read("solar-production") as number || 4.8;
  const consumption = aeolus.read("consumption") as number || 2.1;
  const battery = aeolus.read("battery-level") as number || 72;
  const gridExport = aeolus.read("grid-export") as number || 1.5;
  const gridImport = aeolus.read("grid-import") as number || 0;
  const selfSufficiency = aeolus.read("selfSufficiency") as number || 100;
  const selfPowered = aeolus.read("selfPowered") as boolean ?? true;

  const solarToHouse = Math.min(solar, consumption);
  const solarToBattery = aeolus.read("solarToBattery") as number || 0;
  const solarToGrid = gridExport;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">☀️ Solar Dashboard</div>
        <div className={"text-[9px] px-2 py-0.5 rounded-full font-semibold " + (selfPowered ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#F59E0B]/15 text-[#F59E0B]")}>
          {selfPowered ? "Self-Powered" : "Grid Assist"}
        </div>
      </div>

      {/* Power flow diagram */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <svg width="100%" height="160" viewBox="0 0 360 160" preserveAspectRatio="xMidYMid meet">
          {/* Solar panel */}
          <g>
            <rect x="130" y="5" width="100" height="35" rx="4" fill="#121821" stroke="#F59E0B" strokeWidth="1.5" strokeOpacity="0.6" />
            <line x1="155" y1="5" x2="155" y2="40" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="180" y1="5" x2="180" y2="40" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="205" y1="5" x2="205" y2="40" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="130" y1="20" x2="230" y2="20" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <text x="180" y="55" textAnchor="middle" fill="#F59E0B" fontSize="11" fontFamily="monospace" fontWeight="bold">{solar.toFixed(1)} kW</text>
            <text x="180" y="65" textAnchor="middle" fill="#6B7785" fontSize="7">Solar Production</text>
          </g>

          {/* Flow: Solar → House */}
          <line x1="180" y1="70" x2="180" y2="90" stroke={solarToHouse > 0 ? "#22C55E" : "#2A3441"} strokeWidth="2.5" className="transition-all duration-700" />
          {solarToHouse > 0 && <circle cx="180" cy="80" r="2" fill="#22C55E" className="animate-pulse" />}

          {/* House */}
          <g>
            <path d="M155,100 L180,85 L205,100 L205,130 L155,130 Z" fill="#121821" stroke="#5CE1E6" strokeWidth="1.5" />
            <rect x="173" y="115" width="14" height="15" fill="#5CE1E6" fillOpacity="0.2" stroke="#5CE1E6" strokeWidth="0.8" />
            <text x="180" y="140" textAnchor="middle" fill="#5CE1E6" fontSize="11" fontFamily="monospace" fontWeight="bold">{consumption.toFixed(1)} kW</text>
            <text x="180" y="150" textAnchor="middle" fill="#6B7785" fontSize="7">Consumption</text>
          </g>

          {/* Battery */}
          <g>
            <rect x="30" y="90" width="50" height="30" rx="4" fill="#121821" stroke={battery > 50 ? "#22C55E" : battery > 20 ? "#F59E0B" : "#EF4444"} strokeWidth="1.5" />
            <rect x="80" y="100" width="4" height="10" rx="1" fill={battery > 50 ? "#22C55E" : battery > 20 ? "#F59E0B" : "#EF4444"} fillOpacity="0.5" />
            {/* Battery fill */}
            <rect x="33" y="93" width={(battery / 100) * 44} height="24" rx="2" fill={battery > 50 ? "#22C55E" : battery > 20 ? "#F59E0B" : "#EF4444"} fillOpacity="0.3" className="transition-all duration-700" />
            <text x="55" y="108" textAnchor="middle" fill="#E6EDF3" fontSize="10" fontFamily="monospace" fontWeight="bold">{battery}%</text>
            <text x="55" y="135" textAnchor="middle" fill="#6B7785" fontSize="7">Battery</text>
          </g>

          {/* Flow: Solar → Battery */}
          <line x1="150" y1="95" x2="85" y2="105" stroke={solarToBattery > 0 ? "#22C55E" : "#2A3441"} strokeWidth="2" strokeDasharray={solarToBattery > 0 ? "4 3" : "0"} className="transition-all duration-700" />
          {solarToBattery > 0 && (
            <text x="115" y="93" textAnchor="middle" fill="#22C55E" fontSize="7" fontFamily="monospace">+{solarToBattery.toFixed(1)}kW</text>
          )}

          {/* Grid */}
          <g>
            <rect x="280" y="90" width="50" height="30" rx="4" fill="#121821" stroke={gridImport > 0 ? "#EF4444" : "#22C55E"} strokeWidth="1.5" />
            <line x1="295" y1="90" x2="295" y2="120" stroke={gridImport > 0 ? "#EF4444" : "#22C55E"} strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="305" y1="90" x2="305" y2="120" stroke={gridImport > 0 ? "#EF4444" : "#22C55E"} strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="315" y1="90" x2="315" y2="120" stroke={gridImport > 0 ? "#EF4444" : "#22C55E"} strokeWidth="0.5" strokeOpacity="0.3" />
            <text x="305" y="108" textAnchor="middle" fill="#E6EDF3" fontSize="8" fontFamily="monospace">Grid</text>
            <text x="305" y="135" textAnchor="middle" fill={gridExport > 0 ? "#22C55E" : gridImport > 0 ? "#EF4444" : "#6B7785"} fontSize="8" fontFamily="monospace">
              {gridExport > 0 ? "↑ " + gridExport.toFixed(1) + "kW" : gridImport > 0 ? "↓ " + gridImport.toFixed(1) + "kW" : "0 kW"}
            </text>
          </g>

          {/* Flow: House → Grid (export) or Grid → House (import) */}
          <line x1="210" y1="105" x2="278" y2="105" stroke={gridExport > 0 ? "#22C55E" : gridImport > 0 ? "#EF4444" : "#2A3441"} strokeWidth="2" strokeDasharray={gridExport > 0 || gridImport > 0 ? "4 3" : "0"} className="transition-all duration-700" />
          {gridExport > 0 && <circle cx="245" cy="105" r="2" fill="#22C55E" className="animate-pulse" />}
          {gridImport > 0 && <circle cx="245" cy="105" r="2" fill="#EF4444" className="animate-pulse" />}
        </svg>
      </div>

      {/* Self-sufficiency bar */}
      <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-[#9AA6B2]">Self-Sufficiency</span>
          <span className="text-[10px] font-mono font-bold text-[#22C55E]">{selfSufficiency}%</span>
        </div>
        <div className="h-2 bg-[#1A2330] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: selfSufficiency + "%", background: "linear-gradient(90deg, #22C55E80, #22C55E)" }} />
        </div>
      </div>
    </div>
  );
}`,
});
if (solarDashboard) console.log("  ✓ Solar Dashboard:", solarDashboard.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 4: ENERGY — Battery Manager
// ─────────────────────────────────────────────────────────────────────
const batteryManager = await api("POST", "/api/automations", {
  name: "Battery Manager",
  triggerTopic: "sensor/energy/battery-+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function manageBattery(context) {
      const topic = context.topic;
      const value = context.state.value;

      if (topic.includes("battery-level")) state.set("level", value);
      if (topic.includes("battery-rate")) state.set("chargeRate", value);

      state.set("lastUpdate", Date.now());

      const level = state.get("level") || 72;
      const rate = state.get("chargeRate") || 0;
      const touRate = state.get("tou-rate") || "off-peak";

      // Calculate time estimates
      const capacity = 13.5; // kWh (like a Powerwall)
      const currentKwh = (level / 100) * capacity;

      if (rate > 0) {
        // Charging
        const remainingKwh = capacity - currentKwh;
        const hoursToFull = remainingKwh / rate;
        state.set("timeToFull", Math.round(hoursToFull * 60));
        state.set("timeToEmpty", null);
        state.set("mode", "charging");
      } else if (rate < 0) {
        // Discharging
        const hoursToEmpty = currentKwh / Math.abs(rate);
        state.set("timeToEmpty", Math.round(hoursToEmpty * 60));
        state.set("timeToFull", null);
        state.set("mode", "discharging");
      } else {
        state.set("mode", "idle");
        state.set("timeToFull", null);
        state.set("timeToEmpty", null);
      }

      // TOU-based strategy
      state.set("strategy", touRate === "peak" ? "discharge" : touRate === "shoulder" ? "hold" : "charge");
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function BatteryManager(aeolus: CustomComponentProps) {
  const level = aeolus.read("level") as number || 72;
  const chargeRate = aeolus.read("chargeRate") as number || 1.2;
  const mode = aeolus.read("mode") as string || "charging";
  const timeToFull = aeolus.read("timeToFull") as number | null;
  const timeToEmpty = aeolus.read("timeToEmpty") as number | null;
  const strategy = aeolus.read("strategy") as string || "charge";

  const batteryColor = level > 60 ? "#22C55E" : level > 25 ? "#F59E0B" : "#EF4444";
  const modeColor = mode === "charging" ? "#22C55E" : mode === "discharging" ? "#F59E0B" : "#6B7785";

  // Large battery visualization
  const fillHeight = (level / 100) * 120;
  const capacity = 13.5;
  const currentKwh = ((level / 100) * capacity).toFixed(1);

  const timeEstimate = timeToFull != null ? timeToFull + " min to full"
    : timeToEmpty != null ? timeToEmpty + " min to empty"
    : "Idle";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🔋 Battery Manager</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold capitalize" style={{ backgroundColor: modeColor + "20", color: modeColor }}>
          {mode}
        </span>
      </div>

      {/* Large battery gauge */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-4 flex items-center gap-4">
        {/* Battery SVG */}
        <div className="flex-shrink-0">
          <svg width="80" height="140" viewBox="0 0 80 150">
            <defs>
              <linearGradient id="battFill" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={batteryColor} stopOpacity="0.8" />
                <stop offset="100%" stopColor={batteryColor} stopOpacity="0.3" />
              </linearGradient>
              <clipPath id="battClip"><rect x="10" y="20" width="60" height="120" rx="8" /></clipPath>
            </defs>
            {/* Terminal */}
            <rect x="25" y="8" width="30" height="12" rx="4" fill="#1A2330" stroke={batteryColor} strokeWidth="1.5" strokeOpacity="0.5" />
            {/* Body */}
            <rect x="10" y="20" width="60" height="120" rx="8" fill="#121821" stroke={batteryColor} strokeWidth="2" strokeOpacity="0.4" />
            {/* Fill */}
            <rect x="10" y={140 - fillHeight} width="60" height={fillHeight} fill="url(#battFill)" clipPath="url(#battClip)" className="transition-all duration-700" />
            {/* Percentage */}
            <text x="40" y="82" textAnchor="middle" fill="#E6EDF3" fontSize="18" fontFamily="monospace" fontWeight="bold">{level}%</text>
            {/* kWh */}
            <text x="40" y="98" textAnchor="middle" fill="#9AA6B2" fontSize="9" fontFamily="monospace">{currentKwh}/{capacity}kWh</text>
            {/* Charge indicator */}
            {mode === "charging" && (
              <path d="M35,55 L42,55 L38,65 L45,65 L33,80 L37,70 L30,70 Z" fill={batteryColor} className="animate-pulse" />
            )}
          </svg>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-3">
          {/* Charge rate */}
          <div className="bg-[#121821] rounded-lg p-2.5">
            <div className="text-[9px] text-[#6B7785] mb-0.5">Charge Rate</div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-mono font-bold" style={{ color: modeColor }}>
                {mode === "charging" ? "+" : mode === "discharging" ? "-" : ""}{Math.abs(chargeRate).toFixed(1)}
              </span>
              <span className="text-[10px] text-[#6B7785]">kW</span>
            </div>
          </div>

          {/* Time estimate */}
          <div className="bg-[#121821] rounded-lg p-2.5">
            <div className="text-[9px] text-[#6B7785] mb-0.5">Estimate</div>
            <div className="text-[11px] font-mono font-semibold text-[#E6EDF3]">{timeEstimate}</div>
          </div>

          {/* Strategy */}
          <div className="bg-[#121821] rounded-lg p-2.5">
            <div className="text-[9px] text-[#6B7785] mb-0.5">TOU Strategy</div>
            <div className="text-[11px] font-semibold capitalize" style={{ color: strategy === "charge" ? "#22C55E" : strategy === "discharge" ? "#F59E0B" : "#3BA4FF" }}>
              {strategy}
            </div>
            <div className="text-[8px] text-[#6B7785] mt-0.5">
              {strategy === "charge" ? "Off-peak: storing energy" : strategy === "discharge" ? "Peak: selling back" : "Shoulder: holding steady"}
            </div>
          </div>
        </div>
      </div>

      {/* Rate schedule */}
      <div className="flex items-center gap-1">
        <div className="flex-1 bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-md py-1.5 text-center">
          <div className="text-[8px] text-[#22C55E]">Off-Peak</div>
          <div className="text-[9px] font-mono text-[#E6EDF3]">10pm–7am</div>
        </div>
        <div className="flex-1 bg-[#3BA4FF]/10 border border-[#3BA4FF]/30 rounded-md py-1.5 text-center">
          <div className="text-[8px] text-[#3BA4FF]">Shoulder</div>
          <div className="text-[9px] font-mono text-[#E6EDF3]">7–3pm</div>
        </div>
        <div className="flex-1 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-md py-1.5 text-center">
          <div className="text-[8px] text-[#F59E0B]">Peak</div>
          <div className="text-[9px] font-mono text-[#E6EDF3]">3–10pm</div>
        </div>
      </div>
    </div>
  );
}`,
});
if (batteryManager) console.log("  ✓ Battery Manager:", batteryManager.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 5: WEATHER — Weather Station
// ─────────────────────────────────────────────────────────────────────
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
      const topic = context.topic;
      const value = context.state.value;
      const metric = topic.split("/")[2];
      state.set(metric, value);
      state.set("lastUpdate", Date.now());

      // Derive conditions
      const rain = state.get("rain-today") || 0;
      const wind = state.get("wind-speed") || 0;
      const uv = state.get("uv-index") || 0;

      let condition = "Clear";
      if (rain > 5) condition = "Rainy";
      else if (rain > 0) condition = "Drizzle";
      else if (wind > 30) condition = "Windy";
      else if (uv > 8) condition = "Very Hot";
      state.set("condition", condition);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function WeatherStation(aeolus: CustomComponentProps) {
  const temp = aeolus.read("outdoor-temp") as number || 22.4;
  const windSpeed = aeolus.read("wind-speed") as number || 12.5;
  const windDir = aeolus.read("wind-direction") as number || 225;
  const rain = aeolus.read("rain-today") as number || 2.4;
  const pressure = aeolus.read("pressure") as number || 1013;
  const uv = aeolus.read("uv-index") as number || 6;
  const humidity = aeolus.read("humidity") as number || 58;
  const tempHigh = aeolus.read("temp-high") as number || 26.8;
  const tempLow = aeolus.read("temp-low") as number || 14.2;
  const condition = aeolus.read("condition") as string || "Clear";

  // Wind direction to compass label
  const compassLabels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compassIdx = Math.round(windDir / 45) % 8;
  const compassLabel = compassLabels[compassIdx];

  // UV color
  const uvColor = uv <= 2 ? "#22C55E" : uv <= 5 ? "#F59E0B" : uv <= 7 ? "#EF4444" : "#EF4444";
  const uvLabel = uv <= 2 ? "Low" : uv <= 5 ? "Moderate" : uv <= 7 ? "High" : "Very High";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌤️ Weather Station</div>
        <span className="text-[10px] text-[#9AA6B2]">{condition}</span>
      </div>

      {/* Main temp + wind compass */}
      <div className="grid grid-cols-2 gap-3">
        {/* Temperature card */}
        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex flex-col items-center">
          <div className="text-3xl font-mono font-bold text-[#E6EDF3]">{temp.toFixed(1)}°</div>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-[#EF4444]">▲</span>
              <span className="text-[10px] font-mono text-[#E6EDF3]">{tempHigh.toFixed(1)}°</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-[#3BA4FF]">▼</span>
              <span className="text-[10px] font-mono text-[#E6EDF3]">{tempLow.toFixed(1)}°</span>
            </div>
          </div>
          <div className="text-[8px] text-[#6B7785] mt-1">High / Low Today</div>
        </div>

        {/* Wind compass */}
        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex flex-col items-center">
          <svg width="70" height="70" viewBox="0 0 70 70">
            {/* Compass ring */}
            <circle cx="35" cy="35" r="28" fill="none" stroke="#2A3441" strokeWidth="1.5" />
            <circle cx="35" cy="35" r="22" fill="none" stroke="#1A2330" strokeWidth="1" />
            {/* Cardinal points */}
            <text x="35" y="12" textAnchor="middle" fill="#9AA6B2" fontSize="7" fontWeight="600">N</text>
            <text x="60" y="38" textAnchor="middle" fill="#6B7785" fontSize="6">E</text>
            <text x="35" y="64" textAnchor="middle" fill="#6B7785" fontSize="6">S</text>
            <text x="10" y="38" textAnchor="middle" fill="#6B7785" fontSize="6">W</text>
            {/* Wind direction arrow */}
            <g transform={"rotate(" + windDir + " 35 35)"}>
              <line x1="35" y1="15" x2="35" y2="50" stroke="#5CE1E6" strokeWidth="2" strokeLinecap="round" />
              <polygon points="35,12 30,22 40,22" fill="#5CE1E6" />
            </g>
            <circle cx="35" cy="35" r="3" fill="#5CE1E6" />
          </svg>
          <div className="text-[10px] font-mono font-bold text-[#5CE1E6] mt-1">{windSpeed} km/h {compassLabel}</div>
        </div>
      </div>

      {/* Badges row */}
      <div className="grid grid-cols-4 gap-1.5">
        {/* Rain */}
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">🌧️</span>
          <span className="text-[10px] font-mono font-bold text-[#3BA4FF] mt-1">{rain}mm</span>
          <span className="text-[7px] text-[#6B7785]">Rain</span>
        </div>

        {/* Pressure */}
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">🌡️</span>
          <span className="text-[10px] font-mono font-bold text-[#E6EDF3] mt-1">{pressure}</span>
          <span className="text-[7px] text-[#6B7785]">hPa</span>
        </div>

        {/* UV */}
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">☀️</span>
          <span className="text-[10px] font-mono font-bold mt-1" style={{ color: uvColor }}>{uv}</span>
          <span className="text-[7px]" style={{ color: uvColor }}>{uvLabel}</span>
        </div>

        {/* Humidity */}
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">💧</span>
          <span className="text-[10px] font-mono font-bold text-[#5CE1E6] mt-1">{humidity}%</span>
          <span className="text-[7px] text-[#6B7785]">Humidity</span>
        </div>
      </div>
    </div>
  );
}`,
});
if (weatherStation) console.log("  ✓ Weather Station:", weatherStation.id);


// ─────────────────────────────────────────────────────────────────────
// TAB 5: WEATHER — Indoor Climate
// ─────────────────────────────────────────────────────────────────────
const indoorClimate = await api("POST", "/api/automations", {
  name: "Indoor Climate",
  triggerTopic: "sensor/room/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackRooms(context) {
      const topic = context.topic;
      const value = context.state.value;

      // Parse room name from topic: sensor/room/{name}-temp
      const parts = topic.split("/");
      const roomMetric = parts[2]; // e.g. "kitchen-temp"
      const roomName = roomMetric.replace("-temp", "");
      state.set(roomName, value);
      state.set("lastUpdate", Date.now());

      // Comfort zone logic
      const rooms = ["kitchen", "living-room", "bedroom", "office", "bathroom", "garage"];
      for (const room of rooms) {
        const temp = state.get(room) || 20;
        let zone = "comfortable";
        if (temp < 18) zone = "cold";
        else if (temp > 25) zone = "warm";
        state.set(room + "_zone", zone);
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function IndoorClimate(aeolus: CustomComponentProps) {
  const rooms = [
    { key: "kitchen", label: "Kitchen", x: 55, y: 20, w: 40, h: 30 },
    { key: "living-room", label: "Living Room", x: 5, y: 20, w: 45, h: 40 },
    { key: "bedroom", label: "Bedroom", x: 55, y: 55, w: 40, h: 25 },
    { key: "office", label: "Office", x: 5, y: 65, w: 30, h: 20 },
    { key: "bathroom", label: "Bathroom", x: 40, y: 55, w: 15, h: 25 },
    { key: "garage", label: "Garage", x: 5, y: 5, w: 30, h: 12 },
  ];

  const zoneColor = (zone: string) => zone === "cold" ? "#3BA4FF" : zone === "warm" ? "#EF4444" : "#22C55E";
  const zoneBg = (zone: string) => zone === "cold" ? "#3BA4FF10" : zone === "warm" ? "#EF444410" : "#22C55E10";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🏠 Indoor Climate</div>
        <div className="flex items-center gap-2">
          <span className="text-[8px] text-[#3BA4FF]">● Cold &lt;18°</span>
          <span className="text-[8px] text-[#22C55E]">● Comfortable</span>
          <span className="text-[8px] text-[#EF4444]">● Warm &gt;25°</span>
        </div>
      </div>

      {/* Floor plan layout */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <svg width="100%" height="200" viewBox="0 0 100 90" preserveAspectRatio="xMidYMid meet">
          {/* House outline */}
          <rect x="2" y="2" width="96" height="86" rx="3" fill="none" stroke="#2A3441" strokeWidth="0.8" />

          {rooms.map(room => {
            const temp = aeolus.read(room.key) as number || 20;
            const zone = aeolus.read(room.key + "_zone") as string || "comfortable";
            const color = zoneColor(zone);

            return (
              <g key={room.key}>
                {/* Room rectangle */}
                <rect x={room.x} y={room.y} width={room.w} height={room.h} rx="2" fill={zoneBg(zone)} stroke={color} strokeWidth="0.6" strokeOpacity="0.5" className="transition-all duration-700" />
                {/* Room label */}
                <text x={room.x + room.w / 2} y={room.y + room.h / 2 - 3} textAnchor="middle" fill="#9AA6B2" fontSize="3.5">{room.label}</text>
                {/* Temperature */}
                <text x={room.x + room.w / 2} y={room.y + room.h / 2 + 5} textAnchor="middle" fill={color} fontSize="5" fontFamily="monospace" fontWeight="bold" className="transition-all duration-700">{temp.toFixed(1)}°</text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Room list */}
      <div className="space-y-1">
        {rooms.map(room => {
          const temp = aeolus.read(room.key) as number || 20;
          const zone = aeolus.read(room.key + "_zone") as string || "comfortable";
          const color = zoneColor(zone);

          return (
            <div key={room.key} className="flex items-center gap-2 bg-[#0B0F14] rounded-md px-3 py-1.5 border border-[#2A3441]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-[#9AA6B2] flex-1">{room.label}</span>
              <span className="text-[10px] font-mono font-bold" style={{ color }}>{temp.toFixed(1)}°C</span>
              <span className="text-[8px] capitalize" style={{ color }}>{zone}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}`,
});
if (indoorClimate) console.log("  ✓ Indoor Climate:", indoorClimate.id);


// ═══════════════════════════════════════════════════════════════════════
// 4. CREATE DASHBOARD LAYOUT
// ═══════════════════════════════════════════════════════════════════════
console.log("\n4. Creating dashboard layout...");

const now = new Date().toISOString();

const tabs = [
  { id: "tab-garden", name: "Garden", icon: "sprout", order: 0, createdAt: now },
  { id: "tab-aquarium", name: "Aquarium", icon: "fish", order: 1, createdAt: now },
  { id: "tab-brewery", name: "Brewery", icon: "beer", order: 2, createdAt: now },
  { id: "tab-energy", name: "Energy", icon: "zap", order: 3, createdAt: now },
  { id: "tab-weather", name: "Weather", icon: "cloud-sun", order: 4, createdAt: now },
];

const panes = [
  // Garden (hero tab — irrigation controller gets full width top)
  { id: "pane-irrigation", tabId: "tab-garden", paneType: "automation", config: { ruleId: irrigationController?.id || "", ruleName: "Irrigation Controller" }, x: 0, y: 0, w: 12, h: 12, createdAt: now },
  { id: "pane-greenhouse", tabId: "tab-garden", paneType: "automation", config: { ruleId: greenhouse?.id || "", ruleName: "Greenhouse" }, x: 0, y: 12, w: 12, h: 9, createdAt: now },

  // Aquarium
  { id: "pane-reef", tabId: "tab-aquarium", paneType: "automation", config: { ruleId: reefMonitor?.id || "", ruleName: "Reef Monitor" }, x: 0, y: 0, w: 6, h: 10, createdAt: now },
  { id: "pane-lighting", tabId: "tab-aquarium", paneType: "automation", config: { ruleId: lightingController?.id || "", ruleName: "Lighting Controller" }, x: 6, y: 0, w: 6, h: 10, createdAt: now },

  // Brewery
  { id: "pane-fermentation", tabId: "tab-brewery", paneType: "automation", config: { ruleId: fermentationTracker?.id || "", ruleName: "Fermentation Tracker" }, x: 0, y: 0, w: 6, h: 10, createdAt: now },
  { id: "pane-brew-day", tabId: "tab-brewery", paneType: "automation", config: { ruleId: brewDayTimer?.id || "", ruleName: "Brew Day Timer" }, x: 6, y: 0, w: 6, h: 10, createdAt: now },

  // Energy
  { id: "pane-solar", tabId: "tab-energy", paneType: "automation", config: { ruleId: solarDashboard?.id || "", ruleName: "Solar Dashboard" }, x: 0, y: 0, w: 7, h: 10, createdAt: now },
  { id: "pane-battery", tabId: "tab-energy", paneType: "automation", config: { ruleId: batteryManager?.id || "", ruleName: "Battery Manager" }, x: 7, y: 0, w: 5, h: 10, createdAt: now },

  // Weather
  { id: "pane-weather-station", tabId: "tab-weather", paneType: "automation", config: { ruleId: weatherStation?.id || "", ruleName: "Weather Station" }, x: 0, y: 0, w: 6, h: 10, createdAt: now },
  { id: "pane-indoor-climate", tabId: "tab-weather", paneType: "automation", config: { ruleId: indoorClimate?.id || "", ruleName: "Indoor Climate" }, x: 6, y: 0, w: 6, h: 10, createdAt: now },
];

await api("PUT", "/api/layout", { tabs, panes });
console.log(`  ✓ Layout: ${tabs.length} tabs, ${panes.length} panes`);

// ═══════════════════════════════════════════════════════════════════════
// 5. FIRE AUTOMATIONS FOR EXECUTION HISTORY
// ═══════════════════════════════════════════════════════════════════════
console.log("\n5. Generating execution history...");

const allRules = [
  irrigationController, greenhouse,
  reefMonitor, lightingController,
  fermentationTracker, brewDayTimer,
  solarDashboard, batteryManager,
  weatherStation, indoorClimate,
].filter(Boolean);

for (const rule of allRules) {
  for (let i = 0; i < 5; i++) {
    await api("POST", `/api/automations/${rule.id}/fire`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
console.log(`  ✓ Fired ${allRules.length} automations × 5`);

// ═══════════════════════════════════════════════════════════════════════
// 5. DONE
// ═══════════════════════════════════════════════════════════════════════
console.log(`
✅ Demo seeding complete!

   Dashboard: ${API.replace(":3001", ":3000")}
   Tabs: Garden · Aquarium · Brewery · Energy · Weather
   Automations: ${allRules.length} (all with custom UI components)
   Devices: ${mqttDevices.length} (via MQTT publish)

   Custom UI components render instantly — just refresh the page.
`);
