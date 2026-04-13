# Implementation Plan: Connector Framework

## Overview

Replace the hardcoded Integration system with a pluggable Connector Framework. Implementation proceeds bottom-up: core interfaces → persistence → registry → manager → REST API → Hue migration → Kasa connector → dashboard UI → legacy cleanup. Each layer builds on the previous, with property tests validating correctness at each stage.

## Tasks

- [x] 1. Core interfaces and DeviceType extension
  - [x] 1.1 Create connector interface definitions
    - Create `src/connectors/connector.interface.ts` with all TypeScript interfaces: ConnectorMetadata, ConfigFieldDescriptor, ConnectorConfigSchema, HealthStatus, SetupStepDescriptor, SetupStepResult, Connector, ConnectorModule, ConnectorInstanceInfo
    - Include comprehensive TSDoc on every interface and field
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 10.1, 10.2, 10.3_

  - [x] 1.2 Extend DeviceType with "plug" and update DeviceRegistry
    - Add `"plug"` to the `DeviceType` union in `src/core/types.ts`
    - Add `case "plug": return ["on/off", "energy-monitoring"];` to `inferCapabilities()` in `src/core/device-registry.ts`
    - Update the SQLite `devices` table CHECK constraint in `src/db/database.ts` to include `'plug'`
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 2. Connector persistence layer
  - [x] 2.1 Implement ConnectorStore with SQLite table
    - Create `src/connectors/connector-store.ts` with ConnectorStore class
    - Add `connectors` table creation to `initSchema()` in `src/db/database.ts` (id TEXT PK, connector_type TEXT, enabled INTEGER, config TEXT, created_at INTEGER, updated_at INTEGER)
    - Implement methods: save(), disable(), delete(), loadAll(), loadEnabled()
    - Handle malformed JSON in config column gracefully (log warning, skip record)
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 2.2 Write property test: ConnectorStore persistence round-trip (Property 3)
    - **Property 3: ConnectorStore persistence round-trip**
    - Generate random ConnectorRecords with varied configs using fast-check
    - Save to store, load back, verify equivalence; disable and verify enabled=0 with config preserved
    - **Validates: Requirements 4.2, 4.3**

- [x] 3. Checkpoint — Persistence layer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Connector Registry auto-discovery
  - [x] 4.1 Implement ConnectorRegistry
    - Create `src/connectors/connector-registry.ts` with ConnectorRegistry class
    - Implement `discover()`: scan `src/connectors/` subdirectories, skip `_template`/files starting with `connector`/`README.md`, dynamically import each `index.ts`
    - Validate each module exports `metadata`, `configSchema`, `createConnector`; log warning and skip invalid modules
    - Implement `listAvailable()` and `getModule(connectorType)`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 10.4, 10.5_

  - [ ]* 4.2 Write property test: Registry discovers exactly valid modules (Property 1)
    - **Property 1: Registry discovers exactly valid connector modules**
    - Generate arrays of mock module objects (some valid with all 3 exports, some missing exports)
    - Verify registry contains exactly the valid ones
    - **Validates: Requirements 2.1, 2.3, 10.4**

  - [ ]* 4.3 Write property test: Registry lookup invariant (Property 2)
    - **Property 2: Registry lookup invariant**
    - Generate random metadata ids, register a subset, verify `listAvailable()` includes them and `getModule()` returns correct results; unknown ids return undefined
    - **Validates: Requirements 2.2, 2.4**

- [x] 5. Connector Manager lifecycle
  - [x] 5.1 Implement ConnectorManager
    - Create `src/connectors/connector-manager.ts` with ConnectorManager class
    - Constructor takes ConnectorRegistry, ConnectorStore, DeviceRegistry, EventBus
    - Implement `enable()`: instantiate via factory, apply config, connect, discoverDevices, register devices, persist to store, start polling interval
    - Implement `disable()`: disconnect, dispose, remove devices from DeviceRegistry, update store
    - Implement `updateConfig()`: call onConfigUpdate on instance, persist to store
    - Implement `retry()`: re-call connect on disconnected connector
    - Implement `executeSetupStep()`: delegate to connector instance
    - Implement `executeAction()`: route action to correct connector based on device integration field
    - Implement `listEnabled()`, `getStatus()`
    - Implement `restoreFromStore()`: load enabled records, instantiate and connect each
    - Implement `disposeAll()`: disconnect and dispose all instances
    - Polling: setInterval per connector calling discoverDevices at configurable interval (default 60s)
    - On connect failure: set health to "disconnected", log error, keep in listEnabled
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.4_

  - [ ]* 5.2 Write property test: Enable then disable is clean round-trip (Property 4)
    - **Property 4: Enable then disable is a clean round-trip**
    - Generate connector types with mock factories, enable then disable, verify removed from listEnabled and devices cleaned up
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 5.3 Write property test: Restore from store matches persisted state (Property 5)
    - **Property 5: Restore from store matches persisted state**
    - Generate random enabled records, persist, restore, verify listEnabled matches
    - **Validates: Requirements 3.6, 4.4**

  - [ ]* 5.4 Write property test: Failed connect marks health as disconnected (Property 6)
    - **Property 6: Failed connect marks health as disconnected**
    - Generate connectors with factories that throw random errors on connect
    - Verify health is "disconnected" with error message, connector still in listEnabled
    - **Validates: Requirements 3.5**

  - [ ]* 5.5 Write property test: Action routing to correct connector (Property 7)
    - **Property 7: Action routing to correct connector**
    - Generate devices with random integration fields, dispatch actions, verify routed to correct connector; MQTT devices not routed to any connector
    - **Validates: Requirements 3.4, 11.4**

- [x] 6. Checkpoint — Core framework
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Generic Connector REST API
  - [x] 7.1 Implement connector routes
    - Create `src/api/routes/connector.routes.ts` with `createConnectorRoutes(connectorManager, connectorRegistry)`
    - GET /api/connectors/available — list discovered types with metadata and configSchema
    - GET /api/connectors — list enabled instances with config (passwords redacted), health, device count
    - POST /api/connectors — enable new connector (validate type exists in registry → 404; validate required config fields → 400)
    - PATCH /api/connectors/:id — update config
    - DELETE /api/connectors/:id — disable connector
    - GET /api/connectors/:id/status — get health status
    - POST /api/connectors/:id/setup/:stepId — execute setup step
    - POST /api/connectors/:id/retry — retry connection
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 7.2 Write property test: API validation rejects invalid requests (Property 8)
    - **Property 8: API validation rejects invalid requests**
    - Generate random type strings not in registry → verify 404; generate partial config objects missing required fields → verify 400
    - **Validates: Requirements 5.9, 5.10**

- [x] 8. Hue Connector migration
  - [x] 8.1 Implement Hue Connector module
    - Create `src/connectors/hue/index.ts` with metadata, configSchema, createConnector exports
    - Create `src/connectors/hue/hue-connector.ts` implementing the Connector interface
    - metadata: id "hue", displayName "Philips Hue", icon "lightbulb", supportedDeviceTypes ["light"], requiresSetup true
    - configSchema: bridgeIp (text, required), apiKey (password, required)
    - Setup flow: "discover-bridges" step (calls meethue.com discovery) and "press-button" step (initiates pairing, returns API key)
    - connect(): verify bridge reachable via fetch
    - discoverDevices(): fetch lights from bridge, map to Device objects with integration "hue"
    - execute(): handle toggle and brightness actions via Hue bridge API
    - getHealthStatus(): connected if bridge reachable, disconnected otherwise
    - Port all logic from existing `HueIntegration` class and `hue.routes.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

  - [x] 8.2 Implement legacy Hue credential migration
    - Add migration logic (can be in ConnectorManager or a standalone migration module)
    - On startup: check if `data/hue-credentials.json` exists
    - If found: read bridgeIp and apiKey, create ConnectorRecord with connector_type "hue" and enabled=1, save to ConnectorStore
    - Handle malformed JSON gracefully (log warning, skip migration)
    - _Requirements: 6.5, 11.3_

  - [ ]* 8.3 Write property test: Legacy Hue credential migration round-trip (Property 9)
    - **Property 9: Legacy Hue credential migration round-trip**
    - Generate random bridgeIp/apiKey pairs, write to JSON, run migration, verify ConnectorRecord matches
    - **Validates: Requirements 6.5, 11.3**

- [x] 9. Checkpoint — Hue migration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. TP-Link Kasa Connector
  - [x] 10.1 Implement Kasa Connector module
    - Add `tplink-smarthome-api` to dependencies
    - Create `src/connectors/kasa/index.ts` with metadata, configSchema, createConnector exports
    - Create `src/connectors/kasa/kasa-connector.ts` implementing the Connector interface
    - metadata: id "kasa", displayName "TP-Link Kasa", icon "plug", supportedDeviceTypes ["plug", "light", "switch"], requiresSetup false
    - configSchema: broadcastAddress (text, optional, default "255.255.255.255"), discoveryTimeout (number, optional, default 10000)
    - connect(): initialize tplink-smarthome-api Client
    - discoverDevices(): use Client.startDiscovery(), map to Device objects with type "plug", capabilities ["on/off", "energy-monitoring"], integration "kasa"
    - execute(): handle on/off actions via device.setPowerState()
    - Poll energy data: getSysInfo() + emeter.getRealtime() → update state with { on, voltage, current, power, totalConsumption, online }
    - getHealthStatus(): connected if ≥1 device reachable, degraded if some unreachable, disconnected if none respond
    - Mark unreachable devices as online=false without removing from DeviceRegistry
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [ ]* 10.2 Write property test: Kasa health status follows reachability rules (Property 10)
    - **Property 10: Kasa health status follows reachability rules**
    - Generate arrays of devices with random reachability booleans, verify health status follows connected/degraded/disconnected rules
    - **Validates: Requirements 7.7, 7.8**

  - [ ]* 10.3 Write property test: Kasa discovered plugs have correct type and capabilities (Property 11)
    - **Property 11: Kasa discovered plugs have correct type and capabilities**
    - Generate discovered device info, verify type="plug" and capabilities=["on/off", "energy-monitoring"]
    - **Validates: Requirements 7.4**

- [x] 11. Checkpoint — Kasa connector
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Wire framework into application entry point
  - [x] 12.1 Update index.ts to use Connector Framework
    - Import ConnectorRegistry, ConnectorManager, ConnectorStore
    - After database init: create ConnectorStore, ConnectorRegistry, ConnectorManager
    - Call `registry.discover()` to scan connectors directory
    - Call `manager.restoreFromStore()` to restore enabled connectors (includes legacy Hue migration)
    - Mount connector routes at `/api/connectors`
    - Update device action routing in device.routes.ts to delegate to ConnectorManager for connector-managed devices
    - Update shutdown handler to call `connectorManager.disposeAll()`
    - _Requirements: 3.6, 4.4, 11.1, 11.2, 11.4_

  - [x] 12.2 Remove legacy integration code
    - Remove `src/integrations/` directory (integration.interface.ts, integration-manager.ts, hue/)
    - Remove `src/api/routes/hue.routes.ts`
    - Remove `hueBridgeIp` and `hueApiKey` from `src/config.ts` and the Config interface
    - Remove IntegrationManager and HueIntegration imports from `src/index.ts`
    - Remove `/api/hue` route mount from `src/index.ts`
    - Verify existing MQTT device ingestion and automation engine are untouched
    - _Requirements: 6.6, 11.1, 11.2, 11.5_

- [x] 13. Template connector and developer documentation
  - [x] 13.1 Create template connector
    - Create `src/connectors/_template/index.ts` with placeholder metadata, configSchema, createConnector exports
    - Create `src/connectors/_template/connector.ts` with skeleton Connector class and inline TSDoc comments explaining each method
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 13.2 Create connector developer guide
    - Create `src/connectors/README.md` with developer guide
    - Document: directory structure, required exports, how to create a new connector (copy _template), metadata fields, config schema format, setup flow pattern, lifecycle methods, testing approach
    - _Requirements: 1.1, 10.1, 10.2, 10.3_

- [x] 14. Connector Dashboard UI
  - [x] 14.1 Create ConnectorsPage component
    - Create `frontend/src/components/ConnectorsPage.tsx`
    - Fetch available connectors from GET /api/connectors/available
    - Fetch enabled connectors from GET /api/connectors
    - Display available connector types as cards with displayName, icon, description, and enable/disable toggle
    - Display enabled connectors with health status indicator (green=connected, amber=degraded, red=disconnected)
    - Show discovered device count per enabled connector
    - _Requirements: 9.1, 9.2, 9.4, 9.7_

  - [x] 14.2 Implement connector configuration and setup flows
    - When enabling a connector: render dynamic config form from configSchema, submit to POST /api/connectors
    - For connectors with requiresSetup: render setup steps as a guided wizard, call POST /api/connectors/:id/setup/:stepId for each step
    - Disable button calls DELETE /api/connectors/:id
    - Retry button on disconnected connectors calls POST /api/connectors/:id/retry
    - _Requirements: 9.3, 9.5, 9.6, 9.8_

  - [x] 14.3 Add Connectors page to sidebar navigation
    - Add "Connectors" tab to the sidebar (pinned system tab or accessible from navigation)
    - Wire routing so clicking Connectors navigates to ConnectorsPage
    - _Requirements: 9.1_

- [x] 15. Final checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 11 correctness properties from the design document
- All code uses TypeScript — backend (Node.js/Express) and frontend (React/Vite)
- The project uses fast-check with @fast-check/vitest for property-based testing
- Legacy integration code is removed only after the new framework is fully wired in (task 12.2)
