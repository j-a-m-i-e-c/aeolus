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
[ SQLite DB ]          [ Connector Framework → Hue / Kasa / ... ]
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
│   │   │   ├── health.routes.ts      # GET /api/health
│   │   │   ├── mqtt.routes.ts        # POST /api/mqtt/publish
│   │   │   ├── automation.routes.ts  # CRUD for UI-created automation rules
│   │   │   ├── simulator.routes.ts   # Start/stop device simulator
│   │   │   ├── connector.routes.ts   # Generic connector REST API (replaces hue.routes.ts)
│   │   │   ├── layout.routes.ts      # GET/PUT /api/layout (tab + pane persistence)
│   │   │   └── system.routes.ts      # Host diagnostics, application logs, self-update
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
│   ├── connectors/                   # Pluggable connector framework
│   │   ├── connector.interface.ts    # Core interfaces (Connector, ConnectorMetadata, etc.)
│   │   ├── connector-registry.ts     # Auto-discovery + manual registration of connector modules
│   │   ├── connector-manager.ts      # Lifecycle management (enable/disable/poll/action routing)
│   │   ├── connector-store.ts        # SQLite persistence for connector records
│   │   ├── migrate-legacy-hue.ts     # One-time migration of legacy hue-credentials.json
│   │   ├── hue/                      # Philips Hue connector
│   │   │   ├── index.ts             # Module exports (metadata, configSchema, createConnector)
│   │   │   └── hue-connector.ts     # Connector implementation
│   │   ├── kasa/                     # TP-Link Kasa connector
│   │   │   ├── index.ts             # Module exports (metadata, configSchema, createConnector)
│   │   │   └── kasa-connector.ts    # Connector implementation
│   │   ├── _template/                # Skeleton connector for developers
│   │   │   ├── index.ts             # Template module exports
│   │   │   └── connector.ts         # Template connector class
│   │   └── README.md                 # Developer guide for creating new connectors
│   ├── simulator/
│   │   └── device-simulator.ts       # Fake device data generator (7 devices)
│   ├── services/                     # External API integrations (weather, river height, etc.)
│   │   └── README.md                 # Developer guide for creating services
│   ├── websocket/
│   │   └── ws-server.ts              # WebSocket server
│   ├── db/
│   │   └── database.ts              # sql.js setup + schema (devices, automation_rules, tabs, panes, connectors)
│   ├── types/
│   │   └── sql.js.d.ts              # Type declarations for sql.js
│   ├── config.ts                     # Environment variable loading
│   ├── log-buffer.ts                 # In-memory circular buffer for recent log entries
│   ├── logger.ts                     # pino logger with log buffer interception
│   └── index.ts                      # Entry point
├── frontend/                         # React + Vite dashboard
│   └── src/
│       ├── components/
│       │   ├── AeolusLogo.tsx        # Animated SVG logo
│       │   ├── Layout.tsx            # Sidebar + main content
│       │   ├── Sidebar.tsx           # Dynamic tab navigation + system status + simulator toggle
│       │   ├── TabLayout.tsx         # Renders panes for the active tab (custom tabs only)
│       │   ├── PanePicker.tsx        # Pane type selector for adding panes to a tab
│       │   ├── PaneConfigPanel.tsx   # Per-pane configuration editor
│       │   ├── DeviceGrid.tsx        # Responsive device card grid
│       │   ├── DeviceCard.tsx        # Individual device with controls
│       │   ├── DeviceDetail.tsx      # Device detail modal with full state view
│       │   ├── SensorPanel.tsx       # Live sensor data display
│       │   ├── Sparkline.tsx         # SVG sparkline chart component
│       │   ├── SystemHealth.tsx      # Health status display
│       │   ├── MqttInspector.tsx     # Real-time MQTT message feed + publish form
│       │   ├── TopicTree.tsx         # Hierarchical MQTT topic tree
│       │   ├── EventLog.tsx          # Automation fire event log
│       │   ├── AutomationsPanel.tsx  # Dashboard automations summary
│       │   ├── AutomationsPage.tsx   # Full automation rule editor (CRUD)
│       │   ├── ConnectorsPage.tsx    # Connector management (enable/disable, config, generic setup wizard)
│       │   ├── SystemPage.tsx        # Host diagnostics, application log viewer, self-update
│       │   ├── CommandPalette.tsx    # Ctrl+K command palette
│       │   ├── ToastContainer.tsx    # Animated toast notifications
│       │   └── panes/               # Pane wrapper components for modular dashboard
│       │       ├── DeviceGridPane.tsx
│       │       ├── SensorPanelPane.tsx
│       │       ├── MqttInspectorPane.tsx
│       │       ├── HueControlPane.tsx    # Hue light control pane
│       │       ├── KasaControlPane.tsx   # Kasa device control pane
│       │       ├── AutomationRulesPane.tsx
│       │       ├── SystemStatsPane.tsx
│       │       ├── TopicTreePane.tsx
│       │       ├── EventLogPane.tsx
│       │       └── ConnectorsPane.tsx
│       ├── store/
│       │   ├── device-store.ts       # Zustand device state + WebSocket sync
│       │   └── dashboard-store.ts    # Zustand dashboard layout state (tabs, panes, persistence)
│       ├── lib/
│       │   ├── api-client.ts         # REST API client (dynamic hostname)
│       │   ├── ws-client.ts          # WebSocket client with auto-reconnect
│       │   └── pane-registry.ts      # Maps pane type identifiers to React components + metadata
│       └── types/
│           └── dashboard.ts          # Tab, Pane, PaneConfig, LayoutPayload interfaces + defaults
├── automations/                      # User-defined rule files
│   └── example.ts                    # Sample automation
├── mosquitto/
│   └── mosquitto.conf                # Broker configuration
├── scripts/
│   ├── setup-pi.sh                   # One-line Raspberry Pi install script
│   └── deploy-pi.sh                  # Pull + rebuild deploy script
├── docker-compose.yml
├── Dockerfile                        # Backend multi-stage build (includes git + docker-cli)
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
- Infers capabilities by device type (light → on/off + brightness, sensor → temperature, plug → on/off + energy, etc.)
- Emits `ws:state-change` events for WebSocket broadcast
- Serialize/deserialize round-trip for SQLite storage

### Automation Engine (`src/automations/automation-engine.ts`)

Evaluates code-driven rules against incoming device events.

- TypeScript DSL: `when(topic).if(condition).then(action)`
- MQTT wildcard matching (`#` multi-level, `+` single-level)
- Fault isolation: one rule throwing doesn't affect others
- Loads rule files from `automations/` directory on startup

### Log Buffer (`src/log-buffer.ts`)

In-memory circular buffer that captures recent application log entries for the dashboard log viewer.

- Stores up to 200 log entries in a ring buffer
- Intercepts pino JSON output via a write hook in `logger.ts`
- Parses pino JSON lines and normalises level labels (trace/debug/info/warn/error/fatal)
- Strips pino internals (pid, hostname) for cleaner UI display
- Served via `GET /api/system/logs` with optional count and level filter parameters

### Connector Framework

The connector framework is a pluggable architecture that replaces the previous hardcoded integration system. Each connector is a self-contained module in `src/connectors/{name}/` that exports metadata, a config schema, and a factory function.

Connector devices flow through the same `DEVICE_STATE_CHANGE` event bus as MQTT devices, using synthetic topics in the format `connector/{integration}/{deviceId}`. This unifies the device pipeline so automations can match on connector device events using the standard topic pattern system.

#### ConnectorRegistry (`src/connectors/connector-registry.ts`)

Auto-discovery and manual registration of connector modules.

- Manual registration via `register(module)` for bundled builds
- Filesystem auto-discovery via `discoverFromDirectory(dir)` for development
- Validates module shape: must export `metadata`, `configSchema`, and `createConnector`
- Skips `_template` directory and files starting with `connector`

#### ConnectorManager (`src/connectors/connector-manager.ts`)

Lifecycle management for enabled connector instances.

- Enable: validate type → instantiate via factory → connect → discover devices → persist → start polling
- Disable: stop polling → disconnect → dispose → remove devices → update store
- Config update: apply new config at runtime without full reconnect
- Retry: re-attempt connection for disconnected connectors
- Setup steps: `getSetupSteps(instanceId)` returns setup step descriptors for a connector; `executeSetupStep()` delegates multi-step setup flows (e.g. Hue button-press pairing)
- Action routing: route device actions to the correct connector by `integration` field
- Restore: re-enable previously enabled connectors from SQLite on startup
- Periodic device discovery via 60-second polling interval

#### ConnectorStore (`src/connectors/connector-store.ts`)

SQLite persistence layer for connector records.

- CRUD operations on the `connectors` table
- Save/update, disable (preserves config), delete
- Load all or only enabled records
- JSON serialization for config column
- Flushes to disk via `persistDatabase()` after every write

#### Hue Connector (`src/connectors/hue/`)

Philips Hue smart lighting via local bridge API.

- Metadata: id `"hue"`, icon `"lightbulb"`, supports `["light"]`, requires setup
- Config schema: `bridgeIp` (text, optional), `apiKey` (password, optional) — both are populated by the setup wizard during pairing
- Multi-step setup: bridge discovery + button-press pairing
- Connectors with `requiresSetup` skip the config form and go straight to enable + wizard
- Discovers lights and maps them to Aeolus Device format
- Supports toggle, brightness, hue, and saturation actions

#### Kasa Connector (`src/connectors/kasa/`)

TP-Link Kasa smart plugs and switches via local Wi-Fi.

- Metadata: id `"kasa"`, icon `"plug"`, supports `["plug", "light", "switch"]`, no setup required
- Config schema: `broadcastAddress` (text, optional, default `"255.255.255.255"`), `discoveryTimeout` (number, optional, default `10000`)
- Auto-discovers devices via UDP broadcast
- Supports toggle and energy monitoring actions

#### Legacy Migration (`src/connectors/migrate-legacy-hue.ts`)

One-time migration of legacy `hue-credentials.json` into the ConnectorStore.

- Checks for `hue-credentials.json` in the data directory
- Imports `bridgeIp` and `apiKey` as an enabled Hue connector record
- Renames the file to `.migrated` to prevent re-import


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

### Connector API

**GET /api/connectors/available**
List all discovered connector types with metadata and config schemas.

**GET /api/connectors**
List enabled connector instances with health status. Password fields are redacted in responses.

**POST /api/connectors**
Enable a new connector instance.
```json
{ "connector_type": "hue", "config": { "bridgeIp": "192.168.1.100", "apiKey": "..." } }
```
Returns `{ "success": true, "id": "<uuid>" }`. 404 if connector type not found, 400 if required config fields missing.

**PATCH /api/connectors/:id**
Update connector configuration.
```json
{ "config": { "bridgeIp": "192.168.1.101" } }
```
Returns `{ "success": true }`.

**DELETE /api/connectors/:id**
Disable a connector instance (stops polling, disconnects, removes devices, preserves config in store).
Returns `{ "success": true }`.

**GET /api/connectors/:id/status**
Get connector health status, device count, and configuration for a specific instance.

**GET /api/connectors/:id/setup-steps**
Returns the setup step descriptors for a connector instance. Each step includes an `id`, `title`, `description`, and optional `fields` array. Returns `[]` if the connector does not implement setup steps. 404 if instance not found.

**POST /api/connectors/:id/setup/:stepId**
Execute a setup step in the connector's guided wizard (e.g. bridge discovery, button-press pairing).
Returns `{ "success": true, "message": "...", "data": {...}, "complete": false }`.

**POST /api/connectors/:id/retry**
Retry connection for a disconnected connector, then re-discover devices.
Returns `{ "success": true }`.

### System API

**GET /api/system**
Returns host system diagnostics: hostname, platform, architecture, Node.js version, CPU model/cores/temperature/load averages, memory usage, disk usage, network interfaces, and uptime.

**GET /api/system/logs**
Returns recent application log entries from the in-memory circular buffer.
Query parameters:
- `count` (optional, default 100, max 200) — number of entries to return
- `level` (optional) — filter by level label (`error`, `warn`, `info`, `debug`)

Returns an array of log entry objects with `level`, `levelLabel`, `msg`, `time`, and any additional context fields.

**POST /api/system/update**
Triggers a self-update: runs `git pull` followed by `docker compose up -d --build` in the mounted project directory. The process is fire-and-forget — the response is returned immediately and the container is replaced during rebuild.
Returns `{ "success": true, "message": "Update started — the system will restart shortly" }`.
Returns 400 if the project directory is not mounted (only works on deployed Pi).

### Layout API

**GET /api/layout**
Returns the saved dashboard layout.
```json
{ "tabs": [...], "panes": [...] }
```
Returns empty arrays if no layout is saved.

**PUT /api/layout**
Atomically replace the entire dashboard layout (tabs + panes).
```json
{ "tabs": [...], "panes": [...] }
```
Returns `{ "success": true }`. 400 if tabs or panes are not arrays.

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

**Server → Client: Raw MQTT message (for inspector)**
```json
{ "type": "mqtt-message", "data": { "topic": "sensor/kitchen/temp", "payload": "22.5", "timestamp": 1711806244000 } }
```

**Server → Client: Automation fired**
```json
{ "type": "automation-fired", "data": { "ruleId": "...", "ruleName": "Night motion → light on", "topic": "motion/living-room", "deviceId": "motion-living-room", "timestamp": 1711806244000 } }
```

## Data Models

### Device
```typescript
type DeviceType = "light" | "sensor" | "switch" | "climate" | "plug";

interface Device {
  id: string;           // e.g. "sensor-kitchen-temp"
  name: string;         // e.g. "Kitchen Temp"
  type: DeviceType;
  capabilities: string[];
  state: Record<string, unknown>;
  integration: string;  // "mqtt", "hue", "kasa", etc.
  lastSeen: number;     // Unix timestamp ms
}
```

### NormalizedEvent
```typescript
interface NormalizedEvent {
  deviceId: string;
  deviceType: DeviceType;
  state: Record<string, unknown>;
  topic: string;
  timestamp: number;
  /** Source integration identifier. Defaults to "mqtt" if not provided. */
  integration?: string;
}
```

### ConnectorRecord
```typescript
interface ConnectorRecord {
  id: string;              // UUID — primary key in connectors table
  connectorType: string;   // e.g. "hue", "kasa"
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: number;       // Unix timestamp ms
  updatedAt: number;       // Unix timestamp ms
}
```

### Tab
```typescript
interface Tab {
  id: string;          // UUID
  name: string;        // User-provided
  icon: string;        // Lucide icon name
  order: number;       // Display order (0-based)
  pinned: boolean;     // Pinned tabs cannot be deleted or reordered
  createdAt: number;   // Unix timestamp ms
}
```

### Pane
```typescript
interface Pane {
  id: string;          // UUID
  tabId: string;       // Foreign key → Tab.id
  paneType: string;    // Key into pane registry (e.g. "device-grid", "connectors-page")
  config: PaneConfig;  // Type-specific filter/display config
  x: number;           // Grid column position (0-based)
  y: number;           // Grid row position (0-based)
  w: number;           // Width in grid columns (1-12)
  h: number;           // Height in grid rows (min 2)
  createdAt: number;   // Unix timestamp ms
}
```

### LogEntry
```typescript
interface LogEntry {
  level: number;       // pino numeric level (10-60)
  levelLabel: string;  // "trace" | "debug" | "info" | "warn" | "error" | "fatal"
  msg: string;         // Log message
  time: string;        // ISO 8601 timestamp
  [key: string]: unknown; // Additional context fields
}
```

### SQLite Schema
```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('light','sensor','switch','climate','plug')),
  capabilities TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT '{}',
  integration TEXT NOT NULL DEFAULT 'mqtt',
  last_seen INTEGER NOT NULL
);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_topic TEXT NOT NULL,
  condition_type TEXT,
  condition_value TEXT,
  action_type TEXT NOT NULL,
  action_target TEXT,
  action_params TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'layout',
  "order" INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE panes (
  id TEXT PRIMARY KEY,
  tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
  pane_type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL DEFAULT 6,
  h INTEGER NOT NULL DEFAULT 4,
  created_at INTEGER NOT NULL
);

CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  connector_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| MQTT_BROKER_URL | mqtt://localhost:1883 | Mosquitto broker URL |
| MQTT_TOPICS | sensor/#,switch/#,motion/#,light/# | Comma-separated topic patterns (quote in .env) |
| PORT | 3001 | Backend API port |
| DB_PATH | ./data/aeolus.db | SQLite database file path |
| LOG_LEVEL | debug | pino log level |
| NODE_ENV | development | Environment |
| SIMULATOR | false | Enable device simulator (generates fake data without MQTT) |
| AEOLUS_PROJECT_DIR | /aeolus-host | Host project directory mounted into the backend container (used by self-update) |

**Note:** MQTT_TOPICS must be quoted in `.env` files because `#` is treated as a comment character by dotenv.

## Docker Compose

Three services:

| Service | Image | Port | Network | Description |
|---------|-------|------|---------|-------------|
| mosquitto | eclipse-mosquitto:2 | 1883 | aeolus bridge | MQTT broker with healthcheck |
| backend | Custom (Node.js) | 3001 | host | Express API + WebSocket |
| frontend | Custom (nginx) | 3000 | aeolus bridge | React dashboard |

The backend uses `network_mode: host` to enable UDP broadcast for Kasa device discovery and direct LAN access for Hue bridge communication. Because of host networking, the MQTT broker URL is `mqtt://localhost:1883` (not the Docker service name).

Backend waits for Mosquitto healthcheck before starting. Named volumes persist broker data and SQLite database.

Backend container mounts:
- `backend_data:/app/data` — SQLite database persistence
- `/var/run/docker.sock:/var/run/docker.sock` — Docker socket for self-update rebuild
- `.:/aeolus-host` — Project directory for `git pull` during self-update

The Dockerfile installs `git`, `docker-cli`, and `docker-cli-compose` in the production stage to support the self-update feature.

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
| Connector | connect() fails | Log error, set health to disconnected, keep instance |
| Connector | discoverDevices() fails | Log error, continue with empty device set |
| Connector | Module missing required exports | Log warning with missing export names, skip module |
| Connector | Malformed JSON in config column | Log warning, skip record during load |
| Connector | Unknown connector type on restore | Log warning, skip record |
| Connector | Setup step fails | Return error message to dashboard wizard |
| Connector | Legacy migration file unreadable | Log warning, skip migration |
| Layout | Invalid layout payload | 400 JSON error |
| Layout | Database write failure | Rollback transaction, return 500 |
| Log Viewer | Unparseable log line | Silently ignored by log buffer |
| Log Viewer | Fetch failure | Frontend shows empty log list, retries on next auto-refresh cycle |
| Self-Update | Project directory not mounted | 400 JSON error with explanation |
| Self-Update | git pull or docker compose fails | Fire-and-forget — container may restart or remain on current version |

## Design Decisions

- **sql.js over better-sqlite3:** Pure JavaScript avoids native C++ build tools requirement, enabling cross-platform development (Windows → Raspberry Pi) without compilation issues.
- **EventEmitter over message queue:** Simple pub/sub is sufficient at MVP scale. No need for Redis/RabbitMQ for a local-first system.
- **Zustand over Redux:** Lightweight, minimal boilerplate, matches the "clarity over decoration" design principle.
- **Express over Fastify:** Broader ecosystem familiarity, easier WebSocket integration via ws library.
- **Pluggable connector architecture over hardcoded integrations:** Each connector is a self-contained module with metadata, config schema, and factory function. The ConnectorRegistry discovers modules at startup, the ConnectorManager handles lifecycle (enable/disable/poll/action routing), and the ConnectorStore persists state to SQLite. This replaces the previous `src/integrations/` approach where each integration required its own route file and manual wiring. New connectors can be added by creating a directory in `src/connectors/` with the standard module exports — no changes to core code required. A `_template/` skeleton is provided for developers.
- **Host networking for LAN device discovery:** The backend container uses `network_mode: host` instead of the shared bridge network. This is required for Kasa's UDP broadcast discovery (which doesn't work across Docker bridge networks) and for direct LAN access to Hue bridges. The trade-off is that the backend port is exposed directly on the host rather than through Docker port mapping, and the MQTT broker URL must use `localhost` instead of the Docker service name.
- **Pinned tabs render dedicated components:** Pinned system tabs (Dashboard, Automations, Connectors, System) render their own full-page components directly via a `PINNED_PAGES` map in `App.tsx`, bypassing the modular pane grid. This gives each system page full control over its layout and styling. Custom (unpinned) tabs use the `TabLayout` component with the pane grid system. This separation keeps system pages polished while maintaining flexibility for user-created tabs.


## Dashboard Features

The React dashboard provides a comprehensive developer-focused interface with a modular tab-and-pane layout. The sidebar displays dynamic tabs — 4 pinned system tabs (Dashboard, Automations, Connectors, System) plus user-created custom tabs. Pinned tabs render dedicated full-page components; custom tabs use the modular pane grid. On a fresh install, only the 4 pinned tabs are present with no custom tabs or panes.

### Sidebar
- **Pinned System Tabs** — Dashboard, Automations, Connectors, System (cannot be deleted or reordered)
- **Custom Tabs** — User-created tabs with custom names and Lucide icons
- **Add Tab** — Inline form with name input and icon picker (16 icon choices)
- **Rename** — Double-click a custom tab to rename inline
- **Drag-to-Reorder** — Rearrange custom tabs via HTML5 drag-and-drop
- **Delete** — Remove custom tabs with confirmation (cascades to panes)
- **Simulator Toggle** — Start/stop device simulator without restarting backend
- **System Status** — MQTT connection and WebSocket status indicators

### Modular Pane System
- **Pane Registry** — Maps pane type identifiers to React components with metadata (display name, icon, default size)
- **Available Pane Types:** device-grid, sensor-panel, mqtt-inspector, hue-control, kasa-control, automation-rules, system-stats, topic-tree, event-log, connectors-page
- **PanePicker** — UI for selecting which pane type to add to the active tab
- **PaneConfigPanel** — Per-pane configuration editor for type-specific settings
- **TabLayout** — Renders all panes for the active tab (custom tabs only)
- **Layout Persistence** — Dashboard layout (tabs + panes) is persisted to SQLite via `GET/PUT /api/layout`, with debounced auto-save (2s)

### Dashboard Tab (pinned)
- **Device Grid** — Cards grouped by room (parsed from MQTT topic), collapsible sections, click to open detail modal
- **Device Detail Modal** — Full state view, capabilities, toggle/brightness controls, last seen timestamp
- **Sensor Panel** — Live sensor values with sparkline SVG charts showing last 20 readings
- **System Health** — MQTT connection status, device count, rule count, uptime (polls every 30s)
- **Automations Panel** — Lists active rules with topic, name, and conditional/active badges
- **MQTT Inspector** — Real-time message feed with topic filter, clear button, and inline publish form
- **MQTT Topic Tree** — Hierarchical tree view of all topics seen, expandable with last payload values
- **Event Log** — Automation rule fire events with rule name, trigger topic, and device ID

### Connectors Tab (pinned)
- **Available Connectors** — Cards for each discovered connector type showing display name, icon, description, supported device types, and setup requirement badge
- **Enable Flow** — Click Enable to expand a dynamic config form generated from the connector's `configSchema`, then submit to enable. Connectors with `requiresSetup` skip the config form and go straight to enable + wizard
- **Generic Setup Wizard** — Fully generic multi-step guided flow that fetches step descriptors from the backend via `GET /api/connectors/:id/setup-steps`. No hardcoded steps in the frontend. The wizard accumulates data across steps and patches the connector config on completion via `PATCH /api/connectors/:id`
- **Active Connectors** — Cards for each enabled instance showing health status (green/amber/red dot), device count, last seen time, and error messages
- **Disable** — Stop and disconnect a connector instance (preserves config in store)
- **Retry** — Re-attempt connection for disconnected connectors
- **Health Indicators** — Real-time status: connected (green), degraded (amber), disconnected (red)

### Automations Tab (pinned)
- **Rule Editor** — Create automation rules with when/if/then form (trigger topic, condition, action)
- **Live DSL Preview** — Shows the equivalent TypeScript DSL as you build the rule
- **Rule Listing** — Enable/disable/delete UI-created rules, source badges (file vs ui)
- **Code Rules Toggle** — Checkbox to show/hide rules loaded from TypeScript files

### System Tab (pinned)
- **Host Info** — Hostname, platform, architecture, Node.js version, uptime
- **CPU** — Model, core count, 1m/5m/15m load averages
- **Temperature** — CPU temperature with colour-coded status (Pi thermal zone)
- **Memory** — Used/total with percentage bar and colour coding
- **Disk** — Used/total with percentage bar
- **Network** — Interface names and IP addresses
- **Application Logs** — Collapsible log viewer section with level filter dropdown (all/error/warn/info/debug), auto-refresh toggle (10-second interval), colour-coded entries by level, and manual refresh button. Fetches from `GET /api/system/logs`
- **Self-Update Button** — "Update & Restart" button that triggers `POST /api/system/update` with a confirmation dialog. Shows status message and instructs user to refresh after ~60 seconds

### Global Features
- **Toast Notifications** — Animated alerts in bottom-right when automations fire (auto-dismiss 4s)
- **Command Palette** — Ctrl+K to search devices or publish MQTT messages via keyboard
- **Simulator Toggle** — Start/stop device simulator from the sidebar without restarting backend
- **Dynamic API URLs** — Frontend uses `window.location.hostname` so the dashboard works from any browser on the network
- **Animated Logo** — SVG Aeolus logo with framer-motion wind swirl animation
- **UUID Fallback** — Dashboard store uses a `generateId()` fallback for HTTP contexts where `crypto.randomUUID()` isn't available (e.g. accessing the dashboard over LAN without HTTPS)

## Additional API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/automations` | List active automation rules |
| POST | `/api/automations` | Create a UI automation rule |
| DELETE | `/api/automations/:id` | Delete a UI automation rule |
| PATCH | `/api/automations/:id/toggle` | Enable/disable a rule |
| POST | `/api/mqtt/publish` | Publish MQTT message `{ topic, payload }` |
| GET | `/api/simulator` | Simulator running status |
| POST | `/api/simulator/start` | Start device simulator |
| POST | `/api/simulator/stop` | Stop device simulator |
| GET | `/api/connectors/available` | List discovered connector types with metadata + config schemas |
| GET | `/api/connectors` | List enabled connector instances (passwords redacted) |
| POST | `/api/connectors` | Enable a new connector `{ connector_type, config }` |
| PATCH | `/api/connectors/:id` | Update connector config `{ config }` |
| DELETE | `/api/connectors/:id` | Disable a connector instance |
| GET | `/api/connectors/:id/status` | Connector health, device count, config |
| GET | `/api/connectors/:id/setup-steps` | Get setup step descriptors for a connector instance |
| POST | `/api/connectors/:id/setup/:stepId` | Execute a setup wizard step |
| POST | `/api/connectors/:id/retry` | Retry connection for disconnected connector |
| GET | `/api/layout` | Get saved dashboard layout (tabs + panes) |
| PUT | `/api/layout` | Save dashboard layout (atomic replace) |
| GET | `/api/system` | Host system diagnostics (CPU, memory, disk, temp) |
| GET | `/api/system/logs` | Recent application log entries (count, level filter) |
| POST | `/api/system/update` | Trigger self-update (git pull + docker compose rebuild) |

## Device Simulator

Built-in simulator generates realistic fake data for 7 devices without requiring an MQTT broker:

| Device | Topic | Type | Interval | Behavior |
|--------|-------|------|----------|----------|
| Kitchen Temp | sensor/kitchen/temp | sensor | 5s | Drifts 18-28°C |
| Bathroom Humidity | sensor/bathroom/humidity | sensor | 7s | Drifts 40-90% |
| Living Room Temp | sensor/living-room/temp | sensor | 6s | Drifts 19-26°C |
| Outdoor Temp | sensor/outdoor/temp | sensor | 10s | Drifts 5-35°C |
| Bedroom Light | light/bedroom | light | 15s | Random brightness |
| Desk Switch | switch/desk | switch | 20s | Random on/off |
| Hallway Motion | motion/hallway | sensor | 8s | 30% chance true |

Enable via `SIMULATOR=true` env var (auto-starts on boot) or toggle from the sidebar at runtime.

---

**Last Updated:** April 16, 2026
**Version:** 0.5.0
**Status:** MVP Development

## Future Enhancements

See `docs/ROADMAP.md` for the full categorised roadmap.
