# 🌬️ Aeolus — Technical Documentation

## Overview

Aeolus is a local-first, developer-centric IoT automation platform. It ingests MQTT messages from IoT devices, maintains a persistent device registry, evaluates code-driven automation rules, and exposes device state through a REST API, WebSocket real-time updates, and a React dashboard.

The system runs as three services: a Mosquitto MQTT broker (central event bus), an Express.js + TypeScript backend (core engine), and a React + Vite frontend (dashboard). All data stays local — no cloud dependency.

## Architecture

```
[ IoT Devices / Sensors ]
        ↓ MQTT publish
[ Mosquitto Broker :1883 ]
        ↓ subscribe
[ MQTT Ingestion Service ]
        ↓ normalized event
[ Internal EventEmitter Bus ]
        ↓                    ↓
[ Device Registry ]    [ Automation Engine ]
        ↓                    ↓
[ SQLite DB ]          [ Integration Manager → Hue Bridge ]
        ↓
[ WebSocket Server ] → [ React Dashboard ]
        ↑
[ REST API (Express) ]
```

## Tech Stack

### Backend
- **Runtime:** Node.js 20 + TypeScript (strict mode, ESM)
- **Framework:** Express.js
- **Database:** SQLite via sql.js (pure JavaScript, no native deps)
- **MQTT:** mqtt.js
- **WebSocket:** ws library
- **Logging:** pino with pino-pretty in development
- **Testing:** Vitest + fast-check (property-based testing)

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **State:** Zustand
- **Styling:** Tailwind CSS with Aeolus design tokens
- **Icons:** Lucide React
- **Animation:** Framer Motion

### Infrastructure
- **MQTT Broker:** Eclipse Mosquitto 2 (Docker)
- **Deployment:** Docker Compose (Mosquitto + backend + frontend)
- **Target:** Windows (development), Raspberry Pi (production)


## Project Structure

```
aeolus/
├── src/                              # Backend source
│   ├── api/
│   │   ├── routes/
│   │   │   ├── device.routes.ts      # GET /api/devices, POST action
│   │   │   ├── state.routes.ts       # GET /api/state
│   │   │   └── health.routes.ts      # GET /api/health
│   │   └── middleware/
│   │       ├── error-handler.ts      # AppError hierarchy + global handler
│   │       ├── request-logger.ts     # pino HTTP request logging
│   │       └── validators.ts         # Action payload validation
│   ├── core/
│   │   ├── device-registry.ts        # In-memory cache + SQLite persistence
│   │   ├── event-bus.ts              # Internal EventEmitter pub/sub
│   │   └── types.ts                  # All shared TypeScript interfaces
│   ├── mqtt/
│   │   ├── mqtt-service.ts           # Broker connection + message handling
│   │   ├── topic-parser.ts           # MQTT topic → device metadata
│   │   └── topic-parser.test.ts      # Unit tests
│   ├── automations/
│   │   ├── automation-engine.ts      # Rule evaluation engine
│   │   ├── dsl.ts                    # when/if/then builder
│   │   └── rule-registry.ts          # In-memory rule store
│   ├── integrations/
│   │   ├── integration.interface.ts  # Plugin contract
│   │   ├── integration-manager.ts    # Lifecycle management
│   │   └── hue/
│   │       └── hue-integration.ts    # Philips Hue bridge integration
│   ├── websocket/
│   │   └── ws-server.ts              # WebSocket server
│   ├── db/
│   │   └── database.ts              # sql.js setup + schema
│   ├── types/
│   │   └── sql.js.d.ts              # Type declarations for sql.js
│   ├── config.ts                     # Environment variable loading
│   ├── logger.ts                     # pino logger
│   └── index.ts                      # Entry point
├── frontend/                         # React + Vite dashboard
│   └── src/
│       ├── components/
│       │   ├── AeolusLogo.tsx        # Animated SVG logo
│       │   ├── Layout.tsx            # Sidebar + main content
│       │   ├── Sidebar.tsx           # Navigation + system status
│       │   ├── DeviceGrid.tsx        # Responsive device card grid
│       │   ├── DeviceCard.tsx        # Individual device with controls
│       │   ├── SensorPanel.tsx       # Live sensor data display
│       │   └── SystemHealth.tsx      # Health status display
│       ├── store/
│       │   └── device-store.ts       # Zustand device state
│       └── lib/
│           ├── api-client.ts         # REST API client
│           └── ws-client.ts          # WebSocket client
├── automations/                      # User-defined rule files
│   └── example.ts                    # Sample automation
├── mosquitto/
│   └── mosquitto.conf                # Broker configuration
├── docker-compose.yml
├── Dockerfile                        # Backend multi-stage build
└── frontend/Dockerfile               # Frontend build + nginx
```

## Core Components

### MQTT Ingestion Service (`src/mqtt/mqtt-service.ts`)

Connects to the Mosquitto broker, subscribes to configurable topic patterns, and normalizes incoming messages.

- Exponential backoff retry: `baseDelay * 2^(attempt-1)`, max 5 attempts
- Topic parsing: `{type}/{location}/{metric}` → device ID + type
- Payload handling: JSON objects, JSON primitives, plain numbers, plain strings
- Emits `device:state-change` events on the internal bus

### Device Registry (`src/core/device-registry.ts`)

In-memory device cache backed by SQLite for persistence across restarts.

- Upsert: creates new device on first message, updates state on subsequent
- Infers capabilities by device type (light → on/off + brightness, sensor → temperature, etc.)
- Emits `ws:state-change` events for WebSocket broadcast
- Serialize/deserialize round-trip for SQLite storage

### Automation Engine (`src/automations/automation-engine.ts`)

Evaluates code-driven rules against incoming device events.

- TypeScript DSL: `when(topic).if(condition).then(action)`
- MQTT wildcard matching (`#` multi-level, `+` single-level)
- Fault isolation: one rule throwing doesn't affect others
- Loads rule files from `automations/` directory on startup

### Integration Manager (`src/integrations/integration-manager.ts`)

Manages the lifecycle of device integrations (connect, discover, execute, dispose).

- Fault-tolerant: one integration failing doesn't block others
- Routes actions to the correct integration by device ID

### Philips Hue Integration (`src/integrations/hue/hue-integration.ts`)

Reference implementation of the Integration interface.

- Discovers lights via local Hue bridge API
- Supports toggle and brightness actions
- Requires pre-configured bridge IP and API key

## API Reference

### REST Endpoints

All endpoints return JSON.

**GET /api/devices**
Returns array of all devices.

**GET /api/devices/:id**
Returns single device. 404 if not found.

**POST /api/devices/:id/action**
Execute an action on a device.
```json
{ "type": "toggle", "params": {} }
```
Returns `{ "success": true, "deviceId": "..." }`. 400 if type missing, 404 if device not found.

**GET /api/state**
Returns all devices keyed by ID.

**GET /api/health**
```json
{
  "mqtt": "connected",
  "deviceCount": 3,
  "ruleCount": 1,
  "uptime": 120,
  "timestamp": "2026-03-30T13:44:04.000Z"
}
```

### WebSocket Protocol

Connect to `ws://localhost:3001/ws`

**Server → Client: Initial snapshot**
```json
{ "type": "snapshot", "data": { "sensor-kitchen-temp": { ... } } }
```

**Server → Client: State update**
```json
{ "type": "state-change", "data": { "deviceId": "sensor-kitchen-temp", "state": { "value": 22.5 }, "timestamp": 1711806244000 } }
```

## Data Models

### Device
```typescript
interface Device {
  id: string;           // e.g. "sensor-kitchen-temp"
  name: string;         // e.g. "Kitchen Temp"
  type: "light" | "sensor" | "switch" | "climate";
  capabilities: string[];
  state: Record<string, unknown>;
  integration: string;  // "mqtt" or "hue"
  lastSeen: number;     // Unix timestamp ms
}
```

### SQLite Schema
```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('light','sensor','switch','climate')),
  capabilities TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT '{}',
  integration TEXT NOT NULL DEFAULT 'mqtt',
  last_seen INTEGER NOT NULL
);
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| MQTT_BROKER_URL | mqtt://localhost:1883 | Mosquitto broker URL |
| MQTT_TOPICS | sensor/#,switch/#,motion/#,light/# | Comma-separated topic patterns (quote in .env) |
| PORT | 3001 | Backend API port |
| HUE_BRIDGE_IP | (empty) | Philips Hue bridge IP |
| HUE_API_KEY | (empty) | Hue bridge API key |
| DB_PATH | ./data/aeolus.db | SQLite database file path |
| LOG_LEVEL | debug | pino log level |
| NODE_ENV | development | Environment |

**Note:** MQTT_TOPICS must be quoted in `.env` files because `#` is treated as a comment character by dotenv.

## Docker Compose

Three services on a shared bridge network:

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| mosquitto | eclipse-mosquitto:2 | 1883 | MQTT broker with healthcheck |
| backend | Custom (Node.js) | 3001 | Express API + WebSocket |
| frontend | Custom (nginx) | 3000 | React dashboard |

Backend waits for Mosquitto healthcheck before starting. Named volumes persist broker data and SQLite database.

## Error Handling

| Component | Error | Handling |
|-----------|-------|----------|
| MQTT | Broker connection failure | Exponential backoff retry (max 5) |
| MQTT | Unparseable payload | Log warning, discard |
| Device Registry | Malformed JSON on load | Log warning, skip entry |
| Automation Engine | Rule file syntax error | Log error, skip file |
| Automation Engine | Rule action throws | Log error, continue with remaining rules |
| REST API | Device not found | 404 JSON error |
| REST API | Invalid action payload | 400 JSON error |
| Integration | connect() fails | Log error, skip integration |
| Hue | Bridge communication failure | Log error |

## Design Decisions

- **sql.js over better-sqlite3:** Pure JavaScript avoids native C++ build tools requirement, enabling cross-platform development (Windows → Raspberry Pi) without compilation issues.
- **EventEmitter over message queue:** Simple pub/sub is sufficient at MVP scale. No need for Redis/RabbitMQ for a local-first system.
- **Zustand over Redux:** Lightweight, minimal boilerplate, matches the "clarity over decoration" design principle.
- **Express over Fastify:** Broader ecosystem familiarity, easier WebSocket integration via ws library.

---

**Last Updated:** March 30, 2026
**Version:** 0.1.0
**Status:** MVP Development