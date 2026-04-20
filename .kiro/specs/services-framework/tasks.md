# Implementation Plan: Services Framework

## Overview

Add a pluggable Services Framework as a third event source layer alongside Connectors and MQTT. Implementation mirrors the Connector Framework architecture: interfaces → registry → store → manager → built-in services (cron, trigger, system) → sandbox integration → REST API → frontend UI → application wiring. Services emit events on the standard event bus using synthetic `service/{type}/{name}` topics, requiring zero changes to the automation engine.

## Tasks

- [x] 1. Service interfaces and database schema
  - [x] 1.1 Create service interface definitions
    - Create `src/services/service.interface.ts` with all TypeScript interfaces: ServiceMetadata, ServiceConfigSchema (reusing ConfigFieldDescriptor), ServiceHealthStatus, ServiceDependencies, ServiceInstance, ServiceModule, ServiceRecord, ServiceInstanceInfo
    - Include TSDoc on every interface and field
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.2 Add services table to database schema
    - Add `CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, service_type TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, config TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)` to `initSchema()` in `src/db/database.ts`
    - _Requirements: 4.1_

- [x] 2. Service Registry
  - [x] 2.1 Implement ServiceRegistry
    - Create `src/services/service-registry.ts` with ServiceRegistry class
    - Implement `register(mod)`: validate module exports metadata (with string id), configSchema (array), createService (function); log warning and skip invalid modules; log warning and overwrite on duplicate IDs
    - Implement `listAvailable()` returning metadata and configSchema for all registered modules
    - Implement `getModule(serviceType)` returning the module or undefined
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.2 Write property test: Registry rejects invalid modules (Property 1)
    - **Property 1: Registry rejects invalid modules**
    - Generate random objects with varying combinations of metadata/configSchema/createService, verify only valid ones are registered and appear in `listAvailable()` / `getModule()`
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.2, 2.3**

  - [ ]* 2.3 Write property test: Registration round-trip (Property 2)
    - **Property 2: Registration round-trip**
    - Generate random valid ServiceModules, register, verify retrieval via `getModule()` matches; register duplicate IDs, verify overwrite
    - **Validates: Requirements 2.1, 2.4, 2.5, 2.6**

- [x] 3. Service Store
  - [x] 3.1 Implement ServiceStore
    - Create `src/services/service-store.ts` with ServiceStore class mirroring ConnectorStore
    - Constructor takes sql.js Database instance
    - Implement `save(record)`: INSERT OR REPLACE into services table, call `persistDatabase()`
    - Implement `disable(instanceId)`: SET enabled = 0, call `persistDatabase()`
    - Implement `loadEnabled()`: SELECT WHERE enabled = 1, parse JSON config, skip malformed rows with warning
    - Implement `loadAll()`: SELECT all records
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 3.2 Write property test: Store persistence round-trip (Property 3)
    - **Property 3: Store persistence round-trip**
    - Generate random ServiceRecords with varied configs, save to store, load back, verify equivalence; disable and verify enabled=false with config preserved
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 4. Checkpoint — Persistence and registry
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Service Manager
  - [x] 5.1 Implement ServiceManager
    - Create `src/services/service-manager.ts` with ServiceManager class
    - Constructor takes ServiceRegistry, ServiceStore, EventEmitter (eventBus)
    - Implement `enable(serviceType, config)`: look up module in registry, call `createService(config, { eventBus })`, call `start()`, persist to store, track instance; on `start()` failure mark health as "stopped" and log error
    - Implement `disable(instanceId)`: call `stop()` and `dispose()`, update store to disabled, remove from tracked instances
    - Implement `updateConfig(instanceId, config)`: call `onConfigUpdate()` on instance, merge and persist config
    - Implement `retry(instanceId)`: call `start()` on a stopped instance
    - Implement `listEnabled()`: return ServiceInstanceInfo[] for all running instances
    - Implement `getStatus(instanceId)`: return single ServiceInstanceInfo or undefined
    - Implement `getServiceInstance(serviceType)`: return the running ServiceInstance for sandbox queries
    - Implement `restoreFromStore()`: load enabled records, instantiate and start each
    - Implement `disposeAll()`: stop and dispose all instances, clear tracking
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.4_

  - [ ]* 5.2 Write property test: Manager enable/disable lifecycle (Property 4)
    - **Property 4: Manager enable/disable lifecycle**
    - Generate service types with mock factories, enable then disable, verify removed from `listEnabled()` and `getServiceInstance()` returns undefined; after `disposeAll()` verify empty
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.5, 3.7**

  - [ ]* 5.3 Write property test: Manager restore from store (Property 5)
    - **Property 5: Manager restore from store**
    - Seed store with random enabled records, call `restoreFromStore()`, verify all appear in `listEnabled()` with matching types and configs
    - **Validates: Requirements 3.3, 4.4**

- [x] 6. Checkpoint — Core framework
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Built-in services: Cron Scheduler
  - [x] 7.1 Install node-cron dependency
    - Add `node-cron` and `@types/node-cron` to package.json dependencies/devDependencies
    - _Requirements: 7.1_

  - [x] 7.2 Implement Cron Service module
    - Create `src/services/cron/index.ts` exporting metadata (id: "cron", displayName: "Cron Scheduler", icon: "clock", category: "scheduling"), configSchema (schedules field), and `createService` factory
    - Create CronServiceInstance implementing ServiceInstance: on `start()` parse schedules, validate cron expressions with node-cron, register valid ones, log warnings for invalid; on schedule fire emit `DEVICE_STATE_CHANGE` with topic `service/cron/{scheduleName}` and state `{ scheduleName, cronExpression, firedAt }`; on `onConfigUpdate()` stop all and re-register; on `stop()` cancel all tasks; `getState()` returns schedules with next fire times
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 5.1, 5.3_

  - [ ]* 7.3 Write property test: Cron schedule management (Property 8)
    - **Property 8: Cron schedule management**
    - Generate random mixes of valid/invalid cron expressions, verify `getState()` reflects only valid ones; call `onConfigUpdate()` with new set, verify state reflects only new schedules
    - **Validates: Requirements 7.3, 7.5, 7.6, 7.7**

  - [ ]* 7.4 Write property test: Service event payload format (Property 6)
    - **Property 6: Service event payload format**
    - Generate random service types and event names, emit events, verify NormalizedEvent has correct `deviceId`, `deviceType`, `topic`, `integration`, and `state` shape
    - **Validates: Requirements 5.1, 5.3**

- [x] 8. Built-in services: API Trigger
  - [x] 8.1 Implement Trigger Service module
    - Create `src/services/trigger/index.ts` exporting metadata (id: "trigger", displayName: "API Trigger", icon: "webhook", category: "integration"), empty configSchema, and `createService` factory
    - Create TriggerServiceInstance: `start()` is no-op, health always "running", `getState()` returns `{ triggerCount, lastTriggerAt }`, track trigger count and last trigger timestamp; expose an `emitTrigger(name, body)` method that emits `DEVICE_STATE_CHANGE` with topic `service/trigger/{name}` and state `{ triggerName, payload, firedAt }` and increments counters
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 5.1, 5.3_

  - [ ]* 8.2 Write property test: Trigger event emission and state tracking (Property 9)
    - **Property 9: Trigger event emission and state tracking**
    - Generate random trigger names and bodies, call emitTrigger N times, verify event payloads and `getState().triggerCount` equals N
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6**

- [x] 9. Built-in services: System Events
  - [x] 9.1 Implement System Events Service module
    - Create `src/services/system/index.ts` exporting metadata (id: "system", displayName: "System Events", icon: "server", category: "system"), empty configSchema, and `createService` factory
    - Create SystemEventsServiceInstance: on `start()` emit `service/system/startup` with `{ bootTimestamp }`; on `stop()` emit `service/system/shutdown` with `{ shutdownTimestamp }`; `getState()` returns `{ startupTimestamp, uptimeSeconds }`; health always "running" after start
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 5.1, 5.3_

- [x] 10. Checkpoint — Built-in services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Sandbox services API integration
  - [x] 11.1 Add services global to sandbox
    - Update `SandboxDeps` interface in `src/automations/sandbox.ts` to accept optional `serviceManager?: ServiceManager`
    - Add `services.get(serviceType)` and `services.list()` to the bootstrap script: `get()` calls `serviceManager.getServiceInstance(type)?.getState()`, `list()` returns array of `{ type, displayName, running }` for all registered services
    - Wire host-side callbacks using ivm.Reference pattern matching existing devices/mqtt/log globals
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

  - [x] 11.2 Update sandbox type definitions
    - Add `services` global declaration to `src/automations/sandbox-types.d.ts` with `get(serviceType: string): Record<string, unknown> | undefined` and `list(): Array<{ type: string; displayName: string; running: boolean }>`
    - _Requirements: 10.4_

- [x] 12. Service REST API routes
  - [x] 12.1 Implement service routes
    - Create `src/api/routes/service.routes.ts` with `createServiceRoutes(serviceManager, serviceRegistry)`
    - GET /api/services/available — list registered service types with metadata and configSchema
    - GET /api/services — list enabled service instances with health, config, and service type
    - POST /api/services — enable a service (validate type in registry → 404; validate required config fields → 400; body: `{ service_type, config }`)
    - PATCH /api/services/:id — update service config
    - DELETE /api/services/:id — disable and dispose a service
    - GET /api/services/:id/status — get detailed health status
    - POST /api/services/:id/retry — retry starting a stopped service
    - POST /api/services/trigger/:name — fire an API trigger event (emit `service/trigger/{name}` via TriggerServiceInstance)
    - GET /api/services/topics — list available service event topics for all enabled services
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 8.2, 11.1, 11.2, 11.3, 11.4_

  - [ ]* 12.2 Write property test: Topic matching for service topics (Property 7)
    - **Property 7: Topic matching for service topics**
    - Generate random service topics of form `service/{type}/{name}`, verify automation engine's `topicMatches()` correctly matches exact, `+` wildcard, and `#` wildcard patterns
    - **Validates: Requirements 5.2**

  - [ ]* 12.3 Write property test: Service topics reflect enabled services (Property 10)
    - **Property 10: Service topics reflect enabled services**
    - Enable random services, verify GET /api/services/topics returns topics for each enabled service including cron schedule names
    - **Validates: Requirements 11.1, 11.2**

- [x] 13. Checkpoint — API and sandbox
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Frontend: Services page and sidebar
  - [x] 14.1 Add service API client functions
    - Add to `frontend/src/lib/api-client.ts`: `fetchAvailableServices()`, `fetchEnabledServices()`, `enableService()`, `disableService()`, `retryService()`, `patchServiceConfig()`, `fireServiceTrigger()`, `fetchServiceTopics()` — mirroring the connector API client pattern
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 14.2 Create ServicesPage component
    - Create `frontend/src/components/ServicesPage.tsx` following ConnectorsPage pattern
    - Two sections: "Available Services" (from `/api/services/available`) and "Active Services" (from `/api/services`)
    - Available services show as cards with icon, name, description, category, and enable button
    - Enabling shows dynamic config form from configSchema (reuse ConfigForm pattern)
    - Active services show health status with colour-coded dot (green=running, amber=degraded, red=stopped), config summary, disable/retry buttons
    - Follow BRANDING.md: Tailwind theme tokens, Lucide icons, card layout with 12-16px border radius, Inter font
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.8_

  - [x] 14.3 Implement cron schedule editor
    - Add a custom schedule editor component within ServicesPage for the Cron service
    - Display list of configured schedules with name, cron expression, and human-readable description
    - "Add Schedule" button opens inline form with name input and cron expression input
    - Install `cronstrue` npm package; use it to convert cron expressions to human-readable strings in real-time
    - Preset buttons for common schedules: "Every minute", "Every 5 minutes", "Every hour", "Daily at midnight", "Daily at 6am"
    - Client-side cron expression validation before submission
    - _Requirements: 12.5_

  - [x] 14.4 Add Services entry to sidebar navigation
    - Add a "Services" pinned tab entry in `frontend/src/components/Sidebar.tsx` between "Connectors" and "System" using the `Zap` Lucide icon
    - Add route mapping `"default-services": "/services"` to PINNED_ROUTES
    - _Requirements: 12.1_

  - [x] 14.5 Wire Services page routing in App.tsx
    - Import ServicesPage in `frontend/src/App.tsx`
    - Add `<Route path="/services" element={<ServicesPage />} />` alongside existing routes
    - Add "services" to RESERVED_SLUGS in Sidebar.tsx
    - _Requirements: 12.1_

- [x] 15. Application wiring and startup integration
  - [x] 15.1 Wire Services Framework into index.ts
    - Import ServiceRegistry, ServiceStore, ServiceManager, and the three built-in service modules (cron, trigger, system)
    - After connector framework init (step 4 in startup): create ServiceStore, ServiceRegistry, ServiceManager
    - Register built-in services: `serviceRegistry.register(cronModule)`, `serviceRegistry.register(triggerModule)`, `serviceRegistry.register(systemModule)`
    - Call `serviceManager.restoreFromStore()` to restore enabled services
    - Pass `serviceManager` to Sandbox constructor as optional dependency
    - Mount service routes at `/api/services` on the Express app
    - Update graceful shutdown: call `serviceManager.disposeAll()` before `connectorManager.disposeAll()`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 15.2 Add Services entry to dashboard-store pinned tabs
    - Update `frontend/src/store/dashboard-store.ts` default pinned tabs to include `{ id: "default-services", name: "Services", icon: "zap", pinned: true }` between Connectors and System
    - _Requirements: 12.1_

- [x] 16. Documentation updates
  - [x] 16.1 Update COMPREHENSIVE_DOCUMENTATION.md
    - Add Services Framework section documenting architecture, interfaces, built-in services, REST API endpoints, sandbox API, and database schema
    - Follow the documentation-updates steering rules
    - _Requirements: 13.1_

  - [x] 16.2 Create services developer guide
    - Create `src/services/README.md` with developer guide: directory structure, required exports, how to create a new service, metadata fields, config schema, lifecycle methods, event emission pattern
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 17. Final checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 10 correctness properties from the design document
- All code uses TypeScript — backend (Node.js/Express) and frontend (React/Vite)
- The project uses `@fast-check/vitest` for property-based testing (already in package.json)
- `node-cron` is used for the Cron Scheduler service; `cronstrue` for human-readable cron descriptions in the UI
- Services mirror the Connector Framework pattern — anyone familiar with connectors can immediately understand services
