# Implementation Plan: Aeolus MVP Core Platform

## Overview

Incremental implementation of the Aeolus local-first IoT automation platform. Each task builds on the previous, starting with project scaffolding and core types, progressing through backend services, then frontend, Docker deployment, and property-based tests. All code is TypeScript. Backend uses Express.js, SQLite (better-sqlite3), mqtt.js, ws, and pino. Frontend uses React + Vite + Zustand + Tailwind CSS + Lucide icons + framer-motion.

## Tasks

- [x] 1. Project scaffolding and configuration
  - [x] 1.1 Create backend package.json with dependencies (express, better-sqlite3, mqtt, ws, pino, pino-pretty, dotenv, cors) and devDependencies (typescript, vitest, @fast-check/vitest, fast-check, @types/express, @types/better-sqlite3, @types/ws, @types/cors, tsx, tsup)
    - Initialize `aeolus/package.json` with `"type": "module"`, scripts for `dev`, `build`, `start`, `test`
    - _Requirements: 12.2_

  - [x] 1.2 Create backend tsconfig.json with strict mode enabled
    - Target ES2022, module NodeNext, outDir `dist/`, rootDir `src/`, strict true
    - _Requirements: 12.2_

  - [x] 1.3 Create vitest.config.ts for backend tests
    - Configure Vitest with globals, ts paths, and test file patterns
    - _Requirements: 12.2_

  - [x] 1.4 Create frontend package.json, vite.config.ts, tsconfig.json, and tailwind.config.js
    - Add dependencies: react, react-dom, zustand, lucide-react, framer-motion, tailwindcss, postcss, autoprefixer
    - Configure Tailwind with Aeolus design tokens (background, surface, primary, accent, etc.)
    - Create `frontend/index.html`, `frontend/postcss.config.js`, `frontend/src/main.tsx`, `frontend/src/index.css`
    - The AeolusLogo component already exists at `frontend/src/components/AeolusLogo.tsx` — do not recreate it
    - _Requirements: 8.6, 12.3_

  - [x] 1.5 Create .env.example and src/config.ts for environment variable loading
    - Define all env vars: MQTT_BROKER_URL, MQTT_TOPICS, PORT, HUE_BRIDGE_IP, HUE_API_KEY, DB_PATH, LOG_LEVEL, NODE_ENV
    - `config.ts` exports a typed config object with defaults
    - _Requirements: 12.5_

- [x] 2. Core types and shared interfaces
  - [x] 2.1 Create src/core/types.ts with all shared TypeScript interfaces
    - Define Device, NormalizedEvent, Rule, EventContext, Action, ActionRequest, HealthStatus, ApiError, WsMessage types
    - Device type union: `"light" | "sensor" | "switch" | "climate"`
    - _Requirements: 3.1, 11.1_

  - [x] 2.2 Create src/integrations/integration.interface.ts
    - Define the Integration interface with name, connect, discoverDevices, execute, dispose
    - _Requirements: 11.1, 11.2_

  - [x] 2.3 Create src/core/event-bus.ts
    - Export a typed EventEmitter instance used as the internal pub/sub bus
    - _Requirements: 2.5, 3.6_

- [x] 3. Backend infrastructure — logger, database, error handling
  - [x] 3.1 Create src/logger.ts using pino
    - Configure pino with pino-pretty in development, structured JSON in production
    - Log level from config, ISO timestamps
    - _Requirements: 1.2, 2.4_

  - [x] 3.2 Create src/db/database.ts with better-sqlite3 setup and schema migration
    - Create `devices` table with id, name, type, capabilities (JSON), state (JSON), integration, last_seen
    - Export `getDatabase()` function that initializes and returns the Database instance
    - _Requirements: 3.4, 3.5_

  - [x] 3.3 Create src/api/middleware/error-handler.ts with AppError, NotFoundError, BadRequestError classes and global error handler middleware
    - Follow lol-main error handling pattern
    - _Requirements: 6.3, 6.5, 6.6_

  - [x] 3.4 Create src/api/middleware/request-logger.ts using pino for HTTP request logging
    - _Requirements: 6.1_

  - [x] 3.5 Create src/api/middleware/validators.ts for action payload validation
    - Validate that action type is present and non-empty on POST /api/devices/:id/action
    - _Requirements: 6.6_

- [ ] 4. Checkpoint — Verify project builds
  - Ensure `tsc --noEmit` passes for backend, all config files are valid. Ask the user if questions arise.

- [x] 5. MQTT ingestion service
  - [x] 5.1 Create src/mqtt/topic-parser.ts
    - Parse topic strings following `{type}/{location}` or `{type}/{location}/{metric}` convention
    - Extract device type and construct deterministic device ID
    - _Requirements: 2.2_

  - [ ]* 5.2 Write property test for topic parser
    - **Property 2: Topic Parsing Extracts Device Type and Identifier**
    - **Validates: Requirements 2.2**

  - [x] 5.3 Create src/mqtt/mqtt-service.ts
    - Connect to Mosquitto using mqtt.js with configurable broker URL and topics
    - Implement exponential backoff retry (max 5 attempts, baseDelay * 2^(n-1))
    - Subscribe to configured topic patterns on connect
    - Parse incoming messages, normalize payload to NormalizedEvent, emit on event bus
    - Log warnings and discard messages with unparseable payloads
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.3, 2.4, 2.5_

  - [ ]* 5.4 Write property tests for MQTT service
    - **Property 1: Exponential Backoff Retry Delay**
    - **Validates: Requirements 1.3**
    - **Property 3: Message Normalization Correctness**
    - **Validates: Requirements 2.3, 2.4, 2.5**

- [x] 6. Device registry
  - [x] 6.1 Create src/core/device-registry.ts
    - In-memory cache backed by SQLite via better-sqlite3
    - Implement getAll, getById, upsert, remove, loadFromDb methods
    - Upsert creates new device if ID not found, updates state if ID exists
    - Emit "ws:state-change" on event bus after each upsert
    - Serialize/deserialize Device objects to/from JSON for SQLite storage
    - Handle malformed JSON on load: log warning, skip entry, continue
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 13.1, 13.2, 13.3, 13.4_

  - [ ]* 6.2 Write property tests for device registry
    - **Property 4: Device Registry Upsert Invariant**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - **Property 20: Device Serialization Round-Trip**
    - **Validates: Requirements 13.1, 13.2, 13.3**
    - **Property 21: Malformed JSON Deserialization Safety**
    - **Validates: Requirements 13.4**

- [x] 7. Automation engine and DSL
  - [x] 7.1 Create src/automations/dsl.ts with the when/if/then builder
    - `when(topic)` returns a RuleBuilder with `.if(condition)` and `.then(action)` methods
    - `.then(action)` returns a fully formed Rule with a unique ID
    - _Requirements: 4.1, 4.2_

  - [x] 7.2 Create src/automations/rule-registry.ts
    - In-memory store for Rules with register, unregister, listRules, getRule methods
    - _Requirements: 4.3_

  - [x] 7.3 Create src/automations/automation-engine.ts
    - Listen to "device:state-change" on event bus
    - Evaluate matching rules: topic match → condition check → action execution
    - Fault isolation: if one rule action throws, log error and continue with remaining rules
    - Load rules from directory (automations/) on startup, skip files with syntax errors
    - _Requirements: 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.4 Create automations/example.ts as a sample rule file
    - Demonstrate the when/if/then DSL with a simple example rule
    - _Requirements: 4.1_

  - [ ]* 7.5 Write property tests for automation DSL and engine
    - **Property 5: DSL Rule Registration**
    - **Validates: Requirements 4.1, 4.2**
    - **Property 6: Rule Registry CRUD Consistency**
    - **Validates: Requirements 4.3**
    - **Property 7: Fault-Tolerant Rule Loading**
    - **Validates: Requirements 4.5**
    - **Property 8: Rule Evaluation with Conditional Execution**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - **Property 9: Fault Isolation in Rule Execution**
    - **Validates: Requirements 5.4**

- [ ] 8. Checkpoint — Verify core backend modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. REST API and WebSocket server
  - [x] 9.1 Create src/api/routes/device.routes.ts
    - GET /api/devices — return all devices from registry
    - GET /api/devices/:id — return single device or 404
    - POST /api/devices/:id/action — validate payload, forward to integration manager, return result or 400/404
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 9.2 Create src/api/routes/state.routes.ts
    - GET /api/state — return all devices keyed by ID
    - _Requirements: 6.7_

  - [x] 9.3 Create src/api/routes/health.routes.ts
    - GET /api/health — return HealthStatus with mqtt status, deviceCount, ruleCount, uptime, timestamp
    - _Requirements: 9.1_

  - [x] 9.4 Create src/websocket/ws-server.ts
    - Attach ws WebSocket server to the Express HTTP server on /ws path
    - Send snapshot of all devices on client connect
    - Listen for "ws:state-change" on event bus and broadcast to all connected clients
    - Clean up on client disconnect
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 9.5 Write property tests for REST API and WebSocket
    - **Property 10: API Reflects Device Registry State**
    - **Validates: Requirements 6.1, 6.2, 6.7**
    - **Property 11: Invalid Action Request Validation**
    - **Validates: Requirements 6.6**
    - **Property 12: WebSocket Snapshot on Connect**
    - **Validates: Requirements 7.2**
    - **Property 13: WebSocket Broadcast on State Change**
    - **Validates: Requirements 7.3**
    - **Property 17: Health Endpoint Response Completeness**
    - **Validates: Requirements 9.1**

- [x] 10. Integration manager and Hue integration
  - [x] 10.1 Create src/integrations/integration-manager.ts
    - Register integrations, connectAll, discoverAll, execute action routing, disposeAll
    - Fault tolerance: if one integration's connect() throws, log and continue with remaining
    - _Requirements: 11.1, 11.3, 11.4, 11.5_

  - [x] 10.2 Create src/integrations/hue/hue-integration.ts
    - Implement Integration interface for Philips Hue bridge
    - Connect using configured bridge IP and API key
    - discoverDevices: query Hue bridge API, return Device[] of type "light" with on/off + brightness capabilities
    - execute: handle "toggle" and "brightness" action types
    - Error handling: log failures, mark devices offline
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ]* 10.3 Write property tests for integrations
    - **Property 18: Hue Discovered Devices Type Invariant**
    - **Validates: Requirements 10.4**
    - **Property 19: Integration Fault Tolerance on Connect**
    - **Validates: Requirements 11.5**

- [ ] 11. Backend entry point — wire everything together
  - [x] 11.1 Create src/index.ts
    - Initialize config, logger, database, event bus
    - Create DeviceRegistry, load from DB
    - Create MqttService, connect
    - Create AutomationEngine, load rules from automations/
    - Create IntegrationManager, register HueIntegration (if configured), connectAll, discoverAll
    - Create Express app, mount routes, error handler, request logger
    - Create HTTP server, attach WsServer
    - Start listening on configured port
    - Graceful shutdown: dispose integrations, disconnect MQTT, close DB, close server
    - _Requirements: 1.1, 3.5, 4.4, 11.3, 11.4, 12.2_

  - [ ] 11.2 Create backend Dockerfile
    - Multi-stage build: install deps, build TypeScript, run with Node.js
    - _Requirements: 12.2_

- [ ] 12. Checkpoint — Verify full backend
  - Ensure all tests pass, backend starts and connects to MQTT. Ask the user if questions arise.

- [ ] 13. Frontend scaffolding and dashboard
  - [ ] 13.1 Create frontend/src/store/device-store.ts with Zustand
    - Flat state: devices (Record<string, Device>), health, wsConnected
    - Action setters: setDevices, updateDevice, setHealth, setWsConnected
    - _Requirements: 8.5_

  - [ ] 13.2 Create frontend/src/lib/api-client.ts
    - Functions: fetchDevices, fetchDevice, fetchState, fetchHealth, sendAction
    - Base URL from VITE_API_URL env var
    - _Requirements: 8.1, 8.4, 9.4_

  - [ ] 13.3 Create frontend/src/lib/ws-client.ts
    - Connect to WebSocket at VITE_WS_URL
    - Handle "snapshot" and "state-change" message types
    - Auto-reconnect on disconnect
    - Dispatch updates to Zustand store
    - _Requirements: 7.2, 7.3, 8.5_

  - [ ] 13.4 Create frontend/src/components/Layout.tsx and frontend/src/components/Sidebar.tsx
    - Left sidebar with Aeolus logo (use existing AeolusLogo component), navigation, and system health indicator
    - Main content area
    - Apply Aeolus design system: Deep Void background, Inter font, Lucide icons
    - _Requirements: 8.6_

  - [ ] 13.5 Create frontend/src/components/DeviceGrid.tsx and frontend/src/components/DeviceCard.tsx
    - DeviceGrid renders a responsive grid of DeviceCard components
    - DeviceCard shows device name, type-appropriate Lucide icon, current state values
    - Render toggle control for "light" and "switch" types; no toggle for "sensor" and "climate"
    - Toggle sends POST /api/devices/:id/action via api-client
    - Cards use Graphite surface, 12-16px border radius, framer-motion hover effects
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 13.6 Create frontend/src/components/SensorPanel.tsx
    - Display devices of type "sensor" with most recent values and timestamps
    - Monospace font for values (JetBrains Mono)
    - _Requirements: 8.7_

  - [ ] 13.7 Create frontend/src/components/SystemHealth.tsx
    - Display MQTT connection status, device count, rule count, uptime
    - Poll GET /api/health every 30 seconds
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 13.8 Create frontend/src/App.tsx wiring all components together
    - Initialize WebSocket client on mount
    - Fetch initial devices and health data
    - Render Layout with DeviceGrid, SensorPanel, SystemHealth
    - _Requirements: 8.1, 8.5_

  - [ ]* 13.9 Write property tests for frontend components
    - **Property 14: Device Card Rendering Completeness**
    - **Validates: Requirements 8.1, 8.2**
    - **Property 15: Toggle Rendering for Controllable Devices**
    - **Validates: Requirements 8.3**
    - **Property 16: Sensor Panel Filtering**
    - **Validates: Requirements 8.7**

  - [ ] 13.10 Create frontend Dockerfile
    - Build Vite app, serve with nginx or lightweight static server
    - _Requirements: 12.3_

- [ ] 14. Docker Compose and Mosquitto configuration
  - [ ] 14.1 Create mosquitto/mosquitto.conf
    - Configure listener on port 1883, allow anonymous connections for local dev
    - _Requirements: 12.1_

  - [ ] 14.2 Create docker-compose.yml
    - Define mosquitto, backend, and frontend services
    - Configure healthcheck for mosquitto, depends_on with condition for backend
    - Environment variables for all configurable values
    - Named volumes for mosquitto data/logs and backend data
    - Shared aeolus-network bridge
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 15. Final checkpoint — Full stack verification
  - Ensure all tests pass, `docker-compose config` validates, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Follow Conventional Commits with scoped types as defined in development-workflow.md
- The AeolusLogo component already exists — do not recreate it
