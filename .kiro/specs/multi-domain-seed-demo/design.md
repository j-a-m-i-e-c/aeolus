# Design: Multi-Domain Seed Demo

## Overview

The seed demo replaces the current `scripts/seed-demo.mjs` with a richer multi-domain demonstration. Each tab is a self-contained showcase of Aeolus deployed in a different environment, proving that the platform's core abstractions (event bus, sandboxed execution, connectors, local state, custom UI) are domain-agnostic.

The seed runs as a single script that authenticates against the API and creates everything via REST calls — same mechanism as the current seed.

> **Intentionally not seeded: a "Local Conditions" tab.** Live, location-specific data (local
> weather, fire danger, flood) is deliberately kept *out* of the seed so the demo runs anywhere
> with zero config and no API keys. That tab is instead a hand-built worked example — see
> [`docs/guides/local-conditions-tab.md`](../../../docs/guides/local-conditions-tab.md) — which
> doubles as real-user dogfooding of the `http` global, cron triggers, and Data Store caching.

---

## Tab Designs

### Tab 1: Smart Home

**Premise:** A typical developer's house with smart lighting, climate sensors, and energy monitoring.

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| Living Room Light | light | `{ on: true, brightness: 80 }` |
| Bedroom Light | light | `{ on: false, brightness: 0 }` |
| Kitchen Temp | sensor | `{ value: 22.3, unit: "°C" }` |
| Hallway Motion | sensor | `{ motion: true, lastTriggered: <timestamp> }` |
| Smart Plug (Kettle) | plug | `{ on: false, power: 0, unit: "W" }` |
| Thermostat | climate | `{ target: 21, current: 20.8, mode: "heat" }` |

**Automations:** (option b — home-only; aquarium/brewery carry-overs intentionally dropped)
1. **Evening Mode** — motion + time-of-day drives lighting scenes and thermostat. UI shows day/evening/night selector, lights status, kitchen temp, and motion. *(New.)*
2. **Energy Monitor** — solar production vs consumption, battery, grid import/export. UI shows an animated power-flow diagram + self-sufficiency. *(Carried over from the original seed's Solar Dashboard.)*
3. **Weather Station** — outdoor conditions with wind compass, UV, pressure, rain. *(Carried over.)*
4. **Indoor Climate** — per-room temperatures on an SVG floor plan, colour-coded comfort zones. *(Carried over.)*

**Data Store:** `energy-readings` collection with 48h of 30-min interval solar/consumption/battery data.

---

### Tab 2: Research Vessel

**Premise:** An oceanographic research ship — built around the instruments real vessels like RV Investigator or Schmidt Ocean's Falkor actually run.

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| CTD Sonde | sensor | `{ conductivity: 4.2, temperature: 12.1, depth: 50, salinity: 35.1, oxygen: 5.8 }` |
| CTD Winch | switch | `{ on: true, payOut: 50, rate: 0.5, tension: 220 }` |
| GPS / GNSS | sensor | `{ lat: -42.881, lon: 147.327, heading: 142, sog: 0.2 }` |
| Bow Thruster | switch | `{ on: true, thrust: 18, azimuth: 270 }` |
| Stern Thruster | switch | `{ on: true, thrust: 12, azimuth: 90 }` |
| Thermosalinograph | sensor | `{ sst: 18.4, salinity: 35.2, flow: 2.1 }` |
| Fluorometer | sensor | `{ chlorophyll: 1.8, unit: "µg/L" }` |
| ROV (SuBastian) | sensor | `{ depth: 340, ambientPressure: 35.1, heading: 88, battery: 76 }` |

**Automations:**
1. **CTD Profiler** ⭐ — builds a depth cast as the sonde descends; flags thermocline and records the profile. UI shows the classic vertical oceanographic profile plot (temperature & salinity vs depth). *Connects via: Sea-Bird CTD serial stream → MQTT bridge.*
2. **Dynamic Positioning** — holds station against drift by computing thruster vectors from GNSS offset. UI shows a top-down vessel with bow/stern thruster arrows and a drift circle vs the target fix. *Connects via: Kongsberg DP / NMEA 0183/2000 → connector.*
3. **Underway Seawater** — continuous flow-through monitoring while steaming; accumulates time-series. UI shows live strip charts for SST, salinity, and chlorophyll. *Connects via: thermosalinograph + fluorometer serial → MQTT.*
4. **ROV Dive Telemetry** — tracks a launched ROV's depth, ambient pressure, heading, and battery; alarms on rapid ascent or low battery. UI shows a depth ladder with attitude readout. *Connects via: BlueROV/MAVLink → MQTT.*

**Data Store:** `ctd-casts` (per-dive depth profiles) and `underway-seawater` (continuous SST/salinity/chlorophyll time-series).

---

### Tab 3: Agriculture

**Premise:** A remote farming property with irrigation, soil monitoring, and weather station.

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| Soil Moisture (Zone A) | sensor | `{ value: 42, unit: "%" }` |
| Soil Moisture (Zone B) | sensor | `{ value: 28, unit: "%" }` |
| Weather Station | sensor | `{ temp: 31.2, humidity: 45, windSpeed: 12, rain: false }` |
| Water Tank Level | sensor | `{ value: 73, unit: "%", litres: 7300 }` |
| Irrigation Valve (Zone A) | switch | `{ on: false }` |
| Irrigation Valve (Zone B) | switch | `{ on: true, startedAt: <timestamp> }` |
| Solar Inverter | sensor | `{ power: 4200, unit: "W", dailyYield: 28.5 }` |

### Tab 3: Agriculture ⭐ (priority — agritech showcase)

**Premise:** A connected broadacre/mixed farm — water management, virtual livestock fencing, crop health, and frost protection. This is the flagship domain tab (target industry: agtech), so it gets the richest treatment.

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| Dam Level | sensor | `{ value: 82, unit: "%" }` |
| Header Tank Level | sensor | `{ value: 65, unit: "%" }` |
| Dam Pump | switch | `{ on: true }` |
| Soil Moisture (×4 beds/paddocks) | sensor | `{ value: 38, unit: "%" }` |
| Irrigation Valves (×4) | switch | `{ on: true }` |
| Fence Energiser | sensor | `{ voltage: 7.2, unit: "kV", current: 0.4, fault: false }` |
| Fence Zones (×4) | sensor | `{ intact: true, voltage: 7.1, breach: false }` |
| Livestock Collars | sensor | `{ herd: 120, inZone: 118, strays: 2, avgBattery: 74 }` |
| Crop Field (×3) | sensor | `{ ndvi: 0.72, growthStage: "flowering", canopyTemp: 24.1 }` |
| Weather Station | sensor | `{ temp: 31.2, humidity: 45, windSpeed: 12, rain: false, dewPoint: 8.2 }` |
| Frost Sensors (×3) | sensor | `{ temp: 2.4, leafWetness: 60 }` |

**Automations:**
1. **Irrigation & Water Management** ⭐ — soil-moisture-driven valves per crop; dam pump fills header tank when low; skips on rain. UI shows the SVG flow diagram (Dam → Header Tank → Beds) with animated water flow, per-zone moisture bars, tank gauges, and a "water all" override. *(Carry over + extend the existing hero.) Connects via: soil probes + valve relays + tank level sensors → MQTT.*
2. **Smart Fencing** — monitors electric-fence energiser voltage/current and per-zone line integrity; detects breaches and earth faults; tracks virtual-fence collar containment (in-zone vs strays). UI shows a paddock map with fence-line status (intact/breach), energiser voltage gauge, and a livestock containment count. *Connects via: fence energiser Modbus + GPS collars (Halter/Gallagher-style) → MQTT/LoRa.*
3. **Crop Health** — per-field NDVI, growth stage, and canopy temperature; flags water/heat stress. UI shows field cards with an NDVI colour scale, growth-stage timeline, and stress badges. *Connects via: in-field sensors / drone-NDVI ingest → MQTT.*
4. **Frost Guard** — watches dew point, air temp, and leaf wetness; predicts frost risk overnight and can trigger frost fans/sprinklers. UI shows a frost-risk dial, temp-vs-dewpoint trend, and protection status. *Connects via: frost sensors + weather station → MQTT.*

**Data Store:** `soil-moisture` (72h per zone), `fence-events` (breach/fault log), `frost-log` (overnight minimums).

---

### Tab 4: Underground Mining

**Premise:** A modern underground hard-rock/coal mine — gas safety, ventilation, personnel tracking, and dewatering, using real industry systems (Howden, ABB, Newtrax).

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| Gas Detector (Level 3) | sensor | `{ ch4: 0.3, co: 12, o2: 20.8, no2: 1.2 }` |
| Gas Detector (Drift 7) | sensor | `{ ch4: 0.9, co: 28, o2: 20.6, no2: 2.1 }` |
| Primary Fan | switch | `{ on: true, rpm: 1450, airflow: 280, mode: "auto" }` |
| Booster Fan (Level 3) | switch | `{ on: true, rpm: 980, airflow: 110 }` |
| Personnel Tags | sensor | `{ underground: 14, byLevel: { "L1": 3, "L2": 6, "L3": 5 } }` |
| Refuge Chamber | sensor | `{ occupancy: 0, capacity: 20, sealed: false, o2: 20.9 }` |
| Sump Pump (Deep) | switch | `{ on: true, level: 1.8, flow: 45 }` |
| Sump Pump (Surface) | switch | `{ on: false, level: 0.6, flow: 0 }` |

**Automations:**
1. **Atmospheric Monitoring** — watches CH₄, CO, O₂, NO₂ against statutory limits; triggers alarms and ventilation boost. UI shows multi-gas danger-zone bars with colour-coded thresholds. *Connects via: fixed + personal gas detectors → MQTT.*
2. **Ventilation on Demand** ⭐ — ramps primary and booster fans based on gas levels and where crews are working. UI shows a mine network graph with animated airflow direction and fan RPM. *Connects via: fan VFD Modbus + airflow sensors → MQTT.*
3. **Personnel Muster** — tracks tags by level; on evacuation, shows who's accounted for and refuge-chamber status. UI shows a roster by level with headcount and a "trigger muster" button. *Connects via: RFID/UWB tag readers (Newtrax/MST) → connector.*
4. **Dewatering Cascade** — sump levels trigger a pump cascade lifting water deep-to-surface in stages. UI shows a shaft cross-section with water levels and pump-stage status. *Connects via: level sensors + pump contactors → MQTT.*

**Data Store:** `gas-readings` (48h multi-gas history) and `dewatering-log` (pump run cycles + volume).

---

### Tab 5: Spacecraft

**Premise:** Satellite / crewed-station operations — framed around real subsystems (EPS, ADCS, ECLSS, TT&C). A dev could genuinely wire this to [SatNOGS](https://satnogs.org) or an SDR today.

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| O2 Generator | climate | `{ o2Level: 20.9, target: 21.0, status: "nominal" }` |
| CO2 Scrubber | switch | `{ on: true, efficiency: 94 }` |
| Solar Array | sensor | `{ power: 12400, sunAngle: 42, inEclipse: false }` |
| Battery Bank | sensor | `{ charge: 87, voltage: 48.2, current: -1.2 }` |
| Reaction Wheels | sensor | `{ x: 2400, y: -1800, z: 600, saturation: 38 }` |
| Sun Sensor | sensor | `{ pointingError: 0.4, locked: true }` |
| Ground Link | sensor | `{ station: "GS-Svalbard", aos: <timestamp>, los: <timestamp>, signal: -82 }` |
| Telemetry Buffer | sensor | `{ queued: 142, downlinked: 0, mode: "store" }` |

**Automations:**
1. **Life Support (ECLSS)** *(existing)* — maintains O2 between 20.5–21.5% by adjusting generator output. UI shows atmospheric composition bars (O2, CO2, N2) with a manual EVA-prep override. *Connects via: crewed-station telemetry → MQTT.*
2. **Power System (EPS)** — manages solar input vs load; sheds non-critical loads when battery is low or in eclipse. UI shows a solar→battery→loads flow diagram with battery SoC and an eclipse timeline. *Connects via: EPS telemetry / I²C power monitors → MQTT.*
3. **Attitude Control (ADCS)** — maintains sun-pointing; flags reaction-wheel saturation and schedules desaturation. UI shows an orientation indicator with reaction-wheel RPM dials and pointing error. *Connects via: flight-computer telemetry → connector.*
4. **Ground Station Comms (TT&C)** ⭐ — tracks the next ground-station window, queues telemetry for downlink during the pass. UI shows a pass timeline with AOS/LOS windows, link budget, and downlink queue depth. *Connects via: SatNOGS / SDR → connector.*

**Data Store:** `telemetry-downlink` (frames sent per pass) and `power-history` (solar/battery over orbits).

---

### Tab 6: Escape Room

**Premise:** A commercial escape room business. Escape-room control software is a real product category, and makers already build rigs on Raspberry Pi + relays + MQTT — a dev could run Aeolus here today.

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| Puzzle 1 (Cipher Lock) | sensor | `{ solved: true, solvedAt: <timestamp>, attempts: 3 }` |
| Puzzle 2 (Laser Grid) | sensor | `{ solved: false, beamsBroken: 2 }` |
| Puzzle 3 (Weight Scale) | sensor | `{ solved: false, weight: 2.4, target: 3.1 }` |
| Mag Lock (Door 1) | switch | `{ locked: true }` |
| Mag Lock (Final Exit) | switch | `{ locked: true }` |
| DMX Lighting | light | `{ scene: "puzzle-2", brightness: 40, colour: "#4B0082" }` |
| Hint Screen | switch | `{ on: true, message: "", hintsSent: 1 }` |
| Smoke Machine | switch | `{ on: false }` |

**Automations:**
1. **Puzzle Sequencer** *(existing)* — unlocks the next stage when a puzzle is solved (maglock opens, lights change, audio cue). UI shows a progress tracker with puzzle states (locked/active/solved). *Connects via: reed switches / RFID / relays on a Pi → MQTT.*
2. **Game Master Console** ⭐ — master timer the GM controls: add/subtract time, pause, trigger props, reset room. UI shows a big countdown with transport controls and live prop status. *Connects via: GM dashboard → REST/WebSocket (native).*
3. **Hint System** — delivers hints to an in-room screen/audio and tracks hints used against a budget. UI shows a hint composer, sent-hint log, and remaining hint count. *Connects via: in-room display (Pi/MQTT) + audio relay.*
4. **Effects & Lighting** — drives DMX lighting scenes, smoke, and audio synced to game phase (red wash under 5 min). UI shows a scene selector grid with live colour swatches. *Connects via: DMX/Art-Net gateway → connector.*

**Data Store:** `game-sessions` (team name, completion time, puzzles solved, hints used).

---

### Tab 7: Off-Grid Bunker (Zombie Apocalypse)

**Premise:** A fortified off-grid survival bunker. The zombie framing is flavour — every system is a legit off-grid/remote-cabin concern (generator telemetry, NBC filtration, Meshtastic LoRa mesh are all genuinely connectable). Serious engineering, fun premise.

**Devices:**
| Name | Type | State Example |
|------|------|---------------|
| Perimeter Sensor (North) | sensor | `{ motion: false, lastTriggered: <timestamp> }` |
| Perimeter Sensor (East) | sensor | `{ motion: true, lastTriggered: <timestamp> }` |
| Flood Lights | light | `{ on: true, brightness: 100, mode: "motion-activated" }` |
| Diesel Generator | switch | `{ on: true, fuel: 62, runtime: "14h 22m", co: 8 }` |
| Solar + Battery | sensor | `{ solar: 1800, battery: 74, load: 1200 }` |
| NBC Air Filter | switch | `{ on: true, overpressure: 12, filterLife: 78, sealed: false }` |
| Supply Store | sensor | `{ food: 64, water: 80, meds: 45, ammo: 90 }` |
| Radio / Mesh | sensor | `{ frequency: 146.52, contacts: 3, lastBroadcast: <timestamp> }` |

**Automations:**
1. **Perimeter Defence** *(existing)* — monitors perimeter sensors, triggers flood lights and logs breach events. UI shows a bunker map (SVG) with sector status indicators (green/red) and a breach log. *Connects via: PIR/door sensors + relays → MQTT.*
2. **Off-Grid Power** ⭐ — manages generator + solar + battery, estimates fuel runtime, sheds load to stretch days-of-power. UI shows a fuel gauge, generator status, and a days-of-power countdown. *Connects via: Victron / generator Modbus → MQTT.*
3. **Air Filtration (NBC)** — maintains positive overpressure and monitors filter life + generator CO; seals the bunker on contamination. UI shows an airflow schematic with filter-life rings and a seal toggle. *Connects via: pressure/air-quality sensors → MQTT.*
4. **Supply Inventory** — tracks food/water/meds/ammo and projects depletion dates from burn rate. UI shows resource bars with burn-rate and countdown-to-empty. *Connects via: load-cell shelves / manual logging → MQTT.*

**Data Store:** `perimeter-events` (72h motion log) and `supply-history` (consumption over time).

---

## Tab 8: Space (live public APIs)

**Premise:** Unlike the other tabs (simulated MQTT devices), the Space tab pulls **live data from
free, key-free public APIs** — a showcase of the `http` global + cron triggers + graceful empty
states. It has no MQTT devices and no Data Store collections; the APIs are the source of truth.
(Distinct from the simulated *Spacecraft* ops tab above.)

**Automations (all cron-triggered):**
1. **Upcoming Launches** ⭐ — The Space Devs Launch Library 2 (`lldev` host — cached, no rate limit, no key). Next-launch hero with live countdown + following launches. Cron `0 */2 * * *`.
2. **ISS Tracker** — `wheretheiss.at` live position on an equirectangular world map + altitude/velocity/sunlit. Cron `*/5 * * * *`.
3. **Space Weather** — NOAA SWPC planetary K-index → Kp gauge, storm level, aurora likelihood, 20-reading history. Cron `*/30 * * * *`.
4. **Moon & Meteors** — moon phase + illumination computed locally from the synodic month (no API), plus next major meteor shower from a fixed annual calendar. Fully offline-capable. Cron `0 */6 * * *`.

**No keys, by design.** APOD/Open-Meteo etc. were considered but the seed must run with zero
config for anyone — so only no-key endpoints are used, and `Moon & Meteors` needs no network at all.

---

## Tab 9: Stage & Show Control (DMX)

**Premise:** A live theatre/concert production rig. Show control runs on **DMX512** — and a
Raspberry Pi running Open Lighting Architecture (OLA) can output Art-Net/sACN → DMX directly, so
this is genuinely connectable. A digital lighting board is the hero visual.

**Devices (a small DMX patch):**
| Name | Type | State |
|------|------|-------|
| Front Wash | light | `{ level: 80, color: "#FF6B00" }` |
| Back Wash | light | `{ level: 60, color: "#3BA4FF" }` |
| Moving Head 1/2 | light | `{ level: 100, pan: 120, tilt: 45, color: "#A855F7" }` |
| Master | light | `{ level: 75 }` |
| Hazer / Fogger / CO₂ jet | fx | `{ on, density/fluid/pressure }` |
| Pyro | fx | `{ armed: false, cuesLoaded: 4 }` |
| Cue | show | `{ current: 3, total: 12, name: "Act 2 — Storm" }` |

**Automations:**
1. **Lighting Board** ⭐ — per-fixture DMX channels scaled by a master fader. UI is a digital console: a stage preview with coloured beam pools + a vertical fader bank (level, colour chip, fixture name). *Connects via: OLA / Art-Net / sACN → DMX.*
2. **Cue Stack** — a sequenced show: GO/BACK steps a cue list, each cue recalls lights + atmospherics. UI shows the cue list with live/next highlighting + GO/BACK + cue timer. *(Showcases `fire`.)*
3. **Atmospherics** — haze density, fog blasts, CO₂ jets with fluid/pressure levels. UI: density slider, blast buttons, tank gauges. *Connects via: DMX-controlled hazers/foggers.*
4. **Effects & Pyro** — theatrical pyro/confetti/CO₂ behind an **ARM/DISARM safety interlock** (effects locked until armed) with per-cue fire. UI: arm key-switch, armed indicator, effect buttons disabled unless armed, fired log. *(Models real show-control safety.)*

**Data Store:** `show-log` (cue/effect fire events for the session).

---

## Pane Layout Per Tab

Each tab is a grid of automation panes (typically 4), each showcasing a different automation for
that domain — no device-grid pane (the seed leads with the custom automation UIs, not a raw device
list). Panes use a 12-column responsive layout, generally two columns of automations.

```
┌──────────────────────┬─────────────────────────┐
│  Automation Pane 1   │  Automation Pane 2      │
├──────────────────────┼─────────────────────────┤
│  Automation Pane 3   │  Automation Pane 4      │
└──────────────────────┴─────────────────────────┘
```

A hero automation (e.g. Irrigation, Lighting Board) may span full width at the top.

---

## Seed Script Architecture

The seed script (`scripts/seed-demo.mjs`):

1. **Authenticates** — POST `/api/auth/login` with provided credentials
2. **Cleans** — deletes all automations and layout with a `[SEED]` prefix in their name
3. **Creates devices** — POST device state via MQTT publish (devices auto-register on first message)
4. **Creates automations** — POST `/api/automations` with name, triggerTopic, scriptSource, uiSource
5. **Creates layout** — PUT `/api/layout` with full tab/pane structure
6. **Seeds Data Store** — POST `/api/data-store/collections` + write records

All seeded entities use a `[SEED]` prefix or naming convention for clean identification on re-seed.

---

## Visual Design Principles for UI Components

- Use the existing Aeolus design tokens (bg colours, text colours, border styles from Tailwind)
- SVG graphics for domain-specific visualisations (bunker map, power flow, pressure gauge, atmospheric bars)
- Keep components under 60 lines — concise, readable, demonstrating the API without overwhelming
- Each component should showcase different `aeolus.*` methods (read, fire, control, save) so the full API surface is visible across the demo
- Deliberately vary the dataviz so no two panes look alike: tank flow diagrams, vertical depth profiles, network graphs, orbital pass timelines, transport controls, schematics. The range is itself a selling point — it shows the platform (and the author) can build any kind of instrument UI.

## Portfolio Screenshot Heroes

Five panes are the "money shots" for the README and portfolio — each visually distinct, each instantly communicating a serious, different domain:

1. **Irrigation Controller** (Agriculture) — animated tank-flow diagram (Dam → Header Tank → Beds)
2. **CTD Depth Profiler** (Research Vessel) — vertical oceanographic profile plot
3. **Ventilation on Demand** (Mining) — mine network graph with animated airflow
4. **Ground Station Comms** (Spacecraft) — AOS/LOS pass timeline
5. **Game Master Console** (Escape Room) — countdown + transport controls

Together they tell the story: *same platform, wildly different serious domains.*
