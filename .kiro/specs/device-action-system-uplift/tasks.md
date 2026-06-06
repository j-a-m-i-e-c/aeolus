# Implementation Plan: Device Action System Uplift

## Overview

Closes seven gaps in the Aeolus device action pipeline: action results, error propagation, action discovery, capability-to-action mapping, MQTT command support, pre-flight validation, and bulk execution. All changes are confined to the existing TypeScript source tree. No new infrastructure is required.

## Tasks

- [x] 1. Add core types to `src/core/types.ts`
  - [x] 1.1 Define `ActionResult` interface
    - Add `success: boolean`, `data?: Record<string, unknown>`, `error?: string` fields
    - Export the interface from `src/core/types.ts`
    - _Requirements: 1.1_

  - [x] 1.2 Define `BulkActionResult` interface
    - Add `total`, `succeeded`, `failed`, and `results: Array<{ deviceId: string } & ActionResult>` fields
    - Export the interface from `src/core/types.ts`
    - _Requirements: 7.4_

- [ ] 2. Create `src/connectors/capability-action-map.ts`
  - [-] 2.1 Implement `CAPABILITY_ACTION_MAP` constant
    - Map `"on/off"` → `toggle`, `on`, `off` descriptors
    - Map `"brightness"` → `brightness` descriptor with `level` param schema (0–100)
    - Map `"color"` → `color` descriptor with `hue` (0–65535) and `saturation` (0–254) param schemas
    - Map `"color-temp"` → `color-temp` descriptor with `ct` param schema
    - Map `"energy-monitoring"` → `read-energy` descriptor
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [-] 2.2 Implement `MQTT_COMMAND_DESCRIPTOR` constant
    - Define `command` action type with `payload: string | object` param schema
    - Export alongside `CAPABILITY_ACTION_MAP`
    - _Requirements: 5.7_

  - [~] 2.3 Write property test for capability mapping completeness (Property 8)
    - **Property 8: Capability-to-action mapping completeness**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7, 4.8**
    - Generate random subsets of `["on/off", "brightness", "color", "color-temp", "energy-monitoring"]` with `fc.subarray`
    - Assert that for each capability in the subset, all expected action types appear in the derived catalog

- [ ] 3. Add `CapabilityDescriptor` and `getActionCatalog` to `src/connectors/connector.interface.ts`
  - [ ] 3.1 Define `CapabilityDescriptor` interface
    - Add `type: string`, `label: string`, `description: string`, `params: Record<string, unknown>` fields
    - Export the interface
    - _Requirements: 3.5, 3.6_

  - [~] 3.2 Add optional `getActionCatalog?(deviceId: string): CapabilityDescriptor[] | undefined` to `Connector` interface
    - _Requirements: 4.2_

  - [~] 3.3 Add optional `getActionCatalog?: (device: Device) => CapabilityDescriptor[] | undefined` to `ConnectorModule` interface
    - _Requirements: 4.2_

  - [~] 3.4 Write property test for `CapabilityDescriptor` structural invariant (Property 6)
    - **Property 6: CapabilityDescriptor structural invariant**
    - **Validates: Requirements 3.5, 3.6**
    - Generate random `CapabilityDescriptor` arrays with `fc.array(fc.record(...))`
    - Assert every element has `type`, `label`, `description`, and `params` present and non-null

- [~] 4. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Update `src/connectors/connector-manager.ts`
  - [~] 5.1 Change `executeAction()` return type to `Promise<ActionResult>`
    - Import `ActionResult` from `src/core/types.ts`
    - Import `CAPABILITY_ACTION_MAP` and `MQTT_COMMAND_DESCRIPTOR` from `src/connectors/capability-action-map.ts`
    - _Requirements: 1.2, 1.3_

  - [~] 5.2 Add device-not-found guard
    - Return `ActionResult { success: false, error: "Device '<id>' not found" }` when device ID is absent from registry
    - _Requirements: 1.3, 6.3_

  - [~] 5.3 Add pre-flight validation logic
    - Resolve the device's `Action_Catalog` via `connector.getActionCatalog(deviceId)` if available, else derive from `CAPABILITY_ACTION_MAP`
    - When catalog is available and action type is not in it, return `ActionResult { success: false, error: "Device '<id>': unsupported action '<type>'. Supported: [...]" }`
    - When action type is in catalog but params fail schema, return `ActionResult { success: false, error: "Device '<id>' action '<type>': invalid param '<field>': <reason>" }`
    - When no catalog is available, skip validation and proceed
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_

  - [~] 5.4 Add MQTT command publishing path
    - When `device.integration === "mqtt"`, derive command topic as `topic.split("/").slice(0, -1).concat("set").join("/")`; use explicit `commandTopic` field if present
    - Publish via `MqttService.publish(commandTopic, payload)`
    - Return `ActionResult { success: true }` on success
    - Return `ActionResult { success: false, error: "MQTT broker not connected" }` when broker is unavailable
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [~] 5.5 Wrap `Connector.execute()` call in try/catch
    - On success, return `ActionResult { success: true, data: connectorResult }`
    - On throw, return `ActionResult { success: false, error: thrownMessage }` without re-throwing
    - _Requirements: 1.2, 1.3, 1.4, 2.2_

  - [~] 5.6 Write property test for `executeAction` success wrapping (Property 1)
    - **Property 1: executeAction success wraps connector data**
    - **Validates: Requirements 1.2, 1.4**
    - Generate random `Record<string, unknown>` payloads with `fc.dictionary(fc.string(), fc.jsonValue())`
    - Assert `result.success === true` and `deepEqual(result.data, connectorData)`

  - [~] 5.7 Write property test for `executeAction` error wrapping (Property 2)
    - **Property 2: executeAction failure wraps error message without modification**
    - **Validates: Requirements 1.3, 2.2**
    - Generate random error message strings (including unicode, special chars) with `fc.string()`
    - Assert `result.success === false && result.error === thrownMessage`

  - [~] 5.8 Write property test for pre-flight blocking connector call (Property 10)
    - **Property 10: Pre-flight blocks connector call on invalid action type**
    - **Validates: Requirements 6.1, 6.4**
    - Generate random action type strings not present in a fixed catalog using `fc.string()`
    - Assert `Connector.execute` spy is never called and `result.success === false`

  - [~] 5.9 Write property test for validation error message content (Property 11)
    - **Property 11: Validation error messages identify device, action type, and reason**
    - **Validates: Requirements 6.7**
    - Generate random device IDs, action types, and rejection reasons with `fc.string()`
    - Assert `error` string contains deviceId, actionType, and reason

  - [~] 5.10 Write property test for MQTT command topic derivation (Property 9)
    - **Property 9: MQTT command topic derivation**
    - **Validates: Requirements 5.2**
    - Generate random topic strings (1–5 segments, alphanumeric + `/`) with `fc.array(fc.stringMatching(/^[a-z0-9]+$/), { minLength: 1, maxLength: 5 }).map(segs => segs.join("/"))`
    - Assert `commandTopic === topic.split("/").slice(0, -1).concat("set").join("/")`

- [ ] 6. Update `src/automations/action-executor.ts`
  - [~] 6.1 Change `execute()` return type to `Promise<ActionResult>`
    - Import `ActionResult` from `src/core/types.ts`
    - _Requirements: 2.1_

  - [~] 6.2 Return `ActionResult` from handler dispatch
    - When no handler is registered, return `ActionResult { success: false, error: "No handler for action type: '<type>'" }`
    - When handler succeeds, return the `ActionResult` from `ConnectorManager.executeAction()`
    - When handler throws, catch the error, log at `error` level, and return `ActionResult { success: false, error: thrownMessage }`
    - _Requirements: 2.1, 2.4, 2.5_

  - [~] 6.3 Write property test for `ActionResult.success` always being boolean (Property 3)
    - **Property 3: ActionResult.success is always a boolean**
    - **Validates: Requirements 1.7**
    - Generate random mix of success/failure scenarios
    - Assert `typeof result.success === "boolean"` for every resolved result

  - [~] 6.4 Write property test for `devices.action()` always resolving (Property 4)
    - **Property 4: devices.action() always resolves, never rejects**
    - **Validates: Requirements 1.6, 2.3**
    - Generate random failure scenarios (connector throws, device not found, validation fails)
    - Assert promise resolves (never rejects) and `result.success === false`

  - [~] 6.5 Write property test for missing handler returning typed error (Property 5)
    - **Property 5: Missing handler returns typed error**
    - **Validates: Requirements 2.5**
    - Generate random unregistered action type strings with `fc.string()`
    - Assert `result.success === false && result.error.includes(actionType)`

- [~] 7. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Add `GET /:id/actions` route and update `POST /:id/action` in `src/api/routes/device.routes.ts`
  - [~] 8.1 Add `GET /api/devices/:id/actions` route handler
    - Return HTTP 404 `{ error: "Device not found: <id>" }` when device ID is absent from registry
    - Resolve `Action_Catalog` via `connector.getActionCatalog(deviceId)` if available, else derive from `CAPABILITY_ACTION_MAP` using device's `capabilities` array; include `MQTT_COMMAND_DESCRIPTOR` for MQTT devices
    - Return HTTP 200 with `CapabilityDescriptor[]` (empty array when no catalog is derivable)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.7_

  - [~] 8.2 Update `POST /api/devices/:id/action` to return `ActionResult`
    - Call `ConnectorManager.executeAction()` and return its `ActionResult` as the HTTP 200 body
    - Do not return HTTP 500 for domain-level action failures; always return HTTP 200 with `ActionResult`
    - _Requirements: 1.2, 1.3_

  - [~] 8.3 Write property test for connector catalog taking precedence (Property 7)
    - **Property 7: Connector-provided catalog takes precedence over fallback map**
    - **Validates: Requirements 4.2**
    - Generate random `CapabilityDescriptor[]` arrays with `fc.array(fc.record(...))`
    - Assert returned catalog equals connector-provided array when connector returns non-empty descriptors

- [ ] 9. Update `src/automations/sandbox.ts`
  - [~] 9.1 Update `__actionRef` to return `ActionResult`
    - Change the sandbox-exposed `devices.action()` binding to propagate the `ActionResult` returned by `ActionExecutor.execute()`
    - Ensure the promise resolves with `ActionResult` and never rejects
    - _Requirements: 1.5, 1.6_

  - [~] 9.2 Implement `__actionAllRef` and expose `devices.actionAll()` in `BOOTSTRAP_SCRIPT`
    - Accept `(filter: (device: Device) => boolean, actionType: string, params?: Record<string, unknown>)` signature
    - Apply filter predicate to all devices in `DeviceRegistry`; catch predicate throws and return `BulkActionResult { total: 0, succeeded: 0, failed: 0, results: [{ deviceId: "", success: false, error: msg }] }`
    - When filter matches zero devices, return `BulkActionResult { total: 0, succeeded: 0, failed: 0, results: [] }`
    - Dispatch to all matched devices concurrently with `Promise.allSettled()`
    - Aggregate per-device `ActionResult` objects into `BulkActionResult`
    - Add `devices.actionAll` to `BOOTSTRAP_SCRIPT`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [~] 9.3 Write property test for `BulkActionResult` arithmetic invariant (Property 12)
    - **Property 12: BulkActionResult arithmetic invariant**
    - **Validates: Requirements 7.8**
    - Generate random device lists with random success/failure mix using `fc.array(fc.record(...))`
    - Assert `succeeded + failed === total` for every returned `BulkActionResult`

  - [~] 9.4 Write property test for `actionAll` dispatching only to filter-matched devices (Property 13)
    - **Property 13: actionAll dispatches only to filter-matched devices**
    - **Validates: Requirements 7.2, 7.3**
    - Generate random device lists and boolean predicates with `fc.array` and `fc.func(fc.boolean())`
    - Assert only predicate-matching devices receive dispatch; no non-matching device is called

- [~] 10. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at logical boundaries
- Property tests use `fast-check` (already in the project's test stack); tag each test with `// Feature: device-action-system-uplift, Property N: <property text>`
- Unit tests and property tests are complementary — both should be present for critical paths
- `POST /api/devices/:id/action` intentionally returns HTTP 200 for domain-level failures; callers must inspect `ActionResult.success`
- Individual connector implementations (`hue/`, `kasa/`) may optionally implement `getActionCatalog()` in a follow-up; not required for this uplift

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1"] },
    { "id": 2, "tasks": ["2.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5", "6.1"] },
    { "id": 5, "tasks": ["5.6", "5.7", "5.8", "5.9", "5.10", "6.2"] },
    { "id": 6, "tasks": ["6.3", "6.4", "6.5", "8.1", "8.2"] },
    { "id": 7, "tasks": ["8.3", "9.1", "9.2"] },
    { "id": 8, "tasks": ["9.3", "9.4"] }
  ]
}
```
