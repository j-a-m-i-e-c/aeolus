# 🌬️ Aeolus — Technical Documentation

## Overview

Aeolus is a local-first, developer-centric IoT platform that acts as the central nervous system for all your connected devices. It bridges custom microcontroller projects (ESP32, Arduino), commercial smart devices (Philips Hue, TP-Link Kasa), and external APIs into one unified system — regardless of what protocol each device speaks.

Custom devices communicate via MQTT (bidirectional — Aeolus both ingests sensor data and publishes commands back to actuators). Commercial devices connect through pluggable connectors that translate their native protocols (Zigbee, Wi-Fi, local HTTP APIs) into the same internal pipeline. Everything flows through a central event bus, enabling automations that cross device and protocol boundaries.

The system runs as three Docker services: a Mosquitto MQTT broker, an Express.js + TypeScript backend (core engine), and a React + Vite frontend (dashboard). All data stays local on a Raspberry Pi — no cloud dependency.

## Architecture

```
[ Custom Microcontrollers ]              [ Commercial Devices ]
  ESP32 / Arduino / Pi Pico               Hue (Zigbee) / Kasa (Wi-Fi) / ...
        ↕ MQTT pub/sub                          ↕ Connector APIs
[ Mosquitto Broker :1883 ]               [ Connector Framework ]
        ↓ subscribe                              ↓
        ↓ publish commands ↑             ────────┘
                    ↓
        [ Internal EventEmitter Bus ]
              ↓              ↓
    [ Device Registry ]  [ Automation Engine ]
              ↓              ↓ publish MQTT / trigger connectors
    [ SQLite DB ]        [ Actions → devices ]
              ↓
    [ WebSocket Server ] → [ React Dashboard ]
              ↑
    [ REST API (Express) ]
```

MQTT devices are bidirectional: sensors publish data to topics like `sensor/tank/level`, and Aeolus publishes commands to topics like `valve/irrigation/command` that microcontrollers subscribe to. This enables the full IoT loop — sense, decide, act — across any combination of custom and commercial hardware.

## Tech Stack

### Backend
- **Runtime:** Node.js 20 + TypeScript (strict mode, ESM)
- **Framework:** Express.js
- **Database:** SQLite via sql.js (pure JavaScript, no native deps)
- **MQTT:** mqtt.js
- **WebSocket:** ws library
- **Sandbox:** isolated-vm (secure V8 isolate for user-authored automation scripts)
- **Transpilation:** TypeScript compiler API (runtime dependency — used to transpile user scripts on save)
- **Logging:** pino with pino-pretty in development
- **Testing:** Vitest + fast-check (property-based testing)

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **State:** Zustand
- **Styling:** Tailwind CSS with Aeolus design tokens
- **Icons:** Lucide React
- **Animation:** Framer Motion
- **Code Editor:** Monaco Editor via @monaco-editor/react (TypeScript automation script editor)

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
│   │   │   ├── service.routes.ts     # Generic service REST API
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
│   │   ├── automation-engine.ts      # Rule evaluation engine (dispatches to Sandbox or ActionExecutor)
│   │   ├── action-executor.ts        # Central dispatch service for all automation actions
│   │   ├── transpiler.ts             # TypeScript → JavaScript transpilation with import rejection
│   │   ├── sandbox.ts                # Secure isolated-vm sandbox for user-authored scripts
│   │   ├── execution-log.ts          # In-memory ring buffer for execution history (200 entries)
│   │   ├── sandbox-types.d.ts        # Type definition bundle for Monaco IntelliSense
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
│   ├── services/                     # Pluggable service framework (non-device event producers)
│   │   ├── service.interface.ts      # Core TypeScript interfaces (ServiceModule, ServiceInstance, etc.)
│   │   ├── service-registry.ts       # Manual registration and lookup of service modules
│   │   ├── service-manager.ts        # Lifecycle management (enable/disable/retry/restore)
│   │   ├── service-store.ts          # SQLite persistence for service records
│   │   ├── cron/                     # Cron Scheduler service
│   │   │   └── index.ts             # Module exports (metadata, configSchema, createService)
│   │   ├── trigger/                  # API Trigger service
│   │   │   └── index.ts             # Module exports (metadata, configSchema, createService)
│   │   ├── system/                   # System Events service
│   │   │   └── index.ts             # Module exports (metadata, configSchema, createService)
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
│       │   ├── AutomationsPage.tsx   # Dual-mode automation rule editor (form + script)
│       │   ├── ScriptEditor.tsx      # Monaco code editor with Aeolus dark theme + IntelliSense
│       │   ├── ConnectorsPage.tsx    # Connector management (enable/disable, config, generic setup wizard)
│       │   ├── ServicesPage.tsx     # Service management (enable/disable, cron schedule editor, health)
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

Connects to the Mosquitto broker for bidirectional communication with custom IoT devices.

**Inbound (sensor data):** Subscribes to configurable topic patterns, normalises incoming messages, and emits `device:state-change` events on the internal bus. Supports exponential backoff retry (max 5 attempts), topic parsing (`{type}/{location}/{metric}` → device ID + type), and multiple payload formats (JSON objects, primitives, plain numbers, strings).

**Outbound (device commands):** Publishes MQTT messages to command topics via `POST /api/mqtt/publish` and the dashboard's MQTT Inspector. This enables Aeolus to send commands to custom microcontroller devices — e.g. publishing `{"action": "open"}` to `valve/irrigation/command` where an ESP32 with a solenoid valve is subscribed. The roadmap includes making outbound MQTT publish a first-class automation action type so rules can trigger device commands directly.

### Device Registry (`src/core/device-registry.ts`)

In-memory device cache backed by SQLite for persistence across restarts.

- Upsert: creates new device on first message, updates state on subsequent
- Infers capabilities by device type (light → on/off + brightness, sensor → temperature, plug → on/off + energy, etc.)
- Emits `ws:state-change` events for WebSocket broadcast
- Serialize/deserialize round-trip for SQLite storage

### Automation Engine (`src/automations/automation-engine.ts`)

Evaluates code-driven rules against incoming device events. Supports three rule types: file-based DSL rules, form-based UI rules, and script-based TypeScript rules.

- TypeScript DSL: `when(topic).if(condition).then(action)`
- MQTT wildcard matching (`#` multi-level, `+` single-level)
- Fault isolation: one rule throwing doesn't affect others
- Loads rule files from `automations/` directory on startup
- Script rules are dispatched through the Sandbox (isolated-vm) with execution timing
- Form rules are dispatched through the ActionExecutor pipeline
- Records every execution in the ExecutionLog with duration and success/failure status

### Action Executor (`src/automations/action-executor.ts`)

Central dispatch service for all automation actions. Every action — whether from a form rule, script rule, or file-based rule — flows through this single pipeline.

- Dispatches `publish` actions to `MqttService.publish()`
- Dispatches `toggle` and `device_action` to `ConnectorManager.executeAction()`
- Dispatches `log` to the application logger
- Dispatches `delay` as a `setTimeout` wrapper
- Dispatches `webhook` via `fetch()` with configurable method, headers, and body
- Each action is wrapped in try/catch — errors are logged with the rule ID, never thrown
- Emits `AUTOMATION_FIRED` on the event bus after each successful action
- `executeSequence()` runs actions in order, continuing on individual failures

### TypeScript Transpiler (`src/automations/transpiler.ts`)

Handles TypeScript → JavaScript compilation using the TypeScript compiler API (`ts.transpileModule()`).

- Strips type annotations and produces ES2022-compatible JavaScript output
- Rejects empty source strings with a descriptive error
- Rejects source containing `import` or `require` statements via regex pre-check before transpilation
- Returns structured errors with `line`, `column`, and `message` for the frontend to display inline
- Does not perform full type checking — only syntactic transpilation (type checking happens in the Monaco editor via the `.d.ts` bundle)

### Sandbox (`src/automations/sandbox.ts`)

Secure execution environment for user-authored TypeScript automation scripts using `isolated-vm`.

- Creates a fresh V8 isolate per execution with a 32 MB memory limit
- Enforces a 5-second execution timeout to prevent infinite loops
- Exposes a controlled API surface as globals: `devices`, `mqtt`, `log`, `context`
- `devices.get/list/filter` — synchronous, data copied into isolate via `ivm.ExternalCopy`
- `devices.action()` and `mqtt.publish()` — host-side callbacks via `ivm.Reference` delegating to ActionExecutor
- `log.info/warn/error` — host-side callbacks delegating to the application logger with ruleId context
- `context` — frozen object with `topic`, `deviceId`, `state`, `timestamp` from the triggering event
- Blocks access to `require`, `import`, `process`, `fs`, `child_process`, `eval`, `Function`, `global`
- Graceful fallback: if `isolated-vm` is not available (e.g. Windows dev without C++ toolchain), sandbox execution is disabled with a warning

### Execution Log (`src/automations/execution-log.ts`)

In-memory ring buffer that records every automation execution for debugging.

- Stores up to 200 entries in a ring buffer (oldest evicted when full)
- Each entry records: rule ID, rule name, rule type, trigger topic, actions with success/failure, duration, and timestamp
- `list(limit?)` returns the most recent entries (newest first)
- `getByRuleId(ruleId)` filters entries for a specific rule
- Exposed via `GET /api/automations/history` for the frontend

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


### Services Framework

The Services Framework is a pluggable architecture for non-device event producers — timers, API triggers, system lifecycle events — that sits alongside the Connector Framework as a peer event source layer. Services emit events on the standard event bus using synthetic `service/{type}/{name}` topics, so automations match on service events identically to how they match on `sensor/` or `connector/` topics. Zero changes to the automation engine were required.

The framework mirrors the Connector Framework's architecture: `ServiceModule` → `ServiceRegistry` → `ServiceManager` → `ServiceStore`. Three built-in services ship with the framework; future services (weather, energy pricing, calendar) plug in without touching core files.

#### Service Interfaces (`src/services/service.interface.ts`)

Every service module exports three members:

- `metadata: ServiceMetadata` — static descriptor with `id`, `displayName`, `icon`, `description`, `category`
- `configSchema: ServiceConfigSchema` — reuses `ConfigFieldDescriptor[]` from the Connector framework
- `createService(config, deps): ServiceInstance` — factory function accepting config and `{ eventBus }` dependencies

`ServiceInstance` exposes lifecycle methods: `start()`, `stop()`, `dispose()`, `getHealthStatus()`, `onConfigUpdate(config)`, and optional `getState()` for sandbox queries.

#### ServiceRegistry (`src/services/service-registry.ts`)

Manual registration and lookup of service modules. Validates that each module exports `metadata` (with string `id`), `configSchema` (array), and `createService` (function). Invalid modules are skipped with a warning; duplicate IDs overwrite with a warning.

#### ServiceManager (`src/services/service-manager.ts`)

Lifecycle management for enabled service instances. Handles enable (instantiate → start → persist), disable (stop → dispose → update store), config update, retry, restore from store on startup, and disposeAll on shutdown. Exposes `getServiceInstance(serviceType)` for sandbox queries.

Key differences from ConnectorManager: no device discovery or polling (services emit events on their own schedule), no action routing (services are event producers only).

#### ServiceStore (`src/services/service-store.ts`)

SQLite persistence layer for service records. CRUD operations on the `services` table with JSON serialization for the config column. Disabling preserves the record (sets `enabled = 0`) rather than deleting it.

#### Event Emission Pattern

Services emit events through the existing `DEVICE_STATE_CHANGE` pipeline using synthetic topics:

```typescript
const event: NormalizedEvent = {
  deviceId: `service-${serviceType}`,    // e.g. "service-cron"
  deviceType: "sensor",                   // All service events use "sensor" type
  state: { scheduleName, cronExpression, firedAt: Date.now() },
  topic: `service/cron/${scheduleName}`,  // Synthetic topic
  timestamp: Date.now(),
  integration: "service",
};
eventBus.emit(DEVICE_STATE_CHANGE, event);
```

Automations match `service/cron/every-5m` or `service/+/+` or `service/#` using existing topic matching. Events flow through DeviceRegistry → WebSocket broadcast → frontend automatically.

#### Built-in Services

**Cron Scheduler** (`src/services/cron/index.ts`) — Time-based event scheduling using `node-cron`. Config accepts a `schedules` array of `{ name, cron }` objects. On each schedule fire, emits `service/cron/{scheduleName}` with state `{ scheduleName, cronExpression, firedAt }`. Invalid cron expressions are skipped with a warning. `getState()` returns all schedules with active status.

**API Trigger** (`src/services/trigger/index.ts`) — Fire automation events via HTTP requests. No configuration needed. The route handler for `POST /api/services/trigger/{name}` calls `emitTrigger(name, body)` which emits `service/trigger/{name}` with state `{ triggerName, payload, firedAt }`. Accepts any trigger name without pre-registration. `getState()` returns `{ triggerCount, lastTriggerAt }`.

**System Events** (`src/services/system/index.ts`) — Emits `service/system/startup` on start and `service/system/shutdown` on stop. No configuration needed. `getState()` returns `{ startupTimestamp, uptimeSeconds }`.

#### Sandbox Services API

The `services` global is available in automation scripts alongside `devices`, `mqtt`, `log`, and `context`:

- `services.get(serviceType)` — returns a read-only snapshot of the service's `getState()`, or `undefined` if not running
- `services.list()` — returns `[{ type, displayName, running }]` for all registered services

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

### Automation API

**GET /api/automations**
List all automation rules (file-based, form, and script) with `ruleType` field.

**POST /api/automations**
Create a new automation rule (form or script). For script rules, include `ruleType: "script"` and `scriptSource`.
```json
{
  "name": "Smart heating",
  "triggerTopic": "sensor/+/temperature",
  "ruleType": "script",
  "scriptSource": "if (context.state.value < 18) {\n  devices.action('climate-living-room', 'setTemperature', { target: 22 });\n}"
}
```
Returns `{ "success": true, "id": "..." }`. 400 if transpilation fails (with `details` array of `{ line, column, message }`).

**PUT /api/automations/:id**
Update an existing automation rule. For script rules, re-transpiles the TypeScript source on save.
Returns `{ "success": true, "id": "..." }`. 404 if rule not found, 400 if transpilation fails.

**DELETE /api/automations/:id**
Delete a UI automation rule from both the database and the Rule Registry.
Returns `{ "success": true }`. 404 if not found.

**PATCH /api/automations/:id/toggle**
Enable or disable a rule. Enabling a script rule re-registers it with the compiled JavaScript.
```json
{ "enabled": true }
```
Returns `{ "success": true, "enabled": true }`. 404 if not found.

**GET /api/automations/types**
Serve the sandbox type definition bundle (`sandbox-types.d.ts`) as `text/plain`. The Monaco editor fetches this on mount to provide IntelliSense for `devices`, `mqtt`, `log`, and `context` globals.

**GET /api/automations/history**
Return execution log entries from the in-memory ring buffer (newest first).
Query parameters:
- `limit` (optional) — number of entries to return

Returns an array of `ExecutionLogEntry` objects.

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

### Service API

**GET /api/services/available**
List all registered service types with metadata and config schemas.

**GET /api/services**
List enabled service instances with health status, config, and service type.

**POST /api/services**
Enable a new service instance.
```json
{ "service_type": "cron", "config": { "schedules": [{ "name": "every-5m", "cron": "*/5 * * * *" }] } }
```
Returns `{ "success": true, "id": "<uuid>" }`. 404 if service type not found, 400 if required config fields missing.

**PATCH /api/services/:id**
Update service configuration.
```json
{ "config": { "schedules": [...] } }
```
Returns `{ "success": true }`.

**DELETE /api/services/:id**
Disable and dispose a service instance.
Returns `{ "success": true }`.

**GET /api/services/:id/status**
Get detailed health status for a specific service instance.

**POST /api/services/:id/retry**
Retry starting a stopped service.
Returns `{ "success": true }`.

**POST /api/services/trigger/:name**
Fire an API trigger event. Emits `service/trigger/{name}` on the event bus with the request body as payload.
```json
{ "key": "value" }
```
Returns `{ "success": true, "trigger": "<name>" }`.

**GET /api/services/topics**
List available service event topics for all enabled services (e.g. `service/cron/every-5m`, `service/trigger/{name}`, `service/system/startup`).

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

### ActionDescriptor
```typescript
interface ActionDescriptor {
  type: "publish" | "toggle" | "device_action" | "log" | "delay" | "webhook";
  target: string;           // topic for publish, deviceId for toggle/device_action, URL for webhook
  params: Record<string, unknown>;
}
```

### ExecutionLogEntry
```typescript
interface ExecutionLogEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: "file" | "form" | "script";
  triggerTopic: string;
  actions: Array<{ type: string; target: string; success: boolean; error?: string }>;
  duration: number;     // ms
  timestamp: number;
}
```

### ConnectorMetadata
```typescript
interface ConnectorMetadata {
  id: string;                        // Unique connector type identifier (e.g. "hue", "kasa")
  displayName: string;               // Human-readable name for dashboard cards
  icon: string;                      // Lucide icon name
  description: string;               // Short description of the connector
  supportedDeviceTypes: DeviceType[];// Device types this connector can produce
  requiresSetup: boolean;            // Whether a multi-step setup wizard is needed
}
```

### ConfigFieldDescriptor
```typescript
interface ConfigFieldDescriptor {
  id: string;          // Field key in the config object
  label: string;       // Human-readable label
  type: "text" | "number" | "password" | "boolean" | "select";
  required: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  helpText?: string;
  options?: Array<{ label: string; value: string }>;
}

type ConnectorConfigSchema = ConfigFieldDescriptor[];
```

### SetupStepDescriptor
```typescript
interface SetupStepDescriptor {
  id: string;          // Step identifier used in API path (e.g. "discover-bridges")
  title: string;       // Step heading in the wizard
  description: string; // Instructions shown to the user
  fields?: ConfigFieldDescriptor[]; // Input fields for this step, if any
}
```

### SetupStepResult
```typescript
interface SetupStepResult {
  success: boolean;                  // Whether the step completed successfully
  message: string;                   // User-facing message (confirmation or error)
  data?: Record<string, unknown>;    // Data produced by this step (e.g. apiKey, bridges)
  complete?: boolean;                // When true, setup flow is finished
}
```

### ConnectorHealthStatus
```typescript
interface ConnectorHealthStatus {
  status: "connected" | "degraded" | "disconnected";
  lastSeen: number;          // Unix timestamp ms of last successful communication
  errorMessage?: string;     // Present when status is degraded or disconnected
}
```

### ConnectorInstanceInfo
```typescript
interface ConnectorInstanceInfo {
  id: string;                        // UUID instance identifier
  connectorType: string;             // Matches ConnectorMetadata.id
  displayName: string;               // From metadata
  icon: string;                      // From metadata
  config: Record<string, unknown>;   // Current config (passwords redacted in API responses)
  health: ConnectorHealthStatus;     // Live health status
  deviceCount: number;               // Devices discovered by this instance
  enabled: boolean;                  // Whether the instance is active
}
```

### ServiceMetadata
```typescript
interface ServiceMetadata {
  id: string;           // Unique service type ID (e.g. "cron", "trigger", "system")
  displayName: string;  // Human-readable name for the UI
  icon: string;         // Lucide icon name
  description: string;  // Short description for the service card
  category: string;     // Grouping category (e.g. "scheduling", "integration", "system")
}

type ServiceConfigSchema = ConfigFieldDescriptor[];
```

### ServiceHealthStatus
```typescript
interface ServiceHealthStatus {
  status: "running" | "degraded" | "stopped";
  lastActivity: number;       // Unix timestamp of last event emission
  errorMessage?: string;      // Present when status is degraded or stopped
}
```

### ServiceInstanceInfo
```typescript
interface ServiceInstanceInfo {
  id: string;                        // UUID instance identifier
  serviceType: string;               // Matches ServiceMetadata.id
  displayName: string;               // From metadata
  icon: string;                      // From metadata
  config: Record<string, unknown>;   // Current config
  health: ServiceHealthStatus;       // Live health status
  enabled: boolean;                  // Whether the instance is active
}
```

### ServiceRecord
```typescript
interface ServiceRecord {
  id: string;                        // UUID primary key
  serviceType: string;               // Service type ID
  enabled: boolean;                  // Whether the service is active
  config: Record<string, unknown>;   // JSON-serialized config
  createdAt: number;                 // Unix timestamp ms
  updatedAt: number;                 // Unix timestamp ms
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
  action_type TEXT NOT NULL DEFAULT 'log',
  action_target TEXT NOT NULL DEFAULT '',
  action_params TEXT NOT NULL DEFAULT '{}',
  rule_type TEXT NOT NULL DEFAULT 'form' CHECK(rule_type IN ('form', 'script')),
  script_source TEXT DEFAULT NULL,
  compiled_js TEXT DEFAULT NULL,
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

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL,
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
| Action Executor | MqttService not connected during publish | Log error with rule ID, skip publish, continue sequence |
| Action Executor | ConnectorManager.executeAction throws | Log error with rule ID and device ID, continue sequence |
| Action Executor | Webhook HTTP request fails (network error, non-2xx) | Log error with URL and status, continue sequence |
| Action Executor | Unknown action type | Log warning with type string, skip, continue sequence |
| Action Executor | Delay with negative/zero duration | Treat as no-op, log warning, continue |
| Sandbox | Script throws uncaught exception | Catch, log with rule ID and error message, do not propagate |
| Sandbox | Script exceeds 5-second timeout | isolated-vm terminates execution, log timeout error with rule ID |
| Sandbox | Script exceeds 32MB memory limit | isolated-vm terminates isolate, log OOM error with rule ID |
| Sandbox | Script attempts forbidden API access | ReferenceError or undefined — caught by sandbox error handler |
| Sandbox | isolated-vm not available (Windows dev) | Log warning, sandbox execution disabled, script rules skip |
| Transpiler | Syntax error in TypeScript source | Return 400 with `{ error, details: [{ line, column, message }] }` |
| Transpiler | Source contains import/require | Return 400 with descriptive error before transpilation |
| Transpiler | Empty source string | Return 400 with "Script source cannot be empty" |
| REST API | Device not found | 404 JSON error |
| REST API | Invalid action payload | 400 JSON error |
| Connector | connect() fails | Log error, set health to disconnected, keep instance |
| Connector | discoverDevices() fails | Log error, continue with empty device set |
| Connector | Module missing required exports | Log warning with missing export names, skip module |
| Connector | Malformed JSON in config column | Log warning, skip record during load |
| Connector | Unknown connector type on restore | Log warning, skip record |
| Connector | Setup step fails | Return error message to dashboard wizard |
| Connector | Legacy migration file unreadable | Log warning, skip migration |
| Service | Service type not found in registry | 404 JSON error |
| Service | Missing required config fields | 400 JSON error with field names |
| Service | `start()` throws | Mark health as "stopped", log error, allow retry |
| Service | Invalid cron expression | Log warning, skip schedule, continue with valid ones |
| Service | `stop()` throws during disable | Log error, continue with disposal |
| Service | `dispose()` throws during shutdown | Log error, continue with next service |
| Service | Duplicate service type registration | Log warning, overwrite existing |
| Service | ServiceStore JSON parse failure | Log warning, skip malformed record |
| Service | Sandbox `services.get()` for non-running service | Return `undefined` |
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
- **Pinned tabs render dedicated components:** Pinned system tabs (Dashboard, Automations, Connectors, Services, System) render their own full-page components directly via a `PINNED_PAGES` map in `App.tsx`, bypassing the modular pane grid. This gives each system page full control over its layout and styling. Custom (unpinned) tabs use the `TabLayout` component with the pane grid system. This separation keeps system pages polished while maintaining flexibility for user-created tabs.
- **Services Framework mirrors Connector Framework architecture:** The Services Framework deliberately mirrors the Connector Framework's architecture (Module → Registry → Manager → Store) so that anyone familiar with the connector code can immediately understand the services code. Services differ in that they are event producers only — no device discovery, no polling, no action routing. They emit events through the existing `DEVICE_STATE_CHANGE` pipeline using synthetic `service/{type}/{name}` topics, requiring zero changes to the automation engine.
- **`isolated-vm` over Node.js `vm` for sandbox execution:** The Node.js `vm` module is explicitly documented as "not a security mechanism" — it runs code in the same V8 isolate as the host process, allowing escape via prototype pollution and `Function` constructor access. The `vm2` library was deprecated after repeated critical sandbox escape CVEs. `isolated-vm` creates a separate V8 isolate with its own heap, no access to the host's global scope, and built-in support for memory limits (32 MB) and execution timeouts (5 seconds). This is the same isolation primitive used by Cloudflare Workers. For a Raspberry Pi deployment where the automation engine shares a process with the MQTT broker connection and device registry, true V8-level isolation is essential. The tradeoff is that `isolated-vm` is a native addon requiring C++ compilation — the Dockerfile includes `build-essential` and `python3` for ARM64 builds.
- **Monaco over CodeMirror for the script editor:** Monaco is the editor engine behind VS Code. It provides native TypeScript language service integration — IntelliSense, type checking, and error squiggles work out of the box when you register `.d.ts` type definitions via `addExtraLib()`. CodeMirror 6 is lighter but requires significant custom work to achieve comparable TypeScript support. Since the code editor is the centrepiece of the automation overhaul and developer experience is paramount, Monaco is the right choice. The `@monaco-editor/react` wrapper provides clean React integration.
- **TypeScript as a runtime dependency:** The TypeScript compiler API (`ts.transpileModule()`) is used at runtime to transpile user-authored automation scripts on save. This means `typescript` is a production dependency, not just a dev dependency. The tradeoff is a larger production bundle, but it enables on-the-fly transpilation without a separate build step or external service.
- **Generic backend-driven setup wizard:** The ConnectorsPage setup wizard is fully generic — it fetches step descriptors from `GET /api/connectors/:id/setup-steps` and renders them dynamically. No connector-specific UI code exists in the frontend. Each step can include input fields, and the wizard accumulates data across steps, passing it to subsequent step executions and patching the connector config on completion. This means adding a new connector with a multi-step setup flow requires zero frontend changes.


## Dashboard Features

The React dashboard provides a comprehensive developer-focused interface with a modular tab-and-pane layout. The sidebar displays dynamic tabs — 5 pinned system tabs (Dashboard, Automations, Connectors, Services, System) plus user-created custom tabs. Pinned tabs render dedicated full-page components; custom tabs use the modular pane grid. On a fresh install, only the 5 pinned tabs are present with no custom tabs or panes.

### Sidebar
- **Pinned System Tabs** — Dashboard, Automations, Connectors, Services, System (cannot be deleted or reordered)
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

### Services Tab (pinned)
- **Available Services** — Cards for each registered service type showing display name, icon, description, category, and enable button
- **Enable Flow** — Click Enable to expand a dynamic config form generated from the service's `configSchema`, then submit to enable
- **Cron Schedule Editor** — Custom schedule editor for the Cron service: list of configured schedules with name, cron expression, and human-readable description (via `cronstrue`). "Add Schedule" inline form with preset buttons for common schedules (every minute, every 5 minutes, every hour, daily at midnight, daily at 6am). Client-side cron expression validation
- **Active Services** — Cards for each enabled instance showing health status (green=running, amber=degraded, red=stopped), config summary, and disable/retry buttons
- **Disable** — Stop and dispose a service instance
- **Retry** — Re-attempt starting a stopped service

### Automations Tab (pinned)
- **Dual-Mode Rule Creator** — Segmented control toggle between "Quick Rule" (form-based, `FormInput` icon) and "Script" (Monaco code editor, `Code` icon)
- **Script Mode** — Monaco editor with Aeolus dark theme, name input, and trigger topic input. Saves via `POST /api/automations` with `ruleType: "script"`. Transpilation errors from the backend are displayed inline in the editor and below it with line/column numbers
- **Quick Rule Mode** — Form-based rule creator with when/if/then fields (trigger topic, condition, action type)
- **Richer Action Types** — Action type dropdown includes: log, toggle, publish, device_action, delay, and webhook. Each type shows contextual input fields (e.g. device selector for device_action, URL/method/body for webhook, duration for delay, topic/payload for publish)
- **Live DSL Preview** — Shows the equivalent TypeScript DSL as you build the rule, updates dynamically for all action types
- **Unified Rule List** — All rules (file, form, script) in one list with type badges: `<Code />` icon for script rules, `<FormInput />` icon for form rules
- **Script Editing** — Clicking a script rule opens it in the Monaco editor with source pre-loaded for editing via `PUT /api/automations/:id`
- **Rule Management** — Enable/disable/delete UI-created rules, source badges (file vs ui)
- **Code Rules Toggle** — Checkbox to show/hide rules loaded from TypeScript files

#### Monaco Script Editor (`frontend/src/components/ScriptEditor.tsx`)

A React component wrapping `@monaco-editor/react` with Aeolus theming and sandbox API IntelliSense.

- Fetches type definitions from `GET /api/automations/types` on mount
- Registers types via `monaco.languages.typescript.typescriptDefaults.addExtraLib()` for IntelliSense on `devices`, `mqtt`, `log`, and `context`
- Custom `aeolus-dark` Monaco theme mapping Aeolus brand colours to token types:
  - Keywords (`if`, `const`, `await`): `#3BA4FF` (Aeolus Blue)
  - Strings: `#5CE1E6` (Wind Cyan)
  - Comments: `#6B7785` (Muted Text)
  - Functions/identifiers: `#E6EDF3` (Primary Text)
  - Types: `#9AA6B2` (Secondary Text)
  - Numbers: `#F59E0B` (Amber)
  - Editor background: `#0B0F14` (Deep Void)
  - Gutter: `#121821` (Graphite)
- JetBrains Mono as the editor font
- Displays inline error markers from backend transpilation errors at corresponding line numbers
- Ctrl+S / Cmd+S keyboard shortcut to save
- Accepts `onChange`, `onSave`, `initialValue`, and `errors` props

### System Tab (pinned)
- **Host Info** — Hostname, platform, architecture, Node.js version, uptime
- **CPU** — Model, core count, 1m/5m/15m load averages
- **Temperature** — CPU temperature with colour-coded status (Pi thermal zone)
- **Memory** — Used/total with percentage bar and colour coding
- **Disk** — Used/total with percentage bar
- **Network** — Interface names and IP addresses
- **Application Logs** — Collapsible log viewer section with level filter dropdown (all/error/warn/info/debug), auto-refresh toggle (10-second interval), colour-coded entries by level, and manual refresh button. Fetches from `GET /api/system/logs`
- **Self-Update Button** — "Update & Restart" button that triggers `POST /api/system/update` with a confirmation dialog. Shows status message and instructs user to refresh after ~60 seconds

### Custom Tabs (unpinned)
Custom tabs use the modular pane grid powered by `react-grid-layout`. Users create tabs from the sidebar, then add any combination of panes via the PanePicker.

#### Hue Control Pane (`hue-control`)
- Filters devices from the store where `integration === "hue"` and `type === "light"`
- Responsive grid of light cards with name, online/offline badge, and toggle button
- Debounced brightness slider — tracks local value during drag, sends `{ type: "brightness", params: { brightness } }` on mouse/touch release only (no intermediate API calls)
- Colour picker for color-capable lights (detected by device type containing "color" or "extended", case-insensitive) — 10 preset swatches (red, orange, yellow, green, cyan, blue, purple, pink, warm white, cool white) that send `{ type: "color", params: { hue, saturation } }`
- Optimistic UI updates — toggle flips state immediately, reverts on API failure
- Empty state message directing users to enable the Hue connector

#### Kasa Control Pane (`kasa-control`)
- Filters devices from the store where `integration === "kasa"`
- Responsive grid of device cards with name, device type badge (plug/light/switch), online badge, and toggle button
- Energy monitoring section — conditionally displayed when device state contains `voltage`, `current`, `power`, or `totalConsumption` fields
- Optimistic UI updates — toggle flips state immediately, reverts on API failure
- Empty state message directing users to enable the Kasa connector

#### Other Pane Types
- **Device Grid** (`device-grid`) — Same device card grid as the Dashboard tab
- **Sensor Panel** (`sensor-panel`) — Live sensor values with sparkline charts
- **MQTT Inspector** (`mqtt-inspector`) — Real-time message feed with publish form
- **Automation Rules** (`automation-rules`) — Rule listing from the Automations page
- **System Stats** (`system-stats`) — Host diagnostics summary
- **Topic Tree** (`topic-tree`) — Hierarchical MQTT topic tree
- **Event Log** (`event-log`) — Automation fire event log
- **Connectors** (`connectors-page`) — Connector management page as a pane

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
| GET | `/api/automations` | List active automation rules (file, form, script) with ruleType field |
| POST | `/api/automations` | Create a UI automation rule (form or script) |
| PUT | `/api/automations/:id` | Update an existing automation rule (re-transpiles script source) |
| DELETE | `/api/automations/:id` | Delete a UI automation rule |
| PATCH | `/api/automations/:id/toggle` | Enable/disable a rule |
| GET | `/api/automations/types` | Serve sandbox type definition bundle as text/plain |
| GET | `/api/automations/history` | Execution log entries (optional limit param) |
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
| GET | `/api/services/available` | List registered service types with metadata + config schemas |
| GET | `/api/services` | List enabled service instances with health and config |
| POST | `/api/services` | Enable a new service `{ service_type, config }` |
| PATCH | `/api/services/:id` | Update service config `{ config }` |
| DELETE | `/api/services/:id` | Disable and dispose a service instance |
| GET | `/api/services/:id/status` | Service health status |
| POST | `/api/services/:id/retry` | Retry starting a stopped service |
| POST | `/api/services/trigger/:name` | Fire an API trigger event |
| GET | `/api/services/topics` | List available service event topics |
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

**Last Updated:** April 18, 2026
**Version:** 0.8.0
**Status:** MVP Development

## Future Enhancements

See `docs/ROADMAP.md` for the full categorised roadmap.
