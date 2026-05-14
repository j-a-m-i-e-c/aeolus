# 🌬️ Aeolus — Technical Documentation

## Overview

Aeolus is a local-first, developer-centric IoT platform that acts as the central nervous system for all your connected devices. It bridges custom microcontroller projects (ESP32, Arduino), commercial smart devices (Philips Hue, TP-Link Kasa), and external APIs into one unified system — regardless of what protocol each device speaks.

Custom devices communicate via MQTT (bidirectional — Aeolus both ingests sensor data and publishes commands back to actuators). Commercial devices connect through pluggable connectors that translate their native protocols (Zigbee, Wi-Fi, local HTTP APIs) into the same internal pipeline. Everything flows through a central event bus, enabling automations that cross device and protocol boundaries.

The system runs as three Docker services: a Mosquitto MQTT broker, an Express.js + TypeScript backend (core engine), and a React + Vite frontend (dashboard). All data stays local on a Raspberry Pi — no cloud dependency.

## Architecture

```
                        ┌──────── Event Sources ────────┐
                        │                               │
  [ MQTT Devices ]      │  [ Connectors ]               │  [ Services ]
   ESP32 / Arduino      │   Hue / Kasa / ...            │   Cron · Triggers · System
        ↕               │       ↕                       │       ↕
  [ Mosquitto :1883 ]   │  [ Connector Manager ]        │  [ Service Manager ]
        │               │       │                       │       │
        │  sensor data  │  device state (synthetic      │  events (synthetic
        │  + commands   │  connector/{id}/{device} )     │  service/{type}/{name} )
        │               │       │                       │       │
        └───────────────┴───────┴───────────────────────┴───────┘
                                │
                    ┌───────────▼───────────┐
                    │   Internal Event Bus  │
                    │   (DEVICE_STATE_CHANGE │
                    │    + AUTOMATION_STATE)  │
                    └───┬──────────────┬────┘
                        │              │
                        ▼              ▼
              ┌─────────────┐  ┌────────────────┐
              │   Device    │  │  Automation     │
              │  Registry   │  │   Engine        │
              │  (SQLite)   │  │  (V8 Sandbox)   │
              └──────┬──────┘  └───────┬─────────┘
                     │                 │
                     │          ┌──────▼──────────┐
                     │          │  Action Executor │
                     │          │  MQTT publish    │
                     │          │  Device actions  │
                     │          │  HTTP webhooks   │
                     │          │  Logging         │
                     │          └─────────────────┘
                     │
              ┌──────▼──────┐  ┌──────────────────┐
              │  WebSocket  │  │   Data Store      │
              │   Server    │  │   (SQLite)        │
              └──────┬──────┘  └──────┬────────────┘
                     │                 │
                     │    ┌────────────┘
                     │    │  db global in Sandbox
                     │    │  + REST API
              ┌──────▼────▼─┐      ┌──────────────┐
              │  REST API   │◄────►│    React     │
              │  (Express)  │      │  Dashboard   │
              └─────────────┘      └──────────────┘
```

Three event source layers feed the same internal bus:

- **MQTT devices** — bidirectional via Mosquitto. Sensors publish data to topics like `sensor/tank/level`, and Aeolus publishes commands to topics like `valve/irrigation/command` that microcontrollers subscribe to.
- **Connectors** — commercial devices (Hue, Kasa, etc.) emit state through synthetic `connector/{integration}/{deviceId}` topics, unifying them with MQTT devices in the automation pipeline.
- **Services** — non-device event producers (cron schedules, API triggers, system lifecycle) emit events through synthetic `service/{type}/{name}` topics.

This enables the full IoT loop — sense, decide, act — across any combination of custom hardware, commercial devices, and time/event-based triggers.

## Tech Stack

### Backend
- **Runtime:** Node.js 22 + TypeScript (strict mode, ESM)
- **Framework:** Express.js
- **Database:** SQLite via sql.js (pure JavaScript, no native deps)
- **MQTT:** mqtt.js
- **WebSocket:** ws library
- **Sandbox:** isolated-vm (secure V8 isolate for user-authored automation scripts)
- **Transpilation:** TypeScript compiler API (runtime dependency — used to transpile user scripts on save)
- **Logging:** pino with pino-pretty in development
- **Testing:** Vitest + fast-check (property-based testing)

### Frontend
- **Framework:** React 19 + TypeScript
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
│   │   │   ├── connector.routes.ts   # Generic connector REST API (replaces hue.routes.ts)
│   │   │   ├── service.routes.ts     # Generic service REST API
│   │   │   ├── data-store.routes.ts  # Data Store REST API (collections, records, buckets, config)
│   │   │   ├── layout.routes.ts      # GET/PUT /api/layout (tab + pane persistence)
│   │   │   └── system.routes.ts      # Host diagnostics, application logs, self-update
│   │   └── middleware/
│   │       ├── error-handler.ts      # AppError hierarchy + global handler
│   │       ├── request-logger.ts     # pino HTTP request logging
│   │       └── validators.ts         # Action payload validation
│   ├── core/
│   │   ├── device-registry.ts        # In-memory cache + SQLite persistence
│   │   ├── event-bus.ts              # Internal EventEmitter pub/sub
│   │   ├── state-history.ts          # Per-device state history with throttling + pruning
│   │   └── types.ts                  # All shared TypeScript interfaces
│   ├── mqtt/
│   │   ├── mqtt-service.ts           # Broker connection + message handling
│   │   ├── topic-parser.ts           # MQTT topic → device metadata
│   │   └── topic-parser.test.ts      # Unit tests
│   ├── automations/
│   │   ├── automation-engine.ts      # Rule evaluation engine (dispatches to Sandbox or ActionExecutor)
│   │   ├── action-executor.ts        # Central dispatch service for all automation actions
│   │   ├── automation-state-store.ts # Per-rule key-value store with SQLite persistence + in-memory cache
│   │   ├── cron-timer-manager.ts     # Per-rule cron timer management (start/stop/stopAll)
│   │   ├── cron-utils.ts             # Shared cron expression utilities (validation, presets, description)
│   │   ├── transpiler.ts             # TypeScript → JavaScript transpilation (logic scripts + UI components)
│   │   ├── sandbox.ts                # Secure isolated-vm sandbox for user-authored scripts
│   │   ├── execution-log.ts          # In-memory ring buffer for execution history (200 entries)
│   │   ├── sandbox-types.d.ts        # Type definition bundle for Monaco IntelliSense
│   │   ├── ui-types.d.ts             # Type definition bundle for custom UI component editor
│   │   ├── structured-metadata-extractor.ts  # Best-effort extraction of automation() call metadata for flow diagrams
│   │   ├── snippet-catalog.ts        # Platform + connector code snippet aggregation
│   │   ├── condition-registry.ts     # Factory registry for condition predicates
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
│   ├── data-store/                   # Persistent time-series + key-value storage
│   │   ├── data-store.ts            # DataStore class (write, query, buckets, retention, config)
│   │   ├── duration.ts              # Duration string parser (pure module, no dependencies)
│   │   └── __tests__/               # Property-based + unit tests
│   │       ├── duration.test.ts     # PBT for duration parser
│   │       ├── data-store.test.ts   # PBT for DataStore core logic
│   │       ├── data-store.routes.test.ts  # Integration tests for REST API
│   │       └── data-store.sandbox.test.ts # Integration tests for sandbox wiring
│   ├── websocket/
│   │   └── ws-server.ts              # WebSocket server
│   ├── db/
│   │   └── database.ts              # sql.js setup + schema (devices, automation_rules, automation_state, tabs, panes, connectors, services)
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
│       │   ├── Sidebar.tsx           # Dynamic tab navigation + system status
│       │   ├── TabLayout.tsx         # Renders panes for the active tab (passes paneId to components)
│       │   ├── PanePicker.tsx        # Grouped pane type selector with categories (Controls, Automations, Monitoring, System)
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
│       │   ├── FlowDiagram.tsx       # Pure inline SVG flow diagram for structured automations
│       │   ├── ActivityFeed.tsx      # Recent execution feed for free-form automations
│       │   ├── SnippetPicker.tsx     # Code snippet picker panel for the automation editor
│       │   ├── UiEditor.tsx          # Monaco editor for custom automation UI components (TSX)
│       │   ├── TriggerSelector.tsx   # Inline trigger type selector (MQTT topic, cron schedule, or none)
│       │   ├── CustomComponentBoundary.tsx  # Error boundary for custom automation UI components
│       │   ├── WelcomeScreen.tsx     # Onboarding screen for empty dashboard (no devices)
│       │   ├── ConnectorsPage.tsx    # Connector management (enable/disable, config, generic setup wizard)
│       │   ├── ServicesPage.tsx     # Service management dashboard (available but not routed as a pinned tab)
│       │   ├── SystemPage.tsx        # Host diagnostics, application log viewer, version check, self-update
│       │   ├── StateHistoryChart.tsx  # SVG trend chart for device state history
│       │   ├── CommandPalette.tsx    # Ctrl+K command palette
│       │   ├── ToastContainer.tsx    # Animated toast notifications
│       │   └── panes/               # Pane wrapper components for modular dashboard
│       │       ├── DeviceGridPane.tsx
│       │       ├── SensorPanelPane.tsx
│       │       ├── MqttInspectorPane.tsx
│       │       ├── HueControlPane.tsx    # Hue light control pane
│       │       ├── KasaControlPane.tsx   # Kasa device control pane
│       │       ├── AutomationRulesPane.tsx
│       │       ├── AutomationPane.tsx    # Self-contained one-pane-one-automation (setup/status/editing)
│       │       ├── AutomationCardPane.tsx  # Single automation control card
│       │       ├── AutomationsEditorPane.tsx  # Full automations editor pane wrapper
│       │       ├── ScheduleViewerPane.tsx  # Cron schedule viewer for scheduled automations
│       │       ├── TriggerButtonPane.tsx  # Configurable API trigger button
│       │       ├── SystemStatsPane.tsx
│       │       ├── TopicTreePane.tsx
│       │       ├── EventLogPane.tsx
│       │       ├── StateHistoryPane.tsx  # Per-device state history pane
│       │       ├── ConnectorsPane.tsx
│       │       └── custom/              # Custom automation UI components
│       │           └── types.ts         # CustomComponentProps interface
│       ├── hooks/
│       │   └── useDynamicComponent.ts # Runtime loader for custom automation UI modules (blob URL + dynamic import)
│       ├── pages/
│       │   ├── DataStorePage.tsx      # Data Store page (setup wizard or data explorer)
│       │   └── data-store/           # Data Store sub-components
│       │       ├── BucketList.tsx     # Expandable bucket list with key-value pairs
│       │       ├── CollectionDetail.tsx # Time-series chart + record table + management
│       │       ├── CollectionList.tsx  # Card grid of collections
│       │       ├── DataExplorer.tsx   # Main explorer with SummaryBar + tab switcher
│       │       ├── RecordTable.tsx    # Paginated record table
│       │       ├── SettingsPanel.tsx  # DataStore configuration editor
│       │       ├── SetupWizard.tsx    # First-run setup wizard (shown when disabled)
│       │       └── TimeSeriesChart.tsx # SVG chart adapted for DataStore records
│       ├── store/
│       │   ├── device-store.ts       # Zustand device state + WebSocket sync
│       │   ├── dashboard-store.ts    # Zustand dashboard layout state (tabs, panes, persistence)
│       │   ├── automation-state-store.ts  # Zustand store for per-rule automation state + WebSocket sync
│       │   └── data-store-store.ts   # Zustand store for Data Store state (collections, records, buckets, config)
│       ├── lib/
│       │   ├── api-client.ts         # REST API client (dynamic hostname)
│       │   ├── cron-utils.ts         # Client-side cron validation, presets, and human-readable descriptions
│       │   ├── ws-client.ts          # WebSocket client with auto-reconnect
│       │   └── pane-registry.ts      # Maps pane type identifiers to React components + metadata
│       └── types/
│           └── dashboard.ts          # Tab, Pane, PaneConfig, LayoutPayload interfaces + defaults
├── automations/                      # User-defined rule files (loaded on startup)
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

**Inbound (sensor data):** Subscribes to configurable topic patterns, normalises incoming messages, and emits `device:state-change` events on the internal bus. Supports exponential backoff retry (max 5 attempts), universal topic parsing via `parseTopic()` (any valid MQTT topic is accepted — see Topic Parser below), and multiple payload formats (JSON objects, primitives, plain numbers, strings).

**Outbound (device commands):** Publishes MQTT messages to command topics via `POST /api/mqtt/publish` and the dashboard's MQTT Inspector. This enables Aeolus to send commands to custom microcontroller devices — e.g. publishing `{"action": "open"}` to `valve/irrigation/command` where an ESP32 with a solenoid valve is subscribed. The roadmap includes making outbound MQTT publish a first-class automation action type so rules can trigger device commands directly.

### Topic Parser (`src/mqtt/topic-parser.ts`)

A single universal `parseTopic()` function that always succeeds for any valid MQTT topic. There is no gate, no registry, and no fallback layers — every non-empty topic string produces a `ParsedTopic` with a deterministic device ID, a device type, and a human-readable name.

- **Device ID:** all topic segments joined with hyphens, casing preserved (e.g. `sensor/kitchen/temp` → `sensor-kitchen-temp`)
- **Device type:** first segment, lowercased (e.g. `Valve/garden` → `valve`). This is an open `string`, not a fixed union — any value is accepted.
- **Name derivation:**
  - Known type with ≥2 segments → title-case remaining segments, join with spaces (e.g. `sensor/kitchen/temp` → `Kitchen Temp`)
  - Unknown type with ≥2 segments → title-case all segments, join with spaces (e.g. `thermostat/living/temp` → `Thermostat Living Temp`)
  - Single segment → title-case that segment (e.g. `heartbeat` → `Heartbeat`)
- Returns `null` only for truly invalid inputs: empty string, non-string, or all-empty segments after splitting on `/`

**`KNOWN_TYPES`** is a `ReadonlySet<string>` containing commonly recognized device types (`sensor`, `switch`, `light`, `climate`, `plug`, `valve`, `pump`, `motion`, `fan`, `lock`, `cover`). It is used as a heuristic hint for name derivation and capability inference — not as a gate. Topics with types outside this set are still fully parsed and accepted.

**`prettyPrintTopic(parsed)`** reconstructs a canonical MQTT topic string from a `ParsedTopic` by splitting the `deviceId` on hyphens and joining with `/`. Useful for round-trip verification and debugging.

### Device Registry (`src/core/device-registry.ts`)

In-memory device cache backed by SQLite for persistence across restarts.

- Upsert: creates new device on first message, updates state on subsequent
- For new devices, uses `event.name` from the NormalizedEvent when present (populated by the MQTT service from `ParsedTopic.name`). Falls back to `deriveNameFromId(deviceId)` — splitting on hyphens and title-casing segments — for non-MQTT event sources (connectors, services) that don't provide a name
- Infers capabilities from the device type string using a `KNOWN_TYPES`-based heuristic (light → on/off + brightness, sensor → temperature, plug → on/off + energy, valve → on/off, fan → on/off + speed, etc.). Unknown device types get an empty capabilities array — they are still stored and tracked, just without inferred capabilities.
- Emits `ws:state-change` events for WebSocket broadcast
- Serialize/deserialize round-trip for SQLite storage

### Automation Engine (`src/automations/automation-engine.ts`)

Evaluates code-driven rules against incoming device events. Supports three rule types: file-based DSL rules, form-based UI rules, and script-based TypeScript rules. Supports two trigger modes: MQTT topic matching and cron scheduling.

- TypeScript DSL: `when(topic).if(condition).then(action)`
- MQTT wildcard matching (`#` multi-level, `+` single-level)
- Cron-triggered rules: rules with `triggerType: "cron"` and a `cronExpression` are scheduled via `CronTimerManager` instead of matching MQTT events
- Fault isolation: one rule throwing doesn't affect others
- Loads rule files from `automations/` directory on startup
- Script rules are dispatched through the Sandbox (isolated-vm) with execution timing
- Form rules are dispatched through the ActionExecutor pipeline
- Records every execution in the ExecutionLog with duration and success/failure status

### Cron Trigger System

Automations can be triggered by cron schedules instead of (or in addition to) MQTT topic events. This enables time-based automations like "dim lights at sunset" or "check sensor health every 5 minutes".

**Backend components:**

- `CronTimerManager` (`src/automations/cron-timer-manager.ts`) — manages per-rule `node-cron` scheduled tasks. When a rule with `triggerType: "cron"` is registered, the engine starts a timer that fires the rule's action on schedule. Timers are stopped when rules are unregistered or the engine is disposed.
- `cron-utils.ts` (`src/automations/cron-utils.ts`) — shared utilities: `isValidCron(expression)` validates five-field cron syntax via `node-cron`, `describeCron(expression)` converts to human-readable text, and `CRON_PRESETS` provides common schedule options.

**Frontend components:**

- `TriggerSelector` (`frontend/src/components/TriggerSelector.tsx`) — inline trigger type selector used in the AutomationPane setup/editing mode. Offers three modes: MQTT Topic (text input with wildcard support), Schedule (cron preset dropdown + custom picker with interval/daily modes), or None (manual-only). Reports validity back to the parent via `onValidityChange`.
- `cron-utils.ts` (`frontend/src/lib/cron-utils.ts`) — client-side cron validation (regex-based, no `node-cron` dependency), `describeCron()` for human-readable labels, and `CRON_PRESETS` matching the backend presets.
- `ScheduleViewerPane` (`frontend/src/components/panes/ScheduleViewerPane.tsx`) — dashboard pane that lists all cron-triggered automations with their schedule descriptions and next-fire indicators.

**Database schema additions:**

The `automation_rules` table includes:
- `trigger_type TEXT NOT NULL DEFAULT 'mqtt'` — either `'mqtt'`, `'cron'`, or `'none'`
- `cron_expression TEXT DEFAULT NULL` — five-field cron expression (e.g. `*/5 * * * *`)

**How it works:**
1. User selects "Schedule" in the TriggerSelector and picks a preset or builds a custom expression
2. On save, the rule is stored with `trigger_type: "cron"` and the expression
3. On registration, the AutomationEngine detects `triggerType === "cron"` and starts a `CronTimerManager` timer
4. On each cron fire, the engine constructs a synthetic `EventContext` with topic `cron/{ruleName}` and dispatches through the normal execution pipeline (sandbox for script rules, ActionExecutor for form rules)
5. Execution is logged identically to MQTT-triggered rules

### Condition Registry (`src/automations/condition-registry.ts`)

Factory registry for condition predicates, keyed by condition type string. Replaces the previous inline if/else chain in `registerUiRule()` with a uniform registration pattern — adding a new condition type means calling `registerCondition()` and nothing else.

- `ConditionFactory` type: `(conditionValue: string) => (ctx: EventContext) => boolean`
- `registerCondition(type, factory)` — register a factory for a condition type (overwrites if already registered)
- `unregisterCondition(type)` — remove a factory (no-op if not registered)
- `buildCondition(type, value)` — looks up the factory by type, calls it with the value, and returns the predicate. Returns `undefined` and logs a warning if the type is unregistered or if type/value are null
- At bootstrap, the three built-in condition types are registered via the same `registerCondition()` API that connectors use:
  - `value_above` — `(v) => (ctx) => Number(ctx.state.value) > Number(v)`
  - `value_below` — `(v) => (ctx) => Number(ctx.state.value) < Number(v)`
  - `equals` — `(v) => (ctx) => String(ctx.state.value) === v`
- `registerUiRule()` in `automation.routes.ts` uses `conditionRegistry.buildCondition()` to build condition predicates from stored rule data

### Action Executor (`src/automations/action-executor.ts`)

Central dispatch service for all automation actions. Every action — whether from a form rule, script rule, or file-based rule — flows through this single pipeline. Uses a **handler registry** pattern — a `Map<string, ActionHandler>` — instead of a switch statement, so adding a new action type means calling `registerHandler()` and nothing else.

- `ActionDescriptor.type` is an open `string`, not a fixed union — any action type is accepted
- `registerHandler(type, handler)` — register a handler for an action type (overwrites if already registered)
- `unregisterHandler(type)` — remove a handler (no-op if not registered)
- At bootstrap, the six built-in handlers are registered via the same `registerHandler()` API that connectors use:
  - `publish` — publishes an MQTT message via `MqttService.publish()`
  - `toggle` — toggles a device via `ConnectorManager.executeAction()`
  - `device_action` — executes an arbitrary device action via `ConnectorManager.executeAction()`
  - `log` — logs a message from an automation rule
  - `delay` — pauses execution for a specified duration (`setTimeout` wrapper)
  - `webhook` — sends an HTTP request via `fetch()` with configurable method, headers, and body
- `execute()` looks up the handler by `action.type` in the registry; if no handler is found, logs a warning with the unrecognised type and rule ID
- Each action is wrapped in try/catch — errors are logged with the rule ID, never thrown
- Emits `AUTOMATION_FIRED` on the event bus after each successful action
- `executeSequence()` runs actions in order, continuing on individual failures

### TypeScript Transpiler (`src/automations/transpiler.ts`)

Handles TypeScript → JavaScript compilation using the TypeScript compiler API (`ts.transpileModule()`). Provides two transpilation functions for different contexts.

**`transpile(source)` — Automation logic scripts:**
- Strips type annotations and produces ES2022-compatible JavaScript output
- Rejects empty source strings with a descriptive error
- Rejects source containing `import` or `require` statements via regex pre-check before transpilation
- Returns structured errors with `line`, `column`, and `message` for the frontend to display inline
- Does not perform full type checking — only syntactic transpilation (type checking happens in the Monaco editor via the `.d.ts` bundle)

**`transpileUi(source)` — Custom UI components (TSX):**
- Transpiles TSX source to ES module JavaScript with `jsx: react-jsx` and `jsxImportSource: "react"`
- Allows `import` statements (unlike `transpile()` which rejects them) — UI components need to import React and JSX runtime
- Produces ES2022 ESNext module output suitable for dynamic `import()` in the browser
- Rejects empty source strings with a descriptive error
- Returns structured errors with `line`, `column`, and `message` on syntax failures
- Called by POST/PUT automation routes on save; the compiled output is stored in the `compiled_ui` column

### Sandbox (`src/automations/sandbox.ts`)

Secure execution environment for user-authored automation scripts using `isolated-vm`. The Monaco editor runs in TypeScript mode for IntelliSense, but in practice most scripts are plain JavaScript — TypeScript annotations are optional and stripped at save time by the transpiler.

- Creates a fresh V8 isolate per execution with a 32 MB memory limit
- Enforces a 5-second execution timeout to prevent infinite loops
- Exposes a controlled API surface as globals: `devices`, `mqtt`, `log`, `context`, `services`, `http`, `automation`, `state`, `db`
- `devices.get/list/filter` — synchronous, data copied into isolate via `ivm.ExternalCopy`
- `devices.action()` and `mqtt.publish()` — host-side callbacks via `ivm.Reference` delegating to ActionExecutor
- `log.info/warn/error` — host-side callbacks delegating to the application logger with ruleId context
- `context` — frozen object with `topic`, `deviceId`, `state`, `timestamp` from the triggering event
- `services.get(type)` — returns read-only snapshot of a service's state, or `undefined` if not running
- `services.list()` — returns `[{ type, displayName, running }]` for all registered services
- `http.get(url, opts?)` — async GET request via host-side `fetch()` with 10-second timeout, returns `{ status, body }`. Logs a warning if plain HTTP is used for non-local URLs (HTTPS recommended for external APIs)
- `http.post(url, opts?)` — async POST request via host-side `fetch()` with 10-second timeout, returns `{ status, body }`. Logs a warning if plain HTTP is used for non-local URLs (HTTPS recommended for external APIs)
- `automation({ conditions?, actions })` — structured helper that evaluates conditions (AND logic) and runs actions; supports arrays of named functions for flow diagram visualization
- `state.get(key)` — read a value from the per-rule state store (from in-memory cache)
- `state.set(key, value)` — write a JSON-serializable value; persists to SQLite and broadcasts via WebSocket
- `state.getAll()` — returns all key-value pairs for the current rule as a plain object
- `state.delete(key)` — remove a key from the state store
- `db` — Data Store interface (undefined when Data Store is disabled):
  - `db.write(collection, payload, options?)` — write a record to a time-series collection (auto-creates collection if needed)
  - `db.query(collection, options?)` — query records with time-range filtering, tag filtering, pagination, and aggregation
  - `db.get(bucket, key)` — get a value from a key-value bucket (returns undefined if not found)
  - `db.set(bucket, key, value)` — set a key-value pair in a bucket
  - `db.delete(bucket, key)` — delete a key from a bucket
  - `db.collections()` — list all collections with metadata
- Blocks access to `require`, `import`, `process`, `fs`, `child_process`, `eval`, `Function`, `global`
- Graceful fallback: if `isolated-vm` is not available (e.g. Windows dev without C++ toolchain), sandbox execution is disabled with a warning

### Structured Metadata Extractor (`src/automations/structured-metadata-extractor.ts`)

Best-effort extraction of `automation()` call metadata from transpiled JavaScript for flow diagram visualization.

- Parses the `automation({ conditions: [...], actions: [...] })` pattern from compiled JS
- Extracts named function names from arrays (e.g. `function isLowLight(ctx)` → `"isLowLight"`)
- Falls back to extracting function body text for anonymous/arrow functions
- Supports both array form (`conditions: [fn1, fn2]`) and legacy single-function form (`condition: fn`)
- Returns `StructuredMetadata` with `trigger`, `conditions: string[]`, and `actions: string[]`
- Returns `null` if the code doesn't use the `automation()` helper (free-form scripts)

### Snippet Catalog (`src/automations/snippet-catalog.ts`)

Aggregates platform-level and connector-provided code snippets for the automation script editor.

- Platform snippets organized into categories: MQTT, HTTP, Conditions, Devices, Services, Templates
- Connector snippets pulled from each registered connector's optional `snippets` export
- Connector snippets are grouped under the connector's display name (e.g. "Philips Hue", "TP-Link Kasa")
- Served via `GET /api/automations/snippets` as an array of `SnippetGroup` objects
- Each snippet has `id`, `name`, `description`, and `code` (TypeScript to insert at cursor)
- New connectors automatically contribute snippets by exporting a `snippets: SnippetDescriptor[]` array

### Automation State Store (`src/automations/automation-state-store.ts`)

Per-rule key-value store enabling bidirectional communication between backend automation scripts and frontend custom UI components.

- In-memory `Map<string, Map<string, unknown>>` cache for fast reads from the sandbox
- SQLite persistence in the `automation_state` table (composite primary key: `rule_id` + `key`)
- Values are JSON-serialized for storage; non-serializable values are silently skipped with a warning
- `set(ruleId, key, value)` — writes to SQLite, updates cache, triggers `AUTOMATION_STATE_CHANGE` event on the event bus
- `get(ruleId, key)` — reads from cache (no DB hit)
- `getAll(ruleId)` — returns all key-value pairs for a rule as a plain object
- `delete(ruleId, key)` — removes from SQLite and cache
- `deleteAll(ruleId)` — removes all state for a rule (called on rule deletion)
- `loadFromDb()` — populates cache from SQLite on startup; malformed JSON entries are skipped with a warning
- Exposed to automation scripts via the `state` sandbox global
- State changes are broadcast to all WebSocket clients via the `AUTOMATION_STATE_CHANGE` event

### Runtime UI Module Loading

Custom automation UI components are transpiled on the backend at save time and loaded dynamically in the browser at runtime — no Docker rebuild or Vite recompilation required.

**Backend (`transpileUi()` + `compiled_ui` column):**
- When a POST or PUT request includes `uiSource`, the route calls `transpileUi(uiSource)` to produce an ES module JavaScript string
- The compiled output is stored in the `compiled_ui` column of the `automation_rules` table alongside the original `ui_source`
- `GET /api/automations/:id/ui-module` serves the compiled JS with `Content-Type: application/javascript` and `Cache-Control: no-cache`
- Returns 404 if the rule has no compiled UI module

**Frontend (`useDynamicComponent` hook + `window.__AEOLUS_EXTERNALS__`):**
- `main.tsx` registers `window.__AEOLUS_EXTERNALS__` with references to `React`, `ReactDOM`, and `react/jsx-runtime` so dynamically loaded modules can resolve React imports without bundling their own copy
- The `useDynamicComponent(ruleId, hasUiSource)` hook fetches the compiled JS from `/api/automations/:id/ui-module`
- `rewriteImports(source)` converts ES module import statements for `react`, `react-dom`, and `react/jsx-runtime` into destructuring assignments from `window.__AEOLUS_EXTERNALS__` (e.g. `import { jsx as _jsx } from "react/jsx-runtime"` becomes `const { jsx: _jsx } = window.__AEOLUS_EXTERNALS__["react/jsx-runtime"]`)
- The rewritten source is loaded via a blob URL + dynamic `import()`, then the default export is validated as a React component
- `AutomationPane` uses the `useDynamicComponent` hook via a `DynamicCustomSection` helper component (extracted to satisfy React's rules of hooks)
- Components render inside a `CustomComponentBoundary` error boundary for crash isolation

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

### WebSocket Server (`src/websocket/ws-server.ts`)

Real-time push layer that broadcasts internal event bus events to connected browser clients. Uses a **data-driven event mapping** pattern — event-to-message-type mappings are passed at construction as a `WsEventMapping[]` array, with no hardcoded event listeners in the source.

```typescript
interface WsEventMapping {
  eventName: string;   // Internal event bus event name
  messageType: string; // WebSocket message type sent to clients
}
```

- At construction, iterates over the provided mappings and registers a broadcast listener on the event bus for each entry
- Adding a new real-time event type means adding an entry to the mapping list at the construction site — no changes to `ws-server.ts` required
- The four current mappings are: `WS_STATE_CHANGE` → `"state-change"`, `MQTT_RAW_MESSAGE` → `"mqtt-message"`, `AUTOMATION_FIRED` → `"automation-fired"`, `AUTOMATION_STATE_CHANGE` → `"automation-state"`
- On client connection, sends an initial snapshot of all devices from the DeviceRegistry
- Tracks connected clients and broadcasts JSON messages to all open connections

### Connector Framework

The connector framework is a pluggable architecture that replaces the previous hardcoded integration system. Each connector is a self-contained module in `src/connectors/{name}/` that exports metadata, a config schema, a factory function, and optionally `actionHandlers` and `conditions` to extend the automation system.

Connector devices flow through the same `DEVICE_STATE_CHANGE` event bus as MQTT devices, using synthetic topics in the format `connector/{integration}/{deviceId}`. This unifies the device pipeline so automations can match on connector device events using the standard topic pattern system.

Each connector module optionally exports a `snippets: SnippetDescriptor[]` array — code templates for the automation script editor that appear grouped under the connector's display name in the snippet picker. Connectors can also optionally export `actionHandlers: Record<string, ActionHandler>` and `conditions: Record<string, ConditionFactory>` to contribute custom action handlers and condition factories to the automation system. When a connector is enabled, the ConnectorManager registers these with the ActionExecutor and ConditionRegistry respectively; when disabled, they are unregistered. This is part of the connector developer contract: when building a new connector, ship snippets, action handlers, and condition factories alongside it so users can write automations for your devices.

#### ConnectorRegistry (`src/connectors/connector-registry.ts`)

Auto-discovery and manual registration of connector modules.

- Manual registration via `register(module)` for bundled builds
- Filesystem auto-discovery via `discoverFromDirectory(dir)` for development
- Validates module shape: must export `metadata`, `configSchema`, and `createConnector`
- Skips `_template` directory and files starting with `connector`

#### ConnectorManager (`src/connectors/connector-manager.ts`)

Lifecycle management for enabled connector instances.

- Enable: validate type → instantiate via factory → connect → discover devices → register contributed action handlers and condition factories → persist → start polling
- Disable: unregister contributed action handlers and condition factories → stop polling → disconnect → dispose → remove devices → update store
- Tracks which action handler types and condition types each connector instance contributed (via internal `contributedHandlers` and `contributedConditions` maps) for cleanup on disable
- Config update: apply new config at runtime without full reconnect
- Retry: re-attempt connection for disconnected connectors
- Setup steps: `getSetupSteps(instanceId)` returns setup step descriptors for a connector; `executeSetupStep()` delegates multi-step setup flows (e.g. Hue button-press pairing)
- Action routing: route device actions to the correct connector by `integration` field; emits an immediate `DEVICE_STATE_CHANGE` event with optimistic state after action succeeds (for toggle actions, flips the `on` state; for other actions, merges params) — no waiting for the 60-second polling cycle
- Restore: re-enable previously enabled connectors from SQLite on startup, including re-registering contributed handlers and conditions
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
- Discovers lights and maps them to Aeolus Device format with capability-aware state
- Capability mapping: detects light type ("Extended color light", "Color temperature light", "Dimmable light", "On/Off plug-in unit", "On/Off light") and assigns appropriate capability sets
- Supports toggle, brightness, color (hue/saturation), and color-temperature (mirek) actions
- Validates actions against device capabilities — rejects unsupported actions with descriptive errors
- Zigbee light search: POST to bridge starts a ~40s scan for new unpaired lights
- Firmware update awareness: reads `swupdate2` from bridge config and surfaces update availability in health status
- Contributed action handlers: `hue_scene` (activate a Hue scene by name), `hue_color_loop` (start/stop a color loop on a light)
- Contributed condition factories: `brightness_above` (check if a light's brightness exceeds a threshold)
- Frontend pane: `HueControlPane.tsx` — capability-driven controls (toggle, brightness slider, color temperature slider, colour picker), type badges, reachability indicators, search-for-new-lights button, firmware update banner

##### Hue Connector Prerequisites

**What the user needs before Aeolus can control Hue lights:**

- A Philips Hue bridge powered on and connected to the same LAN as the device running Aeolus
- New lights powered on and within Zigbee range of the bridge (Aeolus can pair them via the built-in search)
- The bridge must be reachable from the Aeolus host (same subnet or routable)

**What Aeolus handles:**

- Auto-discovers the bridge on the local network via the Meethue discovery service
- Pairs with the bridge via the link button (no Hue app needed)
- Searches for and pairs new unpaired lights via Zigbee scan (no Hue app needed)
- Controls all lights on the bridge: toggle, brightness, color (hue/saturation), color temperature (mirek)
- Detects light types and exposes capability-appropriate controls and state fields
- Polls for state changes every 60 seconds
- Detects available firmware updates and surfaces them in the UI

**What Aeolus does NOT handle:**

- Factory-resetting a light that is already paired to a different bridge (requires the Hue app or a Zigbee touchlink reset device)
- Firmware updates to lights or the bridge (use the Hue app — Aeolus only notifies)
- Creating or editing Hue Entertainment zones (use the Hue app)
- Hue Sync or streaming features

#### Kasa Connector (`src/connectors/kasa/`)

TP-Link Kasa smart plugs and switches via local Wi-Fi.

- Metadata: id `"kasa"`, icon `"plug"`, supports `["plug", "light", "switch"]`, no setup required
- Config schema: `broadcastAddress` (text, optional, default `"255.255.255.255"`), `discoveryTimeout` (number, optional, default `10000`)
- Auto-discovers devices via UDP broadcast
- Supports toggle and energy monitoring actions
- Contributed action handlers: `kasa_energy_report` (log current energy usage for a device)
- Contributed condition factories: `power_above` (check if a plug's power draw exceeds a threshold)
- Frontend pane: `KasaControlPane.tsx` — toggle, device type badge, energy monitoring stats (voltage, current, power, kWh)

#### Connector Frontend Panes

The backend connector framework is fully self-contained — connector devices appear in the Device Grid pane and the Connectors management page automatically with no frontend changes. However, each built-in connector also ships a dedicated control pane with connector-specific UI (colour pickers, energy stats, etc.) registered in the pane registry under the `"controls"` category.

New connectors should consider building a frontend pane when they have device-specific controls that don't fit the generic Device Grid. The pattern is:
1. Create a pane component in `frontend/src/components/panes/` that filters devices by `integration === "your-connector-id"`
2. Register it in `frontend/src/lib/pane-registry.ts` under the `"controls"` category
3. Use `useDeviceStore` for live state and `sendAction()` from `lib/api-client.ts` for device actions

See `HueControlPane.tsx` and `KasaControlPane.tsx` for reference implementations, and `src/connectors/README.md` for the full developer guide including a pane component template.

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

The `services` global is available in automation scripts alongside `devices`, `mqtt`, `log`, `context`, `http`, `automation`, and `state`:

- `services.get(serviceType)` — returns a read-only snapshot of the service's `getState()`, or `undefined` if not running
- `services.list()` — returns `[{ type, displayName, running }]` for all registered services

### Data Store (`src/data-store/data-store.ts`)

Persistent time-series and key-value storage system built on the existing sql.js (pure JS SQLite) infrastructure. Enables automations to accumulate structured data over time, share computed values across rules, and query historical records with aggregation.

**Purpose:** Provide a durable storage layer for automation scripts that need to persist data beyond a single execution — sensor data logging, rolling averages, cross-rule state sharing, and historical trend analysis.

**Architecture:** A single `DataStore` class receives the sql.js `Database` instance and an `EventEmitter` (the internal event bus). All logic — write, query, buckets, retention, config, safeguards — lives in this one class, mirroring the existing `StateHistory` and `ConnectorStore` patterns.

**Disabled by default:** The `ds_config` table stores an `enabled` flag. When disabled, the sandbox `db` global is `undefined` and REST write endpoints return 503. A setup wizard on first visit guides users through storage limits to prevent accidental SD card fill on Raspberry Pi.

#### DataStore Class Methods

```typescript
class DataStore {
  constructor(db: Database, eventBus: EventEmitter, config?: Partial<DataStoreConfig>);

  // Lifecycle
  isEnabled(): boolean;
  enable(config: DataStoreConfig): void;
  disable(): void;
  getConfig(): DataStoreConfig;
  updateConfig(partial: Partial<DataStoreConfig>): void;

  // Time-series operations
  write(collection: string, payload: Record<string, unknown>, options?: WriteOptions): void;
  query(collection: string, options?: QueryOptions): QueryResult;

  // Key-value bucket operations
  get(bucket: string, key: string): unknown | undefined;
  set(bucket: string, key: string, value: unknown): void;
  delete(bucket: string, key: string): void;
  listBucket(bucket: string): Array<{ key: string; value: unknown; updatedAt: number }>;
  listBuckets(): Array<{ bucket: string; keyCount: number }>;

  // Collection management
  createCollection(name: string, description?: string, retentionDays?: number | null): void;
  updateCollection(name: string, updates: { description?: string; retentionDays?: number | null }): void;
  deleteCollection(name: string): void;
  listCollections(): CollectionMetadata[];
  getStats(): DataStoreStats;

  // Retention enforcement (called by internal hourly timer)
  enforceRetention(): void;
  startRetentionTimer(): void;
  stopRetentionTimer(): void;
  dispose(): void;
}
```

#### Duration Parser Module (`src/data-store/duration.ts`)

Pure functions with no side effects or dependencies — ideal for property-based testing.

- `parseDuration(input: string): number` — Parse a duration string like `"7d"`, `"24h"`, `"30m"` into milliseconds
- `formatDuration(ms: number): string` — Format milliseconds back into the shortest valid duration string
- Supported units: `m` (minutes), `h` (hours), `d` (days), `w` (weeks), `y` (years)
- Throws a descriptive error for invalid inputs (empty strings, decimal numbers, unknown suffixes, negative numbers)

#### Configuration and Safeguards

```typescript
interface DataStoreConfig {
  enabled: boolean;
  maxStorageMb: number;           // Default: 500 — maximum estimated storage before writes are rejected
  maxRecordsPerCollection: number; // Default: 100,000 — triggers FIFO eviction when exceeded
  maxCollections: number;          // Default: 50 — maximum number of collections allowed
}
```

#### FIFO Eviction Behavior

When a write would cause a collection to exceed `maxRecordsPerCollection`, the oldest records are deleted first to make room for the new record. The newest write is always preserved. This approach preserves the most recent data rather than rejecting the write entirely.

#### Retention Enforcement

An internal timer runs every hour (3,600,000 ms) and deletes records older than `retentionDays` for each collection that has a retention policy set. Collections with `retentionDays = null` keep records forever. Errors during enforcement are logged and do not affect other collections.

#### Event Emission

- `DATA_STORE_WRITE` (`"data-store:write"`) — emitted after every successful write with `{ collection, record }`
- `DATA_STORE_COLLECTION_DELETED` (`"data-store:collection-deleted"`) — emitted when a collection is deleted with `{ collection }`

These events are broadcast to WebSocket clients via the existing `WS_MAPPINGS` array for real-time frontend updates.

#### Enable/Disable Lifecycle

- **Enable:** Called via `POST /api/data-store/enable` with config values. Persists config to `ds_config` table, sets `enabled = true`. The sandbox `db` global becomes available on next script execution.
- **Disable:** Called via `POST /api/data-store/disable`. Sets `enabled = false` in config. Existing data is preserved. The sandbox `db` global becomes `undefined`.

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
Create a new automation rule (form or script). For script rules, include `ruleType: "script"` and `scriptSource`. Optionally include `uiSource` for custom UI component TSX source.
```json
{
  "name": "Smart heating",
  "triggerTopic": "sensor/+/temperature",
  "ruleType": "script",
  "scriptSource": "if (context.state.value < 18) {\n  devices.action('climate-living-room', 'setTemperature', { target: 22 });\n}",
  "uiSource": "export default function MyUI(props: CustomComponentProps) { ... }"
}
```
Returns `{ "success": true, "id": "..." }`. 400 if transpilation fails (with `details` array of `{ line, column, message }`).

**PUT /api/automations/:id**
Update an existing automation rule. For script rules, re-transpiles the TypeScript source on save. Optionally update `uiSource` — the backend transpiles the TSX via `transpileUi()` and stores the compiled output in the `compiled_ui` column for runtime loading.
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

**GET /api/automations/snippets**
Return the snippet catalog — platform-level snippets plus connector-provided snippets grouped by category.
Returns an array of `SnippetGroup` objects: `[{ category, icon, snippets: [{ id, name, description, code }] }]`.

**GET /api/automations/types**
Serve the sandbox type definition bundle (`sandbox-types.d.ts`) as `text/plain`. The Monaco editor fetches this on mount to provide IntelliSense for `devices`, `mqtt`, `log`, `context`, `services`, `http`, `automation`, and `state` globals.

**GET /api/automations/ui-types**
Serve the custom UI component type definition bundle (`ui-types.d.ts`) as `text/plain`. The UiEditor fetches this on mount to provide IntelliSense for `CustomComponentProps`, React hooks, and JSX types.

**GET /api/automations/:id/state**
Return all key-value state pairs for an automation rule from the AutomationStateStore.
Returns `{ "key1": "value1", "key2": 42 }` — a flat object of key-value pairs.

**PUT /api/automations/:id/state**
Set a key-value pair in the automation state store. The value is persisted to SQLite and broadcast to all WebSocket clients via `AUTOMATION_STATE_CHANGE`.
```json
{ "key": "avgTemp", "value": 22.5 }
```
Returns `{ "success": true }`. 400 if key or value missing.

**DELETE /api/automations/:id/state/:key**
Delete a single key from the automation state store.
Returns `{ "success": true }`. 404 if rule not found.

**POST /api/automations/:id/fire**
Manually fire a specific automation rule by ID, bypassing topic matching. Executes the rule's action directly with a synthetic context. Works for any automation regardless of trigger topic.
Returns `{ "success": true }`. 404 if rule not found.

**GET /api/automations/history**
Return execution log entries from the in-memory ring buffer (newest first).
Query parameters:
- `limit` (optional) — number of entries to return

Returns an array of `ExecutionLogEntry` objects.

**GET /api/automations/:id/ui-module**
Serve the compiled UI module JavaScript for a specific automation rule. The response is the transpiled ES module output from `transpileUi()`, served with `Content-Type: application/javascript` and `Cache-Control: no-cache`. The frontend's `useDynamicComponent` hook fetches this endpoint to load custom UI components at runtime.
Returns the compiled JavaScript as a plain text response. 404 if the rule is not found or has no compiled UI module.

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

### Data Store API

All Data Store endpoints are mounted at `/api/data-store`. Write operations return 503 when the Data Store is disabled.

**GET /api/data-store/collections**
List all collections with metadata (name, description, retentionDays, recordCount, oldestRecord, newestRecord, createdAt, updatedAt).
Returns `CollectionMetadata[]`. 200.

**POST /api/data-store/collections**
Create a new collection.
```json
{ "name": "temperatures", "description": "Kitchen sensor readings", "retentionDays": 30 }
```
Returns `{ "success": true }`. 201. 400 if name missing, 409 if collection already exists.

**PATCH /api/data-store/collections/:name**
Update collection description or retention policy.
```json
{ "description": "Updated description", "retentionDays": 7 }
```
Returns `{ "success": true }`. 200. 404 if collection not found.

**DELETE /api/data-store/collections/:name**
Delete a collection and all its records. Emits `DATA_STORE_COLLECTION_DELETED` event.
Returns `{ "success": true }`. 200. 404 if collection not found.

**POST /api/data-store/collections/:name/records**
Write a record to a collection. Auto-creates the collection if it doesn't exist.
```json
{ "payload": { "value": 23.5, "unit": "°C" }, "tags": { "sensor": "kitchen-temp" } }
```
Returns `{ "success": true }`. 201. 400 if payload missing or not an object, 503 if Data Store disabled, 404 if collection not found.

**GET /api/data-store/collections/:name/records**
Query records with filtering, pagination, and aggregation.
Query parameters:
- `from` (optional) — duration string (`"7d"`, `"24h"`) or epoch ms
- `to` (optional) — epoch ms (defaults to now)
- `limit` (optional) — max records to return
- `offset` (optional) — skip N records for pagination
- `tags` (optional) — JSON string of tag key-value pairs to filter by
- `aggregate` (optional) — `sum`, `avg`, `min`, `max`, or `count`
- `field` (optional) — required when aggregate is specified

Returns `{ records: DataRecord[], total: number }` for normal queries or `{ value: number }` for aggregation queries. 200. 400 for invalid parameters.

**GET /api/data-store/collections/:name/export**
Export all records in a collection as CSV. Response has `Content-Type: text/csv` and `Content-Disposition: attachment` headers.

**GET /api/data-store/buckets**
List all buckets with key counts.
Returns `Array<{ bucket: string, keyCount: number }>`. 200.

**GET /api/data-store/buckets/:bucket**
List all entries in a bucket.
Returns `Array<{ key: string, value: unknown, updatedAt: number }>`. 200.

**PUT /api/data-store/buckets/:bucket/:key**
Set a key-value pair in a bucket.
```json
{ "value": 42 }
```
Returns `{ "success": true }`. 200. 400 if value field missing, 503 if Data Store disabled.

**DELETE /api/data-store/buckets/:bucket/:key**
Delete a key from a bucket.
Returns `{ "success": true }`. 200. 503 if Data Store disabled.

**GET /api/data-store/config**
Return current DataStore configuration.
Returns `DataStoreConfig` object. 200.

**PUT /api/data-store/config**
Update configuration values (validates numeric fields are positive).
```json
{ "maxStorageMb": 1000, "maxRecordsPerCollection": 200000 }
```
Returns `{ "success": true }`. 200. 400 if invalid values.

**GET /api/data-store/stats**
Return storage statistics.
Returns `DataStoreStats` object with `totalRecords`, `totalBucketEntries`, `totalCollections`, `estimatedStorageMb`, `maxStorageMb`, `storagePercent`. 200.

**POST /api/data-store/enable**
Enable the Data Store with provided configuration.
```json
{ "maxStorageMb": 500, "maxRecordsPerCollection": 100000, "maxCollections": 50 }
```
Returns `{ "success": true }`. 200. 400 if required fields missing or invalid.

**POST /api/data-store/disable**
Disable the Data Store. Existing data is preserved.
Returns `{ "success": true }`. 200.

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

**Server → Client: Automation state change**
```json
{ "type": "automation-state", "data": { "ruleId": "...", "key": "avgTemp", "value": 22.5 } }
```
Broadcast whenever a script calls `state.set(key, value)` or the REST API updates state via `PUT /api/automations/:id/state`.

**Server → Client: Data Store write**
```json
{ "type": "data-store-write", "data": { "collection": "temperatures", "record": { "id": 42, "collection": "temperatures", "payload": { "value": 23.5 }, "tags": { "sensor": "kitchen" }, "timestamp": 1711806244000 } } }
```
Broadcast whenever a record is written to a Data Store collection (via sandbox `db.write()` or REST API).

**Server → Client: Data Store collection deleted**
```json
{ "type": "data-store-collection-deleted", "data": { "collection": "temperatures" } }
```
Broadcast when a collection is deleted via the REST API.

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
  /** Human-readable device name from ParsedTopic. Populated by the MQTT service. */
  name?: string;
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
  type: string;                 // Open string — any registered action type (e.g. "publish", "toggle", "hue_scene")
  target: string;               // topic for publish, deviceId for toggle/device_action, URL for webhook
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

### StructuredMetadata
```typescript
interface StructuredMetadata {
  trigger: string;       // The trigger topic from the rule
  conditions: string[];  // Named function names or body text from conditions array
  actions: string[];     // Named function names or body text from actions array
}
```

### SnippetDescriptor
```typescript
interface SnippetDescriptor {
  id: string;          // Unique snippet identifier (scoped to connector or platform)
  name: string;        // Short display name in the snippet picker
  description: string; // One-line description
  code: string;        // TypeScript code to insert at cursor
}

interface SnippetGroup {
  category: string;    // Group label (e.g. "MQTT", "Philips Hue", "Conditions")
  icon: string;        // Lucide icon name for the category
  snippets: SnippetDescriptor[];
}
```

### CustomComponentProps
```typescript
interface CustomComponentProps {
  devices: Device[];
  ruleId: string;
  ruleName: string;
  lastFired: number | null;
  enabled: boolean;
  deviceAction: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  mqttPublish: (topic: string, payload: string) => void;
  executionHistory: ExecutionEntry[];
  state: Map<string, unknown>;       // Live key-value state from AutomationStateStore, updated via WebSocket
  stateSet: (key: string, value: unknown) => void;  // Write back to the state store (persisted + broadcast)
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
  type TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT '{}',
  integration TEXT NOT NULL DEFAULT 'mqtt',
  last_seen INTEGER NOT NULL
);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_topic TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'mqtt',
  cron_expression TEXT DEFAULT NULL,
  condition_type TEXT,
  condition_value TEXT,
  action_type TEXT NOT NULL DEFAULT 'log',
  action_target TEXT NOT NULL DEFAULT '',
  action_params TEXT NOT NULL DEFAULT '{}',
  rule_type TEXT NOT NULL DEFAULT 'form' CHECK(rule_type IN ('form', 'script')),
  script_source TEXT DEFAULT NULL,
  compiled_js TEXT DEFAULT NULL,
  structured_metadata TEXT DEFAULT NULL,
  ui_source TEXT DEFAULT NULL,
  compiled_ui TEXT DEFAULT NULL,
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

CREATE TABLE automation_state (
  rule_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (rule_id, key)
);

-- Data Store tables
CREATE TABLE ds_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE ds_collections (
  name TEXT PRIMARY KEY,
  description TEXT,
  retention_days INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ds_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL REFERENCES ds_collections(name) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL
);

CREATE TABLE ds_buckets (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, key)
);

-- Data Store indexes
CREATE INDEX idx_ds_records_collection_ts
  ON ds_records(collection, timestamp DESC);

CREATE INDEX idx_ds_records_collection_tags
  ON ds_records(collection, tags);
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| MQTT_BROKER_URL | mqtt://localhost:1883 | Mosquitto broker URL |
| MQTT_TOPICS | # | Comma-separated topic patterns (quote in .env — `#` is a comment character) |
| PORT | 3001 | Backend API port |
| DB_PATH | ./data/aeolus.db | SQLite database file path |
| LOG_LEVEL | debug | pino log level |
| NODE_ENV | development | Environment |
| AEOLUS_PROJECT_DIR | /aeolus-host | Host project directory mounted into the backend container (used by self-update) |
| STATE_HISTORY_MAX | 100 | Maximum history entries stored per device |
| HISTORY_RECORD_INTERVAL | 5000 | Minimum ms between history records per device |

**Note:** MQTT_TOPICS must be quoted in `.env` files because `#` is treated as a comment character by dotenv. The default is `#` (all topics) — this subscribes to every MQTT topic on the broker.

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
| Sandbox | `http.get/post` request fails (network error, timeout) | Returns `{ status: 0, body: errorMessage }` — logged with ruleId, never throws |
| Sandbox | `http.get/post` exceeds 10-second timeout | AbortController cancels request, returns error response |
| Sandbox | `http.get/post` uses plain HTTP for non-local URL | Logs warning with ruleId, method, and URL — request still proceeds (not blocked) |
| Sandbox | isolated-vm not available (Windows dev) | Log warning, sandbox execution disabled, script rules skip |
| Transpiler | Syntax error in TypeScript source | Return 400 with `{ error, details: [{ line, column, message }] }` |
| Transpiler | Source contains import/require (logic scripts only) | Return 400 with descriptive error before transpilation |
| Transpiler | Empty source string | Return 400 with "Script source cannot be empty" or "UI source cannot be empty" |
| Transpiler | TSX compilation error in `transpileUi()` | Return 400 with `{ error: "TSX compilation failed", details: [...] }` |
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
| State Store | Non-serializable value in `state.set()` | Log warning with ruleId and key, silently skip the set operation |
| State Store | Malformed JSON in `automation_state` table | Log warning, skip entry during `loadFromDb()`, continue with remaining entries |
| State Store | Missing rule on state API request | 404 JSON error |
| Custom UI | TSX syntax error in user-authored component | Caught at transpile time by `transpileUi()` — returns 400 with structured errors (line, column, message) |
| Custom UI | Component render error at runtime | Caught by `CustomComponentBoundary` error boundary — shows fallback UI, isolates crash from other panes |
| Custom UI | `useDynamicComponent` fetch fails (network error) | Hook sets error state with "Connection error — could not reach the server", pane shows error banner |
| Custom UI | UI module endpoint returns 404 | Hook sets error state with "Failed to load UI module (404)", pane shows error banner |
| Custom UI | Module has no default export | Hook sets error state with "Module does not export a default component" |
| Custom UI | Module default export is not a function | Hook sets error state with "Module default export is not a valid React component" |
| Custom UI | Dynamic `import()` fails (syntax error in rewritten module) | Hook catches error, sets error message, revokes blob URL to prevent memory leak |
| Custom UI | `rewriteImports()` encounters unknown specifier | Leaves the import statement unchanged (only rewrites `react`, `react-dom`, `react/jsx-runtime`) |

## Design Decisions

- **Data Store disabled by default with setup wizard:** Prevents accidental SD card fill on Raspberry Pi. Users must explicitly enable with configured storage limits, ensuring they understand the implications of persistent data accumulation on constrained hardware.
- **FIFO eviction over hard rejection when collection hits record limit:** Preserves newest data automatically rather than failing writes. For time-series sensor data, recent readings are almost always more valuable than old ones.
- **Duration parser as pure module for property-based testing:** The `src/data-store/duration.ts` module has zero dependencies and no side effects, making it ideal for exhaustive property-based testing with fast-check. Separating it from the DataStore class keeps the test surface clean.
- **Single DataStore class mirrors existing StateHistory/ConnectorStore patterns:** All logic (write, query, buckets, retention, config, safeguards) lives in one class that receives the sql.js Database instance. This consistency makes the codebase predictable — developers familiar with one storage component can immediately understand the others.
- **sql.js over better-sqlite3:** Pure JavaScript avoids native C++ build tools requirement, enabling cross-platform development (Windows → Raspberry Pi) without compilation issues.
- **EventEmitter over message queue:** Simple pub/sub is sufficient at MVP scale. No need for Redis/RabbitMQ for a local-first system.
- **Zustand over Redux:** Lightweight, minimal boilerplate, matches the "clarity over decoration" design principle.
- **Express over Fastify:** Broader ecosystem familiarity, easier WebSocket integration via ws library.
- **Pluggable connector architecture over hardcoded integrations:** Each connector is a self-contained module with metadata, config schema, and factory function. The ConnectorRegistry discovers modules at startup, the ConnectorManager handles lifecycle (enable/disable/poll/action routing), and the ConnectorStore persists state to SQLite. This replaces the previous `src/integrations/` approach where each integration required its own route file and manual wiring. New connectors can be added by creating a directory in `src/connectors/` with the standard module exports — no changes to backend core code required. A `_template/` skeleton is provided for developers. Connector devices automatically appear in the Device Grid pane and can be targeted by automations. For connector-specific controls (colour pickers, energy stats, thermostat setpoints), a dedicated frontend pane component is recommended but optional — see `HueControlPane.tsx` and `KasaControlPane.tsx` as reference implementations.
- **Host networking for LAN device discovery:** The backend container uses `network_mode: host` instead of the shared bridge network. This is required for Kasa's UDP broadcast discovery (which doesn't work across Docker bridge networks) and for direct LAN access to Hue bridges. The trade-off is that the backend port is exposed directly on the host rather than through Docker port mapping, and the MQTT broker URL must use `localhost` instead of the Docker service name.
- **Pinned tabs render dedicated components:** Pinned system tabs (System, Connectors, Data) render their own full-page components directly via React Router `<Route>` elements in `App.tsx`, bypassing the modular pane grid. The System tab (`/dashboard`) renders `SystemHealth`, `DeviceGrid`, and `SystemPage` inline. The Connectors tab (`/connectors`) renders the `ConnectorsPage` component. The Data tab (`/data-store`) renders the `DataStorePage` component (setup wizard when disabled, data explorer when enabled). This gives each system page full control over its layout and styling. Custom (unpinned) tabs use the `TabLayout` component with the pane grid system. This separation keeps system pages polished while maintaining flexibility for user-created tabs.
- **Services Framework mirrors Connector Framework architecture:** The Services Framework deliberately mirrors the Connector Framework's architecture (Module → Registry → Manager → Store) so that anyone familiar with the connector code can immediately understand the services code. Services differ in that they are event producers only — no device discovery, no polling, no action routing. They emit events through the existing `DEVICE_STATE_CHANGE` pipeline using synthetic `service/{type}/{name}` topics, requiring zero changes to the automation engine.
- **`isolated-vm` over Node.js `vm` for sandbox execution:** The Node.js `vm` module is explicitly documented as "not a security mechanism" — it runs code in the same V8 isolate as the host process, allowing escape via prototype pollution and `Function` constructor access. The `vm2` library was deprecated after repeated critical sandbox escape CVEs. `isolated-vm` creates a separate V8 isolate with its own heap, no access to the host's global scope, and built-in support for memory limits (32 MB) and execution timeouts (5 seconds). This is the same isolation primitive used by Cloudflare Workers. For a Raspberry Pi deployment where the automation engine shares a process with the MQTT broker connection and device registry, true V8-level isolation is essential. The tradeoff is that `isolated-vm` is a native addon requiring C++ compilation — the Dockerfile includes `build-essential` and `python3` for ARM64 builds.
- **Monaco over CodeMirror for the script editor:** Monaco is the editor engine behind VS Code. It provides native TypeScript language service integration — IntelliSense, type checking, and error squiggles work out of the box when you register `.d.ts` type definitions via `addExtraLib()`. CodeMirror 6 is lighter but requires significant custom work to achieve comparable TypeScript support. Since the code editor is the centrepiece of the automation overhaul and developer experience is paramount, Monaco is the right choice. The `@monaco-editor/react` wrapper provides clean React integration.
- **TypeScript as a runtime dependency:** The TypeScript compiler API (`ts.transpileModule()`) is used at runtime to transpile user-authored automation scripts on save. This means `typescript` is a production dependency, not just a dev dependency. The tradeoff is a larger production bundle, but it enables on-the-fly transpilation without a separate build step or external service.
- **Generic backend-driven setup wizard:** The ConnectorsPage setup wizard is fully generic — it fetches step descriptors from `GET /api/connectors/:id/setup-steps` and renders them dynamically. No connector-specific UI code exists in the frontend. Each step can include input fields, and the wizard accumulates data across steps, passing it to subsequent step executions and patching the connector config on completion. This means adding a new connector with a multi-step setup flow requires zero frontend changes.
- **3 pinned tabs instead of 5:** Simplified from 5 pinned tabs (Dashboard, Automations, Connectors, Services, System) to 3 (System, Connectors, Data). The System tab renders the device grid, system health, and host diagnostics inline. The Data tab renders the Data Store explorer (setup wizard when disabled, data explorer when enabled). Automations moved to self-contained panes in custom tabs — each automation is one pane, reflecting the code-first philosophy. Services are infrastructure that auto-enable on startup and don't need a dedicated tab. Pinned tabs are hardcoded in the frontend, not stored in the database.
- **One-pane-one-automation pattern:** Each AutomationPane manages a single automation rule through a setup → status → editing state machine. This replaces the previous list-based approach where all automations lived in one page. The pane pattern means automations live alongside the controls they manage in custom tabs, and users can see the flow diagram or activity feed at a glance.
- **Structured `automation()` helper with named function arrays:** The `automation({ conditions: [...], actions: [...] })` helper accepts arrays of named functions. Named functions become labeled nodes in the FlowDiagram SVG. This gives users the flexibility of free-form TypeScript while enabling automatic visualization. Backward compatible with single-function form.
- **Host-side HTTP for sandbox `http` global:** The `http.get/post` sandbox globals delegate to host-side `fetch()` via `ivm.Reference` callbacks rather than allowing network access inside the isolate. This maintains the security boundary — the isolate has no network stack — while enabling external API calls with a 10-second timeout. Errors are caught and returned as `{ status: 0, body: errorMessage }` rather than throwing. Both HTTP and HTTPS are allowed (local LAN services often don't have TLS), but a warning is logged when plain HTTP is used for non-local URLs to nudge users toward HTTPS for internet-facing requests. Local/private network addresses (localhost, 10.x, 172.16-31.x, 192.168.x) are exempt from the warning.
- **Connector-provided code snippets:** Each connector module can optionally export a `snippets` array alongside `metadata`, `configSchema`, and `createConnector`. These snippets appear grouped under the connector's display name in the automation editor's snippet picker. This makes the snippet system extensible — new connectors automatically contribute code templates without any changes to the snippet catalog or frontend. Platform-level snippets (MQTT, HTTP, Conditions, Devices, Services, Templates) are always available regardless of which connectors are installed.
- **Runtime loading for custom UI components via blob URL + dynamic `import()`:** Custom automation UI components are transpiled on the backend at save time (via `transpileUi()`) and stored in the `compiled_ui` column. The frontend loads them at runtime by fetching the compiled JS from `/api/automations/:id/ui-module`, rewriting React import specifiers to reference `window.__AEOLUS_EXTERNALS__`, creating a blob URL, and using dynamic `import()`. This replaces the previous build-time approach (CustomUiManager writing `.tsx` files + Docker frontend rebuild) with instant activation — save and it renders immediately, no rebuild or refresh needed. The tradeoff is that dynamically loaded modules can't be tree-shaken or statically analyzed by Vite, but for small per-automation UI components this is negligible.
- **`window.__AEOLUS_EXTERNALS__` for React dependency resolution:** Dynamically loaded UI modules need access to React, ReactDOM, and the JSX runtime without bundling their own copies (which would cause hook state mismatches). The solution registers these as globals on `window.__AEOLUS_EXTERNALS__` in `main.tsx`, and the `rewriteImports()` function rewrites ES module import statements into destructuring assignments from these globals. This is similar to Webpack's `externals` configuration but works at the source text level for blob URL imports.
- **Per-rule key-value state store for backend↔frontend communication:** The AutomationStateStore provides a simple key-value interface (`state.set/get/getAll/delete`) scoped per automation rule. Values are JSON-serialized to SQLite for persistence and kept in an in-memory cache for fast sandbox reads. State changes emit `AUTOMATION_STATE_CHANGE` events on the event bus, which the WebSocket server broadcasts to all clients. The frontend Zustand store (`automation-state-store.ts`) listens for `automation-state` WebSocket messages and updates reactively. This enables automation scripts to compute values (e.g. rolling averages, counters) that custom UI components can display in real time.
- **Error boundary isolation for custom components:** Each custom automation UI component renders inside a `CustomComponentBoundary` React error boundary. If a component throws during render, the error boundary catches it and displays a fallback UI without crashing the entire pane or dashboard. This is essential because custom components are user-authored code — runtime errors are expected and must be contained.
- **nginx cache-busting strategy:** `index.html` is served with `no-cache, no-store, must-revalidate` headers so the browser always fetches the latest version (which contains hashed asset references). Static assets under `/assets/` are served with `immutable` caching because Vite includes content hashes in filenames — when assets change, the filename changes, so stale caches are never served. The frontend "Refresh Now" button appends a `?_t=timestamp` query parameter for additional cache busting.
- **MQTT subscribe to all topics (`#`):** Changed the default `MQTT_TOPICS` from `sensor/#,switch/#,motion/#,light/#` to `#` (all topics). This simplifies setup for new users — any MQTT device publishing to any topic is automatically discovered. The previous selective subscription required users to know their topic structure upfront and manually configure the filter. The tradeoff is slightly higher message throughput on busy brokers, but for a local-first Raspberry Pi deployment this is negligible.


## Dashboard Features

The React dashboard provides a comprehensive developer-focused interface with a modular tab-and-pane layout. The sidebar displays dynamic tabs — 3 pinned system tabs (System, Connectors, Data) plus user-created custom tabs. Pinned tabs are hardcoded in the frontend (not from DB) and render dedicated full-page components via React Router routes; custom tabs use the modular pane grid. Automations and services are accessed through panes in custom tabs rather than dedicated pinned tabs — this reflects the code-first philosophy where automations are self-contained units that live alongside the controls they manage.

### Sidebar
- **Pinned System Tabs** — System, Connectors, Data (hardcoded, cannot be deleted or reordered)
- **Custom Tabs** — User-created tabs with custom names and Lucide icons
- **Add Tab** — Inline form with name input and icon picker (16 icon choices)
- **Rename** — Double-click a custom tab to rename inline
- **Drag-to-Reorder** — Rearrange custom tabs via HTML5 drag-and-drop
- **Delete** — Remove custom tabs with confirmation (cascades to panes)
- **System Status** — MQTT connection and WebSocket status indicators

### Modular Pane System
- **Pane Registry** — Maps pane type identifiers to React components with metadata (display name, icon, default size, category)
- **Available Pane Types:** device-grid, sensor-panel, mqtt-inspector, hue-control, kasa-control, trigger-button, automation, automation-card, automations-editor, automation-rules, schedule-viewer, system-stats, topic-tree, event-log, state-history, connectors-page
- **New Automation Button** — Dedicated gradient-styled button in the tab header that directly creates an automation pane in setup mode, bypassing the pane picker. Automations are the core creative act in Aeolus and get first-class entry point treatment
- **PanePicker** — Grouped pane type selector organized into categories: Controls, Automations, Monitoring, System. Each category is a collapsible section with pane type cards. The `automation` pane type is excluded from the picker since it has its own dedicated button
- **PaneConfigPanel** — Per-pane configuration editor for type-specific settings
- **TabLayout** — Renders all panes for the active tab (custom tabs only), passes `paneId` to pane components for state management
- **Layout Persistence** — Dashboard layout (tabs + panes) is persisted to SQLite via `GET/PUT /api/layout`, with debounced auto-save (2s). Only custom (unpinned) tabs are persisted — pinned tabs are hardcoded

### System Tab (pinned — route: `/dashboard`)
- **Welcome Screen** — Shown when no devices exist. Three animated onboarding cards: Publish MQTT Data (guidance on connecting microcontrollers or running the seed script), Connect Devices (navigates to Connectors tab), Write Automations (navigates to create a custom tab). Uses framer-motion animations and Aeolus branding. Also shown in DeviceGrid when the device list is empty
- **System Health** — MQTT connection status, device count, automation count, uptime (polls every 30s)
- **System Page** — Host diagnostics (CPU, memory, disk, Docker usage, temperature, network), application log viewer, version check (daily automatic + manual), self-update controls, Docker prune

### Connectors Tab (pinned)
- **Available Connectors** — Cards for each discovered connector type showing display name, icon, description, supported device types, and setup requirement badge
- **Enable Flow** — Click Enable to expand a dynamic config form generated from the connector's `configSchema`, then submit to enable. Connectors with `requiresSetup` skip the config form and go straight to enable + wizard
- **Generic Setup Wizard** — Fully generic multi-step guided flow that fetches step descriptors from the backend via `GET /api/connectors/:id/setup-steps`. No hardcoded steps in the frontend. The wizard accumulates data across steps and patches the connector config on completion via `PATCH /api/connectors/:id`
- **Active Connectors** — Cards for each enabled instance showing health status (green/amber/red dot), device count, last seen time, and error messages
- **Disable** — Stop and disconnect a connector instance (preserves config in store)
- **Retry** — Re-attempt connection for disconnected connectors
- **Health Indicators** — Real-time status: connected (green), degraded (amber), disconnected (red)

### Services (removed as pinned tab)
Services are infrastructure that auto-enable on startup — they don't need a dedicated pinned tab. The three built-in services (Cron, API Trigger, System Events) start automatically and emit events on synthetic `service/{type}/{name}` topics. Services are managed via the REST API (`/api/services/*`).

### Data Tab (pinned — route: `/data-store`)

The Data tab provides a persistent time-series and key-value storage explorer. It renders either the SetupWizard (when Data Store is disabled) or the DataExplorer (when enabled).

**SetupWizard** — Shown when the Data Store is disabled (first visit). Displays system info (disk space, RAM, current DB size), recommends defaults based on available disk, and presents an editable configuration form with `maxStorageMb`, `maxRecordsPerCollection`, and `maxCollections`. Calls `POST /api/data-store/enable` on confirmation.

**DataExplorer** — The main explorer interface with:
- **SummaryBar** — Total collections, records, buckets, and storage usage with a progress bar. Storage health indicators: normal (green), 80% amber warning, 95% red critical
- **Tab Switcher** — Collections | Buckets | Settings
- **CollectionList** — Card grid showing each collection with name, description, record count, retention policy, and last write timestamp
- **CollectionDetail** — Time-series chart (reuses `StateHistoryChart` SVG component) + paginated record table + management controls (edit description, set retention, delete)
- **TimeSeriesChart** — Catmull-Rom spline rendering adapted for multi-field time-series data from DataStore records
- **RecordTable** — Paginated table of records with timestamp, payload fields, and tags
- **BucketList** — Expandable list of buckets with key-value pairs, inline editing
- **SettingsPanel** — View and edit DataStore configuration (maxStorageMb, maxRecordsPerCollection, maxCollections), disable Data Store

**Real-time WebSocket updates** — The `useDataStoreStore` Zustand store listens for `data-store-write` and `data-store-collection-deleted` WebSocket messages to update the UI in real time without polling.

**Storage health indicators:**
- Normal (green): storage usage below 80%
- Warning (amber): storage usage between 80% and 95%
- Critical (red): storage usage above 95%

### Automation Pane (`automation` pane type)

Self-contained one-pane-one-automation component with a 3-mode state machine. Each automation pane manages a single automation rule — add more panes for more automations.

**Setup Mode** (no ruleId yet):
- Name input and trigger topic input
- Monaco code editor with the default template showing all available globals (`devices`, `mqtt`, `log`, `context`, `services`, `http`, `automation`, `state`)
- Collapsible snippet picker panel (toggle via "Snippets" button) — shows categorized code templates from platform and connectors, click to insert at cursor
- Save button creates the rule via `POST /api/automations` and transitions to status mode
- Transpilation errors displayed inline in the editor and in an error summary panel

**Status Mode** (ruleId linked):
- Rule name and trigger topic badge
- Enable/Disable toggle with optimistic UI
- "Fire Now" button (Zap icon) — directly executes the rule via `POST /api/automations/:id/fire`, bypassing topic matching
- Last fired timestamp (polls every 10 seconds)
- Visual: FlowDiagram for structured automations (using `automation()` helper), ActivityFeed for free-form scripts
- Custom UI component rendering: if the rule has `uiSource`, the `useDynamicComponent` hook fetches the compiled module from `/api/automations/:id/ui-module`, rewrites React imports, loads via blob URL + dynamic `import()`, and renders the component inside a `CustomComponentBoundary` error boundary with full `CustomComponentProps` (devices, state, stateSet, deviceAction, mqttPublish, executionHistory). Components activate instantly on save — no rebuild or refresh needed

**Editing Mode** (entered via Edit button):
- Pre-filled name, topic, and script source
- Logic / UI tabs — Logic tab contains the Monaco script editor; UI tab contains the UiEditor (Monaco with TSX language support) for writing custom React components
- UiEditor fetches type definitions from `GET /api/automations/ui-types` for IntelliSense on `CustomComponentProps`, React hooks, and JSX
- UI component snippets available in the snippet picker under the "UI Components" category (device status card, toggle button, execution history)
- Save updates the rule via `PUT /api/automations/:id` (including `uiSource` if present) and returns to status mode
- Cancel returns to status mode without saving

**Pane Lifecycle:**
- Adding an automation pane starts in setup mode
- Saving links the pane to a ruleId via `updatePaneConfig()`
- Removing the pane sends `DELETE /api/automations/:id` to clean up the backend rule

### FlowDiagram (`frontend/src/components/FlowDiagram.tsx`)

Pure inline SVG flow diagram for structured automations that use the `automation()` helper.

- Renders trigger topic as a rounded rect node (Aeolus Blue border)
- Conditions as diamond nodes (Wind Cyan border) with Yes/No branches
- Actions as rectangular nodes chained vertically
- Arrow markers connecting all nodes in sequence
- Named functions from the `automation()` call become labeled nodes (e.g. `isLowLight`, `dimHueLights`)
- Responsive SVG with `viewBox` scaling

### ActivityFeed (`frontend/src/components/ActivityFeed.tsx`)

Recent execution feed for free-form automations (scripts that don't use the `automation()` helper).

- Fetches last 5 execution history entries from `GET /api/automations/history?ruleId=...&limit=5`
- Polls every 10 seconds for updates
- Each entry shows success/failure icon, timestamp, and action details (type → target)
- Error messages displayed inline for failed actions

### Trigger Button Pane (`trigger-button` pane type)

Configurable button that fires an API trigger event via `POST /api/services/trigger/{name}`.

- Configurable trigger name, button label, color (primary/accent/red/green), and payload
- Shows the synthetic topic (`service/trigger/{name}`) below the button
- Last fired timestamp display
- Useful for manual automation triggers from the dashboard

#### Monaco Script Editor (`frontend/src/components/ScriptEditor.tsx`)

A React component wrapping `@monaco-editor/react` with Aeolus theming and sandbox API IntelliSense.

- Fetches type definitions from `GET /api/automations/types` on mount
- Registers types via `monaco.languages.typescript.typescriptDefaults.addExtraLib()` for IntelliSense on `devices`, `mqtt`, `log`, `context`, `services`, `http`, `automation`, and `state`
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

#### Monaco UI Editor (`frontend/src/components/UiEditor.tsx`)

A React component wrapping `@monaco-editor/react` for editing custom automation UI components in TSX.

- Uses `defaultLanguage="typescript"` with `path="file:///aeolus-custom-ui.tsx"` for full JSX/TSX support
- Registers type stubs at `file:///` paths for Monaco's module resolver: `react`, `react/jsx-runtime`, and `./types` (CustomComponentProps)
- Fetches additional type definitions from `GET /api/automations/ui-types` on mount
- Suppresses only specific diagnostic codes (2307 for module resolution, 2875 for JSX) to keep useful error squiggles while avoiding false positives
- Uses the same `aeolus-dark` Monaco theme as the ScriptEditor
- Ctrl+S / Cmd+S keyboard shortcut to save
- Accepts `onChange`, `onSave`, `initialValue`, and `onEditorReady` props
- `onEditorReady` exposes an `insertText` API for the snippet picker to insert code at cursor

### System Diagnostics (rendered inline on System tab)
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
| GET | `/api/automations/snippets` | Code snippet catalog (platform + connector snippets) |
| GET | `/api/automations/ui-types` | Serve custom UI component type definition bundle as text/plain |
| GET | `/api/automations/:id/state` | Get all key-value state pairs for an automation rule |
| PUT | `/api/automations/:id/state` | Set a key-value pair in the automation state store |
| DELETE | `/api/automations/:id/state/:key` | Delete a single key from the automation state store |
| POST | `/api/automations/:id/fire` | Manually fire a specific automation rule (bypasses topic matching) |
| GET | `/api/automations/history` | Execution log entries (optional limit param) |
| GET | `/api/automations/:id/ui-module` | Serve compiled UI module as JavaScript (for runtime dynamic loading) |
| POST | `/api/mqtt/publish` | Publish MQTT message `{ topic, payload }` |
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
| GET | `/api/devices/:id/history` | Device state history (limit, from, to params) |
| DELETE | `/api/devices/:id/history` | Clear history for a specific device |
| DELETE | `/api/devices/history/all` | Clear all device history |
| POST | `/api/system/shutdown` | Gracefully shut down the host Pi |
| POST | `/api/system/reboot` | Gracefully reboot the host Pi |
| POST | `/api/system/docker-prune` | Remove unused Aeolus Docker images and build cache |
| GET | `/api/data-store/collections` | List all collections with metadata |
| POST | `/api/data-store/collections` | Create a new collection |
| PATCH | `/api/data-store/collections/:name` | Update collection description/retention |
| DELETE | `/api/data-store/collections/:name` | Delete collection and all records |
| POST | `/api/data-store/collections/:name/records` | Write a record to a collection |
| GET | `/api/data-store/collections/:name/records` | Query records (filter, paginate, aggregate) |
| GET | `/api/data-store/collections/:name/export` | Export collection records as CSV |
| GET | `/api/data-store/buckets` | List all buckets with key counts |
| GET | `/api/data-store/buckets/:bucket` | List all entries in a bucket |
| PUT | `/api/data-store/buckets/:bucket/:key` | Set a key-value pair |
| DELETE | `/api/data-store/buckets/:bucket/:key` | Delete a key from a bucket |
| GET | `/api/data-store/config` | Get current DataStore configuration |
| PUT | `/api/data-store/config` | Update DataStore configuration |
| GET | `/api/data-store/stats` | Storage statistics (records, buckets, usage) |
| POST | `/api/data-store/enable` | Enable Data Store with config |
| POST | `/api/data-store/disable` | Disable Data Store (preserves data) |

### State History (`src/core/state-history.ts`)

Records device state snapshots to SQLite for historical trend analysis. Each state change is throttled per-device (configurable interval, default 5 seconds) to prevent flooding from fast sensors. Oldest entries are automatically pruned when the per-device cap is exceeded (configurable, default 100 entries).

- `record(deviceId, state, timestamp)` — store a snapshot (returns false if throttled)
- `getHistory(deviceId, limit?)` — retrieve entries newest-first (default 50, max 500)
- `getHistoryRange(deviceId, from, to)` — retrieve entries within a time range
- `clearDevice(deviceId)` — delete all history for one device
- `clearAll()` — delete all history for all devices
- Served via `GET /api/devices/:id/history`, `DELETE /api/devices/:id/history`, `DELETE /api/devices/history/all`

---

**Last Updated:** May 13, 2026
**Version:** 0.13.0
**Status:** MVP Development

## Future Enhancements

See `docs/ROADMAP.md` for the full categorised roadmap.
