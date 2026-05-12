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

  const TankSVG = ({ level, label }: { level: number; label: string }) => {
    const tankColor = level > 60 ? "#22C55E" : level > 30 ? "#F59E0B" : "#EF4444";
    const fillH = (level / 100) * 70;
    return (
      <div className="flex flex-col items-center gap-1 flex-1">
        <svg width="100%" height="90" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={"tankGrad-" + label} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={tankColor} stopOpacity="0.85" />
              <stop offset="50%" stopColor={tankColor} stopOpacity="0.5" />
              <stop offset="100%" stopColor={tankColor} stopOpacity="0.2" />
            </linearGradient>
            <clipPath id={"tankClip-" + label}>
              <rect x="10" y="10" width="140" height="70" rx="10" />
            </clipPath>
          </defs>
          <rect x="10" y="10" width="140" height="70" rx="10" fill="#0B0F14" stroke="#2A3441" strokeWidth="1.5" />
          <rect x="10" y={80 - fillH} width="140" height={fillH} fill={"url(#tankGrad-" + label + ")"} clipPath={"url(#tankClip-" + label + ")"} className="transition-all duration-700" />
          <rect x="10" y="10" width="140" height="70" rx="10" fill="none" stroke="#2A3441" strokeWidth="1.5" />
          <text x="80" y="48" textAnchor="middle" fill="#E6EDF3" fontSize="14" fontFamily="monospace" fontWeight="bold">{level}%</text>
          <text x="80" y="62" textAnchor="middle" fill="#6B7785" fontSize="9">{label}</text>
        </svg>
      </div>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💧 Smart Irrigation</div>
        <div className="text-[10px] text-[#6B7785]">{totalCycles} cycles</div>
      </div>

      <div className="space-y-2">
        <TankSVG level={tank1} label="Tank A" />
        <TankSVG level={tank2} label="Tank B" />
      </div>

      <div className="space-y-2">
        {zones.map(z => {
          const m = getMoisture(z);
          const active = isWatering(z);
          return (
            <div key={z} className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-[#9AA6B2] uppercase">{z.replace("zone", "Zone ")}</span>
                <span className={"text-[10px] px-1.5 py-0.5 rounded " + (active ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#1A2330] text-[#6B7785]")}>
                  {active ? "● Watering" : "○ Idle"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-[#1A2330] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: (m || 0) + "%", backgroundColor: moistureColor(m) }} />
                </div>
                <span className="text-xs font-mono font-semibold w-8 text-right" style={{ color: moistureColor(m) }}>{m ?? "—"}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => props.mqttPublish("switch/irrigation/zone-1/command", JSON.stringify({ action: "open", duration: 300 }))}
        className="w-full py-2 rounded-lg text-xs font-medium bg-[#3BA4FF]/20 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/30 transition-colors"
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
      const metric = context.topic.split("/")[2];
      const value = context.state.value;
      state.set(metric, value);
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

export default function GreenhousePanel(props: CustomComponentProps) {
  const temp = props.state.get("temp") as number || 0;
  const humidity = props.state.get("humidity") as number || 0;
  const co2 = props.state.get("co2") as number || 0;
  const ventActive = props.state.get("ventActive") as boolean;

  const tempOk = temp >= 20 && temp <= 30;
  const humOk = humidity >= 50 && humidity <= 80;
  const co2Ok = co2 >= 350 && co2 <= 600;

  const statusDot = (ok: boolean) => ok ? "bg-[#22C55E]" : "bg-[#F59E0B]";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌱 Greenhouse</div>
        <div className={"text-[10px] px-2 py-0.5 rounded " + (ventActive ? "bg-[#F59E0B]/20 text-[#F59E0B]" : "bg-[#22C55E]/20 text-[#22C55E]")}>
          {ventActive ? "Venting" : "Sealed"}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className={"w-2 h-2 rounded-full shrink-0 " + statusDot(tempOk)} />
          <div className="flex-1">
            <div className="flex justify-between text-xs">
              <span className="text-[#9AA6B2]">Temperature</span>
              <span className="text-[#E6EDF3] font-mono font-semibold">{temp.toFixed(1)}°C</span>
            </div>
            <div className="w-full h-1.5 bg-[#1A2330] rounded-full mt-1 overflow-hidden">
              <div className="h-full rounded-full bg-[#F59E0B] transition-all" style={{ width: Math.min((temp / 40) * 100, 100) + "%" }} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={"w-2 h-2 rounded-full shrink-0 " + statusDot(humOk)} />
          <div className="flex-1">
            <div className="flex justify-between text-xs">
              <span className="text-[#9AA6B2]">Humidity</span>
              <span className="text-[#E6EDF3] font-mono font-semibold">{humidity}%</span>
            </div>
            <div className="w-full h-1.5 bg-[#1A2330] rounded-full mt-1 overflow-hidden">
              <div className="h-full rounded-full bg-[#3BA4FF] transition-all" style={{ width: humidity + "%" }} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={"w-2 h-2 rounded-full shrink-0 " + statusDot(co2Ok)} />
          <div className="flex-1">
            <div className="flex justify-between text-xs">
              <span className="text-[#9AA6B2]">CO₂</span>
              <span className="text-[#E6EDF3] font-mono font-semibold">{co2} ppm</span>
            </div>
            <div className="w-full h-1.5 bg-[#1A2330] rounded-full mt-1 overflow-hidden">
              <div className="h-full rounded-full bg-[#22C55E] transition-all" style={{ width: Math.min((co2 / 1000) * 100, 100) + "%" }} />
            </div>
          </div>
        </div>
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

  const tankColor = (level: number) => level > 60 ? "#22C55E" : level > 30 ? "#F59E0B" : "#EF4444";
  const mainColor = tankColor(mainLevel);
  const feederColor = tankColor(feederLevel);

  const TankSVG = ({ level, label, color }: { level: number; label: string; color: string }) => {
    const fillH = (level / 100) * 55;
    return (
      <div className="flex-1">
        <svg width="100%" height="75" viewBox="0 0 140 75" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={"xferTank-" + label} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0.85" />
              <stop offset="50%" stopColor={color} stopOpacity="0.5" />
              <stop offset="100%" stopColor={color} stopOpacity="0.2" />
            </linearGradient>
            <clipPath id={"xferClip-" + label}>
              <rect x="8" y="8" width="124" height="58" rx="8" />
            </clipPath>
          </defs>
          <rect x="8" y="8" width="124" height="58" rx="8" fill="#0B0F14" stroke="#2A3441" strokeWidth="1.5" />
          <rect x="8" y={66 - fillH} width="124" height={fillH} fill={"url(#xferTank-" + label + ")"} clipPath={"url(#xferClip-" + label + ")"} className="transition-all duration-700" />
          <rect x="8" y="8" width="124" height="58" rx="8" fill="none" stroke="#2A3441" strokeWidth="1.5" />
          <text x="70" y="40" textAnchor="middle" fill="#E6EDF3" fontSize="13" fontFamily="monospace" fontWeight="bold">{level}%</text>
          <text x="70" y="54" textAnchor="middle" fill="#6B7785" fontSize="8">{label}</text>
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

      <TankSVG level={mainLevel} label="Main (House)" color={mainColor} />

      {/* Pump indicator between tanks */}
      <div className="flex items-center justify-center gap-2 py-1">
        <div className="h-px flex-1 bg-[#2A3441]" />
        <div className={"flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium " + (pumpActive ? "bg-[#3BA4FF]/20 text-[#3BA4FF] border border-[#3BA4FF]/30" : "bg-[#1A2330] text-[#6B7785] border border-[#2A3441]")}>
          {pumpActive ? "⬆ Pumping" : "○ Idle"}
        </div>
        <div className="h-px flex-1 bg-[#2A3441]" />
      </div>

      <TankSVG level={feederLevel} label="Feeder (Rainwater)" color={feederColor} />

      <div className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441] text-[10px] text-[#6B7785]">
        Pump activates when house tank drops below 40% and feeder has water available.
      </div>

      <button
        onClick={() => props.mqttPublish("switch/tank/transfer-pump/command", JSON.stringify({ on: true, duration: 300 }))}
        className="w-full py-2 rounded-lg text-xs font-medium bg-[#3BA4FF]/20 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/30 transition-colors"
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

  const maxBar = Math.max(solar, grid, 0.1);
  const barPct = (v: number) => Math.max((v / (maxBar * 1.3)) * 100, 3) + "%";
  const batteryColor = battery > 60 ? "#22C55E" : battery > 25 ? "#F59E0B" : "#EF4444";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">⚡ Energy Monitor</div>
        <div className={"text-xs font-mono font-semibold px-2 py-0.5 rounded " + (net >= 0 ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-[#EF4444]")}>
          {net >= 0 ? "+" : ""}{net.toFixed(1)} kW net
        </div>
      </div>

      <div className="flex items-end gap-4 justify-center h-28 px-4">
        <div className="flex flex-col items-center gap-1 flex-1">
          <div className="text-[10px] font-mono text-[#22C55E]">{solar.toFixed(1)} kW</div>
          <div className="w-full rounded-t-md transition-all duration-500" style={{ height: barPct(solar), background: "linear-gradient(to top, #22C55E, #5CE1E6)" }} />
          <div className="text-[10px] text-[#6B7785]">Solar</div>
        </div>
        <div className="flex flex-col items-center gap-1 flex-1">
          <div className="text-[10px] font-mono text-[#F59E0B]">{grid.toFixed(1)} kW</div>
          <div className="w-full rounded-t-md transition-all duration-500" style={{ height: barPct(grid), background: "linear-gradient(to top, #F59E0B, #EF4444)" }} />
          <div className="text-[10px] text-[#6B7785]">Grid</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Battery</div>
          <div className="text-xl font-bold font-mono" style={{ color: batteryColor }}>{battery}%</div>
          <div className="w-full h-1.5 bg-[#1A2330] rounded-full mt-1.5 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: battery + "%", backgroundColor: batteryColor }} />
          </div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Self-Sufficiency</div>
          <div className="text-xl font-bold font-mono text-[#5CE1E6]">{selfSuff}%</div>
          <div className="w-full h-1.5 bg-[#1A2330] rounded-full mt-1.5 overflow-hidden">
            <div className="h-full rounded-full bg-[#5CE1E6] transition-all duration-500" style={{ width: selfSuff + "%" }} />
          </div>
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

      <div className="flex justify-center gap-4">
        {vessels.map(v => {
          const temp = getTemp(v.id);
          const gravity = getGravity(v.id);
          const co2 = getCo2(v.id);
          const fill = fillLevel(v.id);
          const color = stageColor(v.stage);
          const fillH = (fill / 100) * 80;

          return (
            <div key={v.id} className="flex flex-col items-center gap-1">
              <svg width="50" height="100" viewBox="0 0 50 100">
                <defs>
                  <linearGradient id={"vesselGrad" + v.id} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor={color} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.3" />
                  </linearGradient>
                  <clipPath id={"vesselClip" + v.id}>
                    <rect x="8" y="10" width="34" height="80" rx="6" />
                  </clipPath>
                </defs>
                <rect x="8" y="10" width="34" height="80" rx="6" fill="#1A2330" stroke="#2A3441" strokeWidth="1.5" />
                <rect x="8" y={90 - fillH} width="34" height={fillH} fill={"url(#vesselGrad" + v.id + ")"} clipPath={"url(#vesselClip" + v.id + ")"} className="transition-all duration-700" />
                <rect x="8" y="10" width="34" height="80" rx="6" fill="none" stroke="#2A3441" strokeWidth="1.5" />
                <rect x="18" y="4" width="14" height="8" rx="3" fill="#1A2330" stroke="#2A3441" strokeWidth="1" />
              </svg>
              <div className="text-center">
                <div className="text-[9px] text-[#6B7785]">{v.label}</div>
                <div className="text-[10px] font-mono" style={{ color }}>{v.stage}</div>
              </div>
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
  triggerTopic: "sensor/hydro/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackLights(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
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
  triggerTopic: "sensor/pool/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackPool(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
      state.set("lastUpdate", Date.now());
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
  triggerTopic: "sensor/rack/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackRack(context) {
      const metric = context.topic.split("/")[2];
      state.set(metric, context.state.value);
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
        <div className="text-[10px] text-[#6B7785]">Avg: <span className="font-mono" style={{ color: tempColor(avgTemp) }}>{avgTemp.toFixed(1)}°C</span></div>
      </div>

      <div className="space-y-2">
        {servers.map(s => {
          const temp = getTemp(s.id);
          const cpu = getCpu(s.id);
          const fan = getFan(s.id);
          const color = tempColor(temp);

          return (
            <div key={s.id} className="bg-[#0B0F14] rounded-lg p-2.5 border border-[#2A3441]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-[#9AA6B2] font-medium">{s.name}</span>
                <span className="text-[10px] font-mono text-[#6B7785]">{fan} RPM</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Temp bar */}
                <div className="flex-1">
                  <div className="w-full h-3 bg-[#1A2330] rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: Math.min((temp / 70) * 100, 100) + "%", backgroundColor: color }} />
                  </div>
                </div>
                <span className="text-[10px] font-mono font-semibold w-10 text-right" style={{ color }}>{temp}°C</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1">
                  <div className="w-full h-1.5 bg-[#1A2330] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#3BA4FF] transition-all duration-500" style={{ width: cpu + "%" }} />
                  </div>
                </div>
                <span className="text-[9px] font-mono text-[#3BA4FF] w-10 text-right">{cpu}% CPU</span>
              </div>
            </div>
          );
        })}
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

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">🌤️ Weather Station</div>

      {/* Large temp display */}
      <div className="text-center py-2">
        <div className="text-5xl font-bold text-[#E6EDF3] font-mono">{temp.toFixed(1)}°</div>
        <div className="text-[10px] text-[#6B7785] mt-1">Outdoor Temperature</div>
      </div>

      {/* Wind with direction arrow */}
      <div className="flex items-center justify-center gap-4 bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
        <svg width="40" height="40" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="18" fill="none" stroke="#2A3441" strokeWidth="1.5" />
          <g transform={"rotate(" + arrowRotation + " 20 20)"}>
            <polygon points="20,4 24,28 20,24 16,28" fill="#5CE1E6" opacity="0.9" />
          </g>
          <circle cx="20" cy="20" r="3" fill="#5CE1E6" />
        </svg>
        <div>
          <div className="text-lg font-bold font-mono text-[#E6EDF3]">{windSpeed.toFixed(1)} km/h</div>
          <div className="text-[10px] text-[#6B7785]">{windDir}° ({windDir >= 315 || windDir < 45 ? "N" : windDir < 135 ? "E" : windDir < 225 ? "S" : "W"})</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">🌧️ Rain</div>
          <div className="text-sm font-bold font-mono text-[#3BA4FF]">{rain} mm</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">📊 Pressure</div>
          <div className="text-sm font-bold font-mono text-[#9AA6B2]">{pressure} hPa</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">☀️ UV</div>
          <div className="text-sm font-bold font-mono" style={{ color: uvColor }}>{uv}</div>
          <div className="text-[8px]" style={{ color: uvColor }}>{uvLabel}</div>
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
  weatherStation, climateOverview,
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
