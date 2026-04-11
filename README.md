# 🌬️ Aeolus

A local-first, developer-centric IoT automation platform. Aeolus unifies communication between microcontrollers, smart home devices, and external APIs through a clean, event-driven architecture.

> "All devices communicate through the wind."

## What It Does

- Ingests MQTT messages from IoT devices and sensors
- Maintains a persistent device registry with real-time state (SQLite)
- Executes automations using a TypeScript DSL (`when/if/then`) or the dashboard editor
- Exposes a REST API and WebSocket server for device control
- Provides a React dashboard with device monitoring, MQTT inspector, automation editor, and system diagnostics
- Integrates with Philips Hue lights — self-service bridge pairing from the dashboard
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

The dashboard has four pages accessible from the sidebar:

**Dashboard** — Device grid grouped by room, sensor panel with sparkline charts, MQTT inspector with publish form, topic tree, event log, system health, and command palette (Ctrl+K).

**Lighting** — Philips Hue bridge setup wizard, light grid with toggle/brightness/colour controls, bridge info card with firmware status, add/delete/reorder lights.

**Automations** — Create automation rules with a when/if/then form editor, live DSL preview, enable/disable/delete rules, toggle visibility of code-based rules.

**System** — Host diagnostics including CPU load, temperature, memory, disk, and network interfaces. Designed for Raspberry Pi monitoring.

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
| GET | `/api/hue/status` | Hue bridge config status |
| GET | `/api/hue/bridge` | Bridge firmware and info |
| GET | `/api/hue/discover` | Discover bridges on network |
| POST | `/api/hue/pair` | Pair with a bridge |
| GET | `/api/hue/lights` | List all Hue lights |
| POST | `/api/hue/lights/search` | Scan for new Zigbee lights |
| GET | `/api/hue/lights/new` | Get newly found lights |
| POST | `/api/hue/lights/:id/state` | Control a light |
| DELETE | `/api/hue/lights/:id` | Remove a light |
| DELETE | `/api/hue/unpair` | Disconnect bridge |
| GET | `/api/system` | Host system diagnostics |
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

## Philips Hue Integration

Connect your Hue bridge directly from the dashboard — no config files needed.

1. Go to the Lighting tab in the sidebar
2. Click Discover Bridges (or enter the bridge IP manually)
3. Press the physical button on your Hue bridge
4. Click Pair

Lights appear with toggle, brightness slider, and colour picker (for colour-capable bulbs). Bridge firmware version and update status are shown in an info card. You can add new lights via Zigbee scan, delete lights, and drag to reorder.

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

## Running Tests

```bash
npm test
```

## Documentation

See `docs/COMPREHENSIVE_DOCUMENTATION.md` for full technical documentation including architecture, data models, WebSocket protocol, error handling, and design decisions.

## License

MIT
