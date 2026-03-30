# Requirements Document

## Introduction

Aeolus MVP Core Platform defines the Phase 1 minimum viable product for a local-first, developer-centric IoT automation platform. The MVP encompasses MQTT message ingestion, a unified device registry, a code-driven automation engine using a TypeScript DSL, a REST API with WebSocket real-time updates, a React dashboard for monitoring and control, and a Philips Hue reference integration. The system runs entirely on local infrastructure (development on Windows, production on Raspberry Pi) with no cloud dependency.

## Glossary

- **MQTT_Ingestion_Service**: The backend module that connects to the Mosquitto MQTT broker, subscribes to device topics, and normalizes incoming messages into internal events.
- **Device_Registry**: The persistent store and in-memory cache that tracks all known devices, their types, capabilities, and current state in a unified format.
- **Automation_Engine**: The rule execution system that evaluates code-driven automation rules written in the TypeScript DSL (when/if/then pattern) against incoming events.
- **Rule**: A single automation definition consisting of a trigger, optional conditions, and one or more actions, registered in the Rule_Registry.
- **Rule_Registry**: The collection of all registered automation rules that the Automation_Engine evaluates against incoming events.
- **REST_API**: The Express.js HTTP server providing endpoints for device listing, device control, and state queries.
- **WebSocket_Server**: The real-time communication layer that pushes device state changes to connected frontend clients.
- **Dashboard**: The React + Vite + Zustand frontend application providing device monitoring, control, and system health display.
- **Hue_Integration**: The plugin module that communicates with a local Philips Hue bridge to discover and control Hue lights.
- **Integration_Interface**: The standard TypeScript interface (connect, discoverDevices, execute, dispose) that all device integrations must implement.
- **Device**: A normalized representation of a physical IoT device with id, name, type (light, sensor, switch, climate), capabilities, state, and integration source.
- **Mosquitto_Broker**: The Eclipse Mosquitto MQTT broker included in the docker-compose configuration, serving as the central event bus.
- **Docker_Compose_Stack**: The containerized deployment configuration including the Mosquitto_Broker, backend service, and frontend service.

## Requirements

### Requirement 1: MQTT Broker Connection

**User Story:** As a developer, I want the backend to connect to the Mosquitto MQTT broker automatically on startup, so that the system can receive messages from IoT devices without manual intervention.

#### Acceptance Criteria

1. WHEN the backend service starts, THE MQTT_Ingestion_Service SHALL establish a connection to the Mosquitto_Broker using the configured host and port.
2. WHEN the MQTT_Ingestion_Service successfully connects to the Mosquitto_Broker, THE MQTT_Ingestion_Service SHALL log the connection status including broker host and port.
3. IF the MQTT_Ingestion_Service fails to connect to the Mosquitto_Broker, THEN THE MQTT_Ingestion_Service SHALL retry the connection using exponential backoff with a maximum of 5 retry attempts.
4. IF the connection to the Mosquitto_Broker is lost after initial establishment, THEN THE MQTT_Ingestion_Service SHALL attempt automatic reconnection using the same retry strategy.

### Requirement 2: MQTT Topic Subscription and Message Normalization

**User Story:** As a developer, I want the system to subscribe to device topics and normalize incoming MQTT messages, so that all device data flows through a consistent internal format.

#### Acceptance Criteria

1. WHEN the MQTT_Ingestion_Service connects to the Mosquitto_Broker, THE MQTT_Ingestion_Service SHALL subscribe to configurable topic patterns (e.g., `sensor/#`, `switch/#`, `motion/#`).
2. WHEN the MQTT_Ingestion_Service receives a message on a subscribed topic, THE MQTT_Ingestion_Service SHALL parse the topic string to extract the device type and device identifier.
3. WHEN the MQTT_Ingestion_Service receives a valid message, THE MQTT_Ingestion_Service SHALL normalize the payload into the standard Device state format containing device id, type, and state values.
4. IF the MQTT_Ingestion_Service receives a message with an unparseable payload, THEN THE MQTT_Ingestion_Service SHALL log a warning including the topic and raw payload, and discard the message.
5. WHEN the MQTT_Ingestion_Service normalizes a message, THE MQTT_Ingestion_Service SHALL emit an internal event containing the normalized device state to the Automation_Engine and the Device_Registry.

### Requirement 3: Device Registry Persistence

**User Story:** As a developer, I want devices to be tracked in a persistent registry, so that the system remembers known devices across restarts.

#### Acceptance Criteria

1. THE Device_Registry SHALL store each Device with a unique id, name, type (light, sensor, switch, or climate), capabilities list, current state, and integration source.
2. WHEN the MQTT_Ingestion_Service emits a normalized event for a device id not present in the Device_Registry, THE Device_Registry SHALL create a new Device entry with the received state.
3. WHEN the MQTT_Ingestion_Service emits a normalized event for a device id already present in the Device_Registry, THE Device_Registry SHALL update the existing Device entry state with the new values.
4. THE Device_Registry SHALL persist the device list to a local SQLite database or JSON file so that registered devices survive backend restarts.
5. WHEN the backend service starts, THE Device_Registry SHALL load all previously persisted devices into memory.
6. WHEN the Device_Registry updates a Device entry, THE Device_Registry SHALL emit a state-change event to the WebSocket_Server within 100ms of receiving the update.

### Requirement 4: Automation Engine Rule Registration

**User Story:** As a developer, I want to define automation rules using a TypeScript DSL with a when/if/then pattern, so that I can create testable, code-driven automations.

#### Acceptance Criteria

1. THE Automation_Engine SHALL provide a TypeScript DSL function `when(topic: string)` that returns a chainable builder supporting `.if(condition)` and `.then(action)` methods.
2. WHEN a Rule is defined using the DSL, THE Automation_Engine SHALL register the Rule in the Rule_Registry with a unique identifier, the trigger topic, optional condition function, and action function.
3. THE Rule_Registry SHALL store all registered Rules in memory and provide methods to list, retrieve by id, and remove Rules.
4. WHEN the backend service starts, THE Automation_Engine SHALL load and register all Rule definitions from the configured automations directory.
5. IF a Rule definition contains a syntax error or fails to register, THEN THE Automation_Engine SHALL log the error with the Rule file path and continue loading remaining Rules.

### Requirement 5: Automation Engine Rule Execution

**User Story:** As a developer, I want automation rules to execute automatically when matching events occur, so that my IoT devices respond to real-world conditions without manual intervention.

#### Acceptance Criteria

1. WHEN the MQTT_Ingestion_Service emits an internal event, THE Automation_Engine SHALL evaluate all Rules in the Rule_Registry whose trigger topic matches the event topic.
2. WHEN a matching Rule has an `.if(condition)` clause, THE Automation_Engine SHALL evaluate the condition function with the event context and only proceed to the action if the condition returns true.
3. WHEN a matching Rule's condition is satisfied (or no condition exists), THE Automation_Engine SHALL execute the Rule's `.then(action)` function with the event context.
4. IF a Rule action throws an error during execution, THEN THE Automation_Engine SHALL log the error with the Rule identifier and event details, and continue evaluating remaining matching Rules.
5. THE Automation_Engine SHALL execute all matching Rules for a single event within 500ms of receiving the event.

### Requirement 6: REST API Device Endpoints

**User Story:** As a developer, I want REST API endpoints to query devices and send control commands, so that external tools and the dashboard can interact with the system over HTTP.

#### Acceptance Criteria

1. THE REST_API SHALL expose a `GET /api/devices` endpoint that returns the complete list of Devices from the Device_Registry as a JSON array.
2. THE REST_API SHALL expose a `GET /api/devices/:id` endpoint that returns a single Device by id from the Device_Registry as a JSON object.
3. IF a `GET /api/devices/:id` request references a device id not present in the Device_Registry, THEN THE REST_API SHALL return HTTP status 404 with a JSON error body containing a descriptive message.
4. THE REST_API SHALL expose a `POST /api/devices/:id/action` endpoint that accepts a JSON body with an action type and parameters, and forwards the action to the appropriate integration for execution.
5. IF a `POST /api/devices/:id/action` request references a device id not present in the Device_Registry, THEN THE REST_API SHALL return HTTP status 404 with a JSON error body.
6. IF a `POST /api/devices/:id/action` request contains an invalid or missing action type, THEN THE REST_API SHALL return HTTP status 400 with a JSON error body describing the validation failure.
7. THE REST_API SHALL expose a `GET /api/state` endpoint that returns the aggregated state of all Devices as a JSON object keyed by device id.

### Requirement 7: WebSocket Real-Time State Updates

**User Story:** As a developer, I want real-time device state updates pushed to connected clients via WebSocket, so that the dashboard and other consumers receive instant feedback when device states change.

#### Acceptance Criteria

1. THE WebSocket_Server SHALL accept client connections on a configurable path (default `/ws`).
2. WHEN a client connects to the WebSocket_Server, THE WebSocket_Server SHALL send the current state of all Devices from the Device_Registry as an initial snapshot message.
3. WHEN the Device_Registry emits a state-change event, THE WebSocket_Server SHALL broadcast a JSON message containing the updated Device id and new state to all connected clients.
4. IF a WebSocket client disconnects, THEN THE WebSocket_Server SHALL clean up the connection resources and stop sending messages to that client.
5. THE WebSocket_Server SHALL support a minimum of 10 concurrent client connections.

### Requirement 8: Frontend Dashboard Device Display

**User Story:** As a user, I want a web dashboard that shows all my devices with their current state and toggle controls, so that I can monitor and control my IoT devices from a browser.

#### Acceptance Criteria

1. THE Dashboard SHALL display a grid of device cards, one card per Device retrieved from the `GET /api/devices` endpoint.
2. THE Dashboard SHALL display each device card with the Device name, type icon (using Lucide icons), and current state values.
3. WHEN a Device has type "light" or "switch", THE Dashboard SHALL render a toggle control on the device card that reflects the current on/off state.
4. WHEN a user activates a toggle control on a device card, THE Dashboard SHALL send a `POST /api/devices/:id/action` request with the appropriate on/off action.
5. WHEN the Dashboard receives a state-change message from the WebSocket_Server, THE Dashboard SHALL update the affected device card state within 200ms without requiring a full page refresh.
6. THE Dashboard SHALL use the Aeolus design system colors (Deep Void `#0B0F14` background, Graphite `#121821` card surfaces, Aeolus Blue `#3BA4FF` primary accent) and Inter font as defined in BRANDING.md.
7. THE Dashboard SHALL display a live sensor data section showing the most recent values from Devices of type "sensor" with timestamps.

### Requirement 9: Frontend Dashboard System Health

**User Story:** As a user, I want to see the system health status on the dashboard, so that I can verify the platform is running correctly.

#### Acceptance Criteria

1. THE REST_API SHALL expose a `GET /api/health` endpoint that returns a JSON object with the MQTT_Ingestion_Service connection status, Device_Registry device count, Automation_Engine rule count, and system uptime.
2. THE Dashboard SHALL display a system health indicator showing the MQTT broker connection status (connected or disconnected).
3. THE Dashboard SHALL display the total count of registered Devices and active Rules retrieved from the health endpoint.
4. THE Dashboard SHALL poll the `GET /api/health` endpoint at a 30-second interval to refresh the system health display.

### Requirement 10: Philips Hue Integration

**User Story:** As a developer, I want a reference Philips Hue integration that discovers and controls lights on the local network, so that the platform demonstrates real-world device integration through the plugin interface.

#### Acceptance Criteria

1. THE Hue_Integration SHALL implement the Integration_Interface (connect, discoverDevices, execute, dispose).
2. WHEN the Hue_Integration connects, THE Hue_Integration SHALL discover the local Hue bridge using the configured bridge IP address.
3. WHEN the Hue_Integration discovers the Hue bridge, THE Hue_Integration SHALL authenticate using a pre-configured API key (manual pairing is out of MVP scope).
4. WHEN the Hue_Integration calls discoverDevices, THE Hue_Integration SHALL query the Hue bridge API and return a list of Devices of type "light" with capabilities including "on/off" and "brightness".
5. WHEN the Hue_Integration receives an execute action of type "toggle", THE Hue_Integration SHALL send the corresponding on/off command to the Hue bridge API for the specified light.
6. WHEN the Hue_Integration receives an execute action of type "brightness", THE Hue_Integration SHALL send the brightness value (0-254) to the Hue bridge API for the specified light.
7. IF the Hue_Integration fails to communicate with the Hue bridge, THEN THE Hue_Integration SHALL log the error and mark the affected Devices as offline in the Device_Registry.

### Requirement 11: Integration Interface Contract

**User Story:** As a developer, I want a standard integration interface, so that I can build new device integrations following a consistent pattern.

#### Acceptance Criteria

1. THE Integration_Interface SHALL define the following methods: `connect(): Promise<void>`, `discoverDevices(): Promise<Device[]>`, `execute(action: Action): Promise<void>`, and `dispose(): Promise<void>`.
2. THE Integration_Interface SHALL define a `name: string` property that uniquely identifies the integration.
3. WHEN the backend service starts, THE backend service SHALL call `connect()` on each registered integration and then call `discoverDevices()` to populate the Device_Registry.
4. WHEN the backend service shuts down, THE backend service SHALL call `dispose()` on each registered integration to release resources.
5. IF an integration's `connect()` method throws an error, THEN THE backend service SHALL log the error and continue starting remaining integrations.

### Requirement 12: Docker Compose Deployment

**User Story:** As a developer, I want a docker-compose configuration that runs the entire stack locally, so that I can start developing and testing with a single command.

#### Acceptance Criteria

1. THE Docker_Compose_Stack SHALL define a service for the Mosquitto_Broker using the official Eclipse Mosquitto image with default MQTT port 1883 exposed.
2. THE Docker_Compose_Stack SHALL define a service for the backend that builds from the backend Dockerfile and connects to the Mosquitto_Broker service.
3. THE Docker_Compose_Stack SHALL define a service for the frontend that builds from the frontend Dockerfile and exposes the Dashboard on a configurable port (default 3000).
4. THE Docker_Compose_Stack SHALL configure service dependencies so that the Mosquitto_Broker starts before the backend service.
5. THE Docker_Compose_Stack SHALL use environment variables for all configurable values including MQTT broker host, MQTT broker port, API port, and Hue bridge IP.
6. WHEN a developer runs `docker-compose up`, THE Docker_Compose_Stack SHALL start all three services and the system SHALL be operational within 60 seconds.

### Requirement 13: Device State Serialization Round-Trip

**User Story:** As a developer, I want device state to survive serialization and deserialization without data loss, so that persisted and transmitted device data remains accurate.

#### Acceptance Criteria

1. THE Device_Registry SHALL serialize Device objects to JSON for persistence and API responses.
2. THE Device_Registry SHALL deserialize JSON back into Device objects when loading from persistence.
3. FOR ALL valid Device objects, serializing to JSON and then deserializing back SHALL produce a Device object with identical id, name, type, capabilities, state, and integration values (round-trip property).
4. IF the Device_Registry encounters malformed JSON during deserialization, THEN THE Device_Registry SHALL log a warning with the malformed data and skip the entry without crashing.
