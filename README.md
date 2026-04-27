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

Aeolus is a self-hosted IoT platform that talks to your devices over MQTT and lets you automate them with TypeScript. Write automation scripts in a Monaco editor with IntelliSense, build custom React dashboard components, and control Philips Hue and TP-Link Kasa devices — all running on a Raspberry Pi with one command. No cloud, no subscriptions — just your LAN.

<!-- screenshot: dashboard -->

## Features

- 🌐 **MQTT-first** — ingest messages from any device that speaks MQTT
- ⚡ **TypeScript automations** — write scripts in a Monaco editor with IntelliSense, flow diagrams, and code snippets
- 🎨 **Custom UI components** — write React/TSX dashboard widgets for your automations
- 🎛️ **Modular dashboard** — create custom tabs with drag-and-drop panes (MQTT inspector, device controls, automations, system stats)
- 💡 **Philips Hue** — toggle, brightness, colour picker with presets
- 🔌 **TP-Link Kasa** — smart plugs with energy monitoring
- 🧩 **Connector framework** — add new integrations without touching core code
- 🔗 **Automation state store** — per-rule key-value store for backend↔frontend communication via WebSocket
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

Two pinned tabs — **System** (devices, health, diagnostics) and **Connectors** (manage integrations). Create custom tabs for your dashboards — add automation panes, MQTT inspectors, device controls, and more.

<!-- screenshot: device-grid -->
<!-- screenshot: mqtt-inspector -->
<!-- screenshot: connectors -->

## Automations

Each automation has two tabs: **Logic** (TypeScript that runs on the backend) and **UI** (React/TSX that renders in the dashboard).

### Logic Tab — `automation()` helper

```typescript
// Runs in a secure V8 sandbox with access to devices, mqtt, http, state, and more
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

Named functions become labeled nodes in the flow diagram. The `state` global lets you share computed values with the UI tab.

### UI Tab — Custom React Components

```tsx
// Renders in the automation pane's status mode after a frontend rebuild
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

Write TSX in the UI tab, save, click "Rebuild Frontend", and your component renders live in the dashboard pane.

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
| POST | `/api/system/rebuild-frontend` | Rebuild frontend (for custom UI components) |
| GET | `/api/system/rebuild-status` | Frontend rebuild status (idle/rebuilding/ready) |
| GET | `/api/automations/:id/state` | Get automation state key-value pairs |
| PUT | `/api/automations/:id/state` | Set automation state key-value pair |
| GET | `/api/automations/snippets` | Code snippet catalog |
| GET | `/api/automations/ui-types` | Custom UI component type definitions |
| POST | `/api/automations/:id/fire` | Manually fire an automation |
| WS | `/ws` | Real-time state updates |

</details>

## Documentation

Full technical docs — architecture, data models, WebSocket protocol, connector development guide — live in [`docs/COMPREHENSIVE_DOCUMENTATION.md`](docs/COMPREHENSIVE_DOCUMENTATION.md).

Roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## License

MIT
