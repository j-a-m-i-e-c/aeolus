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

The built-in device simulator generates fake sensor data so you can explore aspects of the platform without any hardware.

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
| ⏱️ | **Services framework** | Cron schedules, API triggers, and system events as automation triggers |
| 🍓 | **Raspberry Pi ready** | One-line install, auto-start on boot, runs on a Pi 4/5 |
| 🧪 | **Built-in simulator** | Demo the full platform without any hardware |
| 🔒 | **100% local** | Everything stays on your network — no cloud dependency |

---

## Dashboard

The dashboard has two permanent tabs — **System** (device grid, health, diagnostics) and **Connectors** (manage integrations) — plus as many custom tabs as you want.

Custom tabs are where the real work happens. Each tab has two buttons in the header:

- **New Automation** — the primary action. Drops a fresh automation pane straight into setup mode with a Monaco editor, no extra clicks. Automations are the core of Aeolus so they get their own entry point.
- **Add Pane** — everything else. Opens a picker with device grids, MQTT inspectors, sensor panels, system stats, and more.

### Available panes

| Category | Panes |
|----------|-------|
| Controls | Device Grid · Hue Lights · Kasa Devices · Trigger Button |
| Automations | Automation (one-pane-one-rule) · Automation List |
| Monitoring | Sensor Panel · MQTT Inspector · Topic Tree · Event Log |
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
              ┌──────▼──────┐
              │  WebSocket  │
              │   Server    │
              └──────┬──────┘
                     │
              ┌──────▼──────┐      ┌──────────────┐
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

#### MQTT & Simulator
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/mqtt/publish` | Publish MQTT message |
| GET | `/api/simulator` | Simulator status |
| POST | `/api/simulator/start` | Start simulator |
| POST | `/api/simulator/stop` | Stop simulator |

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

#### System & Layout
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/layout` | Get dashboard layout |
| PUT | `/api/layout` | Save dashboard layout |
| GET | `/api/system` | Host system diagnostics |
| GET | `/api/system/logs` | Application log entries |
| POST | `/api/system/update` | Trigger self-update + restart |
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
| `SIMULATOR` | `false` | Start the device simulator on boot |

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
│   ├── simulator/                # Fake device data generator
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
| [`docs/BRANDING.md`](docs/BRANDING.md) | Design system — colour palette, typography, component styles, motion guidelines |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Future plans — visual flow editor, energy analytics, BLE, LoRa, AI assistant, and more |
| [`src/connectors/README.md`](src/connectors/README.md) | Connector developer guide — build new integrations with a template and checklist |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution guide — setup, workflow, commit conventions, PR checklist |

---

## Roadmap Highlights

The full roadmap lives in [`docs/ROADMAP.md`](docs/ROADMAP.md). Some highlights:

- 🔐 **Authentication** — user accounts, sessions, role-based access
- 🌍 **Cloudflare Tunnel** — secure HTTPS access without port forwarding
- 📊 **State history & charts** — trend charts for sensor data over time
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
