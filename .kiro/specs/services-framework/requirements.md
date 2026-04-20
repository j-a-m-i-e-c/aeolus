# Requirements Document

## Introduction

Aeolus currently supports two event source layers: Connectors (physical device integrations like Hue and Kasa that emit `connector/{type}/{deviceId}` events) and MQTT (raw broker messages that emit `DEVICE_STATE_CHANGE` events). This spec introduces a third event source layer — Services — a pluggable framework for non-device event producers such as timers, API triggers, and system lifecycle events. Services follow the same registry-and-lifecycle pattern as Connectors but instead of controlling physical devices, they produce data and events from non-device sources, emitting events on the standard event bus with synthetic `service/{type}/{name}` topics. Automations match on these topics identically to how they match on `sensor/` or `connector/` topics, enabling time-based automations, external webhook triggers, and system event reactions that are currently impossible. Three built-in services ship with the framework: Cron/Scheduler, API Trigger, and System Events. The framework is designed for extensibility — future services (weather, energy pricing, calendar) plug in without touching core files.

## Glossary

- **Service**: A pluggable module that produces events from non-device sources (timers, external APIs, system lifecycle) and emits them on the event bus with synthetic `service/{type}/{name}` topics. Analogous to a Connector but for non-hardware event sources.
- **Service_Module**: The standard export shape for a service module. Contains metadata, a config schema, and a factory function — mirroring the ConnectorModule pattern.
- **Service_Registry**: A singleton that discovers and stores available Service_Module definitions. Provides enumeration and lookup by service type ID.
- **Service_Manager**: A singleton that manages the full lifecycle of enabled Service instances — enable, configure, start, stop, dispose, and restore from persistence. Analogous to ConnectorManager.
- **Service_Store**: A SQLite persistence layer for service instance records (enabled state, configuration). Survives restarts. Analogous to ConnectorStore.
- **Service_Metadata**: A static descriptor exported by every Service_Module containing its unique ID, display name, icon, description, and category.
- **Service_Config_Schema**: A JSON-serializable array of field descriptors (reusing the existing ConfigFieldDescriptor shape from the Connector framework) that describes the configuration fields a service accepts.
- **Service_Instance**: A running instance of a Service created by the Service_Module factory function. Exposes lifecycle methods (start, stop, dispose) and health reporting.
- **Service_Health_Status**: A per-instance status object reporting whether the service is running, degraded, or stopped, along with the last activity timestamp and optional error message.
- **Cron_Service**: A built-in service that manages named cron schedules and emits `service/cron/{scheduleName}` events when schedules fire.
- **Trigger_Service**: A built-in service that exposes a REST endpoint `POST /api/services/trigger/{name}` and emits `service/trigger/{name}` events, allowing external systems and dashboard buttons to fire automations on demand.
- **System_Events_Service**: A built-in service that emits `service/system/startup` on boot and `service/system/shutdown` on graceful shutdown.
- **Sandbox_Services_API**: The `services` global exposed in the automation sandbox, allowing script rules to query service state at runtime.
- **Event_Bus**: The existing internal pub/sub EventEmitter used across Aeolus for device state changes, automation triggers, and WebSocket broadcasts.

## Requirements

### Requirement 1: Service Interface Definition

**User Story:** As a developer building a new Service, I want a well-defined TypeScript interface with metadata, config schema, lifecycle hooks, and health reporting, so that I can implement a Service without modifying core files.

#### Acceptance Criteria

1. THE Service_Module interface SHALL define a static `metadata` property conforming to the Service_Metadata shape with fields: id (string), displayName (string), icon (string), description (string), and category (string).
2. THE Service_Module interface SHALL define a static `configSchema` property conforming to the Service_Config_Schema shape, reusing the existing ConfigFieldDescriptor type from the Connector framework.
3. THE Service_Module interface SHALL define a `createService(config, dependencies)` factory function that accepts a configuration object and a dependencies object containing the event bus reference, and returns a Service_Instance.
4. THE Service_Instance interface SHALL define lifecycle methods: `start()` returning a Promise, `stop()` returning a Promise, and `dispose()` returning a Promise.
5. THE Service_Instance interface SHALL define a `getHealthStatus()` method that returns a Service_Health_Status object with fields: status ("running" | "degraded" | "stopped"), lastActivity (timestamp), and optional errorMessage.
6. THE Service_Instance interface SHALL define an `onConfigUpdate(config)` method that allows runtime configuration changes without requiring a full stop/start cycle.
7. THE Service_Instance interface SHALL define an optional `getState()` method returning a `Record<string, unknown>` that exposes queryable service state for the Sandbox_Services_API.

### Requirement 2: Service Registry

**User Story:** As a platform maintainer, I want available Service types to be registered in a central registry, so that the system can enumerate and instantiate them consistently.

#### Acceptance Criteria

1. THE Service_Registry SHALL accept manual registration of Service_Module objects via a `register(module)` method.
2. THE Service_Registry SHALL validate that a module exports all three required members (metadata, configSchema, createService) before registering it.
3. IF a Service_Module is missing any required export, THEN THE Service_Registry SHALL log a warning identifying the missing export and skip registration.
4. THE Service_Registry SHALL expose a `listAvailable()` method returning all registered service types with their Service_Metadata and Service_Config_Schema.
5. THE Service_Registry SHALL expose a `getModule(serviceType)` method to retrieve a specific Service_Module by its metadata id.
6. IF a service type ID is already registered, THEN THE Service_Registry SHALL log a warning and overwrite the existing registration.

### Requirement 3: Service Manager Lifecycle

**User Story:** As a user, I want to enable, configure, and manage Services at runtime, so that I can add new event sources without restarting Aeolus.

#### Acceptance Criteria

1. WHEN a user enables a Service through the REST API, THE Service_Manager SHALL instantiate the Service via the factory function, apply the provided configuration, call `start()`, and persist the record to the Service_Store.
2. WHEN a user disables a Service through the REST API, THE Service_Manager SHALL call `stop()` and `dispose()` on the Service_Instance and update the Service_Store record to disabled.
3. WHEN the Aeolus backend starts, THE Service_Manager SHALL restore all previously enabled Services from the Service_Store and call `start()` on each.
4. THE Service_Manager SHALL expose a `listEnabled()` method returning all running service instances with their metadata, health status, and configuration.
5. THE Service_Manager SHALL expose a `getServiceInstance(serviceType)` method that returns the running Service_Instance for a given type, enabling the Sandbox_Services_API to query service state.
6. IF a Service's `start()` method fails, THEN THE Service_Manager SHALL mark the Service_Health_Status as "stopped", log the error, and allow retry through the REST API.
7. WHEN the Aeolus backend shuts down, THE Service_Manager SHALL call `stop()` and `dispose()` on all running Service instances.

### Requirement 4: Service Configuration Persistence

**User Story:** As a user, I want my Service configurations and enabled/disabled state to survive restarts, so that I do not have to reconfigure Services after a reboot.

#### Acceptance Criteria

1. THE Service_Store SHALL persist service records in a SQLite table named `services` with columns: id (TEXT PRIMARY KEY), service_type (TEXT), enabled (INTEGER), config (TEXT as JSON), created_at (INTEGER), updated_at (INTEGER).
2. WHEN a Service is enabled or its configuration is updated, THE Service_Store SHALL persist the change to SQLite immediately.
3. WHEN a Service is disabled, THE Service_Store SHALL update the enabled flag to 0 rather than deleting the record, preserving the configuration for re-enablement.
4. WHEN the backend starts, THE Service_Manager SHALL read all enabled records from the Service_Store and restore them with their persisted configuration.

### Requirement 5: Service Event Bus Integration

**User Story:** As a user, I want Services to emit events on the standard event bus with `service/{type}/{name}` topics, so that automations can trigger on service events using the same topic matching system used for device events.

#### Acceptance Criteria

1. WHEN a Service emits an event, THE Service_Manager SHALL emit a `DEVICE_STATE_CHANGE` event on the Event_Bus with a synthetic topic following the pattern `service/{serviceType}/{eventName}`.
2. THE automation engine's existing topic matching logic (exact match, `+` single-level wildcard, `#` multi-level wildcard) SHALL match `service/` prefixed topics without modification.
3. WHEN a service event is emitted, THE Event_Bus event payload SHALL include a `deviceId` field set to `service-{serviceType}`, a `deviceType` of `"sensor"`, a `state` object containing the event data, the synthetic topic string, the current timestamp, and an `integration` field set to `"service"`.
4. THE service events SHALL propagate through the existing WebSocket broadcast pipeline so the frontend receives real-time service event notifications.

### Requirement 6: Service REST API

**User Story:** As a frontend developer, I want a set of REST endpoints for managing all Services, so that I can build a Services management UI.

#### Acceptance Criteria

1. THE REST API SHALL expose `GET /api/services/available` returning all registered service types with their Service_Metadata and Service_Config_Schema.
2. THE REST API SHALL expose `GET /api/services` returning all enabled service instances with their current configuration, Service_Health_Status, and service type.
3. THE REST API SHALL expose `POST /api/services` accepting a service_type and config object to enable and configure a new Service instance.
4. THE REST API SHALL expose `PATCH /api/services/:id` accepting a partial config object to update a Service's configuration at runtime.
5. THE REST API SHALL expose `DELETE /api/services/:id` to disable and dispose a Service instance.
6. THE REST API SHALL expose `GET /api/services/:id/status` returning the detailed Service_Health_Status for a specific Service instance.
7. THE REST API SHALL expose `POST /api/services/:id/retry` to retry starting a Service in "stopped" state.
8. IF a request references a service type not found in the Service_Registry, THEN THE REST API SHALL return a 404 response with a descriptive error message.
9. IF a request provides configuration that does not satisfy the Service_Config_Schema required fields, THEN THE REST API SHALL return a 400 response with validation error details.

### Requirement 7: Cron/Scheduler Service

**User Story:** As a user, I want to define named cron schedules that emit events on a timer, so that I can create time-based automations such as "every 5 minutes" or "daily at 6am".

#### Acceptance Criteria

1. THE Cron_Service SHALL implement the Service_Instance interface with metadata (id: "cron", displayName: "Cron Scheduler", icon: "clock", category: "scheduling").
2. THE Cron_Service SHALL define a Service_Config_Schema with a `schedules` field that accepts an array of schedule objects, each containing a `name` (string) and a `cron` (string in standard cron expression format).
3. WHEN the Cron_Service starts, THE Cron_Service SHALL register all configured schedules and begin emitting `service/cron/{scheduleName}` events on the Event_Bus when each schedule fires.
4. WHEN a cron schedule fires, THE event payload state object SHALL include the schedule name, the cron expression, and the fire timestamp.
5. WHEN the Cron_Service configuration is updated at runtime, THE Cron_Service SHALL stop existing schedules and re-register the updated schedule set without requiring a full service restart.
6. THE Cron_Service `getState()` method SHALL return an object containing all configured schedules with their next scheduled fire time.
7. IF a cron expression is invalid, THEN THE Cron_Service SHALL log a warning for that schedule and skip it without affecting other valid schedules.
8. WHEN the Cron_Service stops, THE Cron_Service SHALL cancel all active schedule timers and release resources.

### Requirement 8: API Trigger Service

**User Story:** As a user, I want an HTTP endpoint that fires automation events on demand, so that external systems, webhooks, IFTTT, or dashboard buttons can trigger automations.

#### Acceptance Criteria

1. THE Trigger_Service SHALL implement the Service_Instance interface with metadata (id: "trigger", displayName: "API Trigger", icon: "webhook", category: "integration").
2. THE REST API SHALL expose `POST /api/services/trigger/{name}` that emits a `service/trigger/{name}` event on the Event_Bus.
3. WHEN a trigger endpoint is called, THE event payload state object SHALL include the trigger name, the request body (if provided), and the fire timestamp.
4. WHEN a trigger endpoint is called with an optional JSON request body, THE Trigger_Service SHALL include the body contents in the event payload state under a `payload` key.
5. THE Trigger_Service SHALL accept trigger requests for any `{name}` value without requiring pre-registration of trigger names.
6. THE Trigger_Service `getState()` method SHALL return an object containing the count of triggers fired and the timestamp of the last trigger event.
7. THE Trigger_Service SHALL report Health_Status as "running" whenever the Aeolus HTTP server is accepting requests.

### Requirement 9: System Events Service

**User Story:** As a user, I want the system to emit events on startup and shutdown, so that I can create automations that react to system lifecycle changes.

#### Acceptance Criteria

1. THE System_Events_Service SHALL implement the Service_Instance interface with metadata (id: "system", displayName: "System Events", icon: "server", category: "system").
2. WHEN the System_Events_Service starts, THE System_Events_Service SHALL emit a `service/system/startup` event on the Event_Bus with the boot timestamp in the state payload.
3. WHEN the Aeolus backend begins graceful shutdown, THE System_Events_Service SHALL emit a `service/system/shutdown` event on the Event_Bus before other services are stopped.
4. THE System_Events_Service SHALL require no user configuration (empty Service_Config_Schema).
5. THE System_Events_Service `getState()` method SHALL return an object containing the startup timestamp and the current uptime in seconds.

### Requirement 10: Sandbox Services API

**User Story:** As an automation script author, I want a `services` global in the sandbox so that I can query service state from script rules.

#### Acceptance Criteria

1. THE Sandbox SHALL expose a `services` global object alongside the existing `devices`, `mqtt`, `log`, and `context` globals.
2. THE `services.get(serviceType)` method SHALL return a read-only snapshot of the service state from the Service_Instance's `getState()` method, or `undefined` if the service is not running.
3. THE `services.list()` method SHALL return an array of objects containing the service type ID, display name, and running status for all registered services.
4. THE sandbox type definitions file (`sandbox-types.d.ts`) SHALL be updated with type declarations for the `services` global, including the `get()` and `list()` methods.
5. THE `services` global SHALL provide read-only access — script rules SHALL query service state but SHALL NOT modify it or call service lifecycle methods.

### Requirement 11: Automation Topic Suggestions for Service Topics

**User Story:** As a user creating an automation, I want the trigger topic field to suggest available service topics, so that I can discover and select service event topics without memorizing them.

#### Acceptance Criteria

1. THE REST API SHALL expose `GET /api/services/topics` returning an array of all currently available service event topics (e.g. `service/cron/every-5m`, `service/trigger/{name}`, `service/system/startup`).
2. WHEN the Cron_Service has configured schedules, THE topics endpoint SHALL include a `service/cron/{scheduleName}` entry for each configured schedule.
3. THE topics endpoint SHALL include static entries for `service/system/startup` and `service/system/shutdown` when the System_Events_Service is enabled.
4. THE topics endpoint SHALL include `service/trigger/{name}` as a template entry indicating the API Trigger pattern.

### Requirement 12: Services Dashboard UI

**User Story:** As a user, I want a Services section in the dashboard where I can see available services, enable or disable them, configure cron schedules, and monitor service health.

#### Acceptance Criteria

1. THE Dashboard SHALL include a "Services" page accessible from the sidebar navigation at the `/services` route.
2. WHEN the Services page loads, THE Dashboard SHALL display a list of all available service types from `GET /api/services/available` with their display name, icon, description, and an enable/disable toggle.
3. WHEN a user enables a Service, THE Dashboard SHALL display the Service_Config_Schema as a dynamic form and submit the configuration to `POST /api/services`.
4. WHILE a Service is enabled, THE Dashboard SHALL display its Service_Health_Status with a colour-coded indicator (green for running, amber for degraded, red for stopped).
5. WHEN a user enables the Cron_Service, THE Dashboard SHALL render a schedule editor allowing the user to add, edit, and remove named cron schedules with human-readable descriptions of the cron expressions.
6. WHEN a user clicks "Disable" on an enabled Service, THE Dashboard SHALL call `DELETE /api/services/:id` and update the UI to reflect the disabled state.
7. WHEN a Service is in "stopped" state due to an error, THE Dashboard SHALL display a "Retry" button that calls `POST /api/services/:id/retry`.
8. THE Services page SHALL follow the Aeolus design system defined in BRANDING.md, using Tailwind theme tokens (background, surface, primary, accent), Lucide icons, and the standard card layout with 12-16px border radius.

### Requirement 13: Application Wiring and Startup Integration

**User Story:** As a platform maintainer, I want the Services framework to be wired into the Aeolus startup sequence alongside Connectors and MQTT, so that services are available immediately on boot.

#### Acceptance Criteria

1. WHEN the Aeolus backend starts, THE entry point (`index.ts`) SHALL instantiate the Service_Registry, Service_Store, and Service_Manager, and register the three built-in services (Cron, Trigger, System Events).
2. WHEN the Aeolus backend starts, THE Service_Manager SHALL restore enabled services from the Service_Store after the database is initialized but before the HTTP server begins listening.
3. THE Sandbox constructor SHALL accept the Service_Manager as an optional dependency and wire the `services` global when available.
4. THE graceful shutdown handler SHALL call `Service_Manager.disposeAll()` before disconnecting MQTT and disposing Connectors.
5. THE service REST routes SHALL be mounted at `/api/services` on the Express app alongside existing route mounts.
