// scripts/seed/tabs/space.mjs — Space tab powered by live public APIs (no keys).
//
// The one seed tab that hits the internet — all key-free:
//   • Upcoming launches  — The Space Devs Launch Library 2 (lldev host: cached, no rate limit)
//   • ISS tracker        — wheretheiss.at
//   • Space weather      — NOAA SWPC planetary K-index
//   • Moon & meteors     — computed locally (no API, always works offline)
//
// Automations are cron-triggered (poll on a schedule) and the seed fires them
// once so they populate immediately. UIs degrade gracefully with no data.

const tab = { id: "tab-space", name: "Space", icon: "telescope" };

// No MQTT devices — this tab is entirely API-driven.
const devices = [];

// ─── Upcoming Launches ⭐ — Launch Library 2 ─────────────────────────────────
const launchLogic = `// Cron-triggered. The Space Devs Launch Library 2 (no key).
const res = await http.get("https://lldev.thespacedevs.com/2.2.0/launch/upcoming/?limit=5");
if (res.status !== 200) {
  log.error("Launch Library fetch failed: " + res.status);
} else {
  const r = JSON.parse(res.body);
  const items = (r.results || []).slice(0, 5).map(function (L) {
    return {
      name: L.name,
      net: L.net,
      provider: (L.launch_service_provider && L.launch_service_provider.name) || "",
      pad: (L.pad && L.pad.location && L.pad.location.name) || (L.pad && L.pad.name) || "",
      status: (L.status && L.status.abbrev) || (L.status && L.status.name) || "",
    };
  });
  state.set("launches", items);
  state.set("updated", Date.now());
  log.info("Next launch: " + (items[0] ? items[0].name : "none"));
}`;

const launchUi = `import type { CustomComponentProps } from "./types";

export default function UpcomingLaunches(aeolus: CustomComponentProps) {
  const launches = (aeolus.read("launches") as any[]) || [];

  const countdown = (iso: string) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (isNaN(ms)) return "TBD";
    if (ms < 0) return "in progress";
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return d > 0 ? d + "d " + h + "h" : h + "h " + m + "m";
  };

  if (launches.length === 0) {
    return <div className="p-4 text-[11px] text-[#6B7785]">No launch data yet — click “Fire Now”.</div>;
  }
  const next = launches[0];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🚀 Upcoming Launches</div>
        <span className="text-[9px] text-[#6B7785]">Launch Library 2</span>
      </div>

      {/* Next launch hero */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#3BA4FF]/30 p-3">
        <div className="text-[9px] text-[#3BA4FF] uppercase tracking-wider mb-1">Next Launch</div>
        <div className="text-[13px] font-semibold text-[#E6EDF3] leading-tight">{next.name}</div>
        <div className="text-[9px] text-[#9AA6B2] mt-1">{next.provider} · {next.pad}</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-mono font-bold text-[#5CE1E6]">{countdown(next.net)}</span>
          <span className="text-[9px] text-[#6B7785]">to liftoff</span>
        </div>
      </div>

      {/* Following launches */}
      <div className="space-y-1.5">
        {launches.slice(1).map((l, i) => (
          <div key={i} className="flex items-center gap-2 bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
            <span className="text-[10px] text-[#E6EDF3] flex-1 truncate">{l.name}</span>
            <span className="text-[9px] font-mono text-[#6B7785]">{countdown(l.net)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}`;

// ─── ISS Tracker — wheretheiss.at ────────────────────────────────────────────
const issLogic = `const res = await http.get("https://api.wheretheiss.at/v1/satellites/25544");
if (res.status !== 200) {
  log.error("ISS fetch failed: " + res.status);
} else {
  const d = JSON.parse(res.body);
  state.set("lat", Math.round(d.latitude * 100) / 100);
  state.set("lon", Math.round(d.longitude * 100) / 100);
  state.set("alt", Math.round(d.altitude));
  state.set("vel", Math.round(d.velocity));
  state.set("vis", d.visibility);
  state.set("updated", Date.now());
  log.info("ISS at " + d.latitude.toFixed(1) + ", " + d.longitude.toFixed(1));
}`;

const issUi = `import type { CustomComponentProps } from "./types";

export default function IssTracker(aeolus: CustomComponentProps) {
  const lat = aeolus.read("lat") as number;
  const lon = aeolus.read("lon") as number;
  const alt = aeolus.read("alt") as number ?? 420;
  const vel = aeolus.read("vel") as number ?? 27600;
  const vis = aeolus.read("vis") as string || "daylight";

  const W = 260, H = 130;
  const x = lon !== undefined ? ((lon + 180) / 360) * W : null;
  const y = lat !== undefined ? ((90 - lat) / 180) * H : null;
  const sunlit = vis !== "eclipsed";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🛰️ ISS Tracker</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: sunlit ? "#F59E0B20" : "#6B778520", color: sunlit ? "#F59E0B" : "#9AA6B2" }}>
          {sunlit ? "☀ Sunlit" : "🌑 Eclipsed"}
        </span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height={H} viewBox={"0 0 " + W + " " + H} preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width={W} height={H} fill="#0A0E13" rx="6" />
          {/* graticule */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={"v" + f} x1={f * W} y1="0" x2={f * W} y2={H} stroke="#1A2330" strokeWidth="0.5" />
          ))}
          {[0, 0.5, 1].map((f) => (
            <line key={"h" + f} x1="0" y1={f * H} x2={W} y2={f * H} stroke="#1A2330" strokeWidth="0.5" />
          ))}
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#2A3441" strokeWidth="0.8" strokeDasharray="3 2" />
          {/* ISS */}
          {x !== null && y !== null ? (
            <g>
              <circle cx={x} cy={y} r="22" fill="#5CE1E6" fillOpacity="0.12" />
              <circle cx={x} cy={y} r="4" fill="#5CE1E6" />
              <text x={x} y={y - 8} textAnchor="middle" fill="#5CE1E6" fontSize="9">🛰️</text>
            </g>
          ) : (
            <text x={W / 2} y={H / 2} textAnchor="middle" fill="#6B7785" fontSize="9">Awaiting position…</text>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[9px] font-mono font-bold text-[#E6EDF3]">{lat ?? "—"}</span>
          <span className="text-[7px] text-[#6B7785]">Lat</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[9px] font-mono font-bold text-[#E6EDF3]">{lon ?? "—"}</span>
          <span className="text-[7px] text-[#6B7785]">Lon</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[9px] font-mono font-bold text-[#3BA4FF]">{alt}</span>
          <span className="text-[7px] text-[#6B7785]">km alt</span>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
          <span className="text-[9px] font-mono font-bold text-[#22C55E]">{(vel / 1000).toFixed(1)}k</span>
          <span className="text-[7px] text-[#6B7785]">km/h</span>
        </div>
      </div>
    </div>
  );
}`;

// ─── Space Weather — NOAA SWPC planetary K-index ─────────────────────────────
const swLogic = `const res = await http.get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
if (res.status !== 200) {
  log.error("SWPC fetch failed: " + res.status);
} else {
  const arr = JSON.parse(res.body);
  const last = arr[arr.length - 1];
  const kp = parseFloat(last.Kp);
  state.set("kp", kp);
  state.set("kpTime", last.time_tag);
  const hist = arr.slice(-20).map(function (x) { return parseFloat(x.Kp); });
  state.set("kpHistory", hist);
  state.set("stormLevel", kp >= 7 ? "severe" : kp >= 5 ? "storm" : kp >= 4 ? "active" : "quiet");
  state.set("updated", Date.now());
  log.info("Planetary Kp = " + kp);
}`;

const swUi = `import type { CustomComponentProps } from "./types";

export default function SpaceWeather(aeolus: CustomComponentProps) {
  const kp = aeolus.read("kp") as number ?? 2;
  const stormLevel = aeolus.read("stormLevel") as string || "quiet";
  const hist = (aeolus.read("kpHistory") as number[]) || [];

  const meta: Record<string, { color: string; label: string; aurora: string }> = {
    quiet: { color: "#22C55E", label: "Quiet", aurora: "Unlikely" },
    active: { color: "#84CC16", label: "Active", aurora: "High latitudes" },
    storm: { color: "#F59E0B", label: "Geomagnetic Storm", aurora: "Possible" },
    severe: { color: "#EF4444", label: "Severe Storm", aurora: "Likely!" },
  };
  const m = meta[stormLevel] || meta.quiet;
  // dial: Kp 0..9 over a 180° arc
  const deg = -90 + (Math.min(9, kp) / 9) * 180;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌌 Space Weather</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: m.color + "20", color: m.color }}>{m.label}</span>
      </div>

      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex flex-col items-center">
        <svg width="160" height="92" viewBox="0 0 160 92">
          <path d="M16,82 A64,64 0 0 1 144,82" fill="none" stroke="#1A2330" strokeWidth="9" strokeLinecap="round" />
          <path d="M16,82 A64,64 0 0 1 80,18" fill="none" stroke="#22C55E" strokeWidth="9" strokeLinecap="round" opacity="0.5" />
          <path d="M80,18 A64,64 0 0 1 116,30" fill="none" stroke="#F59E0B" strokeWidth="9" opacity="0.5" />
          <path d="M116,30 A64,64 0 0 1 144,82" fill="none" stroke="#EF4444" strokeWidth="9" strokeLinecap="round" opacity="0.5" />
          <g transform={"rotate(" + deg + " 80 82)"}>
            <line x1="80" y1="82" x2="80" y2="30" stroke={m.color} strokeWidth="3" strokeLinecap="round" />
          </g>
          <circle cx="80" cy="82" r="4" fill={m.color} />
          <text x="80" y="62" textAnchor="middle" fill="#E6EDF3" fontSize="18" fontFamily="monospace" fontWeight="bold">{kp.toFixed(1)}</text>
          <text x="80" y="74" textAnchor="middle" fill="#6B7785" fontSize="7">Kp index</text>
        </svg>
        <div className="text-[10px] text-[#9AA6B2]">Aurora: <span style={{ color: m.color }}>{m.aurora}</span></div>
      </div>

      {/* recent history */}
      {hist.length > 0 && (
        <div className="flex items-end gap-0.5 h-10 bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2">
          {hist.map((v, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: (Math.min(9, v) / 9) * 100 + "%", background: v >= 5 ? "#F59E0B" : "#3BA4FF", opacity: 0.4 + (i / hist.length) * 0.6 }} />
          ))}
        </div>
      )}
    </div>
  );
}`;

// ─── Moon & Meteor Showers — computed locally (no API, offline-safe) ─────────
const moonLogic = `// Moon phase from the synodic month since a known new moon (2000-01-06 18:14 UTC).
const synodic = 29.53058867;
const knownNew = Date.UTC(2000, 0, 6, 18, 14) / 1000;
const days = (Date.now() / 1000 - knownNew) / 86400;
let age = days % synodic;
if (age < 0) age += synodic;
const illum = Math.round((1 - Math.cos((2 * Math.PI * age) / synodic)) / 2 * 100);
const phases = ["New Moon","Waxing Crescent","First Quarter","Waxing Gibbous","Full Moon","Waning Gibbous","Last Quarter","Waning Crescent"];
const idx = Math.floor(((age / synodic) * 8 + 0.5)) % 8;
state.set("moonPhase", phases[idx]);
state.set("moonIdx", idx);
state.set("moonAge", Math.round(age * 10) / 10);
state.set("moonIllum", illum);

// Next major meteor shower from a fixed annual calendar (peak month/day).
const showers = [
  { name: "Quadrantids", mon: 1, day: 3 },
  { name: "Lyrids", mon: 4, day: 22 },
  { name: "Eta Aquariids", mon: 5, day: 6 },
  { name: "Perseids", mon: 8, day: 12 },
  { name: "Orionids", mon: 10, day: 21 },
  { name: "Leonids", mon: 11, day: 17 },
  { name: "Geminids", mon: 12, day: 14 },
];
const now = new Date();
let best = null, bestDays = 9999;
for (const sh of showers) {
  let yr = now.getFullYear();
  let peak = new Date(yr, sh.mon - 1, sh.day);
  if (peak.getTime() < now.getTime()) peak = new Date(yr + 1, sh.mon - 1, sh.day);
  const d = Math.ceil((peak.getTime() - now.getTime()) / 86400000);
  if (d < bestDays) { bestDays = d; best = { name: sh.name, days: d }; }
}
state.set("nextShower", best);
state.set("updated", Date.now());
log.info("Moon: " + phases[idx] + " (" + illum + "%), next shower " + (best ? best.name : "?"));`;

const moonUi = `import type { CustomComponentProps } from "./types";

const EMOJI = ["🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘"];

export default function MoonAndMeteors(aeolus: CustomComponentProps) {
  const phase = aeolus.read("moonPhase") as string || "Waxing Crescent";
  const idx = aeolus.read("moonIdx") as number ?? 1;
  const illum = aeolus.read("moonIllum") as number ?? 30;
  const age = aeolus.read("moonAge") as number ?? 5;
  const shower = aeolus.read("nextShower") as any;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌙 Moon & Meteors</div>
        <span className="text-[9px] text-[#6B7785]">computed locally</span>
      </div>

      {/* Moon */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex items-center gap-4">
        <div className="text-5xl">{EMOJI[idx] || "🌙"}</div>
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-[#E6EDF3]">{phase}</div>
          <div className="text-[9px] text-[#9AA6B2] mt-0.5">{illum}% illuminated · {age} days old</div>
          <div className="mt-2 h-2 bg-[#1A2330] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: illum + "%", background: "linear-gradient(90deg,#3BA4FF,#E6EDF3)" }} />
          </div>
        </div>
      </div>

      {/* Next meteor shower */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3">
        <div className="text-[9px] text-[#6B7785] uppercase tracking-wider mb-1">Next Meteor Shower</div>
        {shower ? (
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-[#5CE1E6]">☄️ {shower.name}</span>
            <span className="text-[11px] font-mono text-[#E6EDF3]">in {shower.days} days</span>
          </div>
        ) : (
          <div className="text-[11px] text-[#6B7785]">—</div>
        )}
      </div>
    </div>
  );
}`;

// ─── Assembly ────────────────────────────────────────────────────────────────
const automations = [
  { key: "launches", name: "Upcoming Launches", cron: "0 */2 * * *", scriptSource: launchLogic, uiSource: launchUi },
  { key: "iss", name: "ISS Tracker", cron: "*/5 * * * *", scriptSource: issLogic, uiSource: issUi },
  { key: "weather", name: "Space Weather", cron: "*/30 * * * *", scriptSource: swLogic, uiSource: swUi },
  { key: "moon", name: "Moon & Meteors", cron: "0 */6 * * *", scriptSource: moonLogic, uiSource: moonUi },
];

const panes = [
  { kind: "automation", ref: "launches", x: 0, y: 0, w: 6, h: 11 },
  { kind: "automation", ref: "iss", x: 6, y: 0, w: 6, h: 10 },
  { kind: "automation", ref: "weather", x: 0, y: 11, w: 6, h: 10 },
  { kind: "automation", ref: "moon", x: 6, y: 10, w: 6, h: 9 },
];

// No Data Store collections — live APIs are the source of truth here.
const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
