# Requirements Document

## Introduction

This feature adds Prometheus-compatible metrics export and structured observability to the Aeolus IoT platform. The `/metrics` endpoint exposes telemetry in Prometheus text exposition format, covering MQTT messaging, device state, automation execution, connector health, system resources, WebSocket activity, and data store operations. The implementation uses the `prom-client` library and follows the RED method (Rate, Errors, Duration) for service observability. Label cardinality is managed by grouping on device type rather than device ID.

## Glossary

- **Metrics_Service**: The backend module responsible for registering, collecting, and exposing Prometheus metrics
- **Metrics_Endpoint**: The HTTP route (`/metrics`) that serves collected metrics in Prometheus text exposition format
- **Prometheus_Registry**: The `prom-client` registry instance that holds all registered metric collectors
- **Counter**: A Prometheus metric type that only increases (e.g., messages received)
- **Gauge**: A Prometheus metric type that can increase or decrease (e.g., active connections)
- **Histogram**: A Prometheus metric type that samples observations into configurable buckets (e.g., latency)
- **Label**: A key-value pair attached to a metric for dimensional filtering (e.g., `device_type="sensor"`)
- **Scrape**: A Prometheus server pulling metrics from the `/metrics` endpoint at a configured interval
- **RED_Method**: Rate, Errors, Duration — a standard methodology for service-level observability
- **Event_Bus**: The internal Node.js EventEmitter used for decoupled communication between Aeolus subsystems
- **Collector**: A function or hook that observes system activity and updates metric values

## Requirements

### Requirement 1: Metrics Endpoint

**User Story:** As a platform operator, I want a Prometheus-compatible metrics endpoint, so that I can scrape telemetry into my monitoring stack.

#### Acceptance Criteria

1. THE Metrics_Endpoint SHALL serve metrics at the path `/metrics` using HTTP GET
2. THE Metrics_Endpoint SHALL respond with content type `text/plain; version=0.0.4; charset=utf-8`
3. THE Metrics_Endpoint SHALL return all registered metrics from the Prometheus_Registry in Prometheus text exposition format
4. WHEN the Prometheus_Registry collection fails, THE Metrics_Endpoint SHALL respond with HTTP status 500 and a JSON error body
5. THE Metrics_Endpoint SHALL respond to scrape requests within 500 milliseconds under normal operation

### Requirement 2: Metrics Endpoint Authentication

**User Story:** As a platform operator, I want optional bearer token protection on the metrics endpoint, so that I can restrict access when exposing the endpoint beyond the local network.

#### Acceptance Criteria

1. WHILE the `METRICS_TOKEN` environment variable is not set, THE Metrics_Endpoint SHALL allow unauthenticated access to all requests
2. WHILE the `METRICS_TOKEN` environment variable is set, THE Metrics_Endpoint SHALL reject requests that do not include a matching `Authorization: Bearer <token>` header with HTTP status 401
3. WHILE the `METRICS_TOKEN` environment variable is set, THE Metrics_Endpoint SHALL allow requests that include a matching `Authorization: Bearer <token>` header
4. THE Metrics_Endpoint SHALL bypass the existing application-level JWT authentication middleware

### Requirement 3: MQTT Metrics

**User Story:** As a platform operator, I want visibility into MQTT message throughput and broker connectivity, so that I can detect message backlogs and connection issues.

#### Acceptance Criteria

1. WHEN an MQTT message is received, THE Metrics_Service SHALL increment the `aeolus_mqtt_messages_received_total` counter with label `topic_prefix` (first topic segment)
2. WHEN an MQTT message is published, THE Metrics_Service SHALL increment the `aeolus_mqtt_messages_published_total` counter
3. THE Metrics_Service SHALL expose an `aeolus_mqtt_connection_state` gauge with value 1 for connected and 0 for disconnected
4. WHEN an MQTT message is received, THE Metrics_Service SHALL observe the processing duration in the `aeolus_mqtt_message_processing_duration_seconds` histogram with buckets [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]

### Requirement 4: Device Metrics

**User Story:** As a platform operator, I want to monitor device population and message distribution, so that I can understand fleet composition and detect noisy devices.

#### Acceptance Criteria

1. THE Metrics_Service SHALL expose an `aeolus_devices_registered_total` gauge reflecting the current count of registered devices
2. WHEN a device state change event occurs, THE Metrics_Service SHALL increment the `aeolus_device_messages_total` counter with label `device_type`
3. THE Metrics_Service SHALL NOT use device IDs as metric labels to prevent unbounded label cardinality

### Requirement 5: Automation Metrics

**User Story:** As a platform operator, I want to track automation execution health, so that I can identify failing or slow rules.

#### Acceptance Criteria

1. WHEN an automation rule fires, THE Metrics_Service SHALL increment the `aeolus_automations_executions_total` counter with labels `rule_name` and `status` (success or error)
2. WHEN an automation rule completes execution, THE Metrics_Service SHALL observe the duration in the `aeolus_automations_execution_duration_seconds` histogram with buckets [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5]
3. THE Metrics_Service SHALL expose an `aeolus_automations_active_rules` gauge reflecting the current count of loaded automation rules

### Requirement 6: Connector Metrics

**User Story:** As a platform operator, I want to monitor connector health and polling activity, so that I can detect integration failures with Hue, Kasa, or future connectors.

#### Acceptance Criteria

1. WHEN a connector completes a poll cycle, THE Metrics_Service SHALL increment the `aeolus_connector_polls_total` counter with label `connector_type`
2. WHEN a connector poll encounters an error, THE Metrics_Service SHALL increment the `aeolus_connector_errors_total` counter with label `connector_type`
3. THE Metrics_Service SHALL expose an `aeolus_connector_devices_discovered` gauge with label `connector_type` reflecting the number of devices discovered per connector

### Requirement 7: System Metrics

**User Story:** As a platform operator, I want Node.js runtime metrics, so that I can detect memory leaks, event loop saturation, and resource exhaustion on the Raspberry Pi.

#### Acceptance Criteria

1. THE Metrics_Service SHALL collect default Node.js metrics from `prom-client` (memory usage, event loop lag, GC statistics, active handles)
2. THE Metrics_Service SHALL expose an `aeolus_process_uptime_seconds` gauge reflecting seconds since process start
3. WHEN an HTTP request completes, THE Metrics_Service SHALL increment the `aeolus_http_requests_total` counter with labels `method`, `route`, and `status_code`
4. WHEN an HTTP request completes, THE Metrics_Service SHALL observe the response duration in the `aeolus_http_request_duration_seconds` histogram with buckets [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
5. THE Metrics_Service SHALL normalize route paths by replacing dynamic segments with parameter placeholders to prevent unbounded label cardinality (e.g., `/api/devices/:id` not `/api/devices/abc123`)

### Requirement 8: WebSocket Metrics

**User Story:** As a platform operator, I want to monitor WebSocket connection activity, so that I can understand dashboard usage and detect connection storms.

#### Acceptance Criteria

1. THE Metrics_Service SHALL expose an `aeolus_websocket_connections_active` gauge reflecting the current number of connected WebSocket clients
2. WHEN a WebSocket message is broadcast, THE Metrics_Service SHALL increment the `aeolus_websocket_messages_sent_total` counter with label `message_type`

### Requirement 9: Data Store Metrics

**User Story:** As a platform operator, I want to monitor data store write throughput and query performance, so that I can detect SQLite bottlenecks on the Pi.

#### Acceptance Criteria

1. WHEN a record is written to the data store, THE Metrics_Service SHALL increment the `aeolus_datastore_records_written_total` counter with label `collection`
2. WHEN a data store query completes, THE Metrics_Service SHALL observe the query duration in the `aeolus_datastore_query_duration_seconds` histogram with buckets [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]

### Requirement 10: Metrics Registration and Lifecycle

**User Story:** As a developer, I want a centralized metrics registry with clean lifecycle management, so that metrics are consistently named and properly disposed on shutdown.

#### Acceptance Criteria

1. THE Metrics_Service SHALL register all custom metrics with the default `prom-client` registry using the `aeolus_` prefix
2. THE Metrics_Service SHALL subscribe to Event_Bus events for metric collection rather than modifying existing service code where possible
3. WHEN the application shuts down, THE Metrics_Service SHALL clear the Prometheus_Registry to release resources
4. THE Metrics_Service SHALL use a singleton pattern so that all subsystems share one registry instance

### Requirement 11: Metrics Dashboard Pane (Optional)

**User Story:** As a platform operator, I want a dashboard pane showing key metrics at a glance, so that I can monitor system health without configuring Grafana.

#### Acceptance Criteria

1. WHERE the metrics dashboard feature is enabled, THE Frontend SHALL display a "Metrics" pane showing current values for MQTT message rate, device count, automation execution rate, and active WebSocket connections
2. WHERE the metrics dashboard feature is enabled, THE Frontend SHALL refresh metric values via a polling interval of 15 seconds
3. WHERE the metrics dashboard feature is enabled, THE Frontend SHALL display metric values using the Aeolus design system (cards with surface background, Inter typography, Aeolus Blue accent for key figures)
