# Implementation Plan: Remove Hardcoded Restrictions

## Overview

This plan removes all hardcoded restrictions from Aeolus's downstream components, replacing fixed switch statements, union types, and inline lists with open registries and data-driven configuration. The implementation proceeds database-first (unblocking the critical broken CHECK constraint), then refactors each component in dependency order, and finishes by wiring connectors into the new registries.

## Tasks

- [x] 1. Remove database device-type CHECK constraint
  - [x] 1.1 Write migration to remove CHECK constraint from devices table
    - In `src/db/database.ts`, update `initSchema()` to create the devices table without the `CHECK(type IN (...))` constraint
    - Add a `migrateRemoveTypeCheck()` function that detects the old CHECK via `sqlite_master` and recreates the table without it (rename → create → copy → drop old)
    - Call `migrateRemoveTypeCheck()` at the end of `initSchema()` so existing databases are migrated on startup
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x]* 1.2 Write property test for database accepting any device type
    - **Property 1: Database accepts any non-empty device type string**
    - Create an in-memory sql.js database, run `initSchema()`, then for arbitrary non-empty strings insert a device row and verify it persists and is retrievable with the same type value
    - **Validates: Requirements 1.1, 1.2**

  - [x]* 1.3 Write unit test for CHECK constraint migration
    - Create an in-memory database with the old CHECK constraint, run `initSchema()`, verify that inserting a device with type `"valve"` succeeds
    - _Requirements: 1.4_

- [x] 2. Checkpoint — Ensure database tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Refactor ActionExecutor to registry-based dispatch
  - [x] 3.1 Add handler registry to ActionExecutor
    - In `src/automations/action-executor.ts`, change `ActionDescriptor.type` from the fixed union `"publish" | "toggle" | "device_action" | "log" | "delay" | "webhook"` to `string`
    - Add a `private handlers = new Map<string, ActionHandler>()` field
    - Add `registerHandler(type: string, handler: ActionHandler): void` and `unregisterHandler(type: string): void` methods
    - Export the `ActionHandler` type: `(action: ActionDescriptor, ruleId: string, deps: ActionExecutorDeps) => void | Promise<void>`
    - Replace the `switch` statement in `execute()` with a map lookup: get handler by `action.type`, warn if missing, call if found
    - Extract each existing case (`handlePublish`, `handleToggle`, `handleDeviceAction`, `handleLog`, `handleDelay`, `handleWebhook`) into standalone handler functions (can remain private methods or module-level functions)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Register built-in action handlers at bootstrap
    - In the application bootstrap code (likely `src/index.ts` or wherever `ActionExecutor` is instantiated), call `registerHandler()` for each of the six built-in types: `publish`, `toggle`, `device_action`, `log`, `delay`, `webhook`
    - Ensure the handlers are registered using the same `registerHandler()` API that connectors will use
    - _Requirements: 2.6_

  - [ ]* 3.3 Write property test for action executor dispatch
    - **Property 2: Action executor dispatches to registered handler**
    - For arbitrary action type strings, register a handler, call `execute()`, verify exactly that handler was invoked
    - **Validates: Requirements 2.1, 2.3**

  - [ ]* 3.4 Write property test for unregistered action type warning
    - **Property 3: Action executor warns on unregistered action type**
    - For arbitrary action type strings with no registered handler, call `execute()`, verify a warning is logged and no error is thrown
    - **Validates: Requirements 2.4**

- [x] 4. Create ConditionRegistry module
  - [x] 4.1 Implement ConditionRegistry class
    - Create `src/automations/condition-registry.ts` with the `ConditionRegistry` class
    - Export `ConditionFactory` type: `(conditionValue: string) => (ctx: EventContext) => boolean`
    - Implement `registerCondition(type: string, factory: ConditionFactory): void`
    - Implement `unregisterCondition(type: string): void`
    - Implement `buildCondition(type: string | null, value: string | null): ((ctx: EventContext) => boolean) | undefined` — returns `undefined` and logs warning if type is unregistered
    - _Requirements: 3.1, 3.2, 3.4_

  - [x] 4.2 Register built-in conditions and wire into registerUiRule
    - At bootstrap, register factories for `value_above`, `value_below`, and `equals` via `registerCondition()`
    - Refactor `registerUiRule()` in `src/api/routes/automation.routes.ts` to use `conditionRegistry.buildCondition()` instead of the inline if/else chain
    - Pass the `ConditionRegistry` instance to `createAutomationRoutes()` and `registerUiRule()`
    - _Requirements: 3.3, 3.5_

  - [ ]* 4.3 Write property test for condition factory dispatch
    - **Property 4: Condition evaluator uses registered factory**
    - For arbitrary condition type strings with a registered factory, call `buildCondition()`, verify the returned predicate was produced by that factory
    - **Validates: Requirements 3.1, 3.3**

  - [ ]* 4.4 Write property test for unregistered condition type
    - **Property 5: Condition evaluator returns undefined for unregistered type**
    - For arbitrary condition type strings with no registered factory, call `buildCondition()`, verify it returns `undefined` and logs a warning
    - **Validates: Requirements 3.4**

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Refactor WebSocket server to data-driven event mapping
  - [x] 6.1 Replace hardcoded event listeners with mapping list
    - In `src/websocket/ws-server.ts`, define the `WsEventMapping` interface: `{ eventName: string; messageType: string }`
    - Change the `WsServer` constructor to accept a `mappings: WsEventMapping[]` parameter
    - Replace the four hardcoded `eventBus.on(...)` calls with a loop over the mappings array
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 6.2 Pass mapping list at construction site
    - At the site where `WsServer` is instantiated (bootstrap), create the `WS_MAPPINGS` array with the four current mappings (`WS_STATE_CHANGE` → `"state-change"`, `MQTT_RAW_MESSAGE` → `"mqtt-message"`, `AUTOMATION_FIRED` → `"automation-fired"`, `AUTOMATION_STATE_CHANGE` → `"automation-state"`)
    - Pass the array to the `WsServer` constructor
    - _Requirements: 4.3_

  - [ ]* 6.3 Write property test for WebSocket event mapping
    - **Property 6: WebSocket server registers a listener for every mapping**
    - For arbitrary lists of WsEventMapping entries, construct a WsServer, emit each event, verify a broadcast with the corresponding messageType is produced
    - **Validates: Requirements 4.2, 4.3**

- [x] 7. Refactor DeviceSimulator to JSON config
  - [x] 7.1 Create default simulator config file
    - Create `data/simulator-devices.json` containing the current 7 simulated devices in the JSON schema defined in the design (topic, deviceId, deviceType, intervalMs, generator with type/min/max/step/initial/key/probability)
    - _Requirements: 5.6_

  - [x] 7.2 Refactor DeviceSimulator to load from config
    - In `src/simulator/device-simulator.ts`, change the constructor to accept `configPath: string`
    - Implement `loadConfig()` to read and parse the JSON file, returning `SimDeviceConfig[]`
    - Implement generator dispatch: `drift` (numeric drift within bounds), `toggle` (boolean flip), `random_boolean` (probability-based boolean)
    - Replace the hardcoded device array in `start()` with devices loaded from config
    - If config file is missing or invalid, log a warning and start with zero devices
    - Update the construction site to pass the config path
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 7.3 Write property test for simulator config loading
    - **Property 7: Simulator creates devices from JSON config**
    - For arbitrary valid JSON config arrays, verify the simulator creates exactly one device per entry with matching topic, deviceId, and deviceType
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 7.4 Write property test for generator value bounds
    - **Property 8: Simulator generators produce type-conforming values**
    - For arbitrary drift generators with min/max, verify generated values are within [min, max]. For toggle/random_boolean generators, verify output is always boolean
    - **Validates: Requirements 5.3, 5.4**

- [x] 8. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Flow ParsedTopic name into NormalizedEvent and DeviceRegistry
  - [x] 9.1 Add name field to NormalizedEvent and populate from MQTT service
    - In `src/core/types.ts`, add `name?: string` to the `NormalizedEvent` interface
    - In `src/mqtt/mqtt-service.ts` `handleMessage()`, populate `event.name` with `parsed.name` from the ParsedTopic
    - _Requirements: 6.1, 6.2_

  - [x] 9.2 Update DeviceRegistry to use event.name
    - In `src/core/device-registry.ts` `upsert()`, use `event.name` as the device name when present for new devices
    - Extract the existing inline name derivation logic into a private `deriveNameFromId(deviceId: string)` method and use it as the fallback when `event.name` is undefined
    - _Requirements: 6.3, 6.4, 6.5_

  - [ ]* 9.3 Write property test for NormalizedEvent.name population
    - **Property 9: MQTT service populates NormalizedEvent.name from ParsedTopic**
    - For arbitrary valid MQTT topics, verify the emitted NormalizedEvent has `name` equal to `parseTopic(topic).name`
    - **Validates: Requirements 6.2**

  - [ ]* 9.4 Write property test for DeviceRegistry name from event
    - **Property 10: Device registry uses event.name when present**
    - For arbitrary NormalizedEvents with a non-undefined name, verify the upserted device's name equals the event's name
    - **Validates: Requirements 6.3**

  - [ ]* 9.5 Write property test for DeviceRegistry name fallback
    - **Property 11: Device registry falls back to ID-derived name when name absent**
    - For arbitrary NormalizedEvents with undefined name, verify the upserted device's name is derived from the deviceId
    - **Validates: Requirements 6.4**

- [x] 10. Extend ConnectorModule interface and ConnectorManager for contributed handlers
  - [x] 10.1 Add actionHandlers and conditions to ConnectorModule interface
    - In `src/connectors/connector.interface.ts`, add optional `actionHandlers?: Record<string, ActionHandler>` and `conditions?: Record<string, ConditionFactory>` fields to the `ConnectorModule` interface
    - Import the `ActionHandler` and `ConditionFactory` types
    - _Requirements: 7.1, 7.2_

  - [x] 10.2 Update ConnectorManager to register/unregister contributed handlers
    - Add `ActionExecutor` and `ConditionRegistry` as constructor dependencies of `ConnectorManager`
    - Add `contributedHandlers: Map<string, string[]>` and `contributedConditions: Map<string, string[]>` tracking maps
    - In `enable()`, after connecting and discovering devices, register any `actionHandlers` and `conditions` from the module with the ActionExecutor and ConditionRegistry
    - In `disable()`, before disconnecting, unregister contributed handlers and conditions
    - In `restoreFromStore()`, apply the same registration logic so contributed handlers are restored on restart
    - Update the ConnectorManager construction site to pass the new dependencies
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 10.3 Write property test for connector enable registering handlers
    - **Property 12: Connector enable registers contributed action handlers**
    - For arbitrary connector modules with actionHandlers maps, verify enabling registers all handlers and disabling unregisters them
    - **Validates: Requirements 7.3, 7.5**

  - [ ]* 10.4 Write property test for connector enable registering conditions
    - **Property 13: Connector enable registers contributed condition factories**
    - For arbitrary connector modules with conditions maps, verify enabling registers all factories and disabling unregisters them
    - **Validates: Requirements 7.4, 7.6**

- [x] 11. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update Hue connector with reference action handlers and conditions
  - [x] 12.1 Add actionHandlers and conditions exports to Hue connector
    - In `src/connectors/hue/index.ts`, export `actionHandlers` with:
      - `hue_scene`: an ActionHandler that activates a Hue scene by name (reads `params.sceneName`, finds the scene via the Hue bridge API or connector instance, and activates it)
      - `hue_color_loop`: an ActionHandler that starts or stops a color loop on a Hue light (reads `params.enable` boolean and `target` device ID)
    - Export `conditions` with:
      - `brightness_above`: a ConditionFactory that returns a predicate checking if a Hue light's brightness state exceeds the threshold parsed from `conditionValue`
    - These serve as reference implementations showing how connectors contribute to the registries
    - _Requirements: 7.1, 7.3, 7.4_

  - [ ]* 12.2 Write unit tests for Hue connector action handlers and conditions
    - Test `hue_scene` handler dispatches correctly
    - Test `hue_color_loop` handler dispatches correctly
    - Test `brightness_above` condition factory returns correct predicate
    - _Requirements: 7.3, 7.4_

- [x] 13. Update Kasa connector with reference action handlers and conditions
  - [x] 13.1 Add actionHandlers and conditions exports to Kasa connector
    - In `src/connectors/kasa/index.ts`, export `actionHandlers` with:
      - `kasa_energy_report`: an ActionHandler that logs current energy usage for a Kasa device (reads `target` device ID, fetches energy data from device state, logs it)
    - Export `conditions` with:
      - `power_above`: a ConditionFactory that returns a predicate checking if a Kasa plug's power draw exceeds the threshold parsed from `conditionValue`
    - These serve as reference implementations showing how connectors contribute to the registries
    - _Requirements: 7.2, 7.3, 7.4_

  - [ ]* 13.2 Write unit tests for Kasa connector action handlers and conditions
    - Test `kasa_energy_report` handler logs energy data correctly
    - Test `power_above` condition factory returns correct predicate
    - _Requirements: 7.3, 7.4_

- [x] 14. Update documentation
  - [x] 14.1 Update COMPREHENSIVE_DOCUMENTATION.md
    - Document the new ActionExecutor handler registry pattern and `registerHandler()` API
    - Document the new ConditionRegistry module and `registerCondition()` API
    - Document the WsEventMapping data-driven pattern
    - Document the simulator JSON config file format and location (`data/simulator-devices.json`)
    - Document the `NormalizedEvent.name` field and how device names flow from topic parser
    - Document the `ConnectorModule.actionHandlers` and `ConnectorModule.conditions` optional fields
    - Document how connectors contribute handlers/conditions via enable/disable lifecycle
    - _Requirements: 1.1–1.4, 2.1–2.6, 3.1–3.5, 4.1–4.4, 5.1–5.6, 6.1–6.5, 7.1–7.7_

- [x] 15. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using @fast-check/vitest
- Unit tests validate specific examples and edge cases
- The database CHECK constraint removal (task 1) is prioritized first because it is actively broken and blocking
- No backward compatibility layer is needed — the old patterns are replaced in-place
- The Hue and Kasa connector updates (tasks 12–13) serve as reference implementations for the new connector contribution system
