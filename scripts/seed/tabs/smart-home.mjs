// scripts/seed/tabs/smart-home.mjs — Smart home demo (option b: home-only).
//
// Evening Mode (new) + carried-over Energy Monitor, Weather Station, and Indoor
// Climate from the original seed. The aquarium/brewery hobby automations were
// intentionally dropped to keep this tab thematically tight.

import { genSeries, round, noise } from "../lib.mjs";

const tab = { id: "tab-smart-home", name: "Smart Home", icon: "house" };

const devices = [
  // Home / lighting / climate
  { topic: "light/home/living-room", payload: { on: true, brightness: 80 } },
  { topic: "light/home/bedroom", payload: { on: false, brightness: 0 } },
  { topic: "sensor/home/hallway-motion", payload: { motion: true } },
  { topic: "sensor/home/kitchen-temp", payload: { value: 22.3 } },
  { topic: "climate/home/thermostat", payload: { target: 21, current: 20.8, mode: "heat" } },
  { topic: "plug/home/kettle", payload: { on: false, power: 0 } },
  // Energy
  { topic: "sensor/energy/solar-production", payload: { value: 4.8 } },
  { topic: "sensor/energy/consumption", payload: { value: 2.1 } },
  { topic: "sensor/energy/battery-level", payload: { value: 72 } },
  { topic: "sensor/energy/grid-export", payload: { value: 1.5 } },
  { topic: "sensor/energy/grid-import", payload: { value: 0 } },
  // Weather
  { topic: "sensor/weather/outdoor-temp", payload: { value: 22.4 } },
  { topic: "sensor/weather/wind-speed", payload: { value: 12.5 } },
  { topic: "sensor/weather/wind-direction", payload: { value: 225 } },
  { topic: "sensor/weather/rain-today", payload: { value: 2.4 } },
  { topic: "sensor/weather/pressure", payload: { value: 1013 } },
  { topic: "sensor/weather/uv-index", payload: { value: 6 } },
  { topic: "sensor/weather/humidity", payload: { value: 58 } },
  { topic: "sensor/weather/temp-high", payload: { value: 26.8 } },
  { topic: "sensor/weather/temp-low", payload: { value: 14.2 } },
  // Rooms
  { topic: "sensor/room/kitchen-temp", payload: { value: 22.5 } },
  { topic: "sensor/room/living-room-temp", payload: { value: 21.6 } },
  { topic: "sensor/room/bedroom-temp", payload: { value: 19.8 } },
  { topic: "sensor/room/office-temp", payload: { value: 23.1 } },
  { topic: "sensor/room/bathroom-temp", payload: { value: 24.2 } },
  { topic: "sensor/room/garage-temp", payload: { value: 18.3 } },
];

// ─── Evening Mode — motion + time-of-day lighting scenes ─────────────────────
const eveningLogic = `automation({
  conditions: [
    function has(context) {
      return context.state !== undefined;
    },
  ],
  actions: [
    function evening(context) {
      var s = context.state, t = context.topic || "";
      if (t.indexOf("motion") >= 0) state.set("motion", s.motion);
      if (t.indexOf("kitchen-temp") >= 0) state.set("temp", s.value);

      if (t.indexOf("set-mode") >= 0 && s.mode) state.set("override", s.mode);

      var hour = new Date().getHours();
      var auto = (hour >= 6 && hour < 17) ? "day" : (hour >= 17 && hour < 22) ? "evening" : "night";
      state.set("autoMode", auto);
      var mode = state.get("override") || auto;
      state.set("mode", mode);
      state.set("lastUpdate", Date.now());

      if (mode === "evening") {
        mqtt.publish("light/home/living-room/command", JSON.stringify({ on: true, brightness: 60 }));
        mqtt.publish("climate/home/thermostat/command", JSON.stringify({ target: 21 }));
        state.set("lightsOn", true);
      } else if (mode === "night") {
        mqtt.publish("light/home/living-room/command", JSON.stringify({ on: false }));
        state.set("lightsOn", false);
      } else {
        state.set("lightsOn", false);
      }
    },
  ],
});`;

const eveningUi = `import type { CustomComponentProps } from "./types";

export default function EveningMode(aeolus: CustomComponentProps) {
  const mode = aeolus.read("mode") as string || "day";
  const motion = aeolus.read("motion") as boolean ?? false;
  const temp = aeolus.read("temp") as number ?? 22.3;
  const lightsOn = aeolus.read("lightsOn") as boolean ?? false;

  const modes = [
    { key: "day", label: "Day", icon: "☀️", color: "#F59E0B" },
    { key: "evening", label: "Evening", icon: "🌆", color: "#A855F7" },
    { key: "night", label: "Night", icon: "🌙", color: "#3BA4FF" },
  ];
  const active = modes.find((m) => m.key === mode) || modes[0];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🏠 Evening Mode</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: active.color + "20", color: active.color }}>
          {active.icon} {active.label}
        </span>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-3 gap-2">
        {modes.map((m) => {
          const on = m.key === mode;
          return (
            <button
              key={m.key}
              onClick={() => aeolus.fire("set-mode", { mode: m.key })}
              className="flex flex-col items-center gap-1 py-3 rounded-xl border transition-all"
              style={{ background: on ? m.color + "20" : "#0B0F14", borderColor: on ? m.color : "#2A3441" }}
            >
              <span className="text-xl">{m.icon}</span>
              <span className="text-[10px]" style={{ color: on ? "#E6EDF3" : "#9AA6B2" }}>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Status */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: lightsOn ? "#F59E0B" : "#6B7785" }}>{lightsOn ? "ON" : "OFF"}</span>
          <span className="text-[7px] text-[#6B7785]">Living Rm</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold text-[#E6EDF3]">{temp.toFixed(1)}°</span>
          <span className="text-[7px] text-[#6B7785]">Kitchen</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[10px] font-mono font-bold" style={{ color: motion ? "#22C55E" : "#6B7785" }}>{motion ? "●" : "○"}</span>
          <span className="text-[7px] text-[#6B7785]">Motion</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Energy Monitor — solar / battery / grid power flow (carry-over) ─────────
const energyLogic = `automation({
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

      state.set("solarToHouse", Math.min(solar, consumption));
      state.set("solarToBattery", Math.max(0, solar - consumption - gridExport));
      state.set("solarToGrid", gridExport);
      state.set("gridToHouse", gridImport);

      const selfPowered = solar >= consumption;
      state.set("selfPowered", selfPowered);
      state.set("selfSufficiency", solar > 0 ? Math.min(100, Math.round((solar / (solar + gridImport)) * 100)) : 0);
    },
  ],
});`;

const energyUi = `import type { CustomComponentProps } from "./types";

export default function EnergyMonitor(aeolus: CustomComponentProps) {
  const solar = aeolus.read("solar-production") as number || 4.8;
  const consumption = aeolus.read("consumption") as number || 2.1;
  const battery = aeolus.read("battery-level") as number || 72;
  const gridExport = aeolus.read("grid-export") as number || 1.5;
  const gridImport = aeolus.read("grid-import") as number || 0;
  const selfSufficiency = aeolus.read("selfSufficiency") as number || 100;
  const selfPowered = aeolus.read("selfPowered") as boolean ?? true;

  const solarToHouse = Math.min(solar, consumption);
  const solarToBattery = aeolus.read("solarToBattery") as number || 0;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">⚡ Energy Monitor</div>
        <div className={"text-[9px] px-2 py-0.5 rounded-full font-semibold " + (selfPowered ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#F59E0B]/15 text-[#F59E0B]")}>
          {selfPowered ? "Self-Powered" : "Grid Assist"}
        </div>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <svg width="100%" height="160" viewBox="0 0 360 160" preserveAspectRatio="xMidYMid meet">
          <g>
            <rect x="130" y="5" width="100" height="35" rx="4" fill="#121821" stroke="#F59E0B" strokeWidth="1.5" strokeOpacity="0.6" />
            <line x1="155" y1="5" x2="155" y2="40" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="180" y1="5" x2="180" y2="40" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="205" y1="5" x2="205" y2="40" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <line x1="130" y1="20" x2="230" y2="20" stroke="#F59E0B" strokeWidth="0.5" strokeOpacity="0.3" />
            <text x="180" y="55" textAnchor="middle" fill="#F59E0B" fontSize="11" fontFamily="monospace" fontWeight="bold">{solar.toFixed(1)} kW</text>
            <text x="180" y="65" textAnchor="middle" fill="#6B7785" fontSize="7">Solar Production</text>
          </g>

          <line x1="180" y1="70" x2="180" y2="90" stroke={solarToHouse > 0 ? "#22C55E" : "#2A3441"} strokeWidth="2.5" className="transition-all duration-700" />
          {solarToHouse > 0 && <circle cx="180" cy="80" r="2" fill="#22C55E" className="animate-pulse" />}

          <g>
            <path d="M155,100 L180,85 L205,100 L205,130 L155,130 Z" fill="#121821" stroke="#5CE1E6" strokeWidth="1.5" />
            <rect x="173" y="115" width="14" height="15" fill="#5CE1E6" fillOpacity="0.2" stroke="#5CE1E6" strokeWidth="0.8" />
            <text x="180" y="140" textAnchor="middle" fill="#5CE1E6" fontSize="11" fontFamily="monospace" fontWeight="bold">{consumption.toFixed(1)} kW</text>
            <text x="180" y="150" textAnchor="middle" fill="#6B7785" fontSize="7">Consumption</text>
          </g>

          <g>
            <rect x="30" y="90" width="50" height="30" rx="4" fill="#121821" stroke={battery > 50 ? "#22C55E" : battery > 20 ? "#F59E0B" : "#EF4444"} strokeWidth="1.5" />
            <rect x="80" y="100" width="4" height="10" rx="1" fill={battery > 50 ? "#22C55E" : battery > 20 ? "#F59E0B" : "#EF4444"} fillOpacity="0.5" />
            <rect x="33" y="93" width={(battery / 100) * 44} height="24" rx="2" fill={battery > 50 ? "#22C55E" : battery > 20 ? "#F59E0B" : "#EF4444"} fillOpacity="0.3" className="transition-all duration-700" />
            <text x="55" y="108" textAnchor="middle" fill="#E6EDF3" fontSize="10" fontFamily="monospace" fontWeight="bold">{battery}%</text>
            <text x="55" y="135" textAnchor="middle" fill="#6B7785" fontSize="7">Battery</text>
          </g>

          <line x1="150" y1="95" x2="85" y2="105" stroke={solarToBattery > 0 ? "#22C55E" : "#2A3441"} strokeWidth="2" strokeDasharray={solarToBattery > 0 ? "4 3" : "0"} className="transition-all duration-700" />
          {solarToBattery > 0 && (
            <text x="115" y="93" textAnchor="middle" fill="#22C55E" fontSize="7" fontFamily="monospace">+{solarToBattery.toFixed(1)}kW</text>
          )}

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

          <line x1="210" y1="105" x2="278" y2="105" stroke={gridExport > 0 ? "#22C55E" : gridImport > 0 ? "#EF4444" : "#2A3441"} strokeWidth="2" strokeDasharray={gridExport > 0 || gridImport > 0 ? "4 3" : "0"} className="transition-all duration-700" />
          {gridExport > 0 && <circle cx="245" cy="105" r="2" fill="#22C55E" className="animate-pulse" />}
          {gridImport > 0 && <circle cx="245" cy="105" r="2" fill="#EF4444" className="animate-pulse" />}
        </svg>
      </div>

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
}`;

// ─── Weather Station (carry-over) ────────────────────────────────────────────
const weatherLogic = `automation({
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
});`;

const weatherUi = `import type { CustomComponentProps } from "./types";

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

  const compassLabels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compassLabel = compassLabels[Math.round(windDir / 45) % 8];
  const uvColor = uv <= 2 ? "#22C55E" : uv <= 5 ? "#F59E0B" : "#EF4444";
  const uvLabel = uv <= 2 ? "Low" : uv <= 5 ? "Moderate" : uv <= 7 ? "High" : "Very High";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌤️ Weather Station</div>
        <span className="text-[10px] text-[#9AA6B2]">{condition}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex flex-col items-center">
          <div className="text-3xl font-mono font-bold text-[#E6EDF3]">{temp.toFixed(1)}°</div>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1"><span className="text-[8px] text-[#EF4444]">▲</span><span className="text-[10px] font-mono text-[#E6EDF3]">{tempHigh.toFixed(1)}°</span></div>
            <div className="flex items-center gap-1"><span className="text-[8px] text-[#3BA4FF]">▼</span><span className="text-[10px] font-mono text-[#E6EDF3]">{tempLow.toFixed(1)}°</span></div>
          </div>
          <div className="text-[8px] text-[#6B7785] mt-1">High / Low Today</div>
        </div>

        <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex flex-col items-center">
          <svg width="70" height="70" viewBox="0 0 70 70">
            <circle cx="35" cy="35" r="28" fill="none" stroke="#2A3441" strokeWidth="1.5" />
            <circle cx="35" cy="35" r="22" fill="none" stroke="#1A2330" strokeWidth="1" />
            <text x="35" y="12" textAnchor="middle" fill="#9AA6B2" fontSize="7" fontWeight="600">N</text>
            <text x="60" y="38" textAnchor="middle" fill="#6B7785" fontSize="6">E</text>
            <text x="35" y="64" textAnchor="middle" fill="#6B7785" fontSize="6">S</text>
            <text x="10" y="38" textAnchor="middle" fill="#6B7785" fontSize="6">W</text>
            <g transform={"rotate(" + windDir + " 35 35)"}>
              <line x1="35" y1="15" x2="35" y2="50" stroke="#5CE1E6" strokeWidth="2" strokeLinecap="round" />
              <polygon points="35,12 30,22 40,22" fill="#5CE1E6" />
            </g>
            <circle cx="35" cy="35" r="3" fill="#5CE1E6" />
          </svg>
          <div className="text-[10px] font-mono font-bold text-[#5CE1E6] mt-1">{windSpeed} km/h {compassLabel}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">🌧️</span><span className="text-[10px] font-mono font-bold text-[#3BA4FF] mt-1">{rain}mm</span><span className="text-[7px] text-[#6B7785]">Rain</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">🌡️</span><span className="text-[10px] font-mono font-bold text-[#E6EDF3] mt-1">{pressure}</span><span className="text-[7px] text-[#6B7785]">hPa</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">☀️</span><span className="text-[10px] font-mono font-bold mt-1" style={{ color: uvColor }}>{uv}</span><span className="text-[7px]" style={{ color: uvColor }}>{uvLabel}</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-sm">💧</span><span className="text-[10px] font-mono font-bold text-[#5CE1E6] mt-1">{humidity}%</span><span className="text-[7px] text-[#6B7785]">Humidity</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Indoor Climate (carry-over) — floor-plan room temperatures ──────────────
const indoorLogic = `automation({
  conditions: [
    function hasReading(context) {
      return context.state.value !== undefined;
    },
  ],
  actions: [
    function trackRooms(context) {
      const topic = context.topic;
      const value = context.state.value;
      const parts = topic.split("/");
      const roomName = parts[2].replace("-temp", "");
      state.set(roomName, value);
      state.set("lastUpdate", Date.now());

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
});`;

const indoorUi = `import type { CustomComponentProps } from "./types";

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
          <span className="text-[8px] text-[#3BA4FF]">● Cold</span>
          <span className="text-[8px] text-[#22C55E]">● OK</span>
          <span className="text-[8px] text-[#EF4444]">● Warm</span>
        </div>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <svg width="100%" height="200" viewBox="0 0 100 90" preserveAspectRatio="xMidYMid meet">
          <rect x="2" y="2" width="96" height="86" rx="3" fill="none" stroke="#2A3441" strokeWidth="0.8" />
          {rooms.map(room => {
            const temp = aeolus.read(room.key) as number || 20;
            const zone = aeolus.read(room.key + "_zone") as string || "comfortable";
            const color = zoneColor(zone);
            return (
              <g key={room.key}>
                <rect x={room.x} y={room.y} width={room.w} height={room.h} rx="2" fill={zoneBg(zone)} stroke={color} strokeWidth="0.6" strokeOpacity="0.5" className="transition-all duration-700" />
                <text x={room.x + room.w / 2} y={room.y + room.h / 2 - 3} textAnchor="middle" fill="#9AA6B2" fontSize="3.5">{room.label}</text>
                <text x={room.x + room.w / 2} y={room.y + room.h / 2 + 5} textAnchor="middle" fill={color} fontSize="5" fontFamily="monospace" fontWeight="bold" className="transition-all duration-700">{temp.toFixed(1)}°</text>
              </g>
            );
          })}
        </svg>
      </div>

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
            </div>
          );
        })}
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "evening", name: "Evening Mode", triggerTopic: "sensor/home/+", scriptSource: eveningLogic, uiSource: eveningUi },
  { key: "energy", name: "Energy Monitor", triggerTopic: "sensor/energy/+", scriptSource: energyLogic, uiSource: energyUi },
  { key: "weather", name: "Weather Station", triggerTopic: "sensor/weather/+", scriptSource: weatherLogic, uiSource: weatherUi },
  { key: "indoor", name: "Indoor Climate", triggerTopic: "sensor/room/+", scriptSource: indoorLogic, uiSource: indoorUi },
];

const panes = [
  { kind: "device-grid", x: 0, y: 0, w: 12, h: 5 },
  { kind: "automation", ref: "evening", x: 0, y: 5, w: 6, h: 8 },
  { kind: "automation", ref: "energy", x: 6, y: 5, w: 6, h: 10 },
  { kind: "automation", ref: "weather", x: 0, y: 13, w: 6, h: 10 },
  { kind: "automation", ref: "indoor", x: 6, y: 15, w: 6, h: 11 },
];

const dataStore = [
  {
    name: "energy-readings",
    description: "Solar production vs consumption + battery (48h)",
    retentionDays: 30,
    records: genSeries({
      count: 96,
      intervalMs: 30 * 60_000,
      fields: {
        solar: (i) => Math.max(0, round(4 * Math.max(0, Math.sin((i - 12) / 15)) + noise(0.3), 2)),
        consumption: () => round(2 + noise(0.6), 2),
        battery: (i) => round(60 + Math.sin(i / 12) * 20 + noise(2), 0),
      },
    }),
  },
];

export default { tab, devices, automations, panes, dataStore };
