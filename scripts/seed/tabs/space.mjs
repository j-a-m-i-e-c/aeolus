// scripts/seed/tabs/space.mjs — Space Tracker (the ONE real tab).
//
// Unlike every other demo tab (simulated), this one runs against REAL public
// APIs entirely server-side inside trusted seeded Logic:
//   • ISS position  — api.wheretheiss.at  (refreshed every cron tick)
//   • Upcoming launches — ll.thespacedevs.com (throttled: refreshed ~30 min)
//   • Space weather (Kp) — services.swpc.noaa.gov (refreshed ~15 min)
//
// This is safe in the public demo because the visitor never supplies a URL —
// the outbound destinations are fixed in Aeolus-authored Logic. The visitor's
// only lever is a bounded `refresh` event. A cron trigger keeps it live with no
// interaction; server-side fetch means one shared set of calls regardless of how
// many people are watching, which also respects the launch API's rate limit.

const tab = { id: "tab-space", name: "Space", icon: "rocket" };

// No MQTT devices — this tab's data comes from real HTTP APIs, not the broker.
const devices = [];

// ─── Seeded Logic — real outbound HTTP on a cron tick (and on demand) ────────
const spaceLogic = `automation({
  actions: [
    async function spaceTracker(context) {
      var now = Date.now();

      // ISS position — cheap and fast-moving; refresh every run.
      try {
        var res = await http.get("https://api.wheretheiss.at/v1/satellites/25544");
        var iss = JSON.parse(res.body);
        state.set("iss", {
          lat: Math.round(iss.latitude * 100) / 100,
          lon: Math.round(iss.longitude * 100) / 100,
          altKm: Math.round(iss.altitude),
          velKmh: Math.round(iss.velocity),
        });
        state.set("issUpdated", now);
        if (db) db.write("iss-track", { lat: iss.latitude, lon: iss.longitude, alt: iss.altitude });
      } catch (e) { log.warn("ISS fetch failed: " + e.message); }

      // Upcoming launches — slow-moving + rate-limited API; refresh at most every 30 min.
      var launchesAt = Number(state.get("launchesUpdated")) || 0;
      if (now - launchesAt > 1800000) {
        try {
          var lr = await http.get("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=4&mode=list");
          var data = JSON.parse(lr.body);
          var list = (data.results || []).map(function (x) {
            return { name: x.name, net: x.net, provider: (x.launch_service_provider || {}).name || "" };
          });
          state.set("launches", list);
          state.set("launchesUpdated", now);
          log.info("Fetched " + list.length + " upcoming launches");
        } catch (e) { log.warn("Launches fetch failed: " + e.message); }
      }

      // Planetary K-index (geomagnetic activity) — refresh every 15 min.
      var wxAt = Number(state.get("wxUpdated")) || 0;
      if (now - wxAt > 900000) {
        try {
          var wr = await http.get("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
          var arr = JSON.parse(wr.body);
          if (arr && arr.length > 1) {
            var last = arr[arr.length - 1];
            state.set("kp", Number(last[1]));
            state.set("wxUpdated", now);
          }
        } catch (e) { log.warn("Space weather fetch failed: " + e.message); }
      }
    },
  ],
});`;

// ─── UI — displays the real data; bounded manual refresh ─────────────────────
const spaceUi = `import type { CustomComponentProps } from "./types";

export default function SpaceTracker(aeolus: CustomComponentProps) {
  const iss = (aeolus.read("iss") as any) ?? null;
  const launches = (aeolus.read("launches") as any[]) ?? [];
  const kp = aeolus.read("kp") as number | undefined;
  const updated = aeolus.read("issUpdated") as number | undefined;

  const W = 360, H = 180;
  const x = iss ? ((iss.lon + 180) / 360) * W : -10;
  const y = iss ? ((90 - iss.lat) / 180) * H : -10;
  const ago = updated ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : null;
  const kpColor = kp == null ? "#6B7785" : kp >= 5 ? "#EF4444" : kp >= 4 ? "#F59E0B" : "#22C55E";

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🛰️ Space Tracker</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold bg-[#22C55E]/15 text-[#22C55E]">● LIVE · real data</span>
      </div>

      <div className="bg-[#070A0E] rounded-xl border border-[#2A3441] p-2">
        <svg width="100%" height="196" viewBox="0 0 360 180" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width={W} height={H} rx="6" fill="#0B1220" stroke="#2A3441" strokeWidth="1" />
          {[45, 90, 135].map((gy) => <line key={"h" + gy} x1="0" y1={gy} x2={W} y2={gy} stroke="#1A2330" strokeWidth="0.5" />)}
          {[90, 180, 270].map((gx) => <line key={"v" + gx} x1={gx} y1="0" x2={gx} y2={H} stroke="#1A2330" strokeWidth="0.5" />)}
          <line x1="0" y1="90" x2={W} y2="90" stroke="#2A3441" strokeWidth="0.75" strokeDasharray="4 3" />
          {iss && (
            <g>
              <circle cx={x} cy={y} r="10" fill="none" stroke="#3BA4FF" strokeWidth="1" className="animate-ping" opacity="0.4" />
              <circle cx={x} cy={y} r="4" fill="#3BA4FF" stroke="#E6EDF3" strokeWidth="1" />
              <text x={x + 8} y={y - 6} fill="#E6EDF3" fontSize="8" fontFamily="monospace">ISS</text>
            </g>
          )}
          {!iss && <text x="180" y="94" textAnchor="middle" fill="#6B7785" fontSize="9">Acquiring ISS position…</text>}
        </svg>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <Stat label="Latitude" value={iss ? iss.lat + "°" : "—"} color="#3BA4FF" />
        <Stat label="Longitude" value={iss ? iss.lon + "°" : "—"} color="#3BA4FF" />
        <Stat label="Altitude" value={iss ? iss.altKm + " km" : "—"} color="#5CE1E6" />
        <Stat label="Speed" value={iss ? Math.round(iss.velKmh).toLocaleString() + " km/h" : "—"} color="#5CE1E6" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2.5">
          <div className="text-[10px] font-semibold text-[#9AA6B2] mb-1.5">🚀 Upcoming launches</div>
          {launches.length === 0 && <div className="text-[9px] text-[#6B7785]">Loading…</div>}
          <div className="space-y-1">
            {launches.slice(0, 4).map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-[#E6EDF3] truncate">{l.name}</span>
                <span className="text-[8px] text-[#6B7785] font-mono shrink-0">{String(l.net || "").slice(0, 10)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2.5 flex flex-col items-center justify-center">
          <div className="text-[10px] font-semibold text-[#9AA6B2] mb-1">Kp index</div>
          <div className="text-2xl font-mono font-bold" style={{ color: kpColor }}>{kp == null ? "—" : kp}</div>
          <div className="text-[8px] text-[#6B7785]">{kp == null ? "" : kp >= 5 ? "Storm" : kp >= 4 ? "Active" : "Quiet"}</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[8px] text-[#6B7785]">{ago == null ? "" : "Updated " + ago + "s ago · auto-refreshes"}</span>
        <button onClick={() => aeolus.fire("refresh")} className="text-[10px] px-3 py-1 rounded-md bg-[#3BA4FF]/15 text-[#3BA4FF] border border-[#3BA4FF]/30 hover:bg-[#3BA4FF]/25 transition-all">↻ Refresh</button>
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string; color: string }) {
  return (
    <div className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-2 flex flex-col items-center">
      <span className="text-[11px] font-mono font-bold" style={{ color: props.color }}>{props.value}</span>
      <span className="text-[7px] text-[#6B7785]">{props.label}</span>
    </div>
  );
}`;

const automations = [
  {
    key: "space",
    name: "Space Tracker",
    cron: "* * * * *", // every minute — server-side, shared across all visitors
    scriptSource: spaceLogic,
    uiSource: spaceUi,
    demoAccess: { fireEvents: ["refresh"] }, // no writable state keys — read-only tab
  },
];

const panes = [{ kind: "automation", ref: "space", x: 0, y: 0, w: 12, h: 18 }];

const dataStore = [];

export default { tab, devices, automations, panes, dataStore };
