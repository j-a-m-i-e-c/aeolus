# Requirements Document

## Introduction

The device action system in Aeolus currently has several gaps that limit what automation scripts and the frontend can do with devices. `devices.action()` returns `Promise<void>`, so scripts cannot read energy data or know whether an action succeeded. The `ActionExecutor` swallows all errors, so sandbox scripts have no feedback path. There is no API to discover what actions a device supports, so the frontend hardcodes button sets per connector type. MQTT devices are silently skipped when `executeAction()` is called. There is no pre-flight validation, and toggling many devices requires one sequential call per device.

This spec covers the uplift of the device action system to address all seven of these gaps: action results, error propagation, action discovery, capability-to-action mapping, MQTT command support, pre-flight validation, and bulk action execution.

## Glossary

- **Action_System**: The end-to-end pipeline that processes a device action from script or API call through to connector execution and result delivery.
- **Action_Result**: A structured object returned by `devices.action()` and `ConnectorManager.executeAction()` that carries success/failure status and optional payload data.
- **Capability_Descriptor**: A machine-readable record that declares one action type a device supports, including its parameter schema and human-readable metadata.
- **Action_Catalog**: The complete set of `Capability_Descriptor` records for a single device, returned by `GET /api/devices/:id/actions`.
- **Connector**: A module that implements the `Connector` interface and manages communication with a specific device integration (e.g. Hue, Kasa, MQTT).
- **ConnectorManager**: The service that routes actions to the correct `Connector` instance based on a device's `integration` field.
- **ActionExecutor**: The central dispatch service that resolves action handlers and calls `ConnectorManager.executeAction()`.
- **Sandbox**: The isolated-vm execution environment in which user-authored automation scripts run.
- **Device_Registry**: The in-memory store of all currently known devices, keyed by device ID.
- **MQTT_Device**: A device whose `integration` field equals `"mqtt"`, managed via the MQTT broker rather than a connector instance.
- **Param_Schema**: A JSON-Schema-compatible object that describes the parameters accepted by a single action type.
- **Bulk_Action**: A single `devices.actionAll()` call that applies one action to multiple devices matched by a filter predicate.
- **Script_Author**: A user who writes automation scripts in the Aeolus script editor.
- **Frontend**: The Aeolus web dashboard that renders device cards and action buttons.

---

## Requirements

### Requirement 1: Action Result Object

**User Story:** As a Script_Author, I want `devices.action()` to return a result object, so that I can read energy data, check the new device state, and branch my automation logic based on whether the action succeeded.

#### Acceptance Criteria

1. THE Action_System SHALL define an `ActionResult` type with the fields: `success: boolean`, `data?: Record<string, unknown>`, and `error?: string`.
2. WHEN `ConnectorManager.executeAction()` completes without throwing, THE ConnectorManager SHALL return an `ActionResult` with `success: true` and any connector-supplied data in the `data` field.
3. WHEN `ConnectorManager.executeAction()` throws, THE ConnectorManager SHALL return an `ActionResult` with `success: false` and the error message in the `error` field rather than re-throwing.
4. WHEN a `Connector.execute()` implementation returns a data payload, THE ConnectorManager SHALL include that payload in the `ActionResult.data` field.
5. THE Sandbox `devices.action()` function SHALL resolve to an `ActionResult` object that the script can inspect.
6. WHEN `devices.action()` is called in the Sandbox and the action fails, THE Sandbox SHALL resolve the promise with `ActionResult.success === false` rather than rejecting the promise.
7. FOR ALL `ActionResult` objects returned by `devices.action()`, `ActionResult.success` SHALL be a boolean and SHALL NOT be undefined.

---

### Requirement 2: Error Propagation to Scripts

**User Story:** As a Script_Author, I want to know when a `devices.action()` call fails and why, so that I can log the error, retry, or take a fallback action in my script.

#### Acceptance Criteria

1. WHEN `ActionExecutor.execute()` catches an error from a handler, THE ActionExecutor SHALL include the error message in the returned `ActionResult` rather than only logging it.
2. WHEN a `Connector.execute()` call throws with a message such as `"Unsupported action type"`, THE Action_System SHALL surface that message in `ActionResult.error` without modification.
3. WHEN `devices.action()` is called in the Sandbox and the underlying action fails, THE Sandbox SHALL resolve the returned promise with an `ActionResult` where `success === false` and `error` contains the failure reason.
4. THE ActionExecutor SHALL continue to log all action errors at the `error` level in addition to returning them in the `ActionResult`.
5. IF a handler is not registered for the requested action type, THEN THE ActionExecutor SHALL return an `ActionResult` with `success: false` and `error` set to a message identifying the missing handler type.

---

### Requirement 3: Action Discovery API

**User Story:** As a Frontend developer, I want a REST endpoint that returns the actions a specific device supports along with their parameter schemas, so that I can render the correct action buttons dynamically without hardcoding connector types.

#### Acceptance Criteria

1. THE Action_System SHALL expose a `GET /api/devices/:id/actions` endpoint that returns the `Action_Catalog` for the specified device.
2. WHEN the device ID does not exist in the Device_Registry, THE Action_System SHALL return HTTP 404 with a descriptive error message.
3. WHEN the device exists and its connector provides a `Capability_Descriptor` list, THE Action_System SHALL return HTTP 200 with a JSON array of `Capability_Descriptor` objects.
4. WHEN the device exists but no `Capability_Descriptor` list is available for its integration, THE Action_System SHALL return HTTP 200 with an empty array.
5. EACH `Capability_Descriptor` in the response SHALL include: `type: string`, `label: string`, `description: string`, and `params: Param_Schema`.
6. THE `Param_Schema` within each `Capability_Descriptor` SHALL be a valid JSON Schema object describing the accepted parameters, or an empty object `{}` if the action takes no parameters.
7. FOR ALL devices of the same connector type and device sub-type, the `Action_Catalog` SHALL be consistent — the same action types SHALL appear for equivalent devices.

---

### Requirement 4: Capability-to-Action Mapping

**User Story:** As a Script_Author and Frontend developer, I want each device's capabilities array to have a formal mapping to the action types it enables, so that I can programmatically determine what a device can do without trial and error.

#### Acceptance Criteria

1. THE Action_System SHALL define a `CapabilityActionMap` that maps each capability string (e.g. `"on/off"`, `"brightness"`, `"color"`, `"color-temp"`, `"energy-monitoring"`) to one or more `Capability_Descriptor` entries.
2. WHEN a `Connector` declares `Capability_Descriptor` records for a device, THE Action_System SHALL derive the `Action_Catalog` from those records rather than from the `CapabilityActionMap` alone.
3. WHERE a connector does not provide explicit `Capability_Descriptor` records, THE Action_System SHALL fall back to deriving the `Action_Catalog` from the device's `capabilities` array using the `CapabilityActionMap`.
4. WHEN a device has `"on/off"` in its `capabilities` array, THE Action_Catalog SHALL include at minimum the `toggle`, `on`, and `off` action types.
5. WHEN a device has `"brightness"` in its `capabilities` array, THE Action_Catalog SHALL include the `brightness` action type with a `Param_Schema` requiring a numeric `level` field in the range 0–100.
6. WHEN a device has `"color"` in its `capabilities` array, THE Action_Catalog SHALL include the `color` action type with a `Param_Schema` requiring numeric `hue` (0–65535) and `saturation` (0–254) fields.
7. WHEN a device has `"color-temp"` in its `capabilities` array, THE Action_Catalog SHALL include the `color-temp` action type with a `Param_Schema` requiring a numeric `ct` field.
8. WHEN a device has `"energy-monitoring"` in its `capabilities` array, THE Action_Catalog SHALL include a `read-energy` action type that returns current power readings in `ActionResult.data`.

---

### Requirement 5: MQTT Device Command Support

**User Story:** As a Script_Author, I want to send commands to MQTT devices using `devices.action()` instead of having to call `mqtt.publish()` directly, so that my automation scripts are consistent regardless of whether a device is a connector device or an MQTT device.

#### Acceptance Criteria

1. WHEN `ConnectorManager.executeAction()` is called for a device whose `integration` is `"mqtt"`, THE ConnectorManager SHALL publish a command message to the device's command topic rather than returning a no-op.
2. THE command topic for an MQTT_Device SHALL be derived from the device's inbound topic by replacing the trailing segment with `"set"` (e.g. `home/plug1/state` → `home/plug1/set`), unless the device record specifies an explicit `commandTopic` field.
3. WHEN `devices.action()` is called in the Sandbox with an MQTT_Device ID and action type `"command"`, THE Sandbox SHALL publish the `params` object serialised as JSON to the device's command topic.
4. WHEN `devices.action()` is called with action type `"command"` and a `payload` param, THE Action_System SHALL publish the `payload` value directly as the MQTT message body.
5. IF the MQTT broker is not connected when a command action is dispatched to an MQTT_Device, THEN THE Action_System SHALL return an `ActionResult` with `success: false` and an error message indicating the broker is unavailable.
6. WHEN an MQTT command is published successfully, THE Action_System SHALL return an `ActionResult` with `success: true`.
7. THE `Action_Catalog` for an MQTT_Device SHALL include a `command` action type with a `Param_Schema` accepting a `payload` field of type `string` or `object`.

---

### Requirement 6: Pre-flight Action Validation

**User Story:** As a Script_Author, I want `devices.action()` to validate the action type and parameters before sending them to the connector, so that I get a clear error immediately rather than a runtime exception from deep inside the connector.

#### Acceptance Criteria

1. WHEN `devices.action()` is called with an action type that is not present in the device's `Action_Catalog`, THE Action_System SHALL return an `ActionResult` with `success: false` and an error message listing the supported action types for that device.
2. WHEN `devices.action()` is called with an action type that is in the `Action_Catalog` but with parameters that do not satisfy the `Param_Schema`, THE Action_System SHALL return an `ActionResult` with `success: false` and an error message identifying the invalid or missing parameter.
3. WHEN `devices.action()` is called with a device ID that does not exist in the Device_Registry, THE Action_System SHALL return an `ActionResult` with `success: false` and an error message identifying the unknown device ID.
4. THE Action_System SHALL perform pre-flight validation before calling `Connector.execute()`, so that no network request is made for an invalid action.
5. IF pre-flight validation passes, THEN THE Action_System SHALL proceed to execute the action and return the result from the connector.
6. WHEN pre-flight validation is skipped because no `Action_Catalog` is available for the device's integration, THE Action_System SHALL proceed to execute the action and return the connector's result directly.
7. FOR ALL validation errors, the `ActionResult.error` message SHALL identify the device ID, the requested action type, and the reason for rejection.

---

### Requirement 7: Bulk Action Execution

**User Story:** As a Script_Author, I want a `devices.actionAll()` function that applies one action to multiple devices at once, so that I can control groups of devices without writing a loop and without the actions being serialised one-by-one.

#### Acceptance Criteria

1. THE Sandbox SHALL expose a `devices.actionAll(filter, actionType, params?)` function that accepts a predicate function, an action type string, and an optional params object.
2. WHEN `devices.actionAll()` is called, THE Sandbox SHALL apply the filter predicate to all devices in the Device_Registry and collect the matching set.
3. WHEN the matching set is non-empty, THE Sandbox SHALL dispatch the action to all matched devices concurrently using `Promise.allSettled()` rather than sequentially.
4. THE `devices.actionAll()` function SHALL return a `BulkActionResult` object containing: `total: number`, `succeeded: number`, `failed: number`, and `results: Array<{ deviceId: string } & ActionResult>`.
5. WHEN one or more individual actions fail within a `devices.actionAll()` call, THE Sandbox SHALL still resolve the returned promise and SHALL NOT reject it.
6. WHEN the filter predicate matches zero devices, THE Sandbox SHALL return a `BulkActionResult` with `total: 0`, `succeeded: 0`, `failed: 0`, and an empty `results` array.
7. IF the filter predicate throws an error, THEN THE Sandbox SHALL return a `BulkActionResult` with `total: 0`, `succeeded: 0`, `failed: 0`, and a `results` array containing a single entry with `success: false` and the predicate error message.
8. FOR ALL `BulkActionResult` objects, `succeeded + failed` SHALL equal `total`.
