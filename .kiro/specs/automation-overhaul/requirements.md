# Requirements Document

## Introduction

Overhaul the Aeolus automation system to support TypeScript-in-the-browser scripting, real action execution (MQTT publish, device toggle, connector actions), richer action types, and a code editor UI alongside the existing form-based rule creator. The existing `when/if/then` DSL and file-based rules continue to work unchanged. UI rules gain a new "script" type stored in SQLite, and all action types (publish, toggle, device action) execute for real instead of just logging.

## Glossary

- **Automation_Engine**: The backend service (`AutomationEngine` class) that listens for `DEVICE_STATE_CHANGE` events, evaluates registered rules by topic matching, and executes condition → action pipelines.
- **Rule_Registry**: The in-memory `Map<string, Rule>` that stores all active automation rules (file-based, UI form-based, and script-based).
- **Sandbox**: A restricted JavaScript execution environment (Node.js `vm` module or `isolated-vm`) that runs user-authored TypeScript code with access only to an approved API surface and no access to `require`, `import`, `process`, `fs`, `child_process`, or arbitrary network calls.
- **Sandbox_API**: The controlled set of functions and objects exposed inside the Sandbox: `devices`, `mqtt`, `log`, and `context`.
- **Script_Rule**: A UI-created automation rule where the action logic is user-authored TypeScript code executed in the Sandbox, stored in SQLite with `rule_type = 'script'`.
- **Form_Rule**: A UI-created automation rule built via the form-based editor with predefined condition/action types, stored in SQLite with `rule_type = 'form'`.
- **Code_Editor**: A Monaco or CodeMirror editor component embedded in the frontend dashboard that provides syntax highlighting, type hints, and autocompletion for the Sandbox_API.
- **Connector_Manager**: The backend service that manages connector instances and routes device actions to the correct connector via `executeAction()`.
- **MqttService**: The backend service that manages the MQTT broker connection, including the `publish(topic, payload)` method.
- **DSL**: The existing `when(topic).if(condition).then(action)` builder that produces Rule objects from file-based automation scripts.
- **Action_Executor**: A backend service that receives action descriptors and dispatches them to the appropriate service (MqttService for publish, Connector_Manager for device actions, logger for log actions).
- **Type_Definition_Bundle**: A `.d.ts` file describing the Sandbox_API types, served to the Code_Editor for IntelliSense support.

## Requirements

### Requirement 1: Action Executor Service

**User Story:** As a developer, I want automation actions to actually execute (publish MQTT messages, toggle devices, call connector actions) so that automations produce real-world effects instead of just logging.

#### Acceptance Criteria

1. THE Action_Executor SHALL accept action descriptors containing an action type, a target, and parameters.
2. WHEN the Action_Executor receives a "publish" action, THE Action_Executor SHALL call `MqttService.publish()` with the specified topic and payload.
3. WHEN the Action_Executor receives a "toggle" action, THE Action_Executor SHALL call `Connector_Manager.executeAction()` with a toggle action for the specified device.
4. WHEN the Action_Executor receives a "log" action, THE Action_Executor SHALL write the specified message to the application logger.
5. WHEN the Action_Executor receives a "device_action" action, THE Action_Executor SHALL call `Connector_Manager.executeAction()` with the specified device ID, action type, and parameters.
6. WHEN the Action_Executor receives a "delay" action, THE Action_Executor SHALL pause execution for the specified duration in milliseconds before continuing to the next action in a sequence.
7. WHEN the Action_Executor receives a "webhook" action, THE Action_Executor SHALL send an HTTP request to the specified URL with the specified method, headers, and body.
8. IF the Action_Executor receives an action with an unknown type, THEN THE Action_Executor SHALL log a warning and skip execution without throwing an error.
9. IF an action execution fails, THEN THE Action_Executor SHALL log the error with the rule ID and action details and continue processing remaining actions in a sequence.

### Requirement 2: Outbound MQTT Publish Wiring

**User Story:** As a user, I want the "publish" action type in UI rules to actually publish messages to MQTT topics so that my automations can control MQTT devices bidirectionally.

#### Acceptance Criteria

1. WHEN a Form_Rule with action type "publish" fires, THE Automation_Engine SHALL publish the configured payload to the configured MQTT topic via MqttService.
2. WHEN a Script_Rule calls `mqtt.publish(topic, payload)`, THE Sandbox SHALL delegate the call to `MqttService.publish()`.
3. IF MqttService is not connected when a publish action executes, THEN THE Action_Executor SHALL log an error and skip the publish without crashing the Automation_Engine.
4. THE Action_Executor SHALL emit an `AUTOMATION_FIRED` event on the event bus after a publish action executes, including the rule ID, target topic, and timestamp.

### Requirement 3: TypeScript Sandbox Execution Environment

**User Story:** As a developer, I want to write TypeScript automation code that runs in a sandboxed environment on the backend so that I can express complex automation logic safely.

#### Acceptance Criteria

1. THE Sandbox SHALL execute user-authored TypeScript code that has been transpiled to JavaScript.
2. THE Sandbox SHALL expose a `devices` object with methods `get(id)`, `list()`, `filter(predicate)`, and `action(deviceId, actionType, params)`.
3. THE Sandbox SHALL expose an `mqtt` object with a `publish(topic, payload)` method.
4. THE Sandbox SHALL expose a `log` object with methods `info(message)`, `warn(message)`, and `error(message)`.
5. THE Sandbox SHALL expose a `context` object containing the triggering event's `topic`, `deviceId`, `state`, and `timestamp`.
6. THE Sandbox SHALL prevent access to `require`, `import`, `process`, `fs`, `child_process`, `eval`, `Function`, and `global`.
7. THE Sandbox SHALL prevent arbitrary network calls outside the approved Sandbox_API methods.
8. IF user code throws an uncaught exception, THEN THE Sandbox SHALL catch the error, log it with the Script_Rule ID, and prevent the error from propagating to the Automation_Engine.
9. THE Sandbox SHALL enforce a maximum execution timeout of 5 seconds per script invocation.
10. WHEN `devices.action()` is called inside the Sandbox, THE Sandbox SHALL delegate to the Action_Executor to execute the device action.

### Requirement 4: TypeScript Transpilation and Validation

**User Story:** As a developer, I want my TypeScript automation code to be validated and transpiled before execution so that syntax errors are caught early and the code runs correctly.

#### Acceptance Criteria

1. WHEN a Script_Rule is created or updated via the API, THE backend SHALL transpile the TypeScript source to JavaScript using the TypeScript compiler API.
2. IF the TypeScript source contains syntax errors, THEN THE backend SHALL return a 400 response with the error messages and line numbers.
3. THE backend SHALL strip type annotations and produce ES2022-compatible JavaScript output.
4. THE backend SHALL reject TypeScript source that contains `import` or `require` statements, returning a 400 response with a descriptive error.
5. FOR ALL valid TypeScript source strings, transpiling then executing in the Sandbox SHALL produce equivalent behavior to the original TypeScript intent (round-trip property).

### Requirement 5: Script Rule Storage and Lifecycle

**User Story:** As a user, I want to create, update, enable, disable, and delete script-based automation rules so that I can manage my TypeScript automations alongside form-based rules.

#### Acceptance Criteria

1. THE automation_rules SQLite table SHALL include a `rule_type` column with values "form" or "script".
2. THE automation_rules SQLite table SHALL include a `script_source` column to store the TypeScript source code for Script_Rules.
3. THE automation_rules SQLite table SHALL include a `compiled_js` column to store the transpiled JavaScript for Script_Rules.
4. WHEN a Script_Rule is created via `POST /api/automations`, THE backend SHALL store the TypeScript source, transpile it, store the compiled JavaScript, and register the rule in the Rule_Registry.
5. WHEN a Script_Rule is updated via `PUT /api/automations/:id`, THE backend SHALL re-transpile the TypeScript source, update the stored compiled JavaScript, and re-register the rule in the Rule_Registry.
6. WHEN a Script_Rule is enabled via `PATCH /api/automations/:id/toggle`, THE backend SHALL register the rule in the Rule_Registry using the stored compiled JavaScript.
7. WHEN a Script_Rule is disabled via `PATCH /api/automations/:id/toggle`, THE backend SHALL unregister the rule from the Rule_Registry.
8. WHEN a Script_Rule is deleted via `DELETE /api/automations/:id`, THE backend SHALL remove the rule from both the SQLite database and the Rule_Registry.
9. THE `GET /api/automations` endpoint SHALL return Script_Rules with their `rule_type`, `script_source`, and enabled status alongside Form_Rules and file-based rules.

### Requirement 6: Existing Form Rule Migration and Backward Compatibility

**User Story:** As a user, I want my existing form-based rules and file-based rules to continue working after the overhaul so that no automations break during the upgrade.

#### Acceptance Criteria

1. THE backend SHALL migrate existing automation_rules rows to set `rule_type = 'form'` for all rows that lack a `rule_type` value.
2. THE DSL-based file rules loaded from the `automations/` directory SHALL continue to register and execute without modification.
3. WHEN a Form_Rule fires, THE Automation_Engine SHALL route the action through the Action_Executor instead of only logging.
4. THE `GET /api/automations` endpoint SHALL continue to return both file-based and UI-created rules in the same response format, with an additional `ruleType` field.

### Requirement 7: Code Editor Frontend Component

**User Story:** As a developer, I want a code editor with syntax highlighting and type hints in the dashboard so that I can write TypeScript automations with a good developer experience.

#### Acceptance Criteria

1. THE Code_Editor SHALL render a Monaco or CodeMirror editor instance with TypeScript language support.
2. THE Code_Editor SHALL load the Type_Definition_Bundle for the Sandbox_API so that users receive autocompletion and type hints for `devices`, `mqtt`, `log`, and `context`.
3. THE Code_Editor SHALL display syntax errors inline as the user types.
4. THE Code_Editor SHALL use JetBrains Mono as the editor font, consistent with the Aeolus design system.
5. THE Code_Editor SHALL use the Aeolus dark theme colors (Deep Void `#0B0F14` background, Primary Text `#E6EDF3`, Aeolus Blue `#3BA4FF` for keywords) for syntax highlighting.
6. WHEN the user saves a Script_Rule from the Code_Editor, THE frontend SHALL send the TypeScript source to `POST /api/automations` or `PUT /api/automations/:id`.
7. IF the backend returns transpilation errors, THEN THE Code_Editor SHALL display the errors inline at the corresponding line numbers.

### Requirement 8: Dual-Mode Automations Page

**User Story:** As a user, I want to choose between a simple form-based rule creator and the TypeScript code editor so that both non-developers and developers can create automations.

#### Acceptance Criteria

1. THE Automations_Page SHALL provide a toggle or tab control to switch between "Quick Rule" (form-based) and "Script" (code editor) creation modes.
2. THE Automations_Page SHALL retain the existing form-based rule creator as the "Quick Rule" mode with all current functionality preserved.
3. THE Automations_Page SHALL display Script_Rules and Form_Rules in a unified rule list, distinguished by a visual badge indicating the rule type.
4. WHEN a user selects "Script" mode, THE Automations_Page SHALL render the Code_Editor component with a trigger topic input field and a name field.
5. THE Automations_Page SHALL allow editing of existing Script_Rules by opening them in the Code_Editor with the stored TypeScript source pre-loaded.
6. THE Automations_Page SHALL follow the Aeolus design system: surface cards with `#121821` background, 12-16px border radius, Lucide icons, and 150-250ms ease-in-out transitions.

### Requirement 9: Sandbox API Type Definitions

**User Story:** As a developer, I want type definitions for the sandbox API served to the code editor so that I get accurate IntelliSense while writing automation scripts.

#### Acceptance Criteria

1. THE backend SHALL serve a Type_Definition_Bundle at `GET /api/automations/types` containing TypeScript declarations for the Sandbox_API.
2. THE Type_Definition_Bundle SHALL declare the `devices` object with typed methods: `get(id: string): Device | undefined`, `list(): Device[]`, `filter(predicate: (d: Device) => boolean): Device[]`, and `action(deviceId: string, actionType: string, params?: Record<string, unknown>): Promise<void>`.
3. THE Type_Definition_Bundle SHALL declare the `mqtt` object with `publish(topic: string, payload: string): void`.
4. THE Type_Definition_Bundle SHALL declare the `log` object with `info(message: string): void`, `warn(message: string): void`, and `error(message: string): void`.
5. THE Type_Definition_Bundle SHALL declare the `context` object with typed fields: `topic: string`, `deviceId: string`, `state: Record<string, unknown>`, and `timestamp: number`.
6. THE Type_Definition_Bundle SHALL declare the `Device` interface matching the Aeolus core `Device` type.
7. THE Code_Editor SHALL fetch the Type_Definition_Bundle on mount and register it with the editor's TypeScript language service.

### Requirement 10: Richer Action Types in Form Rules

**User Story:** As a user, I want additional action types in the form-based rule creator (device actions, delays, webhooks) so that I can build more powerful automations without writing code.

#### Acceptance Criteria

1. THE form-based rule creator SHALL offer the following action types: "log", "publish", "toggle", "device_action", "delay", and "webhook".
2. WHEN the user selects "device_action", THE form SHALL display a device selector and an action type input with a parameters field.
3. WHEN the user selects "delay", THE form SHALL display a duration input in milliseconds.
4. WHEN the user selects "webhook", THE form SHALL display URL, HTTP method, and body fields.
5. WHEN the user selects "publish", THE form SHALL display a target topic field and a payload field.
6. THE form-based rule creator SHALL display a live DSL preview that updates as the user configures the action, showing the `when(...).if(...).then(...)` representation.
