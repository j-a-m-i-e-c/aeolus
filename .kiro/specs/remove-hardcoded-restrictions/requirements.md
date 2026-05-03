# Requirements Document

## Introduction

Aeolus has accumulated hardcoded restrictions across its codebase that prevent the platform from being truly extensible. The topic parser was recently overhauled to accept any MQTT topic, but several downstream components still gate on fixed lists of device types, action types, condition types, event types, and simulated devices. This spec removes all such restrictions and rearchitects the affected components so that everything is open and registered uniformly — no concept of "built-in" vs "custom", just registered capabilities.

## Glossary

- **Database**: The SQLite persistence layer managed by `src/db/database.ts` using sql.js
- **Device_Registry**: The in-memory device cache (`src/core/device-registry.ts`) that upserts devices from NormalizedEvents and persists them to the Database
- **Action_Executor**: The central dispatch service (`src/automations/action-executor.ts`) that routes automation action descriptors to the appropriate handler
- **Condition_Evaluator**: The logic within `registerUiRule()` in `src/api/routes/automation.routes.ts` that builds condition functions from stored rule condition_type/condition_value pairs
- **WebSocket_Server**: The real-time push layer (`src/websocket/ws-server.ts`) that broadcasts event bus events to connected browser clients
- **Device_Simulator**: The fake-data generator (`src/simulator/device-simulator.ts`) that emits NormalizedEvents for demo/development use
- **Topic_Parser**: The MQTT topic parser (`src/mqtt/topic-parser.ts`) that produces a ParsedTopic with deviceId, deviceType, and name
- **NormalizedEvent**: The internal event structure emitted after MQTT message processing, defined in `src/core/types.ts`
- **ParsedTopic**: The structured output of the Topic_Parser containing deviceId, deviceType, and a human-readable name
- **Action_Handler**: A function registered in the Action_Executor that knows how to execute one type of action
- **Condition_Factory**: A function registered in the Condition_Evaluator that builds a condition predicate from a condition_type and condition_value pair

## Requirements

### Requirement 1: Remove Database Device-Type CHECK Constraint

**User Story:** As a developer, I want the Database to accept any device type string, so that devices discovered via MQTT with arbitrary types (e.g. valve, pump, thermostat) are persisted without error.

#### Acceptance Criteria

1. THE Database SHALL accept any non-empty string as the device type column value
2. WHEN a device with any type string is inserted, THE Database SHALL persist the row without error
3. WHEN the Database is initialised on first run, THE Database SHALL create the devices table without a CHECK constraint on the type column
4. WHEN the Database is initialised against an existing database file that has the old CHECK constraint, THE Database SHALL migrate the schema to remove the CHECK constraint so existing installations are unblocked

### Requirement 2: Registry-Based Action Executor

**User Story:** As a developer, I want all action types to be registered uniformly in the Action_Executor, so that adding a new action type means registering a handler — nothing else.

#### Acceptance Criteria

1. THE Action_Executor SHALL dispatch actions through a handler registry keyed by action type string
2. THE Action_Executor SHALL expose a `registerHandler(type: string, handler: ActionHandler)` method for registering action handlers
3. WHEN `execute()` is called with an action type that has a registered handler, THE Action_Executor SHALL dispatch to that handler
4. WHEN `execute()` is called with an action type that has no registered handler, THE Action_Executor SHALL log a warning that includes the unrecognised action type and rule ID
5. THE ActionDescriptor type definition SHALL accept any string as the `type` field instead of a fixed union
6. WHEN the application bootstraps, THE application SHALL register handlers for publish, toggle, device_action, log, delay, and webhook through the same `registerHandler()` method that any other handler would use

### Requirement 3: Registry-Based Condition Evaluation

**User Story:** As a developer, I want all condition types to be registered uniformly, so that adding a new condition type means registering a factory — nothing else.

#### Acceptance Criteria

1. THE Condition_Evaluator SHALL build condition predicates through a factory registry keyed by condition type string
2. THE Condition_Evaluator SHALL expose a `registerCondition(type: string, factory: ConditionFactory)` method for registering condition factories
3. WHEN `registerUiRule()` builds a condition and the condition_type has a registered factory, THE Condition_Evaluator SHALL use that factory to produce the condition predicate
4. WHEN `registerUiRule()` encounters a condition_type with no registered factory, THE Condition_Evaluator SHALL log a warning and leave the condition undefined so the rule fires unconditionally
5. WHEN the application bootstraps, THE application SHALL register factories for value_above, value_below, and equals through the same `registerCondition()` method that any other factory would use

### Requirement 4: Data-Driven WebSocket Event Broadcasting

**User Story:** As a developer, I want WebSocket event broadcasting to be driven by a mapping list, so that adding a new real-time event type means adding an entry to the list — nothing else.

#### Acceptance Criteria

1. THE WebSocket_Server SHALL accept a list of event-type-to-message-type mappings at construction time
2. WHEN the WebSocket_Server is constructed, THE WebSocket_Server SHALL register a broadcast listener for each mapping in the provided list
3. WHEN a new mapping entry is added to the list, THE WebSocket_Server SHALL broadcast that event type without any source code changes to ws-server.ts
4. THE WebSocket_Server SHALL have no hardcoded event listener registrations in its source code

### Requirement 5: Data-Driven Device Simulator

**User Story:** As a developer, I want simulated devices to be defined in a JSON configuration file, so that adding a new simulated device means editing a config file — nothing else.

#### Acceptance Criteria

1. THE Device_Simulator SHALL load all simulated device definitions from a JSON configuration file at startup
2. WHEN the configuration file exists and contains valid device definitions, THE Device_Simulator SHALL create simulated devices from those definitions
3. WHEN a simulated device definition specifies a state generator type (e.g. "drift", "toggle", "random_boolean"), THE Device_Simulator SHALL generate state values according to that generator type
4. THE Device_Simulator SHALL support the generator types needed to replicate the current device set: numeric drift, boolean toggle, and random boolean
5. IF the configuration file does not exist or is unreadable, THEN THE Device_Simulator SHALL log a warning and start with no simulated devices
6. THE Device_Simulator SHALL ship a default configuration file containing the current set of simulated devices so existing demo behaviour is preserved out of the box

### Requirement 6: Device Registry Uses ParsedTopic Name

**User Story:** As a developer, I want the Device_Registry to use the name derived by the Topic_Parser, so that name derivation logic exists in one place and stays consistent.

#### Acceptance Criteria

1. THE NormalizedEvent interface SHALL include an optional `name` field of type string
2. WHEN the MQTT service constructs a NormalizedEvent from a ParsedTopic, THE MQTT service SHALL populate the NormalizedEvent name field with the ParsedTopic name value
3. WHEN the Device_Registry upserts a new device and the NormalizedEvent has a name field, THE Device_Registry SHALL use that name as the device name
4. WHEN the Device_Registry upserts a new device and the NormalizedEvent has no name field, THE Device_Registry SHALL fall back to deriving the name from the deviceId for backward compatibility with non-MQTT event sources
5. THE Device_Registry SHALL remove its inline name derivation logic as the primary path, using it only as the fallback described above

### Requirement 7: Connectors Can Contribute Action Handlers and Condition Factories

**User Story:** As a connector developer, I want my connector to optionally export custom action handlers and condition factories, so that enabling the connector automatically extends the automation system without manual registration elsewhere.

#### Acceptance Criteria

1. THE ConnectorModule interface SHALL accept an optional `actionHandlers` field of type `Record<string, ActionHandler>` for exporting custom action handlers
2. THE ConnectorModule interface SHALL accept an optional `conditions` field of type `Record<string, ConditionFactory>` for exporting custom condition factories
3. WHEN a connector is enabled via ConnectorManager and it exports `actionHandlers`, THE ConnectorManager SHALL register each handler with the ActionExecutor
4. WHEN a connector is enabled via ConnectorManager and it exports `conditions`, THE ConnectorManager SHALL register each factory with the ConditionRegistry
5. WHEN a connector is disabled via ConnectorManager and it had contributed action handlers, THE ConnectorManager SHALL unregister those handlers from the ActionExecutor
6. WHEN a connector is disabled via ConnectorManager and it had contributed condition factories, THE ConnectorManager SHALL unregister those factories from the ConditionRegistry
7. WHEN a connector does not export `actionHandlers` or `conditions`, THE ConnectorManager SHALL enable it without error, behaving exactly as before
