<p align="center">
  <img src="logo.png" alt="Aeolus" width="120" />
</p>

<h3 align="center">Local-first IoT automation for developers who'd rather write code than tap apps.</h3>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/MQTT-660066?logo=eclipsemosquitto&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/Raspberry_Pi-C51A4A?logo=raspberrypi&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-22C55E" />
</p>

---

## What is Aeolus?

Aeolus is a self-hosted IoT platform that talks to your devices over MQTT and lets you automate them with a TypeScript DSL. It ships with a modular React dashboard, pluggable connectors for Philips Hue and TP-Link Kasa, and runs on a Raspberry Pi with one command. No cloud, no subscriptions — just your LAN.

<!-- screenshot: dashboard -->

## Features

- 🌐 **MQTT-first** — ingest messages from any device that speaks MQTT
- ⚡ **TypeScript automations** — `when/if/then` DSL or visual editor in the dashboard
- 🎛️ **Modular dashboard** — drag-and-drop tabs & panes, MQTT inspector, topic tree, event log
- 💡 **Philips Hue** — toggle, brightness, colour picker with presets
- 🔌 **TP-Link Kasa** — smart plugs with energy monitoring
- 🧩 **Connector framework** — add new integrations without touching core code
- 🍓 **Raspberry Pi ready** — one-line install, auto-start on boot
- 🧪 **Built-in simulator** — demo the platform without any hardware
- 🔒 **Local-first** — everything stays on your network

<!-- screenshot: automations -->

## Quick Start

```bash
git clone https://github.com/j-a-m-i-e-c/aeolus.git
cd aeolus
docker compose up
```

Open **http://localhost:3000** — that's it. No `npm install`, no `.env` setup. Defaults just work.

<!-- screenshot: quick-start -->

## Raspberry Pi

```bash
curl -sSL https://raw.githubusercontent.com/j-a-m-i-e-c/aeolus/main/scripts/setup-pi.sh | bash
```

Installs Docker, clones Aeolus, builds containers, starts everything. Auto-starts on boot.

## Dashboard

See the dashboard in action — create custom tabs, add panes, control devices, inspect MQTT traffic, and manage automations all from one place.

<!-- screenshot: device-grid -->
<!-- screenshot: mqtt-inspector -->
<!-- screenshot: connectors -->

## Automation DSL

```typescript
import { when } from "./src/automations/dsl.js";

export default when("sensor/+/light")
  .if((ctx) => {
    const lux = ctx.state.value as number;
    const hour = new Date(ctx.timestamp).getHours();
    return typeof lux === "number" && lux < 200 && hour >= 16 && hour < 23;
  })
  .then((ctx) => {
    console.log(`[Evening Mode] Low light: ${ctx.state.value} lux — activating evening mode`);
  }, "Smart Evening Mode");
```

Drop `.ts` files in `automations/` — they're loaded on startup. Or create rules from the dashboard editor.

## Architecture

| Layer | Tech |
|-------|------|
| Backend | Express · TypeScript · SQLite (sql.js) · MQTT (mqtt.js) · WebSocket (ws) · pino |
| Frontend | React · Vite · Zustand · Tailwind CSS · Lucide · Framer Motion |
| Infra | Docker Compose · Eclipse Mosquitto · Node.js 20 |


<details>
<summary>📡 API Endpoints</summary>

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
| POST | `/api/connectors/:id/retry` | Retry connector connection |
| GET | `/api/layout` | Get dashboard layout |
| PUT | `/api/layout` | Save dashboard layout |
| GET | `/api/system` | Host system diagnostics |
| GET | `/api/system/logs` | Application log entries |
| POST | `/api/system/update` | Trigger self-update + restart |
| WS | `/ws` | Real-time state updates |

</details>

## Documentation

Full technical docs — architecture, data models, WebSocket protocol, connector development guide — live in [`docs/COMPREHENSIVE_DOCUMENTATION.md`](docs/COMPREHENSIVE_DOCUMENTATION.md).

Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## License

MIT
