// scripts/seed/tabs/space.mjs — Live Space mission view (REAL public data).
//
// Unlike the simulated domain tabs, this seeded Logic calls fixed public APIs
// server-side and shares one result with every visitor:
//   • ISS position — api.wheretheiss.at
//   • upcoming launches — ll.thespacedevs.com
//   • planetary K-index — NOAA SWPC
// Visitors can only request a bounded refresh; they never control a URL.

const tab = { id: "tab-space", name: "Live Space", icon: "rocket" };
const devices = [];

const spaceLogic = `automation({
  actions: [
    async function spaceTracker(context) {
      var now = Date.now();

      try {
        var res = await http.get("https://api.wheretheiss.at/v1/satellites/25544");
        var iss = JSON.parse(res.body);
        state.set("iss", {
          lat: Math.round(iss.latitude * 100) / 100,
          lon: Math.round(iss.longitude * 100) / 100,
          altKm: Math.round(iss.altitude),
          velKmh: Math.round(iss.velocity),
          visibility: iss.visibility || "",
        });
        state.set("issUpdated", now);
        try { if (db) db.write("iss-track", { lat: iss.latitude, lon: iss.longitude, alt: iss.altitude }); } catch (e) {}
      } catch (e) { log.warn("ISS fetch failed: " + e.message); }

      var launchesAt = Number(state.get("launchesUpdated")) || 0;
      if (now - launchesAt > 1800000) {
        try {
          var lr = await http.get("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5&mode=list");
          var data = JSON.parse(lr.body);
          var list = (data.results || []).map(function (x) {
            return {
              name: x.name,
              net: x.net,
              provider: (x.launch_service_provider || {}).name || "",
              pad: ((x.pad || {}).name || ""),
            };
          });
          state.set("launches", list);
          state.set("launchesUpdated", now);
          log.info("Fetched " + list.length + " upcoming launches");
        } catch (e) { log.warn("Launches fetch failed: " + e.message); }
      }

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

const spaceUi = `import { useEffect, useState } from "react";
import type { CustomComponentProps } from "./types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
function wrapLon(lon: number) {
  var x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}
function countdown(net: string, now: number) {
  const ts = Date.parse(net || "");
  if (!Number.isFinite(ts)) return "T− --:--:--";
  let seconds = Math.round((ts - now) / 1000);
  const past = seconds < 0;
  seconds = Math.abs(seconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return (past ? "T+ " : "T− ") + days + "d " + pad(hours) + ":" + pad(mins);
  return (past ? "T+ " : "T− ") + pad(hours) + ":" + pad(mins) + ":" + pad(secs);
}

export default function LiveSpace(aeolus: CustomComponentProps) {
  const iss = (aeolus.read("iss") as any) ?? null;
  const launches = (aeolus.read("launches") as any[]) ?? [];
  const kp = Number(aeolus.read("kp") ?? 0);
  const updated = Number(aeolus.read("issUpdated") ?? 0);
  const [now, setNow] = useState(Date.now());
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); setPulse((v) => (v + 1) % 100000); }, 1000);
    return () => clearInterval(id);
  }, []);

  const mapX = (lon: number) => ((wrapLon(lon) + 180) / 360) * 480;
  const mapY = (lat: number) => ((90 - clamp(lat, -90, 90)) / 180) * 240;
  const x = iss ? mapX(Number(iss.lon)) : -20;
  const y = iss ? mapY(Number(iss.lat)) : -20;
  const age = updated ? Math.max(0, Math.round((now - updated) / 1000)) : null;
  const kpColor = kp >= 5 ? "#FF6F68" : kp >= 4 ? "#F4B854" : "#6DE19D";
  const kpLabel = kp >= 7 ? "Severe storm" : kp >= 5 ? "Geomagnetic storm" : kp >= 4 ? "Active" : kp > 0 ? "Quiet" : "Acquiring";

  const trackSegments: string[] = [];
  if (iss) {
    const inclination = 51.64;
    const phase0 = Math.asin(clamp(Number(iss.lat) / inclination, -1, 1));
    let current: string[] = [];
    let previousX: number | null = null;
    for (let i = -20; i <= 20; i++) {
      const lon = wrapLon(Number(iss.lon) + i * 9.3);
      const lat = inclination * Math.sin(phase0 + i * 0.165);
      const px = mapX(lon);
      const py = mapY(lat);
      if (previousX !== null && Math.abs(px - previousX) > 260) {
        if (current.length > 1) trackSegments.push(current.join(" "));
        current = [];
      }
      current.push(px.toFixed(1) + "," + py.toFixed(1));
      previousX = px;
    }
    if (current.length > 1) trackSegments.push(current.join(" "));
  }

  return (
    <div style={{ minHeight: "100%", padding: 14, color: "#E8EEF5", background: "linear-gradient(180deg,#060913 0%,#04060B 100%)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 850, letterSpacing: "0.025em" }}>LIVE SPACE</span>
            <span style={{ fontSize: 8, border: "1px solid #245846", background: "#0A2118", borderRadius: 999, padding: "2px 7px", color: "#6FE4A5", letterSpacing: "0.1em" }}>● REAL PUBLIC DATA</span>
          </div>
          <div style={{ color: "#647185", fontSize: 9, marginTop: 3 }}>ISS position · launch schedule · NOAA space weather · fetched by trusted Aeolus Logic</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: age != null && age < 120 ? "#71DEA2" : "#F0B85B", fontSize: 10, fontWeight: 850 }}>{age == null ? "ACQUIRING ORBIT" : "ISS TELEMETRY LIVE"}</div>
          <div style={{ color: "#657282", fontSize: 8, marginTop: 2 }}>{age == null ? "Waiting for first server fetch" : "updated " + age + "s ago"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(220px, .75fr)", gap: 10 }}>
        <div style={{ border: "1px solid #263242", borderRadius: 14, overflow: "hidden", background: "#050812" }}>
          <svg width="100%" height="360" viewBox="0 0 480 300" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="ocean" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#07182B"/><stop offset="1" stopColor="#06101D"/></linearGradient>
              <radialGradient id="issGlow"><stop offset="0" stopColor="#75CBFF" stopOpacity=".9"/><stop offset="1" stopColor="#3BA4FF" stopOpacity="0"/></radialGradient>
              <filter id="orbitGlow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>
            <rect width="480" height="300" fill="#04070D" />
            <rect x="0" y="18" width="480" height="240" rx="12" fill="url(#ocean)" stroke="#263747" />

            {/* latitude / longitude grid */}
            {[60,120,180,240,300,360,420].map((gx) => <line key={gx} x1={gx} y1="18" x2={gx} y2="258" stroke="#183047" strokeOpacity=".6" strokeWidth=".6" />)}
            {[58,98,138,178,218].map((gy) => <line key={gy} x1="0" y1={gy} x2="480" y2={gy} stroke="#183047" strokeOpacity=".6" strokeWidth=".6" />)}
            <line x1="0" y1="138" x2="480" y2="138" stroke="#2B506C" strokeOpacity=".7" strokeWidth=".8" strokeDasharray="4 4" />

            {/* deliberately simplified land silhouettes: map context, not a map dependency */}
            <g fill="#163B3B" stroke="#2A6660" strokeWidth=".7">
              <path d="M25 77 L48 52 L89 48 L121 64 L136 85 L124 102 L105 111 L98 132 L79 126 L66 106 L44 98 L30 87 Z" />
              <path d="M104 139 L129 143 L147 162 L145 190 L130 224 L115 205 L105 177 L96 154 Z" />
              <path d="M199 49 L218 38 L236 49 L231 65 L210 68 Z" />
              <path d="M218 76 L252 76 L272 97 L267 130 L248 165 L226 145 L214 112 Z" />
              <path d="M246 50 L281 35 L333 44 L382 56 L432 75 L444 91 L424 105 L382 99 L355 116 L321 98 L286 87 L258 75 Z" />
              <path d="M372 156 L408 151 L438 169 L431 195 L397 202 L372 183 Z" />
              <path d="M81 31 L102 19 L126 24 L120 43 L91 45 Z" />
            </g>

            {/* Night-side hint, intentionally subtle rather than pretending to be a precision terminator. */}
            <rect x={(now / 240000 % 1) * 480 - 180} y="18" width="180" height="240" fill="#02040A" opacity=".20" />

            {/* Approximate orbital ground track anchored to the real current ISS point. */}
            {trackSegments.map((points, i) => <polyline key={i} points={points} fill="none" stroke="#54B9F5" strokeOpacity=".54" strokeWidth="1.25" strokeDasharray="3 4" filter="url(#orbitGlow)" />)}

            {kp >= 4 && <g opacity={Math.min(.5, .18 + kp * .04)}>
              <path d="M0 46 Q120 70 240 48 T480 46" fill="none" stroke="#55E6A0" strokeWidth={kp >= 5 ? 9 : 5} strokeOpacity=".22" />
              <path d="M0 228 Q120 205 240 228 T480 228" fill="none" stroke="#55E6A0" strokeWidth={kp >= 5 ? 9 : 5} strokeOpacity=".18" />
            </g>}

            {iss ? <g>
              <circle cx={x} cy={y + 18} r={17 + Math.sin(pulse * .25) * 3} fill="url(#issGlow)" opacity=".45" />
              <circle cx={x} cy={y + 18} r="4.4" fill="#86D5FF" stroke="#EAF7FF" strokeWidth="1.2" />
              <path d={"M" + (x - 11) + " " + (y + 18) + " H" + (x + 11)} stroke="#9EDFFF" strokeWidth="1" />
              <rect x={x - 7} y={y + 15} width="14" height="6" rx="1.5" fill="#DDECF7" />
              <text x={x + 10} y={y + 9} fill="#DDF3FF" fontSize="7" fontWeight="700">ISS</text>
            </g> : <text x="240" y="141" textAnchor="middle" fill="#6D7D8D" fontSize="9">Acquiring ISS position…</text>}

            {/* Telemetry strip integrated into the map. */}
            <g transform="translate(14 268)">
              <text x="0" y="11" fill="#607287" fontSize="6.5" letterSpacing="1">ISS</text>
              <text x="28" y="11" fill="#7FCFFF" fontFamily="monospace" fontSize="9">{iss ? Number(iss.lat).toFixed(2) + "°" : "—"}</text>
              <text x="103" y="11" fill="#7FCFFF" fontFamily="monospace" fontSize="9">{iss ? Number(iss.lon).toFixed(2) + "°" : "—"}</text>
              <text x="184" y="11" fill="#A9DDEF" fontFamily="monospace" fontSize="9">{iss ? iss.altKm + " km" : "—"}</text>
              <text x="256" y="11" fill="#A9DDEF" fontFamily="monospace" fontSize="9">{iss ? Math.round(Number(iss.velKmh)).toLocaleString() + " km/h" : "—"}</text>
            </g>
          </svg>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ border: "1px solid #263242", borderRadius: 12, background: "#070B12", padding: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "#93A2B2", fontSize: 8, letterSpacing: "0.12em" }}>SPACE WEATHER</span>
              <span style={{ color: kpColor, fontSize: 8, fontWeight: 800 }}>{kpLabel.toUpperCase()}</span>
            </div>
            <div style={{ display: "flex", alignItems: "end", gap: 10 }}>
              <div style={{ fontFamily: "monospace", fontSize: 31, fontWeight: 850, lineHeight: 1, color: kpColor }}>{kp > 0 ? kp.toFixed(1) : "—"}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 2, height: 12, alignItems: "end" }}>
                  {Array.from({ length: 9 }).map((_, i) => <div key={i} style={{ flex: 1, height: 4 + i * .8, borderRadius: 2, background: i + 1 <= Math.round(kp) ? kpColor : "#18212B", opacity: i + 1 <= Math.round(kp) ? .85 : 1 }} />)}
                </div>
                <div style={{ color: "#5F6D7C", fontSize: 7, marginTop: 4 }}>NOAA planetary K-index</div>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, border: "1px solid #263242", borderRadius: 12, background: "#070B12", padding: 11, minHeight: 240 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
              <span style={{ color: "#93A2B2", fontSize: 8, letterSpacing: "0.12em" }}>NEXT LAUNCHES</span>
              <span style={{ color: "#5E6C7B", fontSize: 7 }}>LIVE SCHEDULE</span>
            </div>
            {launches.length === 0 && <div style={{ color: "#627181", fontSize: 9, paddingTop: 24, textAlign: "center" }}>Waiting for launch feed…</div>}
            {launches.slice(0, 4).map((l, i) => {
              const cd = countdown(String(l.net || ""), now);
              return <div key={i} style={{ padding: i === 0 ? "9px 9px 10px" : "9px 2px", border: i === 0 ? "1px solid #334B61" : "0", borderTop: i > 1 ? "1px solid #18222D" : undefined, borderRadius: i === 0 ? 9 : 0, background: i === 0 ? "#0A1420" : "transparent", marginBottom: i === 0 ? 6 : 0 }}>
                <div style={{ color: i === 0 ? "#E9F3FA" : "#BAC6D0", fontSize: i === 0 ? 10 : 9, fontWeight: i === 0 ? 780 : 650, lineHeight: 1.25 }}>{String(l.name || "Unnamed mission")}</div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                  <span style={{ color: "#687889", fontSize: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{String(l.provider || "")}</span>
                  <span style={{ color: i === 0 ? "#75C9F8" : "#8494A3", fontFamily: "monospace", fontSize: i === 0 ? 9 : 8, fontWeight: 750 }}>{cd}</span>
                </div>
              </div>;
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 9 }}>
        <span style={{ color: "#5D6B79", fontSize: 8 }}>Map is stylised; position, altitude, speed, launches and Kp are fetched live server-side.</span>
        <button onClick={() => aeolus.fire("refresh")} style={{ border: "1px solid #315778", borderRadius: 8, padding: "7px 12px", background: "#0B1825", color: "#79C8FA", cursor: "pointer", fontSize: 9, fontWeight: 800 }}>↻ REFRESH LIVE DATA</button>
      </div>
    </div>
  );
}`;

const automations = [
  {
    key: "space",
    name: "Live Space",
    cron: "* * * * *",
    scriptSource: spaceLogic,
    uiSource: spaceUi,
    demoAccess: { fireEvents: ["refresh"] },
  },
];

const panes = [{ kind: "automation", ref: "space", x: 0, y: 0, w: 12, h: 18 }];

const dataStore = [
  {
    name: "iss-track",
    description: "Recent ISS positions captured from the live public feed",
    retentionDays: 7,
    // Seeded history so the collection is populated on first load; the seeded
    // cron/refresh Logic appends live ISS fixes (same shape) from the public feed.
    records: [
      { payload: { lat: -12.4, lon: 130.8, alt: 419 }, timestamp: Date.now() - 1_800_000 },
      { payload: { lat: 8.7, lon: 145.2, alt: 421 }, timestamp: Date.now() - 1_200_000 },
      { payload: { lat: 27.3, lon: 162.5, alt: 417 }, timestamp: Date.now() - 600_000 },
      { payload: { lat: 41.9, lon: -179.1, alt: 420 }, timestamp: Date.now() - 120_000 },
    ],
  },
];

export default { tab, devices, automations, panes, dataStore };
