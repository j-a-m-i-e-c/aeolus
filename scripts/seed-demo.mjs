#!/usr/bin/env node
/**
 * seed-demo.mjs — Populate Aeolus with realistic demo data for screenshots.
 *
 * Run against a live Aeolus instance:
 *   node scripts/seed-demo.mjs http://192.168.0.40:3001
 *
 * DO NOT commit the resulting database — this is for screenshots only.
 */

const API = process.argv[2] || "http://192.168.0.40:3001";
console.log(`\n🌬️  Seeding Aeolus demo data → ${API}\n`);

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    console.error(`  ✗ ${method} ${path} → ${res.status}`, data);
    return null;
  }
  return data;
}

// ─── 1. Start simulator ──────────────────────────────────────────────
console.log("1. Starting simulator...");
await api("POST", "/api/simulator/start");
await new Promise(r => setTimeout(r, 3000)); // Let it generate some data

// ─── 2. Publish extra MQTT devices (garden/workshop sensors) ─────────
console.log("2. Publishing custom MQTT device data...");

const mqttDevices = [
  { topic: "sensor/garden/soil-moisture", payload: '{"value": 42}' },
  { topic: "sensor/garden/soil-moisture-2", payload: '{"value": 38}' },
  { topic: "sensor/greenhouse/temp", payload: '{"value": 28.3}' },
  { topic: "sensor/greenhouse/humidity", payload: '{"value": 72}' },
  { topic: "sensor/tank/water-level", payload: '{"value": 78}' },
  { topic: "sensor/workshop/temp", payload: '{"value": 19.7}' },
  { topic: "sensor/workshop/humidity", payload: '{"value": 55}' },
  { topic: "motion/workshop", payload: '{"value": true}' },
  { topic: "motion/front-door", payload: '{"value": false}' },
  { topic: "light/garden/path", payload: '{"on": true, "brightness": 180}' },
  { topic: "light/porch", payload: '{"on": false, "brightness": 0}' },
  { topic: "switch/irrigation/zone-1", payload: '{"on": true}' },
  { topic: "switch/irrigation/zone-2", payload: '{"on": false}' },
  { topic: "sensor/energy/solar-production", payload: '{"value": 2.4}' },
  { topic: "sensor/energy/grid-consumption", payload: '{"value": 1.1}' },
];

for (const msg of mqttDevices) {
  await api("POST", "/api/mqtt/publish", msg);
}
await new Promise(r => setTimeout(r, 2000));


// ─── 3. Create automations with scripts + custom UI components ───────
console.log("3. Creating automations...");

// Automation 1: Temperature Monitor with gauge UI
const tempMonitor = await api("POST", "/api/automations", {
  name: "Temperature Monitor",
  triggerTopic: "sensor/+/temp",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasTemperature(ctx) {
      return typeof ctx.state.value === "number";
    },
  ],
  actions: [
    function trackTemperature(ctx) {
      const temp = ctx.state.value;
      const location = ctx.topic.split("/")[1];
      state.set(location, temp);

      // Track min/max
      const min = state.get("min");
      const max = state.get("max");
      if (min === undefined || temp < min) state.set("min", temp);
      if (max === undefined || temp > max) state.set("max", temp);
      state.set("lastUpdate", Date.now());
      state.set("readings", (state.get("readings") || 0) + 1);

      if (temp > 30) {
        log.warn("High temperature alert: " + temp + "°C at " + location);
      }
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function TempDashboard(props: CustomComponentProps) {
  const locations = ["kitchen", "living-room", "outdoor", "greenhouse", "workshop"];
  const min = props.state.get("min") as number | undefined;
  const max = props.state.get("max") as number | undefined;
  const readings = props.state.get("readings") as number || 0;

  const getTemp = (loc: string) => props.state.get(loc) as number | undefined;
  const getTempColor = (t: number | undefined) => {
    if (t === undefined) return "#6B7785";
    if (t > 30) return "#EF4444";
    if (t > 25) return "#F59E0B";
    if (t < 10) return "#3BA4FF";
    return "#22C55E";
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌡️ Temperature Overview</div>
        <div className="text-[10px] text-[#6B7785]">{readings} readings</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {locations.map(loc => {
          const temp = getTemp(loc);
          return (
            <div key={loc} className="bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441]">
              <div className="text-[10px] text-[#6B7785] uppercase tracking-wider mb-1">
                {loc.replace("-", " ")}
              </div>
              <div className="text-2xl font-bold" style={{ color: getTempColor(temp) }}>
                {temp !== undefined ? temp.toFixed(1) + "°" : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 text-xs text-[#9AA6B2]">
        <span>Min: <span className="text-[#3BA4FF] font-mono">{min?.toFixed(1) ?? "—"}°</span></span>
        <span>Max: <span className="text-[#EF4444] font-mono">{max?.toFixed(1) ?? "—"}°</span></span>
      </div>
    </div>
  );
}`,
});
if (tempMonitor) console.log("  ✓ Temperature Monitor:", tempMonitor.id);

// Automation 2: Irrigation Controller
const irrigation = await api("POST", "/api/automations", {
  name: "Smart Irrigation",
  triggerTopic: "sensor/garden/soil-moisture",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function isSoilDry(ctx) {
      const moisture = ctx.state.value;
      return typeof moisture === "number" && moisture < 40;
    },
    function isDaytime(ctx) {
      const hour = new Date(ctx.timestamp).getHours();
      return hour >= 6 && hour < 20;
    },
  ],
  actions: [
    function activateIrrigation(ctx) {
      const moisture = ctx.state.value;
      mqtt.publish("switch/irrigation/zone-1/command", JSON.stringify({ action: "open", duration: 300 }));
      state.set("lastWatered", Date.now());
      state.set("moistureAtTrigger", moisture);
      state.set("zone1Active", true);
      state.set("totalCycles", (state.get("totalCycles") || 0) + 1);
      log.info("Irrigation activated — soil moisture at " + moisture + "%");
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function IrrigationPanel(props: CustomComponentProps) {
  const zone1Active = props.state.get("zone1Active") as boolean;
  const lastWatered = props.state.get("lastWatered") as number | undefined;
  const moistureAtTrigger = props.state.get("moistureAtTrigger") as number | undefined;
  const totalCycles = props.state.get("totalCycles") as number || 0;

  const soilDevice = props.devices.find(d => d.id.includes("soil-moisture"));
  const currentMoisture = soilDevice?.state?.value as number | undefined;

  const moistureColor = (v: number | undefined) => {
    if (v === undefined) return "#6B7785";
    if (v < 30) return "#EF4444";
    if (v < 45) return "#F59E0B";
    return "#22C55E";
  };

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">💧 Smart Irrigation</div>

      <div className="flex items-center gap-3">
        <div className="flex-1 bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785] uppercase mb-1">Soil Moisture</div>
          <div className="text-3xl font-bold" style={{ color: moistureColor(currentMoisture) }}>
            {currentMoisture !== undefined ? currentMoisture + "%" : "—"}
          </div>
        </div>
        <div className="flex-1 bg-[#0B0F14] rounded-lg p-3 border border-[#2A3441] text-center">
          <div className="text-[10px] text-[#6B7785] uppercase mb-1">Zone 1</div>
          <div className={"text-lg font-bold " + (zone1Active ? "text-[#22C55E]" : "text-[#6B7785]")}>
            {zone1Active ? "🟢 Active" : "⏸ Idle"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-[10px] text-[#6B7785]">Last Watered</div>
          <div className="text-[#E6EDF3] font-mono">
            {lastWatered ? new Date(lastWatered).toLocaleTimeString() : "Never"}
          </div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-[10px] text-[#6B7785]">Total Cycles</div>
          <div className="text-[#E6EDF3] font-mono">{totalCycles}</div>
        </div>
      </div>

      <button
        onClick={() => props.mqttPublish("switch/irrigation/zone-1/command", JSON.stringify({ action: "open", duration: 300 }))}
        className="w-full py-2 rounded-lg text-xs font-medium bg-[#3BA4FF]/20 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/30 transition-colors"
      >
        Manual Water (5 min)
      </button>
    </div>
  );
}`,
});
if (irrigation) console.log("  ✓ Smart Irrigation:", irrigation.id);


// Automation 3: Energy Monitor with bar chart
const energy = await api("POST", "/api/automations", {
  name: "Energy Monitor",
  triggerTopic: "sensor/energy/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function hasReading(ctx) {
      return typeof ctx.state.value === "number";
    },
  ],
  actions: [
    function trackEnergy(ctx) {
      const metric = ctx.topic.split("/")[2];
      const value = ctx.state.value;
      state.set(metric, value);

      if (metric === "solar-production" && metric === "grid-consumption") {
        const solar = state.get("solar-production") || 0;
        const grid = state.get("grid-consumption") || 0;
        state.set("net", solar - grid);
      }
      state.set("lastUpdate", Date.now());
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function EnergyDashboard(props: CustomComponentProps) {
  const solar = props.state.get("solar-production") as number || 0;
  const grid = props.state.get("grid-consumption") as number || 0;
  const net = solar - grid;

  const maxVal = Math.max(solar, grid, 0.1);
  const barHeight = (v: number) => Math.max((v / (maxVal * 1.2)) * 100, 4);

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm font-semibold text-[#E6EDF3]">⚡ Energy Monitor</div>

      <div className="flex items-end gap-6 justify-center h-32 px-4">
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs font-mono text-[#22C55E]">{solar.toFixed(1)} kW</div>
          <div
            className="w-12 rounded-t-lg transition-all duration-500"
            style={{ height: barHeight(solar) + "%", background: "linear-gradient(to top, #22C55E, #5CE1E6)" }}
          />
          <div className="text-[10px] text-[#6B7785]">Solar</div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs font-mono text-[#F59E0B]">{grid.toFixed(1)} kW</div>
          <div
            className="w-12 rounded-t-lg transition-all duration-500"
            style={{ height: barHeight(grid) + "%", background: "linear-gradient(to top, #F59E0B, #EF4444)" }}
          />
          <div className="text-[10px] text-[#6B7785]">Grid</div>
        </div>
      </div>

      <div className="text-center">
        <div className="text-[10px] text-[#6B7785] uppercase">Net</div>
        <div className={"text-xl font-bold " + (net >= 0 ? "text-[#22C55E]" : "text-[#EF4444]")}>
          {net >= 0 ? "+" : ""}{net.toFixed(1)} kW
        </div>
        <div className="text-[10px] text-[#6B7785]">
          {net >= 0 ? "Exporting to grid ☀️" : "Drawing from grid"}
        </div>
      </div>
    </div>
  );
}`,
});
if (energy) console.log("  ✓ Energy Monitor:", energy.id);

// Automation 4: Evening Lighting Mode
const evening = await api("POST", "/api/automations", {
  name: "Evening Lighting",
  triggerTopic: "sensor/outdoor/temp",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function isEvening(ctx) {
      const hour = new Date(ctx.timestamp).getHours();
      return hour >= 17 && hour < 23;
    },
  ],
  actions: [
    function setEveningMode(ctx) {
      const lights = devices.filter(d => d.type === "light");
      for (const light of lights) {
        devices.action(light.id, "brightness", { brightness: 120 });
      }
      state.set("mode", "evening");
      state.set("activeLights", lights.length);
      state.set("lastActivated", Date.now());
      log.info("Evening lighting mode activated — " + lights.length + " lights dimmed");
    },
  ],
});`,
  uiSource: `import type { CustomComponentProps } from "./types";

export default function EveningMode(props: CustomComponentProps) {
  const mode = props.state.get("mode") as string || "day";
  const activeLights = props.state.get("activeLights") as number || 0;
  const lastActivated = props.state.get("lastActivated") as number | undefined;

  const lights = props.devices.filter(d => d.type === "light");
  const onCount = lights.filter(d => d.state.on).length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">
          {mode === "evening" ? "🌙 Evening Mode" : "☀️ Day Mode"}
        </div>
        <div className={"text-xs px-2 py-0.5 rounded " + (mode === "evening" ? "bg-[#F59E0B]/20 text-[#F59E0B]" : "bg-[#3BA4FF]/20 text-[#3BA4FF]")}>
          {mode}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-lg font-bold text-[#E6EDF3]">{lights.length}</div>
          <div className="text-[10px] text-[#6B7785]">Total</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-lg font-bold text-[#22C55E]">{onCount}</div>
          <div className="text-[10px] text-[#6B7785]">On</div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg p-2 border border-[#2A3441]">
          <div className="text-lg font-bold text-[#6B7785]">{lights.length - onCount}</div>
          <div className="text-[10px] text-[#6B7785]">Off</div>
        </div>
      </div>

      {lastActivated && (
        <div className="text-[10px] text-[#6B7785]">
          Last activated: {new Date(lastActivated).toLocaleTimeString()}
        </div>
      )}

      <div className="flex gap-2">
        {lights.slice(0, 4).map(light => (
          <button
            key={light.id}
            onClick={() => props.deviceAction(light.id, "toggle")}
            className={"flex-1 py-1.5 rounded-lg text-[10px] font-medium border transition-colors " +
              (light.state.on
                ? "bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/30"
                : "bg-[#1A2330] text-[#6B7785] border-[#2A3441]")}
          >
            {light.name}
          </button>
        ))}
      </div>
    </div>
  );
}`,
});
if (evening) console.log("  ✓ Evening Lighting:", evening.id);

// Automation 5: Security Monitor (motion-based, no custom UI — uses flow diagram)
const security = await api("POST", "/api/automations", {
  name: "Motion Alert",
  triggerTopic: "motion/+",
  ruleType: "script",
  scriptSource: `automation({
  conditions: [
    function motionDetected(ctx) {
      return ctx.state.value === true;
    },
    function isNightTime(ctx) {
      const hour = new Date(ctx.timestamp).getHours();
      return hour >= 22 || hour < 6;
    },
  ],
  actions: [
    function turnOnLights(ctx) {
      const location = ctx.topic.split("/")[1];
      const light = devices.filter(d => d.type === "light")[0];
      if (light) {
        devices.action(light.id, "brightness", { brightness: 254 });
      }
      log.warn("Night motion detected at " + location);
    },
    function sendAlert(ctx) {
      const location = ctx.topic.split("/")[1];
      http.post("https://hooks.example.com/webhook", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Motion at " + location + " at " + new Date().toLocaleTimeString() }),
      });
    },
  ],
});`,
});
if (security) console.log("  ✓ Motion Alert:", security.id);


// ─── 4. Pre-populate automation state so UIs have data ───────────────
console.log("4. Populating automation state...");

if (tempMonitor) {
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "kitchen", value: 22.5 });
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "living-room", value: 21.6 });
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "outdoor", value: 14.4 });
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "greenhouse", value: 28.3 });
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "workshop", value: 19.7 });
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "min", value: 8.2 });
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "max", value: 31.4 });
  await api("PUT", `/api/automations/${tempMonitor.id}/state`, { key: "readings", value: 847 });
  console.log("  ✓ Temperature state seeded");
}

if (irrigation) {
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "zone1Active", value: true });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "lastWatered", value: Date.now() - 3600000 });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "moistureAtTrigger", value: 35 });
  await api("PUT", `/api/automations/${irrigation.id}/state`, { key: "totalCycles", value: 23 });
  console.log("  ✓ Irrigation state seeded");
}

if (energy) {
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "solar-production", value: 2.4 });
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "grid-consumption", value: 1.1 });
  await api("PUT", `/api/automations/${energy.id}/state`, { key: "lastUpdate", value: Date.now() });
  console.log("  ✓ Energy state seeded");
}

if (evening) {
  await api("PUT", `/api/automations/${evening.id}/state`, { key: "mode", value: "evening" });
  await api("PUT", `/api/automations/${evening.id}/state`, { key: "activeLights", value: 3 });
  await api("PUT", `/api/automations/${evening.id}/state`, { key: "lastActivated", value: Date.now() - 1800000 });
  console.log("  ✓ Evening state seeded");
}

// ─── 5. Set up dashboard layout with custom tabs ─────────────────────
console.log("5. Creating dashboard layout...");

const now = Date.now();

const gardenTabId = "demo-garden-tab";
const homeTabId = "demo-home-tab";
const monitorTabId = "demo-monitor-tab";

const layout = {
  tabs: [
    { id: gardenTabId, name: "Garden", icon: "leaf", order: 2, pinned: false, createdAt: now },
    { id: homeTabId, name: "Home", icon: "home", order: 3, pinned: false, createdAt: now },
    { id: monitorTabId, name: "Monitoring", icon: "activity", order: 4, pinned: false, createdAt: now },
  ],
  panes: [
    // Garden tab — irrigation automation + soil sensor + topic tree
    { id: "demo-p1", tabId: gardenTabId, paneType: "automation", config: { ruleId: irrigation?.id || "" }, x: 0, y: 0, w: 6, h: 8, createdAt: now },
    { id: "demo-p2", tabId: gardenTabId, paneType: "sensor-panel", config: {}, x: 6, y: 0, w: 6, h: 4, createdAt: now },
    { id: "demo-p3", tabId: gardenTabId, paneType: "mqtt-inspector", config: {}, x: 6, y: 4, w: 6, h: 4, createdAt: now },

    // Home tab — evening lighting + energy + device grid
    { id: "demo-p4", tabId: homeTabId, paneType: "automation", config: { ruleId: evening?.id || "" }, x: 0, y: 0, w: 6, h: 7, createdAt: now },
    { id: "demo-p5", tabId: homeTabId, paneType: "automation", config: { ruleId: energy?.id || "" }, x: 6, y: 0, w: 6, h: 7, createdAt: now },
    { id: "demo-p6", tabId: homeTabId, paneType: "device-grid", config: {}, x: 0, y: 7, w: 12, h: 5, createdAt: now },

    // Monitoring tab — temp monitor + event log + topic tree + system stats
    { id: "demo-p7", tabId: monitorTabId, paneType: "automation", config: { ruleId: tempMonitor?.id || "" }, x: 0, y: 0, w: 6, h: 8, createdAt: now },
    { id: "demo-p8", tabId: monitorTabId, paneType: "automation", config: { ruleId: security?.id || "" }, x: 6, y: 0, w: 6, h: 5, createdAt: now },
    { id: "demo-p9", tabId: monitorTabId, paneType: "event-log", config: {}, x: 6, y: 5, w: 6, h: 3, createdAt: now },
    { id: "demo-p10", tabId: monitorTabId, paneType: "topic-tree", config: {}, x: 0, y: 8, w: 6, h: 4, createdAt: now },
    { id: "demo-p11", tabId: monitorTabId, paneType: "system-stats", config: {}, x: 6, y: 8, w: 6, h: 4, createdAt: now },
  ],
};

await api("PUT", "/api/layout", layout);
console.log("  ✓ Layout saved (3 tabs, " + layout.panes.length + " panes)");

// ─── 6. Fire automations to generate execution history ───────────────
console.log("6. Firing automations for execution history...");

const ruleIds = [tempMonitor, irrigation, energy, evening, security].filter(Boolean).map(r => r.id);
for (const id of ruleIds) {
  for (let i = 0; i < 3; i++) {
    await api("POST", `/api/automations/${id}/fire`);
    await new Promise(r => setTimeout(r, 200));
  }
}
console.log("  ✓ Fired " + ruleIds.length + " automations × 3");

// ─── 7. Trigger frontend rebuild for custom UI components ────────────
console.log("7. Triggering frontend rebuild for custom UI components...");
const rebuildResult = await api("POST", "/api/system/rebuild-frontend");
if (rebuildResult) {
  console.log("  ✓ Frontend rebuild started — this takes 1-3 minutes on a Pi");
  console.log("    Watch status at: " + API + "/api/system/rebuild-status");
} else {
  console.log("  ⚠ Frontend rebuild failed — custom UI components won't render until rebuilt");
}

// ─── Done ────────────────────────────────────────────────────────────
console.log("\n✅ Demo seeding complete!");
console.log("   Dashboard: http://192.168.0.40:3000");
console.log("   Tabs: Garden, Home, Monitoring");
console.log("   Automations: 5 (4 with custom UI)");
console.log("   Devices: ~22 (simulator + custom MQTT)");
console.log("\n   ⏳ Wait for frontend rebuild to finish before taking screenshots.");
console.log("   Custom UI components will show after rebuild + page refresh.\n");
