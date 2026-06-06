# Requirements Document

## Introduction

The Device Action Capability System is a foundational enhancement to the Aeolus IoT platform that addresses seven identified gaps in the current `devices.action()` API and connector framework. Today, automation scripts fire actions into a void — no return values, no error feedback, no way to know what actions a device supports before calling them. The frontend hardcodes button sets per connector type, MQTT devices silently ignore action calls, and there is no way to batch operations across multiple devices.

This feature introduces a **capability descriptor system** where every connector formally declares the actions each device supports, with typed parameter schemas. It upgrades the action pipeline to return structured results, surfaces available actions through a REST endpoint, gives MQTT devices a first-class `command` action, and adds bulk action support to the sandbox API. The result is a self-describing, observable, and reliable action layer that automation authors and the dashboard can both depend on.

## Glossary

- **Action_Descriptor**: A structured object that describes a single action a device supports, including its type identifier, human-readable label, parameter schema, and capability requirements.
- **Action_Result**: The structured return value of an action execution, containing a success flag, optional data payload, and optional error message.
- **Capability**: A string token on a `Device` object (e.g. `"on/off"`, `"energy-monitoring"`, `"brightness"`) that declares a functional category the device belongs to.
- **Capability_Registry**: The in-memory store that maps connector type + device capability combinations to their available `Action_Descriptor` arrays.
- **Connector**: A pluggable module (e.g. Hue, Kasa) that implements the `Connector` interface and manages a set of physical devices.
- **ConnectorManager**: The runtime service that manages enabled `Connector` instances, routes actions, and polls for device state.
- **Device_Registry**: The in-memory + SQLite store of all known `Device` objects, keyed by device ID.
- **MQTT_Device**: A device whose `integration` field equals `"mqtt"`, managed by the MQTT pipeline rather than a `Connector` instance.
- **Param_Schema**: A JSON-Schema-compatible descriptor for the parameters an action accepts, used for validation and UI rendering.
- **Sandbox**: The isolated-vm V8 execution environment where user-authored automation scripts run.
- **ActionExecutor**: The central dispatch service that routes `ActionDescriptor` objects to registered handlers.
- **Bulk_Filter**: A predicate object used with `devices.actionAll()` to select a subset of devices by capability, integration, type, or ID pattern.

---

## Requirements

### Requirement 1: Action Descriptor Declaration on Connectors

**User Story:** As a connector developer, I want to declare the actions my connector's devices support with typed parameter schemas, so that the platform can validate calls, generate UI, and surface capabilities to automation authors without hardcoding anything per connector.

#### Acceptance Criteria

1. THE `Connector` interface SHALL include an optional `getActionDescriptors(deviceId: string)` method that returns an array of `Action_Descriptor` objects for the specified device.
2. WHEN a `Connector` implements `getActionDescriptors()`, THE `Action_Descriptor` for each action SHALL include: a unique `type` string, a human-readable `label`, an optional `description`, an optional `Param_Schema` object, and an optional array of required `capabilities` strings.
3. THE `Param_Schema` SHALL follow JSON Schema draft-07 conventions for `type`, `properties`, `required`, `minimum`, `maximum`, and `enum` fields.
4. WHEN a `Connector` does not implement `getActionDescriptors()`, THE `Capability_Registry` SHALL return an empty array for that connector's devices rather than throwing an error.
5. THE Hue `Connector` SHALL implement `getActionDescriptors()` and return descriptors for: `toggle`, `brightness` (param: `brightness` integer 0–254), `color` (params: `hue` integer 0–65535, `saturation` integer 0–254), `color-temp` (param: `ct` integer with device-specific min/max), `rename` (param: `name` string), and `delete`.
6. THE Kasa `Connector` SHALL implement `getActionDescriptors()` and return descriptors for: `toggle`, `on`, and `off`.
7. WHEN a Hue device does not have the `"brightness"` capability, THE `getActionDescriptors()` method SHALL omit the `brightness` descriptor from the returned array for that device.
8. WHEN a Hue device does not have the `"color"` capability, THE `getActionDescriptors()` method SHALL omit the `color` descriptor from the returned array for that device.
9. WHEN a Hue device does not have the `"color-temp"` capability, THE `getActionDescriptors()` method SHALL omit the `color-temp` descriptor from the returned array for that device.

---

### Requirement 2: Action Discovery REST Endpoint

**User Story:** As a frontend developer, I want a REST endpoint that returns the available actions for a specific device with their parameter schemas, so that the dashboard can render the correct control buttons and forms dynamically without hardcoding connector-specific logic.

#### Acceptance Criteria

1. THE `Device_Routes` SHALL expose a `GET /api/devices/:id/actions` endpoint.
2. WHEN a valid device ID is provided, THE `GET /api/devices/:id/actions` endpoint SHALL return an array of `Action_Descriptor` objects for that device with HTTP 200.
3. WHEN an unknown device ID is provided, THE `GET /api/devices/:id/actions` endpoint SHALL return HTTP 404 with a structured error body.
4. WHEN the device's `Connector` does not implement `getActionDescriptors()`, THE `GET /api/devices/:id/actions` endpoint SHALL return an empty array with HTTP 200.
5. WHEN the device's `integration` is `"mqtt"`, THE `GET /api/devices/:id/actions` endpoint SHALL return an array containing at least the `command` action descriptor (see Requirement 5).
6. THE `Action_Descriptor` objects in the response SHALL include `type`, `label`, and `paramSchema` fields; `description` and `capabilities` fields are optional.
7. THE `GET /api/devices/:id/actions` endpoint SHALL NOT require authentication beyond the existing tab-permission middleware pattern used by other device endpoints.

---

### Requirement 3: Action Execution Returns a Structured Result

**User Story:** As an automation script author, I want `devices.action()` to return a result object instead of `void`, so that my script can branch on success or failure, read returned data (like energy readings), and log meaningful diagnostics.

#### Acceptance Criteria

1. THE `Action_Result` type SHALL have the shape: `{ success: boolean; data?: Record<string, unknown>; error?: string }`.
2. THE `ConnectorManager.executeAction()` method SHALL return `Promise<Action_Result>` instead of `Promise<void>`.
3. WHEN a `Connector.execute()` call completes without throwing, THE `ConnectorManager` SHALL return an `Action_Result` with `success: true`.
4. WHEN a `Connector.execute()` call throws an error, THE `ConnectorManager` SHALL return an `Action_Result` with `success: false` and the error message in the `error` field, rather than re-throwing.
5. WHEN a `Connector.execute()` call returns a data payload (see Requirement 4), THE `ConnectorManager` SHALL include that payload in the `Action_Result.data` field.
6. THE `Connector` interface's `execute()` method SHALL be updated to return `Promise<Record<string, unknown> | void>` so connectors can optionally return data.
7. THE `POST /api/devices/:id/action` endpoint SHALL include the `Action_Result` in its response body alongside the existing `success` and `deviceId` fields.
8. THE sandbox `devices.action(deviceId, actionType, params?)` function SHALL return `Promise<Action_Result>` so automation scripts can `await` and inspect the result.
9. WHEN the `ActionExecutor` dispatches a `device_action` type, THE `ActionExecutor` SHALL propagate the `Action_Result` returned by `ConnectorManager.executeAction()` back to the sandbox caller.
10. WHEN a device is not found during `devices.action()` in the sandbox, THE sandbox SHALL return an `Action_Result` with `success: false` and a descriptive `error` string rather than silently swallowing the failure.

---

### Requirement 4: Energy Data Return from Kasa Actions

**User Story:** As an automation script author, I want `devices.action("kasa-plug1", "on")` to return the current energy readings in the result data, so that I can read power consumption immediately after toggling a plug without a separate polling cycle.

#### Acceptance Criteria

1. WHEN the Kasa `Connector` executes a `toggle`, `on`, or `off` action on a device that has the `"energy-monitoring"` capability, THE Kasa `Connector` SHALL return a data object containing `voltage`, `current`, `power`, and `totalConsumption` fields if the device's emeter data is available.
2. WHEN the Kasa device does not have the `"energy-monitoring"` capability or emeter data is unavailable, THE Kasa `Connector` SHALL return `undefined` (no data payload) rather than an empty object.
3. THE returned energy data fields SHALL use the same units and field names as the device's `state` object (`voltage` in V, `current` in A, `power` in W, `totalConsumption` in Wh).

---

### Requirement 5: MQTT Devices Support a `command` Action

**User Story:** As an automation script author, I want to call `devices.action("my-esp32", "command", { payload: "ON" })` on an MQTT device and have it publish to the device's command topic, so that I don't need to separately call `mqtt.publish()` and manually construct the topic.

#### Acceptance Criteria

1. WHEN `ConnectorManager.executeAction()` is called for a device whose `integration` is `"mqtt"`, THE `ConnectorManager` SHALL handle the `command` action type by publishing the `params.payload` value to the device's command topic.
2. THE MQTT command topic for a device SHALL be derived from the device's last-seen MQTT topic by replacing the final path segment with `"command"` (e.g. `home/sensors/temp1/state` → `home/sensors/temp1/command`).
3. WHEN the `params.payload` value is a non-string type, THE `ConnectorManager` SHALL serialize it to a JSON string before publishing.
4. WHEN the `params.topic` field is provided in the action params, THE `ConnectorManager` SHALL publish to that explicit topic instead of the derived command topic.
5. WHEN the MQTT service is not connected during a `command` action, THE `ConnectorManager` SHALL return an `Action_Result` with `success: false` and an error message indicating the MQTT service is unavailable.
6. WHEN `ConnectorManager.executeAction()` is called for an MQTT device with an action type other than `command`, THE `ConnectorManager` SHALL return an `Action_Result` with `success: false` and an error message indicating the action type is not supported for MQTT devices.
7. THE `GET /api/devices/:id/actions` endpoint for an MQTT device SHALL return a `command` action descriptor with a `Param_Schema` that requires a `payload` field (string or object) and accepts an optional `topic` field (string).

---

### Requirement 6: Pre-Execution Action Validation

**User Story:** As an automation script author, I want `devices.action()` to validate the action type and parameters against the device's declared capabilities before executing, so that I get a clear error result immediately rather than a runtime exception from deep inside a connector.

#### Acceptance Criteria

1. THE `ConnectorManager` SHALL expose a `validateAction(deviceId: string, actionType: string, params: Record<string, unknown>)` method that returns `{ valid: boolean; error?: string }`.
2. WHEN `validateAction()` is called with an unknown device ID, THE `ConnectorManager` SHALL return `{ valid: false, error: "Device not found: <id>" }`.
3. WHEN `validateAction()` is called with an action type not present in the device's `Action_Descriptor` array, THE `ConnectorManager` SHALL return `{ valid: false, error: "Action '<type>' is not supported by device '<id>'" }`.
4. WHEN `validateAction()` is called with params that do not satisfy the action's `Param_Schema` required fields, THE `ConnectorManager` SHALL return `{ valid: false, error: "<field> is required for action '<type>'" }`.
5. WHEN `validateAction()` is called with a numeric param that falls outside the schema's `minimum` or `maximum` bounds, THE `ConnectorManager` SHALL return `{ valid: false, error: "<field> must be between <min> and <max>" }`.
6. WHEN `validateAction()` is called with valid inputs, THE `ConnectorManager` SHALL return `{ valid: true }`.
7. THE sandbox `devices.action()` function SHALL call `validateAction()` before dispatching the action and SHALL return an `Action_Result` with `success: false` and the validation error string when validation fails, without calling the connector.
8. THE `POST /api/devices/:id/action` endpoint SHALL call `validateAction()` before dispatching and SHALL return HTTP 422 with the validation error when validation fails.

---

### Requirement 7: Bulk Action Support in the Sandbox

**User Story:** As an automation script author, I want to call `devices.actionAll(filter, actionType, params?)` to execute the same action on multiple devices in a single call, so that I can toggle all lights in a room without writing a loop.

#### Acceptance Criteria

1. THE sandbox `devices` global SHALL expose an `actionAll(filter: Bulk_Filter, actionType: string, params?: Record<string, unknown>)` function that returns `Promise<BulkActionResult>`.
2. THE `Bulk_Filter` type SHALL support the following optional fields: `capability` (string — match devices that include this capability), `integration` (string — match devices with this integration), `type` (string — match devices with this device type), `ids` (string[] — match devices whose ID is in the list).
3. WHEN multiple `Bulk_Filter` fields are provided, THE `devices.actionAll()` function SHALL apply them as AND conditions (all must match).
4. THE `BulkActionResult` type SHALL have the shape: `{ total: number; succeeded: number; failed: number; results: Array<{ deviceId: string; result: Action_Result }> }`.
5. WHEN `devices.actionAll()` is called, THE sandbox SHALL execute actions on all matching devices concurrently using `Promise.allSettled()` semantics — a failure on one device SHALL NOT prevent execution on others.
6. WHEN no devices match the `Bulk_Filter`, THE `devices.actionAll()` function SHALL return a `BulkActionResult` with `total: 0`, `succeeded: 0`, `failed: 0`, and an empty `results` array.
7. WHEN `devices.actionAll()` is called with an empty filter object `{}`, THE sandbox SHALL apply the action to all registered devices.
8. THE `devices.actionAll()` function SHALL respect the same pre-execution validation as `devices.action()` — per-device validation failures SHALL be recorded in the `results` array with `success: false` rather than aborting the batch.

---

### Requirement 8: Sandbox Type Enrichment from Capability Descriptors

**User Story:** As an automation script author, I want IntelliSense in the Monaco editor to show me the correct parameter types for `devices.action()` calls based on the actual capabilities of my devices, so that I can write correct automation scripts without consulting external documentation.

#### Acceptance Criteria

1. THE `GET /api/automations/types` endpoint (or equivalent TypeScript declaration endpoint) SHALL include the `Action_Result` and `BulkActionResult` type definitions in the generated type declarations served to the Monaco editor.
2. THE generated type declarations SHALL include a `devices.action(deviceId: string, actionType: string, params?: Record<string, unknown>): Promise<Action_Result>` signature.
3. THE generated type declarations SHALL include a `devices.actionAll(filter: BulkFilter, actionType: string, params?: Record<string, unknown>): Promise<BulkActionResult>` signature.
4. THE `BulkFilter`, `Action_Result`, and `BulkActionResult` types SHALL be fully defined in the generated declarations with all fields and their types documented via JSDoc comments.
5. WHEN the Monaco editor loads an automation script, THE editor SHALL provide autocomplete for `Action_Result` fields (`success`, `data`, `error`) when the user accesses the return value of `devices.action()`.

---

### Requirement 9: Connector Module Capability Export

**User Story:** As a connector developer, I want to export a static capability-to-action mapping from my connector module's `index.ts`, so that the platform can build the `Capability_Registry` at startup without instantiating connectors or calling live devices.

#### Acceptance Criteria

1. THE `ConnectorModule` interface SHALL include an optional `capabilityActions` field of type `Record<string, Action_Descriptor[]>` where keys are capability strings (e.g. `"on/off"`, `"brightness"`).
2. WHEN a `ConnectorModule` exports `capabilityActions`, THE `ConnectorManager` SHALL register those mappings in the `Capability_Registry` when the connector is enabled.
3. WHEN a `ConnectorModule` exports `capabilityActions`, THE `ConnectorManager` SHALL unregister those mappings from the `Capability_Registry` when the connector is disabled.
4. THE Hue connector module SHALL export `capabilityActions` mapping `"on/off"` to `[toggle]`, `"brightness"` to `[brightness]`, `"color"` to `[color]`, and `"color-temp"` to `[color-temp]`.
5. THE Kasa connector module SHALL export `capabilityActions` mapping `"on/off"` to `[toggle, on, off]`.
6. WHEN the `Capability_Registry` is queried for a device's available actions, THE `Capability_Registry` SHALL union the `Action_Descriptor` arrays from all of the device's capabilities, deduplicated by `type`.
7. WHEN both `getActionDescriptors()` (per-device) and `capabilityActions` (per-capability) provide descriptors for the same action type, THE per-device `getActionDescriptors()` result SHALL take precedence, allowing device-specific overrides (e.g. device-specific `ct` min/max bounds).

---

### Requirement 10: Error Propagation from ActionExecutor to Sandbox

**User Story:** As an automation script author, I want errors from action execution to surface as structured `Action_Result` objects in my script rather than being silently swallowed, so that I can implement retry logic or alert on failures.

#### Acceptance Criteria

1. THE `ActionExecutor.execute()` method SHALL return `Promise<Action_Result>` instead of `Promise<void>`.
2. WHEN a registered action handler throws an error, THE `ActionExecutor` SHALL catch the error, log it with the rule ID, and return an `Action_Result` with `success: false` and the error message — it SHALL NOT re-throw.
3. WHEN no handler is registered for the action type, THE `ActionExecutor` SHALL return an `Action_Result` with `success: false` and an error message indicating the unknown action type.
4. WHEN a registered action handler completes without throwing, THE `ActionExecutor` SHALL return an `Action_Result` with `success: true`.
5. THE `ActionExecutor.executeSequence()` method SHALL return `Promise<Action_Result[]>` — one result per action in the sequence, in order.
6. WHEN `ActionExecutor.executeSequence()` encounters a failed action, THE `ActionExecutor` SHALL continue executing subsequent actions and include all results in the returned array.
7. THE `AUTOMATION_FIRED` event emitted by the `ActionExecutor` SHALL include the `Action_Result` in its payload so that metrics and monitoring can track action success rates.
