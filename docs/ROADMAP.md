# 🌬️ Aeolus — Roadmap

Future development plans for the Aeolus platform, organised by category.

---

## Infrastructure

### Cloudflare Tunnel for HTTPS
Expose the Aeolus dashboard securely over the internet via a Cloudflare Tunnel, enabling HTTPS access without port forwarding or self-signed certificates. This also unlocks `crypto.randomUUID()` in the browser (requires secure context) and enables push notifications. Currently the dashboard is served over plain HTTP on the LAN, which is fine for local use but insufficient for a portfolio demo or remote access. Cloudflare Tunnel would provide a public URL with automatic TLS, zero firewall changes, and DDoS protection — making the project presentable as a live demo.

### ~~Authentication & User Management~~ ✅ Implemented
JWT-based authentication with first-run admin setup, user groups, per-tab read/interact/write permissions, rate-limited login, bcrypt password hashing, httpOnly refresh cookies, and WebSocket auth. MQTT security with three configurable levels (Open, Shared Password, Per-Device) managed from the dashboard.

### MQTT 5.0 Request/Response (Command Acknowledgment)
Use MQTT 5.0's request/response pattern to get confirmation that a device actually received and executed a command. Currently, when Aeolus publishes a command (e.g., "open valve"), it's fire-and-forget — we don't know if the ESP32 was online, received it, or executed it. With request/response, Aeolus attaches a `responseTopic` and `correlationData` to each command. The device publishes an acknowledgment back to that topic after executing. Aeolus matches the correlation ID and updates the UI: "Valve opened ✓" instead of "Command sent." If no response arrives within a timeout (5 seconds), show "Device didn't respond." Requires firmware-side changes on ESP32 devices (respond to the `responseTopic` from the incoming message properties). The broker already supports this (Mosquitto 2.x + MQTT 5.0 enabled). Low priority since it's a LAN system where you can just look at the device, but improves reliability for unattended automations.

---

## Connectors

### More Connectors (Zigbee, Z-Wave, Tasmota, Shelly)
Expand the connector library with support for popular IoT protocols and device ecosystems. Zigbee (via zigbee2mqtt) and Z-Wave would cover a wide range of sensors and actuators. Tasmota and Shelly connectors would add support for popular DIY and off-the-shelf Wi-Fi devices.

### DMX / Stage Lighting Connector
Drive professional stage and architectural lighting over DMX512 — the standard used in theatre, concert, and live-event production. Aeolus is application-layer and can't bit-bang RS-485 timing itself, so the connector hands off DMX universes to a layer that does the physical signal. Several integration paths, in rough order of how "native" they are:

- **Art-Net / sACN (E1.31) over Ethernet** — the backend emits DMX universes as UDP packets (Node's built-in `dgram`) to a network DMX node (Enttec ODE, DMXKing eDMX, etc.) that converts IP → physical DMX. No USB on the Pi; scales to many universes. This is the cleanest, most scalable option.
- **OLA (Open Lighting Architecture)** — run `olad` on the Pi and POST channel values to its HTTP/JSON API. OLA abstracts every output (USB-DMX widgets, Art-Net, sACN, KiNET, GPIO), so the connector stays tiny and supports the widest hardware. Lowest-effort path to a working proof.
- **MQTT → ESP32 → DMX** — fits the existing ESP32/MQTT pattern: Aeolus publishes channel values to a command topic, a ~$5 ESP32 with an RS-485 transceiver outputs DMX (or acts as its own Art-Net node). No new connector required — just `mqtt.publish`.
- **Local hardware** — USB-DMX widget, a DMX HAT, or GPIO + a MAX485 transceiver for direct output; wireless DMX (CRMX/W-DMX) sits downstream.

The seed's **Stage & Show Control** tab (Lighting Board, Cue Stack, Atmospherics, Effects & Pyro) already demonstrates the UI/automation side — fader values, cue recalls, and effect fires map directly to DMX channel writes. The connector would turn those into real fixture output. Lowest-effort proof: `olad` on the Pi + a cheap USB-DMX widget (or an ESP32 Art-Net node).

### Smart Camera Integration
Connect IP cameras and smart camera systems (Reolink, Hikvision, UniFi Protect, RTSP-compatible cameras) to the Aeolus device registry. Stream snapshots or MJPEG feeds into a dedicated camera pane on the dashboard. Integrate motion detection events into the automation engine so cameras can trigger rules (e.g. "when front door camera detects motion after 11pm, turn on porch light and send a notification"). ONVIF protocol support would cover a wide range of cameras. For AI-capable cameras, ingest object detection events (person, vehicle, animal) as device state — enabling automations like "when a person is detected in the driveway, unlock the front gate." Camera feeds stay local, no cloud required.

### Smart Lock Connector
Integrate smart locks (Yale, August, Nuki, Schlage, TTLock) for keyless entry control from the Aeolus dashboard. Generate temporary access codes via the automation DSL — particularly powerful when combined with the short-term rental automation vertical (auto-generate a unique code per Airbnb booking, expire it at checkout). Surface lock state (locked/unlocked/jammed) in the device registry, log access events in the event log, and trigger automations on lock/unlock (e.g. "when front door unlocks after 6pm, turn on hallway lights"). Many smart locks expose local APIs or work via Zigbee/Z-Wave, fitting naturally into the connector framework.

### Garden & Irrigation Automation
Connect smart irrigation controllers and garden sensors (Holman, Orbit B-hyve, OpenSprinkler, soil moisture sensors via Zigbee/MQTT) for automated watering schedules driven by real data. Combine soil moisture readings, local weather forecasts (via the external services framework), and rain predictions to skip unnecessary watering cycles. Surface zone status, run history, and water usage in a dedicated garden pane. The automation DSL can express rules like "water zone 3 for 15 minutes at 6am, but skip if rain probability exceeds 60% or soil moisture is above 40%." This ties into the energy/cost analytics opportunity — tracking water usage and savings from smart scheduling.

### Bluetooth Low Energy (BLE) Connector
Use the Raspberry Pi's built-in Bluetooth 5.0/BLE radio (standard on every Pi since the Pi 3) to communicate directly with nearby BLE IoT devices — no extra hardware required. The BLE ecosystem includes Xiaomi/Mijia sensors (temperature, humidity, door/window — ~$5-10 each), Switchbot (curtain motors, button pushers, locks), Govee (LED strips, thermometers), BLE smart locks, and plant/soil moisture sensors. A BLE connector would use `noble` or `node-ble` to scan for devices, decode manufacturer-specific advertisements and GATT characteristics, and push state through the event bus like any other connector. The Docker container already uses host networking, so accessing the host Bluetooth adapter is straightforward.

The main limitation is range — BLE reaches ~10-30 metres, so it only covers devices near the Pi. For whole-house coverage, the recommended approach is BLE proxy nodes: cheap ESP32 boards (~$5 each) placed in each room running ESPHome or Theengs Gateway, which scan for BLE devices locally and forward the data to the MQTT broker over Wi-Fi. From Aeolus's perspective, the BLE data arrives as standard MQTT topics — no special connector needed. This hybrid approach (direct BLE for nearby devices + ESP32 proxies for distant rooms) gives full-house BLE coverage while keeping the architecture clean. The direct BLE connector on the Pi is still valuable for devices in the same room (smart locks on the front door, presence detection, nearby sensors) and for setups where users don't want to deploy ESP32 proxies.

### LoRa / LoRaWAN Gateway
Add a LoRa HAT to the Raspberry Pi (RAK2245, Dragino, SX1302-based boards — ~$20-30) to turn it into a LoRaWAN gateway for long-range, ultra-low-power sensors. LoRa reaches 2-15km line-of-sight, making it ideal for outdoor and remote sensors that Wi-Fi and BLE can't reach — soil moisture probes in the garden, weather stations on the roof, water tank levels, gate/fence sensors, and agricultural monitoring. LoRa devices transmit tiny packets (temperature, humidity, on/off) at very low data rates with battery life measured in years. The gateway would run ChirpStack (open source LoRaWAN network server) which handles device management, encryption, and MQTT integration — so LoRa sensors appear as standard MQTT topics in Aeolus with zero custom connector code. This opens up the small building management and multi-property monitoring use cases where sensors need to cover large areas without Wi-Fi infrastructure.

### LTE / Cellular Connectivity
Enable Aeolus hubs to operate in locations without Wi-Fi by adding a 4G/LTE USB dongle (~$30) to the Pi. This is a network transport layer rather than a device connector — the Pi gets internet connectivity via cellular, and Aeolus runs normally on top. Relevant for the multi-property management vertical where each property runs its own Pi hub: remote holiday houses, construction sites, sheds, or rural properties without broadband. The hub would sync device state, alerts, and energy data back to a central dashboard over the cellular connection. Combined with LoRa sensors for local device communication, this creates a fully self-contained IoT hub that works anywhere with cell coverage — no Wi-Fi, no ethernet, just power and a SIM card.

### External Services Framework
A structured way to integrate external APIs (weather forecasts, river height data, energy prices, calendar events) as virtual devices in the Aeolus device registry. Services would poll external APIs on a schedule and emit events through the standard event bus, making external data available to automations and the dashboard.

---

## Dashboard

### Visual Flow Editor
Drag-and-drop canvas for building automations visually (Node-RED style). Nodes for triggers, conditions, and actions connected by wires. Would generate the same underlying rule structure as the form-based editor and TypeScript DSL, providing a more intuitive way to create complex multi-step automations.

### Automation Pipelines & Linkage Pane
Visual chaining of automations with transform steps — connect the output of one automation to the input of another with a mapper function in between. A dedicated "Linkage" pane type would show the connection graph and let users write transform code in a Monaco editor. The underlying mechanism already exists (automations can chain via the state store or MQTT topics), but a visual linkage pane would make the connections discoverable and the transforms explicit. Think Unix pipes for IoT: `sensor → compute average → threshold check → device action → notification`.

### Automation & Panel Export/Import
Persist user-created automations and custom panes as portable JSON files that can be exported, version-controlled, and imported on another Aeolus instance. This enables backup/restore workflows, sharing automation recipes between users, and migrating setups between Pis without manually recreating everything. The export format would include the script source, UI source, state store snapshot, and pane layout metadata — everything needed to reconstruct the automation or panel on a fresh install.

### ~~State History & Charts~~ ✅ Implemented
Store the last N values per device in SQLite and display trend charts as a dedicated pane type. Implemented with throttled recording (configurable interval), auto-pruning, a pure SVG line chart with Catmull-Rom spline interpolation, multi-series support, hover tooltips, time range picker (15m/1h/6h/24h), auto-refresh, and per-device or global history clearing. Available as the "State History" pane in the monitoring category.

### Device Offline Detection
~~Mark devices as offline if no message is received within a configurable timeout.~~ The timeout-based approach was rejected because many MQTT devices (motion sensors, door sensors, leak detectors) only emit when they sense something — silence is normal, not a failure. A global timeout would generate constant false positives for event-driven devices. The correct approach is **MQTT Last Will and Testament (LWT)**: the device tells the broker "if I disconnect unexpectedly, publish this message to a death topic." Aeolus would listen for LWT messages and mark the device offline based on that — reliable regardless of how often a device publishes. This requires device-side configuration (setting a will topic/payload in the MQTT connect options) and Aeolus subscribing to a convention like `{deviceId}/status` or `aeolus/lwt/{deviceId}`.

### Anomaly Detection
Detect unusual patterns in device state history and surface them as alerts or automation triggers. Examples: "temperature rose more than 5°C in the last hour", "power draw is 40% above the 7-day average", "humidity has been above 80% for 3 hours straight." Requires the state history feature (now implemented) as a foundation. The design needs decisions around what constitutes an "anomaly" — rate of change thresholds, statistical deviation from rolling averages, absolute bounds, or time-in-state duration. Could be implemented as a set of built-in condition factories for the automation system (e.g. `rate_of_change_above`, `rolling_avg_deviation`, `sustained_above`) so users write automations like "when sensor/bathroom/humidity sustained_above 80 for 3h, send notification."

---

## Platform

### Data Store — Persistent Time-Series & Key-Value Storage
Add a general-purpose data store accessible from automations, connectors, and services for persisting structured data beyond the ephemeral device state. Currently, device readings are transient (overwritten on each update) and the state history only keeps the last N snapshots per device. The Data Store would provide:

- **Time-series collections** — automations can write timestamped records (e.g. daily energy totals, irrigation cycle logs, pool chemistry readings) that accumulate over time without being pruned
- **Key-value buckets** — persistent storage for computed values, configuration, and cross-automation shared state (beyond the per-rule state store)
- **Query API** — retrieve records by time range, aggregate (sum, avg, min, max), and filter by tags
- **Sandbox global** — `db.write("energy-daily", { solar: 14.2, grid: 8.1 })` and `db.query("energy-daily", { from: "7d" })`
- **Dashboard pane** — a "Data Explorer" pane for browsing collections, viewing charts, and exporting CSV
- **Retention policies** — configurable per-collection (keep 30 days, keep 1 year, keep forever)

This would be a new pinned tab in the sidebar (under Connectors) called "Data Store" with a UI for browsing collections, viewing time-series charts, and managing retention. The underlying storage would use SQLite (same as everything else) with a dedicated `data_store` table.

**Use cases:**
- Track daily/weekly/monthly energy production and consumption totals
- Log every irrigation cycle with duration, volume, and which zones were watered
- Store pool chemistry readings over time for trend analysis
- Record automation execution metrics for performance monitoring
- Persist computed values that survive automation restarts (rolling averages, counters, thresholds)

### Multi-Node Clustering
Run Aeolus across multiple Raspberry Pis with shared state and distributed device management. A primary node would coordinate automations and state, while secondary nodes handle local MQTT ingestion and connector communication. Useful for large homes or buildings with multiple floors.

### Mobile App
React Native companion app for quick device control, push notifications when automations fire, and at-a-glance sensor readings. Would communicate with the Aeolus backend via the existing REST API and WebSocket server.

### Plugin Marketplace
Community-contributed connectors and pane types installable from the dashboard. A registry of published plugins with one-click install, automatic dependency resolution, and version management. Would lower the barrier for extending Aeolus without writing code.

### OTA Firmware Management
Manage microcontroller firmware updates from the Aeolus dashboard. Upload compiled binaries (.bin files) and push them to ESP32/ESP8266 devices over Wi-Fi using the ArduinoOTA or ESP-IDF OTA protocols. Track firmware versions per device, roll back to previous versions, and schedule updates during low-activity windows. This would close the loop on the microcontroller workflow — currently users need the Arduino IDE or PlatformIO on a separate machine to flash their boards. With OTA support, the entire lifecycle (write automation → deploy firmware → monitor device) happens from the Aeolus dashboard. The microcontroller templates in [`docs/MICROCONTROLLERS.md`](MICROCONTROLLERS.md) would be extended with OTA-ready variants that include the update client library.

### Browser-Based Code Editor (code-server Add-on)
Embed a full VS Code instance ([code-server](https://github.com/coder/code-server)) into the Aeolus stack as an additional Docker Compose service, accessible from the dashboard via an ingress proxy — similar to Home Assistant's VS Code add-on. The backend (or nginx frontend) would reverse-proxy requests from a path like `/addon/code-server/` into the code-server container, including WebSocket traffic, so the editor works seamlessly within the Aeolus UI.

**Why not for automations?** Aeolus already has purpose-built Monaco editors for automation logic scripts and custom UI components (TSX). These editors are tightly integrated with the automation context — IntelliSense powered by `sandbox-types.d.ts`, a snippet picker pulling from platform and connector catalogs, instant transpile-on-save, live execution feedback in the activity feed and flow diagram, and the automation state store bridging scripts and UI components over WebSocket. A full VS Code instance would lose all of that context and be a downgrade for the automation editing workflow.

**Where it shines — platform development from the Pi:**
- **Editing Aeolus source code** — working on backend services, connectors, the frontend, Docker configs, and infrastructure directly from the Pi's browser without needing SSH or a separate development machine
- **Building new connectors** — the `_template/` scaffold, implementing `connector.interface.ts`, testing against live devices on the LAN. This is real multi-file TypeScript work where a full IDE with project-wide navigation, refactoring, and terminal access makes a meaningful difference
- **Writing file-based automation rules** — the `automations/` directory DSL rules that live as `.ts` files on disk, where git integration and multi-file awareness help
- **System administration** — reading logs, inspecting the SQLite database, running diagnostic scripts, managing Docker containers, all from the browser
- **Remote development** — when combined with the Cloudflare Tunnel roadmap item, developers could work on the Aeolus platform from anywhere without SSH tunnels or VPN setup

**Implementation approach:** Add a `code-server` service to `docker-compose.yml` mounting the Aeolus project directory, proxy it through Express using `http-proxy-middleware` (with WebSocket support), and add a new dashboard pane type or sidebar link that renders the editor in an iframe. The backend container already has `docker-cli` and the Docker socket mounted, so orchestration is straightforward. Estimated effort: 1-2 days for a working MVP.

---

## Untapped Opportunities

These are areas where the current smart home landscape has genuine gaps. Aeolus's architecture — TypeScript DSL, pluggable connectors, event bus, local-first design — positions it well to explore any of these directions.

### Energy Analytics & Cost Intelligence
Turn raw wattage data from smart plugs (Kasa HS110, Shelly PM, etc.) and CT clamps into actionable insights. Per-device cost breakdowns using real electricity tariffs, anomaly detection ("your fridge is drawing 40% more than last month"), time-of-use scheduling to shift loads to cheaper rate periods, and solar self-consumption optimisation. Home Assistant has a basic energy dashboard but it's widely considered clunky. A dedicated energy analytics layer with historical trends, cost forecasting, and automated recommendations is a clear monetisation path — the home energy management market is growing fast and homeowners can save $200+/year just by understanding their consumption patterns.

### Short-Term Rental Automation (Airbnb / VRBO)
Calendar-driven automation for vacation rental properties. Sync with Airbnb/VRBO booking calendars to automatically generate smart lock codes per guest, pre-condition HVAC before check-in, set welcome lighting scenes, switch to energy-saving mode during vacancy, and send automated check-in instructions. The workflow is well-defined but no open source platform handles it end-to-end. Rental Home Automator exists but is basic and closed-source. Aeolus's TypeScript DSL is a natural fit for expressing calendar-triggered automation rules, and the connector framework already supports smart locks (via Kasa/Zigbee) and thermostats. This is a vertical with paying customers — hosts managing 5-50 properties would pay for a reliable, self-hosted solution.

### Local AI / On-Device LLM Assistant
Run a small language model (e.g. quantized Llama, Phi, or Gemma) directly on the Raspberry Pi for natural language device control and intelligent automation generation. "Turn on the lights when I get home after sunset" gets parsed locally and converted into a TypeScript automation rule — no cloud dependency, full privacy. Research is advancing rapidly on edge LLM inference (Pi 5 with 8GB RAM can run 3B parameter models). Home Assistant is experimenting with voice pipelines but they're slow and cloud-dependent. A local-first AI assistant that understands your device registry, suggests automations based on usage patterns, and detects anomalies ("your bathroom humidity has been above 80% for 3 hours — possible ventilation issue") would be a compelling differentiator and an incredible portfolio piece.

### Small Building / Commercial Lite Management
Traditional Building Management Systems (BMS) cost $2.50-8 per square foot and are designed for large commercial buildings. Small businesses, churches, community centres, co-working spaces, and small offices have zero affordable options for HVAC scheduling, occupancy-based lighting, and energy monitoring. Aeolus running on a Pi with a handful of smart plugs, temperature sensors, and occupancy detectors could serve this market at a fraction of the cost. The dashboard's modular pane system already supports multi-room views, and the automation DSL can express occupancy-based rules. This is a genuinely underserved segment — IoT for All calls it "the other 90%" of buildings that have no smart infrastructure.

### Multi-Property Management
Landlords and property managers with 5-50 rental units need to monitor water leaks, HVAC health, energy usage, and security across properties from a single dashboard. Current solutions are either enterprise-grade (expensive, complex) or consumer-grade (one home at a time). Aeolus's multi-node clustering roadmap item could evolve into a multi-property management platform where each property runs its own Pi hub and a central Aeolus Cloud dashboard aggregates device state, alerts, and energy data across all locations. Combine with the short-term rental automation vertical for a complete property management IoT stack.

### Matter Bridge / Protocol Translation Hub
The Matter smart home standard is struggling with adoption — it only standardises basic functions (on/off, dimming) and can't handle advanced features like colour gradients, energy monitoring, or complex device states. Devices speaking Zigbee, Z-Wave, or proprietary protocols still need bridges to participate in Matter ecosystems. Aeolus could act as a universal Matter bridge — exposing non-Matter devices to Apple Home, Google Home, and Alexa via Matter, while preserving full feature access through the Aeolus dashboard and API. The connector framework is architecturally ready for this: each connector already normalises devices into a standard format, and adding a Matter server layer on top would make Aeolus the translation hub between legacy protocols and the Matter world.

### TypeScript Automation SDK & Developer Platform
The current `when/if/then` DSL is a convenient shorthand for simple rules, but it's a constraint — you can't query devices, call external APIs, maintain state across events, or compose multi-step workflows. The SDK vision is to give developers full, unrestricted TypeScript access to the entire Aeolus runtime while keeping the DSL as an optional convenience layer.

**The `@aeolus/sdk` npm package** would expose typed access to the device registry, event bus, connectors, services, and scheduling — all with IntelliSense and compile-time type safety. Automation files would be plain TypeScript that can import any npm package, use `async/await`, and express arbitrarily complex logic:

```typescript
import { aeolus } from "@aeolus/sdk";

// Direct device access — query, filter, act on any device by ID or type
const thermostat = aeolus.devices.get("climate-living-room");
const allLights = aeolus.devices.filter(d => d.type === "light" && d.state.on);

// Subscribe to events with full context — not limited to topic matching
aeolus.on("device:state-change", async (event) => {
  if (event.deviceId !== "motion-living-room") return;
  const forecast = await aeolus.services.get("weather").getForecast();
  if (event.state.motion && forecast.low < 5) {
    await aeolus.devices.action("climate-living-room", "setTemperature", { target: 22 });
  }
});

// Cron-based scheduling — not possible with the DSL
aeolus.schedule("0 23 * * *", async () => {
  for (const light of aeolus.devices.filter(d => d.type === "light" && d.state.on)) {
    await aeolus.devices.action(light.id, "off");
  }
});

// Use any npm package — date-fns, axios, node-cron, whatever you need
import { format } from "date-fns";
aeolus.log.info(`Rule loaded at ${format(new Date(), "HH:mm")}`);
```

**The `@aeolus/cli`** would provide a proper developer workflow:
- `npx @aeolus/cli init` — scaffold a project with tsconfig, types, and example rules
- `npx @aeolus/cli dev` — hot-reload automations against a running Aeolus instance
- `npx @aeolus/cli test` — run automation tests with a simulated device registry and event stream
- `npx @aeolus/cli deploy` — push rules to the Pi over SSH or via the REST API

**Why this matters:** Home Assistant's community has been asking for "real code" automation support for years. Their YAML automations and visual editor are fine for simple rules, but developers hit a wall when they need conditional logic, external API calls, or state machines. Aeolus would be the only platform where you write automations in a real programming language with a real type system, test them with a real test runner, version them in git, and deploy them through CI/CD. That's a developer experience no other home automation platform offers.


---

## Engineering Maturity (Portfolio Gaps)

These items address gaps identified in a portfolio assessment for IoT software engineering roles. Some will be implemented; others are documented here with architectural reasoning for why they're deferred and how they'd be approached.

### ~~Observability & Metrics Export~~ ✅ Implemented
Export platform metrics (device count, message throughput, automation execution time, error rates, memory usage) to Prometheus via a `/metrics` endpoint. Implemented with 19+ custom metrics, optional bearer token protection, and a two-tier metrics history system (30s live sparklines + 5-minute permanent aggregates with trend charts) — no Grafana required for basic monitoring.

### Configurable Metrics & Custom Dashboards
Allow users to define their own tracked metrics from the dashboard — select which device fields to sample, set custom aggregation intervals, configure alert thresholds, and build personalised metrics views. Currently the metrics history system tracks a fixed set of platform metrics (MQTT throughput, device counts, automation execution, system resources). Users should be able to add their own: "track the average temperature from sensor/kitchen every 5 minutes", "alert me if power draw from kasa-plug1 exceeds 500W for more than 10 minutes", "show a 7-day chart of my solar production vs grid consumption." This would bridge the gap between the built-in observability and the Data Store — giving users Grafana-like custom dashboards without leaving Aeolus.

### End-to-End Test Coverage
Add integration tests that prove the full IoT pipeline: MQTT publish → device appears in registry → automation fires → action executes → WebSocket delivers update to frontend. Also add load tests showing behavior under pressure (100 devices publishing simultaneously) and chaos tests (MQTT broker disconnect mid-automation). Use Vitest + supertest for integration, and k6 or Artillery for load testing.

### Device Provisioning Workflow
Currently, any device that publishes to any MQTT topic is automatically discovered — no registration, no approval, no security. A production IoT platform would have: device claim codes, fleet management, firmware assignment, group policies, and approval workflows. For Aeolus's local-first model, a lightweight version would be: optional device allowlist (only accept messages from known device IDs), device groups/tags for organization, and a "pending devices" queue that requires user approval before a new device enters the registry.

**Why it's deferred:** The auto-discovery model is intentional for the home/hobbyist use case — zero friction for getting started. Adding provisioning gates would hurt the onboarding experience. The right approach is to make it optional: auto-discover by default, with an opt-in "strict mode" that requires device registration.

### Message Queuing / Buffering
Currently, if the backend restarts, any MQTT messages published during the restart window are lost (Mosquitto retains the last message per topic, but not a queue of messages). A production system would have a durable message queue (Redis Streams, Kafka, or NATS JetStream) between the broker and the processing layer to guarantee no message loss.

**Why it's deferred:** For a local-first system on a single Pi, the restart window is ~5-10 seconds. MQTT retained messages cover the "last known state" case. The complexity of adding Kafka/Redis to a Pi deployment outweighs the benefit. If Aeolus ever targets multi-node or cloud deployment, this becomes essential.

### High Availability / Failover
Single Pi, single process, single database file. If the Pi dies, everything stops. A production IoT platform would have: database replication, process supervision, automatic failover, and multi-node clustering.

**Why it's deferred:** This is a self-hosted edge platform, not a cloud service. The Pi is the single point of failure by design — it's the user's hardware. Docker's `restart: unless-stopped` policy handles process crashes. For hardware failure, the backup strategy (documented in `docs/production-deployment.md`) covers recovery. Multi-node clustering is on the roadmap as a separate feature for users with multiple properties.

### Scalability Beyond 1000 Devices
The current architecture (single Node.js process, SQLite, EventEmitter) handles ~100-1000 devices comfortably. Beyond that, the event bus becomes a bottleneck, SQLite write contention increases, and the single-threaded event loop can't keep up with message processing.

**How we'd scale (if needed):**
- Replace EventEmitter with NATS or Redis pub/sub for distributed event routing
- Replace SQLite with TimescaleDB for time-series data (keeps better-sqlite3 for config/state)
- Add worker threads or separate processes for automation execution
- Horizontal scaling via multiple backend instances behind a load balancer
- Shard devices across instances by topic prefix or device group

**Why it's deferred:** The target deployment is a single Raspberry Pi managing a home or small building (<500 devices). The architecture is intentionally simple for this use case. Over-engineering for 10,000 devices would add complexity that hurts the primary use case.

### OTA Firmware Management
Manage microcontroller firmware updates from the Aeolus dashboard. Track firmware versions per device, push updates over Wi-Fi (ArduinoOTA / ESP-IDF OTA), staged rollouts, rollback mechanisms. This closes the loop on the device lifecycle — currently users need a separate IDE to flash firmware.

**Why it's deferred:** This is a significant feature that requires firmware-side cooperation (devices must implement an OTA update client). It's on the roadmap but lower priority than platform stability and observability. The microcontroller guide documents how to add OTA capability to ESP32 firmware independently.

### Device Simulator (Continuous)
A background process that generates realistic sensor data patterns (sine waves for temperature, random walks for humidity, step functions for switches, correlated multi-sensor patterns) so the platform can be demoed without hardware. Different from the seed script (which runs once) — this would continuously publish MQTT messages simulating a realistic home environment.

**Why it's valuable:** Enables live demos, load testing, and development without physical devices. Would make the GitHub repo much more impressive — clone, run, and immediately see a living dashboard with realistic data flowing through.
