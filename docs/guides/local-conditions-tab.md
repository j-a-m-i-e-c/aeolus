# Build Guide: A "Local Conditions" Tab (live public APIs)

This guide walks through building a **Local Conditions** dashboard tab entirely from the
Aeolus UI — the same way any user would — using free public APIs that need **no API key**.
It's a real-world worked example of:

- the `http` sandbox global (calling external REST APIs from an automation)
- **cron-triggered** automations (polling on a schedule)
- caching results in the **Data Store** for history
- pushing live data to a **custom React UI** via the state store

> **Why this isn't in the seed demo.** The seed is meant to run anywhere with zero config and
> no keys, and its data shouldn't be tied to one location. This tab is location-specific
> (built here for **The Channon, NSW** — lat `-28.68`, lon `153.30`) so it's documented as a
> hand-built tab instead. Swap the coordinates/district for your own location.

All APIs below are **key-free** and return JSON (except the RFS fire-danger feed, which is small
XML we parse with a regex).

| Data | API | Endpoint | Auth |
|------|-----|----------|------|
| Weather + forecast + sun times | Open-Meteo | `api.open-meteo.com/v1/forecast` | none |
| Fire danger rating + total fire ban | NSW RFS | `rfs.nsw.gov.au/feeds/fdrToban.xml` | none |
| Nearby fire incidents | NSW RFS | `rfs.nsw.gov.au/feeds/majorIncidents.json` | none |
| River discharge / flood outlook | Open-Meteo Flood | `flood-api.open-meteo.com/v1/flood` | none |

**Attribution:** Open-Meteo data is CC-BY (credit "Weather data by Open-Meteo.com"); RFS feeds
are public NSW Government data.

## Prerequisites

1. Aeolus running, logged in as a user with **write** permission.
2. **Data Store enabled** (Data tab → enable) if you want history charts. The automations below
   guard on `typeof db !== "undefined"`, so they still work if it's disabled.
3. Create a custom tab: sidebar → **+** → name it `Local` (or "The Channon").

---

## Automation 1 — Weather (Open-Meteo)

On the `Local` tab click **New Automation**. Name it `Weather`, set the trigger to **Cron** with
expression `*/30 * * * *` (every 30 minutes), then paste the code below.

### Logic tab

```javascript
// Open-Meteo — free, no key. The Channon, NSW.
const LAT = -28.68, LON = 153.30;

const url =
  "https://api.open-meteo.com/v1/forecast?latitude=" + LAT + "&longitude=" + LON +
  "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
  "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max" +
  "&timezone=Australia/Sydney&forecast_days=5";

const res = await http.get(url);
if (res.status !== 200) {
  log.error("Open-Meteo fetch failed: " + res.status);
} else {
  const data = JSON.parse(res.body);
  const c = data.current;
  state.set("temp", c.temperature_2m);
  state.set("feelsLike", c.apparent_temperature);
  state.set("humidity", c.relative_humidity_2m);
  state.set("wind", c.wind_speed_10m);
  state.set("windDir", c.wind_direction_10m);
  state.set("rain", c.precipitation);
  state.set("code", c.weather_code);
  state.set("daily", data.daily);   // arrays: time, temperature_2m_max/min, precipitation_probability_max, sunrise, sunset
  state.set("updated", Date.now());

  // Optional: keep a temperature history in the Data Store
  if (typeof db !== "undefined") {
    db.write("local-weather", {
      temp: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      wind: c.wind_speed_10m,
    });
  }
  log.info("Weather updated: " + c.temperature_2m + "°C");
}
```

> Click **Fire Now** after saving to populate it immediately rather than waiting for the cron tick.

### UI tab

```tsx
import type { CustomComponentProps } from "./types";

// WMO weather_code → label + emoji
const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "Clear", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤️" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫️" },
  48: { label: "Rime fog", icon: "🌫️" },
  51: { label: "Light drizzle", icon: "🌦️" },
  61: { label: "Light rain", icon: "🌧️" },
  63: { label: "Rain", icon: "🌧️" },
  65: { label: "Heavy rain", icon: "⛈️" },
  80: { label: "Showers", icon: "🌦️" },
  95: { label: "Thunderstorm", icon: "⛈️" },
};

export default function Weather(aeolus: CustomComponentProps) {
  const temp = aeolus.read("temp") as number;
  const feels = aeolus.read("feelsLike") as number;
  const humidity = aeolus.read("humidity") as number;
  const wind = aeolus.read("wind") as number;
  const rain = aeolus.read("rain") as number;
  const code = aeolus.read("code") as number ?? 0;
  const daily = aeolus.read("daily") as any;

  const cond = WMO[code] || { label: "—", icon: "🌡️" };
  const days = daily?.time || [];

  if (temp === undefined) {
    return <div className="p-4 text-[11px] text-[#6B7785]">No data yet — click “Fire Now”.</div>;
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🌦️ The Channon</div>
        <span className="text-[10px] text-[#9AA6B2]">{cond.label}</span>
      </div>

      {/* Current */}
      <div className="bg-[#0B0F14] rounded-xl border border-[#2A3441] p-3 flex items-center gap-3">
        <div className="text-4xl">{cond.icon}</div>
        <div>
          <div className="text-3xl font-mono font-bold text-[#E6EDF3]">{temp.toFixed(1)}°</div>
          <div className="text-[9px] text-[#6B7785]">feels {feels?.toFixed(1)}° · {humidity}% RH · {wind} km/h · {rain}mm</div>
        </div>
      </div>

      {/* 5-day forecast */}
      <div className="grid grid-cols-5 gap-1.5">
        {days.map((iso: string, i: number) => {
          const d = new Date(iso);
          const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
          return (
            <div key={iso} className="bg-[#0B0F14] rounded-lg border border-[#2A3441] p-1.5 flex flex-col items-center">
              <span className="text-[8px] text-[#9AA6B2]">{i === 0 ? "Today" : dow}</span>
              <span className="text-[10px] font-mono text-[#E6EDF3]">{Math.round(daily.temperature_2m_max[i])}°</span>
              <span className="text-[9px] font-mono text-[#6B7785]">{Math.round(daily.temperature_2m_min[i])}°</span>
              <span className="text-[8px] text-[#3BA4FF]">{daily.precipitation_probability_max[i]}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Sunrise/sunset and UV come free in the same payload (`daily.sunrise[0]`, `daily.uv_index_max[0]`) —
add them to the UI if you like; no extra API needed.

---

## Automation 2 — Fire Danger Rating (NSW RFS)

The RFS publishes a small XML feed of fire danger ratings + total fire bans per district.
The Channon sits in the **Far North Coast** district (Ballina, Byron, Kyogle, Lismore, Richmond
Valley, Tweed). New Automation → name `Fire Danger`, trigger **Cron** `0 */2 * * *` (every 2 hours).

### Logic tab

```javascript
// NSW RFS Fire Danger Ratings + Total Fire Bans (XML, no key)
const DISTRICT = "Far North Coast";   // change to your RFS district

const res = await http.get("https://www.rfs.nsw.gov.au/feeds/fdrToban.xml");
if (res.status !== 200) {
  log.error("RFS fetch failed: " + res.status);
} else {
  const xml = res.body;
  const block = (xml.match(new RegExp("<District>\\s*<Name>" + DISTRICT + "</Name>[\\s\\S]*?</District>")) || [])[0];
  if (!block) {
    log.warn("District not found: " + DISTRICT);
  } else {
    const grab = (tag) => {
      const m = block.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
      return m ? m[1].trim() : null;
    };
    state.set("district", DISTRICT);
    state.set("today", grab("DangerLevelToday"));
    state.set("tomorrow", grab("DangerLevelTomorrow"));
    state.set("banToday", grab("FireBanToday"));
    state.set("banTomorrow", grab("FireBanTomorrow"));
    state.set("updated", Date.now());
    log.info("Fire danger today: " + grab("DangerLevelToday"));
  }
}
```

### UI tab

```tsx
import type { CustomComponentProps } from "./types";

// AFDRS rating → colour
const RATING: Record<string, { color: string; label: string }> = {
  NONE: { color: "#6B7785", label: "No Rating" },
  MODERATE: { color: "#22C55E", label: "Moderate" },
  HIGH: { color: "#F59E0B", label: "High" },
  EXTREME: { color: "#EF4444", label: "Extreme" },
  CATASTROPHIC: { color: "#7F1D1D", label: "Catastrophic" },
};

export default function FireDanger(aeolus: CustomComponentProps) {
  const today = (aeolus.read("today") as string) || "NONE";
  const tomorrow = (aeolus.read("tomorrow") as string) || "NONE";
  const banToday = (aeolus.read("banToday") as string) === "Yes";
  const district = (aeolus.read("district") as string) || "Far North Coast";

  const r = RATING[today] || RATING.NONE;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🔥 Fire Danger</div>
        <span className="text-[9px] text-[#6B7785]">{district}</span>
      </div>

      {/* Today's rating */}
      <div className="rounded-xl border p-4 text-center" style={{ background: r.color + "20", borderColor: r.color }}>
        <div className="text-[10px] uppercase tracking-wider" style={{ color: r.color }}>Today</div>
        <div className="text-2xl font-bold" style={{ color: r.color }}>{r.label}</div>
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#9AA6B2]">Tomorrow</span>
        <span className="font-semibold" style={{ color: (RATING[tomorrow] || RATING.NONE).color }}>
          {(RATING[tomorrow] || RATING.NONE).label}
        </span>
      </div>

      {banToday && (
        <div className="rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] text-[11px] font-semibold text-center py-2">
          🚫 Total Fire Ban in force
        </div>
      )}
    </div>
  );
}
```

---

## Automation 3 — Nearby Fire Incidents (NSW RFS)

The `majorIncidents.json` feed is GeoJSON of current incidents statewide. We distance-filter to
within 100 km of The Channon. New Automation → name `Nearby Fires`, trigger **Cron** `*/15 * * * *`.

### Logic tab

```javascript
const LAT = -28.68, LON = 153.30, RADIUS_KM = 100;

const res = await http.get("https://www.rfs.nsw.gov.au/feeds/majorIncidents.json");
if (res.status !== 200) {
  log.error("RFS incidents fetch failed: " + res.status);
} else {
  const data = JSON.parse(res.body);

  const dist = (la, lo) => {
    const R = 6371, dLa = (la - LAT) * Math.PI / 180, dLo = (lo - LON) * Math.PI / 180;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(LAT * Math.PI / 180) * Math.cos(la * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  const pointOf = (f) => {
    const g = f.geometry;
    if (g.type === "Point") return g.coordinates;
    if (g.type === "GeometryCollection") {
      const p = g.geometries.find((x) => x.type === "Point");
      return p ? p.coordinates : null;
    }
    return null;
  };

  const near = [];
  for (const f of data.features) {
    const co = pointOf(f);
    if (!co) continue;
    const km = dist(co[1], co[0]);
    if (km <= RADIUS_KM) near.push({ title: f.properties.title, level: f.properties.category, km: Math.round(km) });
  }
  near.sort((a, b) => a.km - b.km);

  state.set("incidents", near.slice(0, 6));
  state.set("count", near.length);
  state.set("updated", Date.now());
  log.info(near.length + " incidents within " + RADIUS_KM + "km");
}
```

### UI tab

```tsx
import type { CustomComponentProps } from "./types";

const LEVEL: Record<string, string> = {
  "Emergency Warning": "#EF4444",
  "Watch and Act": "#F59E0B",
  "Advice": "#3BA4FF",
};

export default function NearbyFires(aeolus: CustomComponentProps) {
  const incidents = (aeolus.read("incidents") as any[]) || [];
  const count = aeolus.read("count") as number ?? 0;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-[#E6EDF3]">🚒 Nearby Incidents</div>
        <span className="text-[9px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: count > 0 ? "#F59E0B20" : "#22C55E20", color: count > 0 ? "#F59E0B" : "#22C55E" }}>
          {count} within 100km
        </span>
      </div>

      {incidents.length === 0 ? (
        <div className="text-[11px] text-[#6B7785] text-center py-4">No active incidents nearby 🎉</div>
      ) : (
        <div className="space-y-1.5">
          {incidents.map((it, i) => (
            <div key={i} className="flex items-center gap-2 bg-[#0B0F14] rounded-lg border border-[#2A3441] px-3 py-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: LEVEL[it.level] || "#6B7785" }} />
              <span className="text-[10px] text-[#E6EDF3] flex-1 truncate">{it.title}</span>
              <span className="text-[9px] font-mono text-[#6B7785]">{it.km}km</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Extension — Flood / river outlook (Open-Meteo Flood)

For flood-prone catchments (the Northern Rivers very much included), Open-Meteo's Flood API gives a
river-discharge forecast with no key:

```
https://flood-api.open-meteo.com/v1/flood?latitude=-28.68&longitude=153.30&daily=river_discharge&forecast_days=7
```

The response has `daily.time[]` and `daily.river_discharge[]` (m³/s). Build a cron automation the
same way as Weather, `state.set("discharge", data.daily.river_discharge)`, and render a small bar
chart — rising discharge is an early flood signal.

---

## Cron reference & polling etiquette

| Automation | Suggested cron | Why |
|---|---|---|
| Weather | `*/30 * * * *` | Conditions change slowly; every 30 min is plenty |
| Fire Danger | `0 */2 * * *` | RFS updates a few times a day |
| Nearby Fires | `*/15 * * * *` | More frequent during fire season; back off otherwise |
| Flood | `0 */6 * * *` | Discharge forecasts update infrequently |

Be a good API citizen — these are free public services. Poll conservatively, and lean on the
**Data Store** to keep history rather than hammering the endpoint.

## Notes & troubleshooting

- **HTTPS only for external URLs.** The `http` global allows HTTP for LAN, but warns on plain HTTP
  to the internet — all endpoints here are HTTPS.
- **10-second timeout.** Each `http.get`/`http.post` call times out at 10s; the scripts above
  handle a non-200 status gracefully and just skip the update.
- **`db` may be undefined.** If the Data Store isn't enabled, `db` is `undefined` — the weather
  script guards with `typeof db !== "undefined"`, so it still runs.
- **No data on first load?** Hit **Fire Now** on the pane to trigger an immediate fetch instead of
  waiting for the next cron tick.
- **Different location?** Change `LAT`/`LON` (find yours on any map) and the RFS `DISTRICT` name
  (see the council list in `fdrToban.xml`).

## Suggested layout

Drop a **Device Grid** up top if you have local MQTT sensors, then the three automation panes:
Weather (wide), Fire Danger and Nearby Incidents side by side. All three render live the moment
their cron fires — or when you hit Fire Now.
