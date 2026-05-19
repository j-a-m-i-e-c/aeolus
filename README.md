<p align="center">
  <img src="logo.png" alt="Aeolus" width="120" />
</p>

<h1 align="center">Aeolus</h1>

<h3 align="center">Self-hosted IoT platform for developers</h3>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/MQTT-660066?logo=eclipsemosquitto&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/Raspberry_Pi-C51A4A?logo=raspberrypi&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-22C55E" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#dashboard">Dashboard</a> •
  <a href="#automations">Automations</a> •
  <a href="#security">Security</a> •
  <a href="#observability">Observability</a> •
  <a href="#data-store">Data Store</a> •
  <a href="#connectors">Connectors</a> •
  <a href="#architecture">Architecture</a> •
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

---


## What is Aeolus?

Aeolus is a local-first IoT platform that bridges custom microcontrollers, commercial smart devices , and external APIs into one unified system. Write automation scripts in a code editor with full IntelliSense and autocomplete, build custom React dashboard components, and control everything from a single interface — all running on a Raspberry Pi with one command.

No cloud. No subscriptions. Just your LAN.

<!-- TODO: Add hero screenshot of the dashboard here -->
<!-- ![Dashboard Screenshot](docs/screenshots/dashboard.png) -->

---

## Quick Start

```bash
git clone https://github.com/j-a-m-i-e-c/aeolus.git
cd aeolus
docker compose up
```

Open **http://localhost:3000** — that's it.

Use the seed script (`node scripts/seed-demo.mjs`) to populate the platform with realistic demo data so you can explore without any hardware.

<!-- TODO: Add screenshot of the welcome/onboarding screen here -->
<!-- ![Welcome Screen](docs/screenshots/welcome.png) -->

### Raspberry Pi (one-line install)

```bash
curl -sSL https://raw.githubusercontent.com/j-a-m-i-e-c/aeolus/main/scripts/setup-pi.sh | bash
```

Installs Docker, clones Aeolus, builds containers, and starts everything. Auto-starts on boot. Sets the Pi's hostname to `aeolus` so you can access the dashboard at **http://aeolus.local:3000** from any device on your network.

---

## Features

| | Feature | Description |
|---|---|---|
| 🌐 | **MQTT-first** | Bidirectional communication with any MQTT device — ingest sensor data and publish commands back to actuators |
| ⚡ | **Code-driven automations** | Write scripts in a Monaco editor with full IntelliSense, flow diagrams, and a code snippet library |
| 🎨 | **Custom UI components** | Write React/TSX dashboard widgets for your automations — save and they render instantly, no rebuild needed |
| 🎛️ | **Modular dashboard** | Create custom tabs with drag-and-drop panes |
| 🧩 | **Connector framework** | Add new device integrations without touching core code — [developer guide included](src/connectors/README.md) |
| 💡 | **Philips Hue (Connector)** | Toggle, brightness, colour picker with guided bridge pairing wizard |
| 🔌 | **TP-Link Kasa (Connector)** | Smart plugs with auto-discovery and energy monitoring |
| 🔗 | **Automation state store** | Per-rule key-value store for backend↔frontend communication via WebSocket |
| 📡 | **Internal event bus** | Typed pub/sub bus decouples MQTT ingestion, device state changes, automation triggers, and WebSocket pushes |
| ⏱️ | **Services framework** | Cron schedules, API triggers, and system events as automation triggers |
| 🍓 | **Raspberry Pi ready** | One-line install, auto-start on boot, runs on a Pi 4/5 |
| 💾 | **Data Store** | Persistent time-series collections and key-value buckets — accumulate sensor data, query with aggregation, share state across automations |
| 📊 | **State history & charts** | Per-device state history with SVG trend charts, time range filtering, and data cleanup |
| 🔒 | **100% local** | Everything stays on your network — no cloud dependency |
| 🔐 | **Authentication & RBAC** | JWT-based auth with admin setup, user groups, per-tab read/interact/write permissions, rate-limited login |
| 🛡️ | **MQTT Security** | Three configurable levels — Open, Shared Password, or Per-Device credentials — managed from the dashboard |
| 📈 | **Prometheus Metrics** | `/metrics` endpoint with MQTT throughput, device counts, automation execution, HTTP stats, and system resources |
| 📉 | **Metrics History** | Two-tier system — 30s live sparklines (10min retention) + 5min aggregates (permanent) with trend charts |
| ✅ | **92% test coverage** | 1200+ tests with 90% coverage enforced in CI — unit, integration, and property-based tests |

---

## Dashboard

The dashboard has three permanent tabs — **System** (device grid, health, diagnostics), **Connectors** (manage integrations), and **Data** (time-series explorer and key-value buckets) — plus as many custom tabs as you want.

Custom tabs are where the real work happens. Each tab has two buttons in the header:

- **New Automation** — the primary action. Drops a fresh automation pane straight into setup mode with a Monaco editor, no extra clicks. Automations are the core of Aeolus so they get their own entry point.
- **Add Pane** — everything else. Opens a picker with device grids, MQTT inspectors, sensor panels, system stats, and more.

### Available panes

| Category | Panes |
|----------|-------|
| Controls | Device Grid · Hue Lights · Kasa Devices · Trigger Button |
| Automations | Automation (one-pane-one-rule) · Automation List |
| Monitoring | Sensor Panel · MQTT Inspector · Topic Tree · Event Log · State History |
| System | System Stats · Connectors |

Every pane is draggable and resizable. Layout persists to SQLite automatically.

<!-- TODO: Add screenshot of a custom tab with automation panes here -->
<!-- ![Custom Tab](docs/screenshots/custom-tab.png) -->

<!-- TODO: Add screenshot of the MQTT inspector here -->
<!-- ![MQTT Inspector](docs/screenshots/mqtt-inspector.png) -->

<!-- TODO: Add screenshot of the connector management page here -->
<!-- ![Connectors](docs/screenshots/connectors.png) -->

---

## Automations

Each automation has two tabs: **Logic** (code that runs on the backend in a secure V8 sandbox) and **UI** (React/TSX that renders in the dashboard). They communicate through a shared per-rule state store.

### How data flows between Logic and UI

```
Logic tab (backend sandbox)          UI tab (React component)
─────────────────────────           ─────────────────────────
state.set("mode", "evening")  ──→  props.state.get("mode")
                               WS   (live via WebSocket)
state.set("avgTemp", 22.5)    ──→  props.state.get("avgTemp")

props.stateSet("target", 25)  ←──  user clicks a button
                               WS   (persisted + broadcast)
state.get("target")            ←──
```

The `state` global in the Logic tab and `props.state` / `props.stateSet` in the UI tab read and write to the same per-rule key-value store. Values are persisted to SQLite and synced in real time over WebSocket — so the Logic tab can compute something (a rolling average, a mode flag, a counter) and the UI tab sees it instantly, and vice versa.

### Logic Tab — `automation()` helper

```javascript
// Runs in a secure V8 sandbox with access to devices, mqtt, http, state, and more
// Monaco provides full IntelliSense — autocomplete, parameter hints, and hover docs
// TypeScript annotations are optional but supported (stripped at save time)
automation({
  conditions: [
    function isLowLight(ctx) {
      const lux = ctx.state.value as number;
      return typeof lux === "number" && lux < 200;
    },
    function isEvening(ctx) {
      const hour = new Date(ctx.timestamp).getHours();
      return hour >= 16 && hour < 23;
    },
  ],
  actions: [
    function dimLights(ctx) {
      const lights = devices.filter(d => d.integration === "hue");
      for (const light of lights) {
        devices.action(light.id, "brightness", { brightness: 60 });
      }
      state.set("mode", "evening");
      log.info("Evening mode activated");
    },
  ],
});
```

Named functions become labeled nodes in the flow diagram. The `state.set()` call in the action is what pushes `"mode"` to the UI tab.

### Logic Tab — Free-form code

The `automation()` helper is optional. You can write completely free-form code using the sandbox globals directly — no structure imposed:

```javascript
// React to a temperature sensor event
const temp = context.state.value;
const room = context.topic.split("/")[1];

// Fetch weather data from an external API
const weather = await http.get("https://api.weather.com/current");
const forecast = JSON.parse(weather.body);

// Control devices based on conditions
if (temp > 28 && forecast.willRain === false) {
  const fans = devices.filter(d => d.type === "plug" && d.name.includes("fan"));
  for (const fan of fans) {
    devices.action(fan.id, "on");
  }
  mqtt.publish("alerts/heat", JSON.stringify({ room, temp }));
  log.warn(`High temp in ${room}: ${temp}°C — fans activated`);
}

// Push data to the UI component via the state store
state.set("currentTemp", temp);
state.set("room", room);
state.set("fansActive", temp > 28);
state.set("lastUpdate", Date.now());
```

Free-form scripts have full access to the same globals (`devices`, `mqtt`, `http`, `state`, `log`, `services`, `context`) — you just don't get the visual flow diagram. Use whichever style fits: the structured helper for simple condition→action flows, free-form for complex logic with API calls, loops, and data aggregation.

### UI Tab — Custom React Components

```tsx
// Renders in the automation pane instantly after saving
export default function EveningMode(props: CustomComponentProps) {
  const mode = props.state.get("mode") as string;
  return (
    <div className="p-4 space-y-2">
      <div className="text-lg font-bold text-[#E6EDF3]">
        {mode === "evening" ? "🌙 Evening Mode" : "☀️ Day Mode"}
      </div>
      <button
        onClick={() => props.deviceAction("hue-light-1", "toggle")}
        className="px-3 py-1.5 rounded-lg bg-[#3BA4FF]/20 text-[#3BA4FF]"
      >
        Toggle Light
      </button>
    </div>
  );
}
```

`props.state.get("mode")` reads the value the Logic tab wrote. `props.deviceAction` and `props.mqttPublish` let the UI tab control devices directly. Write TSX, save, and your component renders live in the pane — no rebuild or refresh needed.

**How it works under the hood:** When you save, the backend transpiles your TSX into an ES module using the TypeScript compiler API with the React JSX transform. The compiled JavaScript is stored in the database and served via a dedicated API endpoint. The frontend fetches it, rewrites the React imports to reference the host app's shared React instance, loads it as a module via a blob URL and dynamic `import()`, and renders it inside an error boundary. The whole round-trip happens in milliseconds — no Docker rebuild, no Vite recompilation, no page refresh.

<!-- TODO: Add screenshot of the automation editor (Monaco + flow diagram) here -->
<!-- ![Automation Editor](docs/screenshots/automation-editor.png) -->

<!-- TODO: Add screenshot of a custom UI component rendering in a pane here -->
<!-- ![Custom UI Component](docs/screenshots/custom-ui.png) -->

### Sandbox API

Scripts run in an isolated V8 sandbox (32 MB memory limit, 5-second timeout) with access to:

The Monaco editor provides full IntelliSense for all globals — autocomplete, parameter hints, hover documentation, and error squiggles. TypeScript annotations are supported but optional; the transpiler strips them at save time.

| Global | Description |
|--------|-------------|
| `devices` | Query, filter, and send actions to any device |
| `mqtt` | Publish messages to MQTT topics |
| `log` | Structured logging (info, warn, error) |
| `context` | Triggering event data (topic, deviceId, state, timestamp) |
| `state` | Per-rule key-value store (persisted, synced to frontend via WebSocket) |
| `services` | Read-only access to service state (cron, triggers, system events) |
| `http` | GET/POST requests to external APIs (10s timeout, HTTPS recommended for non-local URLs) |
| `automation()` | Structured helper with conditions + actions for flow diagram visualization |
| `db` | Time-series write/query and key-value get/set/delete (available when Data Store is enabled) |

---

## Microcontrollers

Aeolus communicates with custom hardware (ESP32, Arduino, etc.) over MQTT. Your microcontroller connects to the Mosquitto broker on the Pi (`aeolus.local:1883`), publishes sensor data, and optionally subscribes to command topics. Devices appear in the dashboard automatically — no registration needed. Any MQTT topic is accepted; the recommended convention is `{type}/{location}/{metric}` for cleaner auto-generated names, but it's not required.

**Full guide with templates: [`docs/MICROCONTROLLERS.md`](docs/MICROCONTROLLERS.md)**

### Publish a sensor reading

```cpp
mqtt.publish("sensor/kitchen/temp", "{\"value\":23.5,\"unit\":\"°C\"}");
```

### Receive a command

```cpp
mqtt.subscribe("valve/irrigation/command");
// In your callback:
if (msg == "{\"action\":\"open\"}") digitalWrite(RELAY_PIN, HIGH);
```

The guide includes a minimal publish example, a minimal subscribe example, and a full production-style combined template with reconnection handling.

> **Note:** Aeolus doesn't handle compiling or uploading firmware to your boards — you'll need the [Arduino IDE](https://www.arduino.cc/en/software) or [PlatformIO](https://platformio.org/) for that. OTA firmware management from the dashboard is on the [roadmap](docs/ROADMAP.md).

---

## Connectors

Aeolus uses a pluggable connector framework. Each connector is a self-contained backend module that handles discovery, authentication, and device communication for a specific ecosystem.

| Connector | Devices | Features |
|-----------|---------|----------|
| **Philips Hue** | Lights | Toggle, brightness, colour picker, guided bridge pairing wizard |
| **TP-Link Kasa** | Smart plugs, switches | Auto-discovery via UDP broadcast, energy monitoring |

### Backend — zero core changes

```bash
cp -r src/connectors/_template src/connectors/my-connector
# Implement the Connector interface, restart Aeolus — done.
```

A connector exports `metadata`, `configSchema`, `createConnector`, and optionally `snippets` (code templates for the automation editor). The framework handles the REST API, lifecycle management, setup wizard, and device registry integration. Full guide: [`src/connectors/README.md`](src/connectors/README.md)

### Frontend — optional but recommended

Connector devices automatically appear in the Device Grid pane. But for connector-specific controls (like the Hue colour picker or Kasa energy stats), you'll want a dedicated pane component. This means adding a React component in `frontend/src/components/panes/` and registering it in the pane registry. The built-in Hue and Kasa panes are good reference implementations.

---

## Services

The services framework provides non-device event sources for automations:

| Service | Description |
|---------|-------------|
| **Cron Scheduler** | Time-based triggers using cron expressions |
| **API Trigger** | HTTP endpoint triggers for external integrations |
| **System Events** | Startup, shutdown, and lifecycle events |

Services emit events on the standard event bus using `service/{type}/{name}` topics, so automations match on service events the same way they match on device events.

---

## Security

Aeolus ships with a complete authentication and authorization system — no external auth provider needed.

### Authentication
- **First-run setup** — guided admin account creation on first launch
- **JWT-based** — short-lived access tokens (15min) + httpOnly refresh cookies (7 days)
- **Rate-limited login** — 5 attempts/min per IP to prevent brute-force
- **bcrypt password hashing** — cost factor 12
- **WebSocket auth** — token required for real-time connections

### Authorization (RBAC)
- **Admin** — full platform control, manages users/groups/tabs
- **User Groups** — each group gets a set of tab assignments
- **Three permission levels per tab:**
  - `read` — view only, all controls disabled
  - `interact` — control devices, fire automations
  - `write` — full control including editing automation code

### MQTT Security
Three configurable levels managed from the dashboard:

| Level | Description |
|-------|-------------|
| **Open** | No authentication (development/trusted networks) |
| **Shared Password** | Single credential for all devices |
| **Per-Device** | Unique username/password per device |

Switching levels regenerates the Mosquitto password file and reloads the broker config automatically. The backend maintains its own dedicated credential across all modes.

---

## Observability

### Prometheus Metrics (`/metrics`)

Exposes 19+ metrics in Prometheus text exposition format, covering:

| Category | Metrics |
|----------|---------|
| MQTT | Messages received/published, connection state, processing duration |
| Devices | Active count by type, state changes per second |
| Automations | Execution count, duration, error rate |
| Connectors | Health status, action latency |
| HTTP | Request rate, duration histogram, status codes |
| WebSocket | Active connections, messages sent |
| System | Node.js memory, event loop lag, CPU usage |

Optional bearer token protection via `METRICS_TOKEN` env var. Bypasses JWT auth so Prometheus can scrape without a user account.

### Metrics History (built-in, no Grafana required)

Two-tier system for historical metrics without external tooling:

- **Tier 1 (Live)** — samples every 30s, 10-minute retention, powers 1-hour sparkline charts
- **Tier 2 (Permanent)** — 5-minute aggregates (avg, peak, spike detection), kept forever, powers 6h/24h/7d/30d trend charts

Storage footprint: ~70 MB/year for the permanent tier. The frontend renders SVG sparklines and trend charts with time-range selection directly in the metrics dashboard pane.

---

## Data Store

Persistent time-series collections and key-value buckets built on the existing SQLite infrastructure. Accumulate sensor data over time, query with aggregation, and share computed state across automations.

- **Disabled by default** — a setup wizard on first visit guides you through storage limits to prevent accidental SD card fill on Raspberry Pi
- **Accessible from automations** via the `db` sandbox global (undefined when disabled)
- **REST API** at `/api/data-store` for the frontend and external consumers
- **Data Explorer UI** in the "Data" pinned sidebar tab with collection browsing, charts, and bucket management
- **Configurable safeguards** — `maxStorageMb`, `maxRecordsPerCollection`, `maxCollections`, FIFO eviction, and retention policies

### Quick example — using `db` in an automation

```javascript
// Write a temperature reading to a time-series collection
db.write("temperatures", { value: context.state.value, room: "kitchen" }, {
  tags: { sensor: context.deviceId }
});

// Query the last hour of readings with aggregation
const avg = db.query("temperatures", {
  from: "1h",
  aggregate: "avg",
  field: "value"
});
log.info(`Average temperature (1h): ${avg.value}°C`);

// Key-value bucket for sharing state across automations
db.set("config", "heating-target", 22);
const target = db.get("config", "heating-target"); // 22
```

---

## Architecture

```
                        ┌─── Event Sources ───┐
                        │                     │
  [ MQTT Devices ]      │  [ Connectors ]     │  [ Services ]
   ESP32 / Arduino      │   Hue / Kasa / ...  │   Cron · Triggers · System
        ↕               │       ↕              │       ↕
  [ Mosquitto :1883 ]   │  [ Connector Mgr ]  │  [ Service Mgr ]
        │               │       │              │       │
        └───────────────┴───────┴──────────────┴───────┘
                                │
                    ┌───────────▼───────────┐
                    │   Internal Event Bus  │
                    └───┬──────────────┬────┘
                        │              │
                        ▼              ▼
              ┌─────────────┐  ┌───────────────┐
              │   Device    │  │  Automation    │
              │  Registry   │  │   Engine       │
              │  (SQLite)   │  │  (V8 Sandbox)  │
              └──────┬──────┘  └───────┬────────┘
                     │                 │
                     │          ┌──────▼──────┐
                     │          │   Actions   │
                     │          │ MQTT · HTTP  │
                     │          │ Devices · Log│
                     │          └─────────────┘
                     │
              ┌──────▼──────┐  ┌──────────────┐
              │  WebSocket  │  │  Data Store   │
              │   Server    │  │  (SQLite)     │
              └──────┬──────┘  └──────┬────────┘
                     │                 │
                     │    ┌────────────┘
                     │    │  db global in Sandbox
                     │    │  + REST API
              ┌──────▼────▼─┐      ┌──────────────┐
              │  REST API   │◄────►│    React     │
              │  (Express)  │      │  Dashboard   │
              └─────────────┘      └──────────────┘
```

Three event source layers feed the same internal bus: MQTT devices (bidirectional via Mosquitto), commercial devices (via the pluggable connector framework), and services (cron schedules, API triggers, system events). The automation engine evaluates rules against every event and dispatches actions back out. The device registry persists state to SQLite and pushes updates to the React dashboard over WebSocket.

### Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Express · TypeScript · SQLite (sql.js) · MQTT (mqtt.js) · WebSocket (ws) · isolated-vm · pino |
| Frontend | React 19 · Vite · Zustand · Tailwind CSS · Monaco Editor · Lucide · Framer Motion |
| Infra | Docker Compose · Eclipse Mosquitto 2 · Node.js 22 |

### Three Docker Services

| Service | Port | Description |
|---------|------|-------------|
| `aeolus-mosquitto` | 1883 | Eclipse Mosquitto MQTT broker |
| `aeolus-backend` | 3001 | Express.js API + automation engine + WebSocket |
| `aeolus-frontend` | 3000 | React + Vite dashboard (nginx) |


<details>
<summary>📡 API Endpoints (click to expand)</summary>

#### Devices
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | List all devices |
| GET | `/api/devices/:id` | Get single device |
| POST | `/api/devices/:id/action` | Execute action on device |
| GET | `/api/devices/:id/history` | Device state history (limit, from, to) |
| DELETE | `/api/devices/:id/history` | Clear history for a device |
| DELETE | `/api/devices/history/all` | Clear all device history |
| GET | `/api/state` | All devices keyed by ID |
| GET | `/api/health` | System health status |

#### Automations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/automations` | List automation rules (file, form, script) |
| POST | `/api/automations` | Create a UI automation rule |
| PUT | `/api/automations/:id` | Update an existing automation rule |
| DELETE | `/api/automations/:id` | Delete a UI automation rule |
| PATCH | `/api/automations/:id/toggle` | Enable/disable a rule |
| POST | `/api/automations/:id/fire` | Manually fire an automation |
| GET | `/api/automations/:id/state` | Get automation state key-value pairs |
| PUT | `/api/automations/:id/state` | Set automation state key-value pair |
| DELETE | `/api/automations/:id/state/:key` | Delete a state key |
| GET | `/api/automations/snippets` | Code snippet catalog |
| GET | `/api/automations/types` | Sandbox type definitions (for IntelliSense) |
| GET | `/api/automations/ui-types` | Custom UI component type definitions |
| GET | `/api/automations/history` | Execution log entries |
| GET | `/api/automations/:id/ui-module` | Compiled UI module (JavaScript) |

#### MQTT
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/mqtt/publish` | Publish MQTT message |

#### Connectors
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/connectors/available` | List discovered connector types |
| GET | `/api/connectors` | List enabled connector instances |
| POST | `/api/connectors` | Enable a connector |
| PATCH | `/api/connectors/:id` | Update connector config |
| DELETE | `/api/connectors/:id` | Disable a connector |
| GET | `/api/connectors/:id/status` | Connector health status |
| GET | `/api/connectors/:id/setup-steps` | Get setup wizard step descriptors |
| POST | `/api/connectors/:id/setup/:stepId` | Execute a setup wizard step |
| POST | `/api/connectors/:id/retry` | Retry connector connection |

#### Services
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/services/available` | List registered service types |
| GET | `/api/services` | List enabled service instances |
| POST | `/api/services` | Enable a service |
| PATCH | `/api/services/:id` | Update service config |
| DELETE | `/api/services/:id` | Disable a service |
| GET | `/api/services/:id/status` | Service health status |
| POST | `/api/services/:id/retry` | Retry a stopped service |
| POST | `/api/services/trigger/:name` | Fire an API trigger event |
| GET | `/api/services/topics` | List available service event topics |

#### Data Store
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/data-store/collections` | List all collections |
| POST | `/api/data-store/collections` | Create a collection |
| PATCH | `/api/data-store/collections/:name` | Update collection |
| DELETE | `/api/data-store/collections/:name` | Delete collection |
| POST | `/api/data-store/collections/:name/records` | Write a record |
| GET | `/api/data-store/collections/:name/records` | Query records |
| GET | `/api/data-store/collections/:name/export` | Export as CSV |
| GET | `/api/data-store/buckets` | List buckets |
| GET | `/api/data-store/buckets/:bucket` | List bucket entries |
| PUT | `/api/data-store/buckets/:bucket/:key` | Set a key |
| DELETE | `/api/data-store/buckets/:bucket/:key` | Delete a key |
| GET | `/api/data-store/config` | Get config |
| PUT | `/api/data-store/config` | Update config |
| GET | `/api/data-store/stats` | Storage statistics |
| POST | `/api/data-store/enable` | Enable Data Store |
| POST | `/api/data-store/disable` | Disable Data Store |

#### System & Layout
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/layout` | Get dashboard layout |
| PUT | `/api/layout` | Save dashboard layout |
| GET | `/api/system` | Host system diagnostics |
| GET | `/api/system/logs` | Application log entries |
| POST | `/api/system/update` | Trigger self-update + restart |
| POST | `/api/system/shutdown` | Gracefully shut down the host Pi |
| POST | `/api/system/reboot` | Gracefully reboot the host Pi |
| POST | `/api/system/docker-prune` | Clean up unused Aeolus Docker resources |
| WS | `/ws` | Real-time state updates |

</details>

---

## Environment Variables

All configuration is via environment variables. Defaults work out of the box with Docker Compose.

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | MQTT broker connection URL |
| `MQTT_TOPICS` | `#` | MQTT topic subscription pattern |
| `PORT` | `3001` | Backend API port |
| `DB_PATH` | `./data/aeolus.db` | SQLite database path |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `NODE_ENV` | `development` | Environment mode |
| `JWT_SECRET` | *(auto-generated)* | JWT signing key (auto-generated on first run if not set) |
| `METRICS_TOKEN` | *(unset)* | Bearer token for `/metrics` endpoint (optional — unset = open access) |

---

## Project Structure

<details>
<summary>Click to expand</summary>

```
aeolus/
├── src/                          # Backend (Express + TypeScript)
│   ├── api/                      # REST routes + middleware
│   ├── core/                     # Device registry, event bus, types
│   ├── mqtt/                     # MQTT connection + message handling
│   ├── automations/              # Automation engine, sandbox, transpiler, state store
│   ├── connectors/               # Pluggable connector framework
│   │   ├── hue/                  # Philips Hue connector
│   │   ├── kasa/                 # TP-Link Kasa connector
│   │   └── _template/            # Skeleton for new connectors
│   ├── services/                 # Pluggable service framework (cron, triggers, system)
│   ├── data-store/               # Persistent time-series + key-value storage
│   │   ├── data-store.ts         # DataStore class (write, query, buckets, retention)
│   │   ├── duration.ts           # Duration string parser (pure module)
│   │   └── __tests__/            # Property-based + unit tests
│   ├── websocket/                # WebSocket server
│   └── db/                       # SQLite setup + schema
├── frontend/                     # React + Vite dashboard
│   └── src/
│       ├── components/           # UI components + pane wrappers
│       │   └── panes/custom/     # Custom automation UI component types
│       ├── hooks/                # React hooks (useDynamicComponent for runtime UI loading)
│       ├── store/                # Zustand stores
│       ├── lib/                  # API client, WebSocket client, pane registry
│       └── types/                # Dashboard type definitions
├── automations/                  # User-defined automation rule files
├── scripts/                      # Pi setup + deploy scripts
├── docker-compose.yml
├── Dockerfile
└── docs/
    ├── COMPREHENSIVE_DOCUMENTATION.md
    ├── BRANDING.md
    └── ROADMAP.md
```

</details>

---

## Screenshots

> Screenshots coming soon — the sections below are placeholders for dashboard captures.

<!-- TODO: Replace these placeholders with actual screenshots -->

| Screenshot | Description |
|------------|-------------|
| <!-- ![Dashboard](docs/screenshots/dashboard.png) --> `dashboard.png` | Main dashboard with device grid and live sensor data |
| <!-- ![Automations](docs/screenshots/automations.png) --> `automations.png` | Automation editor with Monaco, flow diagram, and snippet picker |
| <!-- ![Custom UI](docs/screenshots/custom-ui.png) --> `custom-ui.png` | Custom React component rendering in an automation pane |
| <!-- ![MQTT Inspector](docs/screenshots/mqtt-inspector.png) --> `mqtt-inspector.png` | Real-time MQTT message feed with topic tree |
| <!-- ![Connectors](docs/screenshots/connectors.png) --> `connectors.png` | Connector management page with Hue pairing wizard |
| <!-- ![System](docs/screenshots/system.png) --> `system.png` | System diagnostics and log viewer |
| <!-- ![Mobile](docs/screenshots/mobile.png) --> `mobile.png` | Responsive mobile view (if applicable) |

> **Tip:** Save screenshots to `docs/screenshots/` and uncomment the image tags above.

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/COMPREHENSIVE_DOCUMENTATION.md`](docs/COMPREHENSIVE_DOCUMENTATION.md) | Full technical docs — architecture, data models, WebSocket protocol, every component explained |
| [`docs/MICROCONTROLLERS.md`](docs/MICROCONTROLLERS.md) | Microcontroller guide — ESP32/Arduino MQTT templates for sensors, actuators, and combined devices |
| [`docs/BRANDING.md`](docs/BRANDING.md) | Design system — colour palette, typography, component styles, motion guidelines |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Future plans — visual flow editor, energy analytics, BLE, LoRa, AI assistant, and more |
| [`src/connectors/README.md`](src/connectors/README.md) | Connector developer guide — build new integrations with a template and checklist |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution guide — setup, workflow, commit conventions, PR checklist |

---

## Roadmap Highlights

The full roadmap lives in [`docs/ROADMAP.md`](docs/ROADMAP.md). Some highlights:

- 🌍 **Cloudflare Tunnel** — secure HTTPS access without port forwarding
- 📡 **More connectors** — Zigbee, Z-Wave, Tasmota, Shelly, BLE, LoRa
- 📱 **Mobile app** — React Native companion for quick control and notifications
- 🤖 **Local AI assistant** — on-device LLM for natural language device control-
---

## Contributing

Contributions are welcome! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup instructions, commit conventions, and the PR checklist.

The connector framework is designed to be community-extensible — if you have a device ecosystem you'd like to integrate, the [`_template` connector](src/connectors/_template/) and [developer guide](src/connectors/README.md) will get you started.

---

## License

[MIT](LICENSE)
