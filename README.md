# 🌬️ Aeolus

A local-first, developer-centric IoT automation platform. Aeolus unifies communication between microcontrollers, smart home devices, and external APIs through a clean, event-driven architecture.

> "All devices communicate through the wind."

## What It Does

- Ingests MQTT messages from IoT devices and sensors
- Maintains a persistent device registry with real-time state
- Executes code-driven automations using a TypeScript DSL (`when/if/then`)
- Exposes a REST API and WebSocket server for device control
- Provides a React dashboard for monitoring and control
- Integrates with Philips Hue lights via the local bridge API

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
# Edit .env if needed (defaults work for local dev)
```

### 3. Start Mosquitto broker

```bash
docker run -d --name aeolus-mosquitto -p 1883:1883 \
  -v "$(pwd)/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf" \
  eclipse-mosquitto:2
```

### 4. Start the backend

```bash
npx tsx src/index.ts
```

### 5. Start the frontend

```bash
cd frontend
npm run dev
```

### 6. Open the dashboard

Visit http://localhost:3000

### 7. Test with MQTT messages

```bash
# Publish a sensor reading
docker exec aeolus-mosquitto mosquitto_pub -t "sensor/kitchen/temp" -m "22.5"

# Publish a switch state
docker exec aeolus-mosquitto mosquitto_pub -t "switch/bedroom" -m '{"on":true}'

# Publish a light state
docker exec aeolus-mosquitto mosquitto_pub -t "light/living-room" -m '{"on":true,"brightness":200}'
```

Devices appear on the dashboard in real-time via WebSocket.

## Docker Compose (Full Stack)

```bash
docker-compose up
```

Starts Mosquitto (port 1883), backend (port 3001), and frontend (port 3000).

## Project Structure

```
aeolus/
├── src/                          # Backend
│   ├── api/routes/               # REST endpoints
│   ├── api/middleware/            # Error handling, logging, validation
│   ├── core/                     # Device registry, types, event bus
│   ├── mqtt/                     # MQTT connection and topic parsing
│   ├── automations/              # DSL and rule engine
│   ├── integrations/             # Plugin interface + Hue integration
│   ├── websocket/                # WebSocket server
│   ├── db/                       # SQLite database
│   └── index.ts                  # Entry point
├── frontend/                     # React + Vite dashboard
│   └── src/
│       ├── components/           # UI components
│       ├── store/                # Zustand state
│       └── lib/                  # API client, WebSocket client
├── automations/                  # User-defined automation rules
├── mosquitto/                    # Broker configuration
├── docker-compose.yml
└── docs/
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | List all devices |
| GET | `/api/devices/:id` | Get single device |
| POST | `/api/devices/:id/action` | Execute action on device |
| GET | `/api/state` | All devices keyed by ID |
| GET | `/api/health` | System health status |
| GET | `/api/automations` | List active automation rules |
| POST | `/api/mqtt/publish` | Publish MQTT message `{ topic, payload }` |
| GET | `/api/simulator` | Simulator running status |
| POST | `/api/simulator/start` | Start device simulator |
| POST | `/api/simulator/stop` | Stop device simulator |
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

Place rule files in the `automations/` directory. They're loaded automatically on startup.

## Philips Hue Integration

Set your bridge IP and API key in `.env`:

```bash
HUE_BRIDGE_IP=192.168.1.100
HUE_API_KEY=your-hue-api-key
```

Lights are discovered automatically and appear on the dashboard with toggle and brightness controls.

## Running Tests

```bash
npm test
```

## License

MIT