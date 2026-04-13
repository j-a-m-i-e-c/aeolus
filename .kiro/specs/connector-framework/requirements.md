# Requirements Document

## Introduction

Aeolus currently has a minimal `Integration` interface (connect, discoverDevices, execute, dispose) with hardcoded wiring in `index.ts`, per-integration route files, and no runtime management from the dashboard. This spec replaces the integration system with a pluggable Connector Framework — a richer abstraction with metadata, config schemas, setup flows, health tracking, auto-discovery of connector types, SQLite-persisted configuration, generic REST endpoints, and a dashboard management UI. The TP-Link Kasa connector is built as the first implementation on the new framework, targeting the HS110 smart plug with on/off and energy monitoring.

## Glossary

- **Connector**: A self-contained module that bridges Aeolus to an external device ecosystem (e.g. Philips Hue, TP-Link Kasa). Replaces the former "Integration" concept with a richer interface including metadata, config schema, and setup flow support.
- **Connector_Registry**: A singleton service that auto-discovers available Connector types by scanning the `src/connectors/` directory at startup and exposes them for enumeration.
- **Connector_Manager**: A singleton service that manages the full lifecycle of enabled Connectors — enable, configure, connect, discover devices, poll, execute actions, disable, and dispose.
- **Connector_Metadata**: A static descriptor exported by every Connector module containing its unique ID, display name, icon, description, supported device types, and whether it requires a setup flow.
- **Connector_Config_Schema**: A JSON-serializable schema (array of field descriptors) exported by a Connector that describes the configuration fields the Connector requires (e.g. bridge IP, API key, polling interval).
- **Setup_Flow**: An optional multi-step pairing or authentication process that a Connector can expose (e.g. Hue button-press pairing, OAuth token exchange). Driven generically through the Connector interface rather than custom route files.
- **Health_Status**: A per-Connector status object reporting whether the Connector is connected, degraded, or disconnected, along with the last successful communication timestamp and optional error message.
- **Kasa_Connector**: The TP-Link Kasa Connector implementation targeting local Wi-Fi devices (HS110 smart plug) using the `tplink-smarthome-api` npm package.
- **Device_Type**: A category string for IoT devices. The existing set (`light`, `sensor`, `switch`, `climate`) is extended with `plug` to support smart plugs with energy monitoring.
- **Connector_Store**: A SQLite table (`connectors`) that persists which Connectors are enabled and their configuration, surviving restarts.

## Requirements

### Requirement 1: Connector Interface Definition

**User Story:** As a developer building a new Connector, I want a well-defined TypeScript interface with metadata, config schema, lifecycle hooks, and setup flow support, so that I can implement a Connector without touching any core files.

#### Acceptance Criteria

1. THE Connector interface SHALL define a static `metadata` property conforming to the Connector_Metadata shape (id, displayName, icon, description, supportedDeviceTypes, requiresSetup).
2. THE Connector interface SHALL define a static `configSchema` property conforming to the Connector_Config_Schema shape (array of field descriptors with id, label, type, required, and optional default/placeholder/helpText).
3. THE Connector interface SHALL define lifecycle methods: `connect()`, `disconnect()`, `discoverDevices()`, `execute(action)`, and `dispose()`.
4. THE Connector interface SHALL define a `getHealthStatus()` method that returns a Health_Status object with fields: status ("connected" | "degraded" | "disconnected"), lastSeen (timestamp), and optional errorMessage.
5. WHERE a Connector requires a Setup_Flow, THE Connector interface SHALL define `getSetupSteps()` returning an array of step descriptors and `executeSetupStep(stepId, params)` returning a step result.
6. THE Connector interface SHALL define an `onConfigUpdate(config)` method that allows runtime configuration changes without full reconnection.

### Requirement 2: Connector Registry Auto-Discovery

**User Story:** As a platform maintainer, I want available Connector types to be auto-discovered from the filesystem, so that adding a new Connector requires only creating a folder under `src/connectors/` with no changes to core files.

#### Acceptance Criteria

1. WHEN the Aeolus backend starts, THE Connector_Registry SHALL scan the `src/connectors/` directory for subdirectories containing a valid Connector module export.
2. THE Connector_Registry SHALL expose a method to list all discovered Connector types with their Connector_Metadata.
3. IF a subdirectory under `src/connectors/` does not export a valid Connector module, THEN THE Connector_Registry SHALL log a warning and skip that directory without affecting other Connectors.
4. THE Connector_Registry SHALL provide a method to retrieve a specific Connector type by its metadata id.

### Requirement 3: Connector Manager Lifecycle

**User Story:** As a user, I want to enable, configure, and manage Connectors at runtime from the dashboard, so that I can add new device ecosystems without restarting Aeolus.

#### Acceptance Criteria

1. WHEN a user enables a Connector through the REST API, THE Connector_Manager SHALL instantiate the Connector, apply the provided configuration, call `connect()`, and call `discoverDevices()`.
2. WHEN a user disables a Connector through the REST API, THE Connector_Manager SHALL call `disconnect()` and `dispose()` on the Connector instance and remove its devices from the Device Registry.
3. WHILE a Connector is enabled, THE Connector_Manager SHALL periodically call `discoverDevices()` to detect newly added or removed devices at a configurable polling interval.
4. WHEN an action is dispatched for a device, THE Connector_Manager SHALL route the action to the correct Connector instance based on the device's integration field.
5. IF a Connector's `connect()` method fails, THEN THE Connector_Manager SHALL mark the Connector's Health_Status as "disconnected", log the error, and allow retry through the REST API.
6. WHEN the Aeolus backend starts, THE Connector_Manager SHALL restore all previously enabled Connectors from the Connector_Store and reconnect them automatically.

### Requirement 4: Connector Configuration Persistence

**User Story:** As a user, I want my Connector configurations and enabled/disabled state to survive restarts, so that I do not have to reconfigure Connectors after a reboot.

#### Acceptance Criteria

1. THE Connector_Store SHALL persist Connector records in a SQLite table with columns: id (TEXT PRIMARY KEY), connector_type (TEXT), enabled (INTEGER), config (TEXT as JSON), created_at (INTEGER), updated_at (INTEGER).
2. WHEN a Connector is enabled or its configuration is updated, THE Connector_Store SHALL persist the change to SQLite immediately.
3. WHEN a Connector is disabled, THE Connector_Store SHALL update the enabled flag to 0 rather than deleting the record, preserving the configuration for re-enablement.
4. WHEN the backend starts, THE Connector_Manager SHALL read all records from the Connector_Store and restore enabled Connectors with their persisted configuration.

### Requirement 5: Generic Connector REST API

**User Story:** As a frontend developer, I want a single set of REST endpoints for managing all Connectors, so that I do not need to build custom API routes for each Connector type.

#### Acceptance Criteria

1. THE REST API SHALL expose `GET /api/connectors/available` returning all discovered Connector types with their Connector_Metadata and Connector_Config_Schema.
2. THE REST API SHALL expose `GET /api/connectors` returning all enabled Connector instances with their current configuration, Health_Status, and discovered device count.
3. THE REST API SHALL expose `POST /api/connectors` accepting a connector_type and config object to enable and configure a new Connector instance.
4. THE REST API SHALL expose `PATCH /api/connectors/:id` accepting a partial config object to update a Connector's configuration at runtime.
5. THE REST API SHALL expose `DELETE /api/connectors/:id` to disable and dispose a Connector instance.
6. THE REST API SHALL expose `GET /api/connectors/:id/status` returning the detailed Health_Status for a specific Connector.
7. THE REST API SHALL expose `POST /api/connectors/:id/setup/:stepId` to execute a Setup_Flow step for Connectors that require pairing or authentication.
8. THE REST API SHALL expose `POST /api/connectors/:id/retry` to retry connection for a Connector in "disconnected" state.
9. IF a request references a Connector type not found in the Connector_Registry, THEN THE REST API SHALL return a 404 response with a descriptive error message.
10. IF a request provides configuration that does not satisfy the Connector_Config_Schema required fields, THEN THE REST API SHALL return a 400 response with validation error details.

### Requirement 6: Hue Connector Migration

**User Story:** As a user with an existing Hue setup, I want the Hue integration to be migrated to the new Connector framework, so that I can manage it from the unified Connectors UI alongside other Connectors.

#### Acceptance Criteria

1. THE Hue_Connector SHALL implement the Connector interface with metadata (id: "hue", displayName: "Philips Hue", supportedDeviceTypes: ["light"]).
2. THE Hue_Connector SHALL define a Setup_Flow with steps for bridge discovery and button-press pairing, replacing the standalone `hue.routes.ts` endpoints.
3. THE Hue_Connector SHALL define a Connector_Config_Schema with fields for bridgeIp and apiKey.
4. WHEN the Hue_Connector is enabled and configured, THE Hue_Connector SHALL discover lights, report Health_Status, and execute light control actions through the standard Connector lifecycle methods.
5. WHEN the backend starts with existing Hue credentials in the legacy `hue-credentials.json` file, THE migration logic SHALL import those credentials into the Connector_Store and enable the Hue_Connector automatically.
6. THE legacy `hue.routes.ts` route file SHALL be removed after migration, with all Hue functionality served through the generic Connector REST API.

### Requirement 7: TP-Link Kasa Connector

**User Story:** As a user with TP-Link Kasa smart plugs, I want to control and monitor them from the Aeolus dashboard, so that I can manage my smart plugs alongside other devices.

#### Acceptance Criteria

1. THE Kasa_Connector SHALL implement the Connector interface with metadata (id: "kasa", displayName: "TP-Link Kasa", supportedDeviceTypes: ["plug", "light", "switch"]).
2. THE Kasa_Connector SHALL define a Connector_Config_Schema with optional fields for broadcast address and discovery timeout.
3. WHEN the Kasa_Connector connects, THE Kasa_Connector SHALL use the `tplink-smarthome-api` package to discover devices on the local network via UDP broadcast.
4. WHEN a Kasa plug device is discovered, THE Kasa_Connector SHALL register it in the Device Registry with type "plug" and capabilities ["on/off", "energy-monitoring"].
5. WHEN an "on/off" action is executed on a Kasa plug, THE Kasa_Connector SHALL send the corresponding power state command to the device via the local TCP protocol.
6. WHILE a Kasa plug is connected, THE Kasa_Connector SHALL poll energy monitoring data (voltage, current, power, total consumption) and update the device state in the Device Registry.
7. THE Kasa_Connector SHALL report Health_Status as "connected" when at least one device is reachable, "degraded" when some devices are unreachable, and "disconnected" when no devices respond.
8. IF a Kasa device becomes unreachable during polling, THEN THE Kasa_Connector SHALL mark that device's state as offline without removing it from the Device Registry.

### Requirement 8: Device Type Extension

**User Story:** As a developer, I want the device type system to support smart plugs with energy monitoring, so that the dashboard can display plug-specific data and controls.

#### Acceptance Criteria

1. THE Device_Type union SHALL be extended to include "plug" as a valid device type.
2. THE Device Registry SHALL infer capabilities for "plug" type devices as ["on/off", "energy-monitoring"].
3. THE SQLite devices table type CHECK constraint SHALL be updated to include "plug".

### Requirement 9: Connector Dashboard UI

**User Story:** As a user, I want a Connectors page in the dashboard where I can see available Connectors, enable or disable them, configure them, and monitor their health, so that I can manage all device ecosystems from one place.

#### Acceptance Criteria

1. THE Dashboard SHALL include a "Connectors" page accessible from the sidebar navigation.
2. WHEN the Connectors page loads, THE Dashboard SHALL display a list of all available Connector types from `GET /api/connectors/available` with their display name, icon, description, and an enable/disable toggle.
3. WHEN a user enables a Connector, THE Dashboard SHALL display the Connector_Config_Schema as a dynamic form and submit the configuration to `POST /api/connectors`.
4. WHILE a Connector is enabled, THE Dashboard SHALL display its Health_Status with a colour-coded indicator (green for connected, amber for degraded, red for disconnected).
5. WHERE a Connector requires a Setup_Flow, THE Dashboard SHALL render the setup steps as a guided wizard within the configuration panel.
6. WHEN a user clicks "Disable" on an enabled Connector, THE Dashboard SHALL call `DELETE /api/connectors/:id` and update the UI to reflect the disabled state.
7. THE Dashboard SHALL display the count of discovered devices per enabled Connector.
8. WHEN a Connector is in "disconnected" state, THE Dashboard SHALL display a "Retry Connection" button that calls `POST /api/connectors/:id/retry`.

### Requirement 10: Connector Module Standard Export Shape

**User Story:** As a developer, I want a documented standard export shape for Connector modules, so that the Connector_Registry can auto-discover and instantiate Connectors consistently.

#### Acceptance Criteria

1. THE standard Connector module SHALL export a `metadata` object conforming to Connector_Metadata.
2. THE standard Connector module SHALL export a `configSchema` array conforming to Connector_Config_Schema.
3. THE standard Connector module SHALL export a `createConnector(config)` factory function that returns a Connector instance.
4. THE Connector_Registry SHALL validate that a module exports all three required members (metadata, configSchema, createConnector) before registering it.
5. IF a Connector module is missing any required export, THEN THE Connector_Registry SHALL log a warning identifying the missing export and the module path.

### Requirement 11: Backward Compatibility and Migration

**User Story:** As an existing Aeolus user, I want the refactor to preserve my current device data and not break existing MQTT-based device handling, so that the upgrade is seamless.

#### Acceptance Criteria

1. THE refactored system SHALL preserve all existing MQTT-based device ingestion and Device Registry functionality without modification.
2. THE refactored system SHALL preserve all existing automation engine functionality without modification.
3. WHEN the backend starts for the first time after the refactor, THE migration logic SHALL detect legacy Hue credentials and import them into the Connector_Store.
4. THE existing device action routing (`POST /api/devices/:id/action`) SHALL continue to work for both MQTT devices and Connector-managed devices.
5. THE legacy `config.ts` fields for `hueBridgeIp` and `hueApiKey` SHALL be removed after migration, with Hue configuration managed exclusively through the Connector_Store.
