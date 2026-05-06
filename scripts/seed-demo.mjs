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
// 1. START SIMULATOR + PUBLISH EXTRA DEVICES
// ═══════════════════════════════════════════════════════════════════════
console.log("1. Starting simulator & publishing devices...");
await api("POST", "/api/simulator/start");
await new Promise(r => setTimeout(r, 2000));

const mqttDevices = [
  // Garden ecosystem
  { topic: "sensor/garden/soil-moisture", payload: '{"value": 42}' },
  { topic: "sensor/garden/soil-moisture-bed-2", payload: '{"value": 58}' },
  { topic: "sensor/greenhouse/temp", payload: '{"value": 28.3}' },
  { topic: "sensor/greenhouse/humidity", payload: '{"value": 72}' },
  { topic: "sensor/greenhouse/co2", payload: '{"value": 420}' },
  { topic: "sensor/tank/water-level", payload: '{"value": 78}' },
  { topic: "switch/irrigation/zone-1", payload: '{"on": true}' },
  { topic: "switch/irrigation/zone-2", payload: '{"on": false}' },
  { topic: "switch/irrigation/zone-3", payload: '{"on": false}' },
  // Home
  { topic: "sensor/workshop/temp", payload: '{"value": 19.7}' },
  { topic: "sensor/workshop/humidity", payload: '{"value": 55}' },
  { topic: "motion/front-door", payload: '{"value": false}' },
  { topic: "motion/workshop", payload: '{"value": true}' },
  { topic: "motion/garage", payload: '{"value": false}' },
  { topic: "light/garden/path", payload: '{"on": true, "brightness": 180}' },
  { topic: "light/porch", payload: '{"on": false, "brightness": 0}' },
  { topic: "light/workshop", payload: '{"on": true, "brightness": 254}' },
  // Energy
  { topic: "sensor/energy/solar-production", payload: '{"value": 3.2}' },
  { topic: "sensor/energy/grid-consumption", payload: '{"value": 1.4}' },
  { topic: "sensor/energy/battery-level", payload: '{"value": 72}' },
  // Weather station
  { topic: "sensor/weather/wind-speed", payload: '{"value": 12.5}' },
  { topic: "sensor/weather/rain", payload: '{"value": 0}' },
  { topic: "sensor/weather/pressure", payload: '{"value": 1013}' },
  { topic: "sensor/weather/uv-index", payload: '{"value": 4}' },
];

for (const msg of mqttDevices) {
  await api("POST", "/api/mqtt/publish", msg);
}
await new Promise(r => setTimeout(r, 1500));
console.log(`  ✓ Published ${mqttDevices.length} device messages`);

// ═══════════════════════════════════════════════════════════════════════
// 2. CREATE AUTOMATIONS
// ═══════════════════════════════════════════════════════════════════════
console.log("\n2. Creating automations...");

// ─── Automation 1: Climate Dashboard ─────────────────────────────────
const climate = await api("POST", "/api/automations", {
  name: "Climate Dashboard",
  triggerTopic: "sensor/+/temp",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasTemp(context) {
      return typeof context.state.value === "number";
    },
  ],
  actions: [
    function trackClimate(context) {
      const temp = context.state.value;
      const room = context.topic.split("/")[1];

      // Store per-room temperature
      state.set("temp_" + room, temp);
      state.set("lastRoom", room);
      state.set("lastTemp", temp);
      state.set("lastUpdate", Date.now());

      // Track daily min/max
      const min = state.get("dailyMin");
      const max = state.get("dailyMax");
      if (min === undefined || temp < min) state.set("dailyMin", temp);
      if (max === undefined || temp > max) state.set("dailyMax", temp);

      // Increment reading counter
      state.set("totalReadings", (state.get("totalReadings") || 0) + 1);

      // Comfort assessment
      const comfort = temp >= 18 && temp <= 24 ? "comfortable" : temp < 18 ? "cold" : "hot";
      state.set("comfort_" + room, comfort);

      if (temp > 30) log.warn(room + " is overheating: " + temp + "°C");
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function ClimateDashboard(props: CustomComponentProps) {
  const rooms = ["kitchen", "living-room", "outdoor", "greenhouse", "workshop"];
  const lastUpdate = props.state.get("lastUpdate") as number | undefined;
  const dailyMin = props.state.get("dailyMin") as number | undefined;
  const dailyMax = props.state.get("dailyMax") as number | undefined;
  const totalReadings = props.state.get("totalReadings") as number || 0;

  const getTemp = (room: string) => props.state.get("temp_" + room) as number | undefined;
  const getComfort = (room: string) => props.state.get("comfort_" + room) as string || "—";

  const tempColor = (t: number | undefined) => {
    if (t === undefined) return "#6B7785";
    if (t > 30) return "#EF4444";
    if (t > 25) return "#F59E0B";
    if (t < 12) return "#3BA4FF";
    return "#22C55E";
  };

  const comfortIcon = (c: string) => c === "comfortable" ? "✓" : c === "cold" ? "❄" : c === "hot" ? "🔥" : "—";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌡️ Climate Overview</div>
        <div className="flex items-center gap-3 text-[10px] text-[#6B7785]">
          <span>{totalReadings} readings</span>
          {lastUpdate && <span>{new Date(lastUpdate).toLocaleTimeString()}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {rooms.map(room => {
          const temp = getTemp(room);
          const comfort = getComfort(room);
          return (
            <div key={room} className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#6B7785] uppercase">{room.replace("-", " ")}</span>
                <span className="text-[10px]">{comfortIcon(comfort)}</span>
              </div>
              <div className="text-2xl font-bold font-mono" style={{ color: tempColor(temp) }}>
                {temp !== undefined ? temp.toFixed(1) + "°" : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between px-1">
        <div className="text-xs">
          <span className="text-[#6B7785]">Low </span>
          <span className="text-[#3BA4FF] font-mono font-semibold">{dailyMin?.toFixed(1) ?? "—"}°</span>
        </div>
        <div className="text-xs">
          <span className="text-[#6B7785]">High </span>
          <span className="text-[#EF4444] font-mono font-semibold">{dailyMax?.toFixed(1) ?? "—"}°</span>
        </div>
      </div>
    </div>
  );
}`,
});
if (climate) console.log("  ✓ Climate Dashboard:", climate.id);

// ─── Automation 2: Smart Irrigation ──────────────────────────────────
const irrigation = await api("POST", "/api/automations", {
  name: "Smart Irrigation",
  triggerTopic: "sensor/garden/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasMoisture(context) {
      return typeof context.state.value === "number" && context.topic.includes("moisture");
    },
  ],
  actions: [
    function manageIrrigation(context) {
      const moisture = context.state.value;
      const zone = context.topic.includes("bed-2") ? "zone-2" : "zone-1";

      state.set("moisture_" + zone, moisture);
      state.set("lastReading", Date.now());

      // Auto-water if dry and during daytime
      const hour = new Date(context.timestamp).getHours();
      const isDaytime = hour >= 6 && hour < 20;
      const isDry = moisture < 35;

      if (isDry && isDaytime) {
        mqtt.publish("switch/irrigation/" + zone + "/command", JSON.stringify({ action: "open", duration: 300 }));
        state.set(zone + "_active", true);
        state.set(zone + "_lastWatered", Date.now());
        state.set("totalCycles", (state.get("totalCycles") || 0) + 1);
        log.info("Watering " + zone + " — moisture at " + moisture + "%");
      } else {
        state.set(zone + "_active", false);
      }

      // Water tank level
      const tank = devices.get("sensor-tank-water-level");
      if (tank) state.set("tankLevel", tank.state.value);
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function IrrigationPanel(props: CustomComponentProps) {
  const zones = ["zone-1", "zone-2"];
  const tankLevel = props.state.get("tankLevel") as number || 0;
  const totalCycles = props.state.get("totalCycles") as number || 0;

  const getMoisture = (z: string) => props.state.get("moisture_" + z) as number | undefined;
  const isActive = (z: string) => props.state.get(z + "_active") as boolean;
  const lastWatered = (z: string) => props.state.get(z + "_lastWatered") as number | undefined;

  const moistureColor = (v: number | undefined) => {
    if (v === undefined) return "#6B7785";
    if (v < 25) return "#EF4444";
    if (v < 40) return "#F59E0B";
    return "#22C55E";
  };

  const tankColor = tankLevel > 60 ? "#22C55E" : tankLevel > 30 ? "#F59E0B" : "#EF4444";

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">💧 Smart Irrigation</div>
        <div className="text-[10px] text-[#6B7785]">{totalCycles} cycles total</div>
      </div>

      {/* Tank level bar */}
      <div className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[#6B7785] uppercase">Water Tank</span>
          <span className="text-xs font-mono font-semibold" style={{ color: tankColor }}>{tankLevel}%</span>
        </div>
        <div className="w-full h-3 bg-[#1A2330] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: tankLevel + "%", backgroundColor: tankColor }} />
        </div>
      </div>

      {/* Zone cards */}
      <div className="grid grid-cols-2 gap-2">
        {zones.map(zone => {
          const moisture = getMoisture(zone);
          const active = isActive(zone);
          const watered = lastWatered(zone);
          return (
            <div key={zone} className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-[#6B7785] uppercase">{zone}</span>
                <span className={"text-[10px] px-1.5 py-0.5 rounded " + (active ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#1A2330] text-[#6B7785]")}>
                  {active ? "Watering" : "Idle"}
                </span>
              </div>
              <div className="text-xl font-bold font-mono" style={{ color: moistureColor(moisture) }}>
                {moisture !== undefined ? moisture + "%" : "—"}
              </div>
              <div className="text-[10px] text-[#6B7785] mt-1">
                {watered ? "Last: " + new Date(watered).toLocaleTimeString() : "Not watered yet"}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => props.mqttPublish("switch/irrigation/zone-1/command", JSON.stringify({ action: "open", duration: 300 }))}
        className="w-full py-2 rounded-lg text-xs font-medium bg-[#3BA4FF]/20 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/30 transition-colors"
      >
        Manual Water Zone 1 (5 min)
      </button>
    </div>
  );
}`,
});
if (irrigation) console.log("  ✓ Smart Irrigation:", irrigation.id);

// ─── Automation 3: Energy Monitor ────────────────────────────────────
const energy = await api("POST", "/api/automations", {
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
      const battery = state.get("battery-level") || 0;
      state.set("net", solar - grid);
      state.set("selfSufficiency", solar > 0 ? Math.min(Math.round((solar / (solar + grid)) * 100), 100) : 0);
      state.set("lastUpdate", Date.now());

      if (grid > 3) log.warn("High grid draw: " + grid.toFixed(1) + " kW");
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function EnergyDashboard(props: CustomComponentProps) {
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
        <div className="text-sm font-semibold text-[#E6EDF3]">⚡ Energy</div>
        <div className={"text-xs font-mono font-semibold px-2 py-0.5 rounded " + (net >= 0 ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#EF4444]/20 text-[#EF4444]")}>
          {net >= 0 ? "+" : ""}{net.toFixed(1)} kW
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-4 justify-center h-24 px-4">
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

      {/* Battery + self-sufficiency */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Battery</div>
          <div className="text-lg font-bold font-mono" style={{ color: batteryColor }}>{battery}%</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785]">Self-Sufficient</div>
          <div className="text-lg font-bold font-mono text-[#5CE1E6]">{selfSuff}%</div>
        </div>
      </div>
    </div>
  );
}`,
});
if (energy) console.log("  ✓ Energy Monitor:", energy.id);


// ─── Automation 4: Security & Motion ─────────────────────────────────
const security = await api("POST", "/api/automations", {
  name: "Security Monitor",
  triggerTopic: "motion/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function motionDetected(context) {
      return context.state.value === true;
    },
  ],
  actions: [
    function handleMotion(context) {
      const zone = context.topic.split("/")[1];
      const hour = new Date(context.timestamp).getHours();
      const isNight = hour >= 22 || hour < 6;

      // Track motion events
      const events = state.get("events") || [];
      events.unshift({ zone, time: context.timestamp, night: isNight });
      if (events.length > 10) events.pop();
      state.set("events", events);
      state.set("lastMotion", zone);
      state.set("lastMotionTime", context.timestamp);
      state.set("totalAlerts", (state.get("totalAlerts") || 0) + 1);

      if (isNight) {
        state.set("nightAlerts", (state.get("nightAlerts") || 0) + 1);
        // Turn on nearest light
        const lights = devices.filter(d => d.type === "light");
        if (lights.length > 0) {
          devices.action(lights[0].id, "brightness", { brightness: 254 });
        }
        log.warn("Night motion at " + zone);
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function SecurityPanel(props: CustomComponentProps) {
  const events = props.state.get("events") as Array<{ zone: string; time: number; night: boolean }> || [];
  const lastMotion = props.state.get("lastMotion") as string || "—";
  const totalAlerts = props.state.get("totalAlerts") as number || 0;
  const nightAlerts = props.state.get("nightAlerts") as number || 0;

  const zones = ["front-door", "workshop", "garage"];
  const motionDevices = props.devices.filter(d => d.id.includes("motion"));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🛡️ Security</div>
        <div className="text-[10px] text-[#6B7785]">{totalAlerts} alerts ({nightAlerts} night)</div>
      </div>

      {/* Zone status */}
      <div className="flex gap-2">
        {zones.map(zone => {
          const device = motionDevices.find(d => d.id.includes(zone));
          const active = device?.state?.value === true;
          return (
            <div key={zone} className={"flex-1 rounded-lg p-2 border text-center text-[10px] " + (active ? "bg-[#EF4444]/10 border-[#EF4444]/30 text-[#EF4444]" : "bg-[#0B0F14] border-[#2A3441] text-[#6B7785]")}>
              <div className="font-semibold uppercase">{zone.replace("-", " ")}</div>
              <div className="mt-0.5">{active ? "● Motion" : "○ Clear"}</div>
            </div>
          );
        })}
      </div>

      {/* Recent events */}
      <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] overflow-hidden">
        <div className="px-3 py-1.5 border-b border-[#2A3441] text-[10px] text-[#6B7785] uppercase">Recent Activity</div>
        <div className="max-h-28 overflow-auto">
          {events.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-[#6B7785]">No motion events yet</div>
          ) : events.map((ev, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[10px] border-b border-[#2A3441]/50 last:border-0">
              <span className="text-[#E6EDF3]">{ev.zone}</span>
              <div className="flex items-center gap-2">
                {ev.night && <span className="text-[#F59E0B]">🌙</span>}
                <span className="text-[#6B7785] font-mono">{new Date(ev.time).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}`,
});
if (security) console.log("  ✓ Security Monitor:", security.id);

// ─── Automation 5: Weather Station ───────────────────────────────────
const weather = await api("POST", "/api/automations", {
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
  const wind = props.state.get("wind-speed") as number || 0;
  const rain = props.state.get("rain") as number || 0;
  const pressure = props.state.get("pressure") as number || 0;
  const uv = props.state.get("uv-index") as number || 0;

  const outdoor = props.devices.find(d => d.id.includes("outdoor"));
  const temp = outdoor?.state?.value as number | undefined;

  const uvColor = uv <= 2 ? "#22C55E" : uv <= 5 ? "#F59E0B" : uv <= 7 ? "#EF4444" : "#9333EA";
  const uvLabel = uv <= 2 ? "Low" : uv <= 5 ? "Moderate" : uv <= 7 ? "High" : "Very High";

  return (
    <div className="p-4 space-y-3">
      <div className="text-sm font-semibold text-[#E6EDF3]">🌤️ Weather Station</div>

      {/* Main temp */}
      <div className="text-center py-2">
        <div className="text-4xl font-bold text-[#E6EDF3] font-mono">
          {temp !== undefined ? temp.toFixed(1) + "°C" : "—"}
        </div>
        <div className="text-[10px] text-[#6B7785] mt-1">Outdoor Temperature</div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-[10px] text-[#6B7785]">💨 Wind</div>
          <div className="text-sm font-bold text-[#E6EDF3] font-mono">{wind.toFixed(1)} km/h</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-[10px] text-[#6B7785]">🌧️ Rain</div>
          <div className="text-sm font-bold text-[#E6EDF3] font-mono">{rain} mm</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-[10px] text-[#6B7785]">📊 Pressure</div>
          <div className="text-sm font-bold text-[#E6EDF3] font-mono">{pressure} hPa</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-[10px] text-[#6B7785]">☀️ UV Index</div>
          <div className="text-sm font-bold font-mono" style={{ color: uvColor }}>{uv} <span className="text-[10px] font-normal">({uvLabel})</span></div>
        </div>
      </div>
    </div>
  );
}`,
});
if (weather) console.log("  ✓ Weather Station:", weather.id);

// ─── Automation 6: Greenhouse Controller ─────────────────────────────
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

      // Ventilation logic
      const temp = state.get("temp") || 0;
      const humidity = state.get("humidity") || 0;
      const needsVent = temp > 28 || humidity > 80;
      state.set("ventActive", needsVent);

      if (needsVent) {
        mqtt.publish("switch/greenhouse/vent/command", JSON.stringify({ action: "open" }));
        log.info("Greenhouse vent opened — temp: " + temp + "°C, humidity: " + humidity + "%");
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

// ═══════════════════════════════════════════════════════════════════════
// 3. SEED AUTOMATION STATE
// ═══════════════════════════════════════════════════════════════════════
console.log("\n3. Populating automation state...");

if (climate) {
  const temps = { kitchen: 22.5, "living-room": 21.6, outdoor: 14.4, greenhouse: 28.3, workshop: 19.7 };
  for (const [room, temp] of Object.entries(temps)) {
    await api("PUT", `/api/automations/${climate.id}/state`, { key: "temp_" + room, value: temp });
    const comfort = temp >= 18 && temp <= 24 ? "comfortable" : temp < 18 ? "cold" : "hot";
    await api("PUT", `/api/automations/${climate.id}/state`, { key: "comfort_" + room, value: comfort });
  }
  await api("PUT", `/api/automations/${climate.id}/state`, { key: "dailyMin", value: 8.2 });
  await api("PUT", `/api/automations/${climate.id}/state`, { key: "dailyMax", value: 31.4 });
  await api("PUT", `/api/automations/${climate.id}/state`, { key: "totalReadings", value: 1247 });
  await api("PUT", `/api/automations/${climate.id}/state`, { key: "lastUpdate", value: Date.now() });
  console.log("  ✓ Climate state");
}

if (irrigation) {
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "moisture_zone-1", value: 42 });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "moisture_zone-2", value: 58 });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "zone-1_active", value: false });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "zone-2_active", value: false });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "zone-1_lastWatered", value: Date.now() - 7200000 });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "tankLevel", value: 78 });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "totalCycles", value: 47 });
  console.log("  ✓ Irrigation state");
}

if (energy) {
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "solar-production", value: 3.2 });
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "grid-consumption", value: 1.4 });
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "battery-level", value: 72 });
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "net", value: 1.8 });
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "selfSufficiency", value: 70 });
  console.log("  ✓ Energy state");
}

if (security) {
  const events = [
    { zone: "front-door", time: Date.now() - 300000, night: false },
    { zone: "workshop", time: Date.now() - 1800000, night: false },
    { zone: "garage", time: Date.now() - 7200000, night: true },
  ];
  await api("PUT", `/api/automations/${security.id}/state`, { key: "events", value: events });
  await api("PUT", `/api/automations/${security.id}/state`, { key: "lastMotion", value: "front-door" });
  await api("PUT", `/api/automations/${security.id}/state`, { key: "totalAlerts", value: 34 });
  await api("PUT", `/api/automations/${security.id}/state`, { key: "nightAlerts", value: 5 });
  console.log("  ✓ Security state");
}

if (weather) {
  await api("PUT", `/api/automations/${weather.id}/state`, { key: "wind-speed", value: 12.5 });
  await api("PUT", `/api/automations/${weather.id}/state`, { key: "rain", value: 0 });
  await api("PUT", `/api/automations/${weather.id}/state`, { key: "pressure", value: 1013 });
  await api("PUT", `/api/automations/${weather.id}/state`, { key: "uv-index", value: 4 });
  console.log("  ✓ Weather state");
}

if (greenhouse) {
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "temp", value: 28.3 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "humidity", value: 72 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "co2", value: 420 });
  await api("PUT", `/api/automations/${greenhouse.id}/state`, { key: "ventActive", value: true });
  console.log("  ✓ Greenhouse state");
}

// ═══════════════════════════════════════════════════════════════════════
// 4. CREATE DASHBOARD LAYOUT
// ═══════════════════════════════════════════════════════════════════════
console.log("\n4. Creating dashboard layout...");

const now = Date.now();
const gardenTab = "demo-garden";
const homeTab = "demo-home";
const monitorTab = "demo-monitor";

const layout = {
  tabs: [
    { id: gardenTab, name: "Garden", icon: "leaf", order: 2, pinned: false, createdAt: now },
    { id: homeTab, name: "Home", icon: "home", order: 3, pinned: false, createdAt: now },
    { id: monitorTab, name: "Monitoring", icon: "activity", order: 4, pinned: false, createdAt: now },
  ],
  panes: [
    // Garden tab
    { id: "p-irrigation", tabId: gardenTab, paneType: "automation", config: { ruleId: irrigation?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
    { id: "p-greenhouse", tabId: gardenTab, paneType: "automation", config: { ruleId: greenhouse?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },
    { id: "p-garden-sensors", tabId: gardenTab, paneType: "sensor-panel", config: {}, x: 0, y: 9, w: 12, h: 4, createdAt: now },

    // Home tab
    { id: "p-energy", tabId: homeTab, paneType: "automation", config: { ruleId: energy?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
    { id: "p-security", tabId: homeTab, paneType: "automation", config: { ruleId: security?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },
    { id: "p-devices", tabId: homeTab, paneType: "device-grid", config: {}, x: 0, y: 9, w: 12, h: 5, createdAt: now },

    // Monitoring tab
    { id: "p-climate", tabId: monitorTab, paneType: "automation", config: { ruleId: climate?.id || "" }, x: 0, y: 0, w: 6, h: 9, createdAt: now },
    { id: "p-weather", tabId: monitorTab, paneType: "automation", config: { ruleId: weather?.id || "" }, x: 6, y: 0, w: 6, h: 9, createdAt: now },
    { id: "p-mqtt", tabId: monitorTab, paneType: "mqtt-inspector", config: {}, x: 0, y: 9, w: 6, h: 5, createdAt: now },
    { id: "p-topics", tabId: monitorTab, paneType: "topic-tree", config: {}, x: 6, y: 9, w: 6, h: 5, createdAt: now },
  ],
};

await api("PUT", "/api/layout", layout);
console.log(`  ✓ Layout: 3 tabs, ${layout.panes.length} panes`);

// ═══════════════════════════════════════════════════════════════════════
// 5. FIRE AUTOMATIONS FOR EXECUTION HISTORY
// ═══════════════════════════════════════════════════════════════════════
console.log("\n5. Generating execution history...");

const allRules = [climate, irrigation, energy, security, weather, greenhouse].filter(Boolean);
for (const rule of allRules) {
  for (let i = 0; i < 5; i++) {
    await api("POST", `/api/automations/${rule.id}/fire`);
    await new Promise(r => setTimeout(r, 150));
  }
}
console.log(`  ✓ Fired ${allRules.length} automations × 5`);

// ═══════════════════════════════════════════════════════════════════════
// DONE
// ═══════════════════════════════════════════════════════════════════════
console.log(`
✅ Demo seeding complete!

   Dashboard: ${API.replace(":3001", ":3000")}
   Tabs: Garden · Home · Monitoring
   Automations: ${allRules.length} (all with custom UI components)
   Devices: ~30 (simulator + custom MQTT)

   Custom UI components render instantly — just refresh the page.
`);
