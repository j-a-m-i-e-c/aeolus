# 🌬️ Aeolus

A local-first, developer-centric IoT automation platform. Aeolus unifies communication between microcontrollers, smart home devices, and external APIs through a clean, event-driven architecture.

> "All devices communicate through the wind."

## What It Does

- Ingests MQTT messages from IoT devices and sensors
- Maintains a persistent device registry with real-time state (SQLite)
- Executes automations using a TypeScript DSL (`when/if/then`) or the dashboard editor
- Exposes a REST API and WebSocket server for device control
- Provides a modular React dashboard with dynamic tabs, configurable panes, device monitoring, MQTT inspector, automation editor, and system diagnostics
- Pluggable connector framework — add new device integrations (Philips Hue, TP-Link Kasa, etc.) without modifying core code
- Application log viewer and one-click self-update from the System page
- Runs on Raspberry Pi with one-line Docker install and auto-start on boot
- Built-in device simulator for development without hardware

## Tech Stack

**Backend:** Express.js · TypeScript · SQLite (sql.js) · MQTT (mqtt.js) · WebSocket (ws) · pino

**Frontend:** React · Vite · Zustand · Tailwind CSS · Lucide icons · Framer Motion

**Infrastructure:** Docker Compose · Eclipse Mosquitto · Node.js 20

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for Mosquitto MQTT broker)

### 1. Clone and install

```bash
git clone https://github.com/j-a-m-i-e-c/aeolus.git
cd aeolus
npm install
cd frontend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
# Defaults work for local dev — edit if needed
```

### 3. Start with Docker Compose (recommended)

```bash
docker compose up
```

This starts Mosquitto (port 1883), the backend (port 3001), and the frontend (port 3000).

### 4. Or start services individually

```bash
# Start Mosquitto
docker run -d --name aeolus-mosquitto -p 1883:1883 \
  -v "$(pwd)/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf" \
  eclipse-mosquitto:2

# Start backend
npx tsx src/index.ts

# Start frontend
cd frontend && npm run dev
```

### 5. Open the dashboard

Visit http://localhost:3000

### 6. Test with MQTT messages

```bash
docker exec aeolus-mosquitto mosquitto_pub -t "sensor/kitchen/temp" -m "22.5"
docker exec aeolus-mosquitto mosquitto_pub -t "switch/bedroom" -m '{"on":true}'
docker exec aeolus-mosquitto mosquitto_pub -t "light/living-room" -m '{"on":true,"brightness":200}'
```

Or use the built-in simulator — toggle it from the sidebar or set `SIMULATOR=true` in `.env`.

## Dashboard

The dashboard uses a modular tab-and-pane layout. On a fresh install, the sidebar shows 4 pinned system tabs: Dashboard, Automations, Connectors, and System. No custom tabs or panes are created by default — users add their own via the sidebar and PanePicker. Layout is persisted to SQLite automatically.

**Dashboard** — Device grid grouped by room, sensor panel with sparkline charts, MQTT inspector with publish form, topic tree, event log, system health, and command palette (Ctrl+K).

**Automations** — Create automation rules with a when/if/then form editor, live DSL preview, enable/disable/delete rules, toggle visibility of code-based rules.

**Connectors** — Manage device integrations from the dashboard. View available connector types, enable/disable connectors with dynamic config forms, monitor health status (connected/degraded/disconnected), and run a generic setup wizard for connectors that require pairing (e.g. Hue bridge). The wizard fetches steps from the backend — no hardcoded flows in the frontend.

**System** — Host diagnostics including CPU load, temperature, memory, disk, and network interfaces. Collapsible application log viewer with level filtering and auto-refresh. One-click "Update & Restart" button for self-update via git pull + Docker rebuild.

**Custom Tabs** — Create your own tabs with a name and icon, then add any combination of panes: device grid, sensor panel, MQTT inspector, Hue light control (toggle, brightness slider, colour picker with 10 presets), Kasa device control (toggle, energy monitoring stats), automation rules, system stats, topic tree, event log, or connectors.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | List all devices |
| GET | `/api/devices/:id` | Get single device |
| POST | `/api/devices/:id/action` | Execute action on device |
| GET | `/api/state` | All devices keyed by ID |
| GET | `/api/health` | System health status |
| GET | `/api/automations` | List automation rules |
| POST | `/api/automations` | Create a UI automation rule |
| DELETE | `/api/automations/:id` | Delete a UI automation rule |
| PATCH | `/api/automations/:id/toggle` | Enable/disable a rule |
| POST | `/api/mqtt/publish` | Publish MQTT message |
| GET | `/api/simulator` | Simulator status |
| POST | `/api/simulator/start` | Start simulator |
| POST | `/api/simulator/stop` | Stop simulator |
| GET | `/api/connectors/available` | List discovered connector types |
| GET | `/api/connectors` | List enabled connector instances |
| POST | `/api/connectors` | Enable a connector |
| PATCH | `/api/connectors/:id` | Update connector config |
| DELETE | `/api/connectors/:id` | Disable a connector |
| GET | `/api/connectors/:id/status` | Connector health status |
| GET | `/api/connectors/:id/setup-steps` | Get setup step descriptors |
| POST | `/api/connectors/:id/setup/:stepId` | Execute setup wizard step |
| POST | `/api/connectors/:id/retry` | Retry connector connection |
| GET | `/api/layout` | Get dashboard layout |
| PUT | `/api/layout` | Save dashboard layout |
| GET | `/api/system` | Host system diagnostics |
| GET | `/api/system/logs` | Recent application log entries |
| POST | `/api/system/update` | Trigger self-update + restart |
| WS | `/ws` | Real-time state updates |

## Automation DSL

```typescript
import { when } from "./src/automations/dsl.js";

export default when("motion/living-room")
  .if((ctx) => {
    const hour = new Date(ctx.timestamp).getHours();
    return hour >= 20 || hour < 6;
  })
  .then((ctx) => {
    console.log("Motion detected at night — turning on light");
  }, "Night motion → light on");
```

Place rule files in the `automations/` directory. They're loaded automatically on startup. Rules can also be created from the Automations page in the dashboard.

## Connector Framework

Aeolus uses a pluggable connector architecture for device integrations. Built-in connectors include Philips Hue (smart lighting) and TP-Link Kasa (smart plugs/switches). Connectors are managed entirely from the Connectors page in the dashboard — enable, configure, monitor health, and run a generic setup wizard that fetches its steps from the backend. No hardcoded setup flows in the frontend.

### Adding a New Connector

1. Copy `src/connectors/_template/` to `src/connectors/your-connector/`
2. Implement the `Connector` interface and export `metadata`, `configSchema`, and `createConnector` from `index.ts`
3. Register in `src/index.ts` or let auto-discovery find it

See `src/connectors/README.md` for the full developer guide.

## Philips Hue Integration

Hue lights are managed through the Connectors page in the dashboard.

1. Go to the Connectors tab in the sidebar
2. Find "Philips Hue" in Available Connectors and click Enable
3. The setup wizard launches automatically — discover bridges and press the link button to pair
4. Once paired, Hue lights appear in the device grid and can be controlled via the Hue Control pane

## Raspberry Pi Deployment

### One-Line Install

SSH into your Pi and run:

```bash
curl -sSL https://raw.githubusercontent.com/j-a-m-i-e-c/aeolus/main/scripts/setup-pi.sh | bash
```

This installs Docker, clones Aeolus, builds the containers, and starts everything. Aeolus auto-starts on boot via Docker's `restart: unless-stopped` policy.

### Manual Setup

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
sudo systemctl enable docker

# Clone and configure
git clone https://github.com/j-a-m-i-e-c/aeolus.git
cd aeolus
cp .env.example .env

# Build and start
docker compose build
docker compose up -d
```

### Access the Dashboard

Open a browser on any device on the same network:

```
http://<pi-ip-address>:3000
```

### Management

```bash
docker compose logs -f        # View live logs
docker compose restart        # Restart all services
docker compose down           # Stop everything
docker compose up -d --build  # Rebuild after updates
```

Or use the "Update & Restart" button on the System page to pull the latest code and rebuild from the dashboard.

## Running Tests

```bash
npm test
```

## Documentation

See `docs/COMPREHENSIVE_DOCUMENTATION.md` for full technical documentation including architecture, data models, WebSocket protocol, error handling, and design decisions.

See `docs/ROADMAP.md` for the future development roadmap.

## License

MIT
