# Implementation Plan: Observability Metrics

## Overview

This plan implements Prometheus-compatible metrics export for Aeolus using `prom-client`. A `MetricsService` singleton subscribes to Event Bus events to collect telemetry across all subsystems. Two endpoints are exposed: `/metrics` (Prometheus text format, bearer token auth) and `/api/metrics/summary` (JSON, JWT auth). The frontend gains an optional MetricsPane polling the summary endpoint.

## Tasks

- [x] 1. Install dependencies and add event constants
  - [x] 1.1 Install prom-client and add all new event constants to event-bus.ts
    - Install `prom-client` as a production dependency
    - Add new event constants to `src/core/event-bus.ts`: `AUTOMATION_EXECUTION_COMPLETE`, `AUTOMATION_RULE_REGISTERED`, `AUTOMATION_RULE_UNREGISTERED`, `MQTT_MESSAGE_PROCESSED`, `CONNECTOR_POLL`, `CONNECTOR_ERROR`, `DATA_STORE_QUERY`, `WS_CLIENT_CONNECT`, `WS_CLIENT_DISCONNECT`, `WS_BROADCAST`, `MQTT_MESSAGE_PUBLISHED`
    - _Requirements: 10.1, 10.2_

- [x] 2. Emit new events from existing services
  - [x] 2.1 Modify automation-engine.ts to emit AUTOMATION_EXECUTION_COMPLETE, AUTOMATION_RULE_REGISTERED, and AUTOMATION_RULE_UNREGISTERED
    - In `recordExecution()`: emit `AUTOMATION_EXECUTION_COMPLETE` with `{ruleId, ruleName, status, durationMs}`
    - In `register()`: emit `AUTOMATION_RULE_REGISTERED` with `{ruleId, ruleName}`
    - In `unregister()`: emit `AUTOMATION_RULE_UNREGISTERED` with `{ruleId}`
    - Keep existing `AUTOMATION_FIRED` emission unchanged (used by WebSocket broadcast)
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 2.2 Modify mqtt-service.ts to add timing and emit MQTT_MESSAGE_PROCESSED
    - Add `const start = Date.now()` at the beginning of `handleMessage()`
    - At the end of `handleMessage()`, compute `durationMs = Date.now() - start` and emit `MQTT_MESSAGE_PROCESSED` with `{topic, durationMs}`
    - _Requirements: 3.1, 3.4_

  - [x] 2.3 Emit MQTT_MESSAGE_PUBLISHED from mqtt-service.ts publish method
    - Emit `MQTT_MESSAGE_PUBLISHED` with `{topic}` after each successful MQTT publish
    - _Requirements: 3.2_

  - [x] 2.4 Emit connector events (CONNECTOR_POLL, CONNECTOR_ERROR) from connector-manager.ts
    - Emit `CONNECTOR_POLL` with `{connectorType, instanceId, devicesDiscovered}` after successful poll cycles
    - Emit `CONNECTOR_ERROR` with `{connectorType, instanceId, error}` on poll errors
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 2.5 Emit WebSocket events (WS_CLIENT_CONNECT, WS_CLIENT_DISCONNECT, WS_BROADCAST) from ws-server.ts
    - Emit `WS_CLIENT_CONNECT` on new WebSocket connection
    - Emit `WS_CLIENT_DISCONNECT` on WebSocket close
    - Emit `WS_BROADCAST` with `{messageType, clientCount}` on each broadcast
    - _Requirements: 8.1, 8.2_

  - [x] 2.6 Emit DATA_STORE_QUERY from data-store.ts query methods
    - Emit `DATA_STORE_QUERY` with `{collection, durationMs}` after query operations complete
    - _Requirements: 9.2_

- [x] 3. Implement MetricsService core
  - [x] 3.1 Create MetricsService singleton with dependency injection and metric registration
    - Create `src/metrics/metrics-service.ts`
    - Implement `MetricsServiceConfig` and `MetricsServiceDeps` interfaces
    - Register all 19 custom metrics (counters, gauges, histograms) with `aeolus_` prefix using the default prom-client registry
    - Implement `initialize(deps: MetricsServiceDeps)` that subscribes to all Event Bus events
    - On `DEVICE_STATE_CHANGE`: increment device messages counter (by `device_type` label), update device count gauge via `deps.getDeviceCount()`
    - On `AUTOMATION_EXECUTION_COMPLETE`: increment executions counter (by `rule_name`, `status`), observe duration histogram
    - On `AUTOMATION_RULE_REGISTERED` / `AUTOMATION_RULE_UNREGISTERED`: update active rules gauge via `deps.getRuleCount()`
    - On `MQTT_MESSAGE_PROCESSED`: increment received counter (by `topic_prefix` = first topic segment), observe processing duration histogram
    - On `MQTT_MESSAGE_PUBLISHED`: increment published counter
    - On `MQTT_CONNECTION_STATE`: set connection gauge (1/0)
    - On `CONNECTOR_POLL`: increment polls counter, set devices discovered gauge
    - On `CONNECTOR_ERROR`: increment errors counter
    - On `WS_CLIENT_CONNECT` / `WS_CLIENT_DISCONNECT`: adjust active connections gauge
    - On `WS_BROADCAST`: increment messages sent counter (by `message_type`)
    - On `DATA_STORE_WRITE`: increment records written counter (by `collection`)
    - On `DATA_STORE_QUERY`: observe query duration histogram
    - Implement `dispose()` to remove all listeners and clear registry
    - Collect default Node.js metrics (memory, GC, event loop) via `prom-client.collectDefaultMetrics()`
    - Expose `aeolus_process_uptime_seconds` gauge
    - Use histogram bucket configurations from design
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 8.1, 8.2, 9.1, 9.2, 10.1, 10.2, 10.3, 10.4_

  - [ ]* 3.2 Write property tests for MetricsService (Properties 2–7, 9, 10, 12, 13)
    - Create `src/metrics/metrics-service.property.test.ts`
    - **Property 2: Registered metrics completeness** — Validates: Requirements 1.3, 10.1
    - **Property 3: MQTT message receive metrics recording** — Validates: Requirements 3.1, 3.4
    - **Property 4: MQTT connection state gauge correctness** — Validates: Requirements 3.3
    - **Property 5: Device metrics label cardinality safety** — Validates: Requirements 4.2, 4.3
    - **Property 6: Automation execution metrics recording** — Validates: Requirements 5.1, 5.2
    - **Property 7: Connector poll metrics recording** — Validates: Requirements 6.1, 6.2
    - **Property 9: WebSocket connection gauge accuracy** — Validates: Requirements 8.1
    - **Property 10: Data store metrics recording** — Validates: Requirements 9.1, 9.2
    - **Property 12: Device count gauge accuracy** — Validates: Requirements 4.1
    - **Property 13: Active automation rules gauge accuracy** — Validates: Requirements 5.3
    - Use fast-check with minimum 100 iterations per property

  - [ ]* 3.3 Write unit tests for MetricsService
    - Create `src/metrics/metrics-service.test.ts`
    - Test initialization, dispose, singleton behavior
    - Test gauge updates via dependency injection (getDeviceCount, getRuleCount)
    - Test that AUTOMATION_EXECUTION_COMPLETE correctly updates counter and histogram
    - Test that MQTT_MESSAGE_PROCESSED correctly updates histogram
    - Test that AUTOMATION_RULE_REGISTERED/UNREGISTERED events update active rules gauge
    - Test that DEVICE_STATE_CHANGE triggers device count gauge update via getDeviceCount()
    - Test default Node.js metrics are present
    - Test uptime gauge is positive
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement HTTP metrics middleware
  - [x] 5.1 Create metrics middleware with route normalization
    - Create `src/metrics/metrics-middleware.ts`
    - Implement `metricsMiddleware()` that records request duration via `res.on('finish', ...)`
    - Implement and export `normalizeRoutePath(path, method)` for unit testing
    - Normalize UUIDs → `:id`, numeric-only segments → `:id`, segments after known resource paths → `:id`
    - Call `metricsService.recordHttpRequest(method, route, statusCode, durationSeconds)`
    - Catch internal errors and call `next()` without blocking the request pipeline
    - _Requirements: 7.3, 7.4, 7.5_

  - [ ]* 5.2 Write property tests for route normalization (Properties 8, 11)
    - Create `src/metrics/metrics-middleware.property.test.ts`
    - **Property 8: HTTP request metrics and route normalization** — Validates: Requirements 7.3, 7.4, 7.5
    - **Property 11: Route path normalization is idempotent** — Validates: Requirements 7.5
    - Use fast-check with minimum 100 iterations per property

  - [ ]* 5.3 Write unit tests for metrics middleware
    - Create `src/metrics/metrics-middleware.test.ts`
    - Test specific route normalization examples (UUID, numeric, nested paths)
    - Test middleware records duration correctly
    - Test middleware does not block on internal errors
    - _Requirements: 7.3, 7.4, 7.5_

- [x] 6. Implement metrics auth guard and route registration
  - [x] 6.1 Create metricsAuthGuard for bearer token validation
    - Create `src/metrics/metrics-auth.ts`
    - Implement `metricsAuthGuard` middleware: if `METRICS_TOKEN` unset → allow all; if set → require matching `Authorization: Bearer <token>` header; return 401 JSON on failure
    - This guard is ONLY for the `/metrics` Prometheus endpoint
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 6.2 Create split route registration (Prometheus route before auth, summary route after auth)
    - Create `src/api/routes/metrics.routes.ts`
    - Implement `createPrometheusMetricsRoute(metricsService)`: GET `/metrics` with `metricsAuthGuard`, returns Prometheus text exposition format with correct content type
    - Implement `createMetricsSummaryRoute(metricsService)`: GET `/api/metrics/summary` (uses JWT auth from `authenticate` middleware), returns JSON summary
    - Summary endpoint computes rates from counter values and returns the `MetricsSummary` JSON structure
    - Handle registry collection errors with 500 status
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.4_

  - [x] 6.3 Wire metrics into index.ts with correct middleware ordering
    - Import and initialize MetricsService with `{eventBus, getDeviceCount: () => registry.getAll().length, getRuleCount: () => engine.ruleCount}`
    - Mount `createPrometheusMetricsRoute` BEFORE `authenticate` middleware (and before any future rate limiter)
    - Mount `metricsMiddleware()` in the middleware stack (after cors/json/cookie, before routes)
    - Mount `createMetricsSummaryRoute` AFTER `authenticate` alongside other `/api/` routes
    - Add `metricsService.dispose()` to the shutdown sequence
    - _Requirements: 1.1, 2.4, 7.3, 7.4, 10.3_

  - [ ]* 6.4 Write property test for auth guard (Property 1)
    - Create `src/metrics/metrics-auth.property.test.ts`
    - **Property 1: Bearer token authentication correctness** — Validates: Requirements 2.1, 2.2, 2.3, 2.4
    - Use fast-check with minimum 100 iterations

  - [ ]* 6.5 Write integration tests for metrics routes
    - Create `src/api/routes/metrics.routes.test.ts`
    - Test `/metrics` returns correct content type (`text/plain; version=0.0.4; charset=utf-8`)
    - Test `/metrics` bypasses JWT auth (mounted before `authenticate`)
    - Test `/metrics` is protected by `metricsAuthGuard` (401 without token when METRICS_TOKEN set, 200 with valid token)
    - Test `/api/metrics/summary` uses JWT auth (401 without JWT, 200 with valid JWT)
    - Test `/api/metrics/summary` does NOT require METRICS_TOKEN
    - Test summary endpoint returns valid JSON structure
    - Test full scrape flow: emit events → GET /metrics → verify counters/gauges in output text
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement frontend MetricsPane
  - [x] 8.1 Create Zustand metrics store with polling
    - Create `frontend/src/store/metrics-store.ts`
    - Implement `MetricsState` interface with `fetchSummary()`, `startPolling()`, `stopPolling()`
    - Poll `GET /api/metrics/summary` every 15 seconds using JWT auth (same as other API calls)
    - Handle loading, error, and lastUpdated states
    - _Requirements: 11.1, 11.2_

  - [x] 8.2 Create MetricsPane component with Aeolus design system
    - Create `frontend/src/components/panes/MetricsPane.tsx`
    - Display cards for: MQTT message rate, device count, automation execution rate, active rules, WebSocket connections, uptime, memory usage
    - Use Aeolus design system: surface background cards, Inter typography, Aeolus Blue accent for key figures
    - Auto-start/stop polling on mount/unmount via the metrics store
    - Register in the pane registry
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 8.3 Write unit tests for metrics store
    - Test fetchSummary parses response correctly
    - Test polling starts and stops cleanly
    - Test error handling on failed fetch
    - _Requirements: 11.1, 11.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design (13 total)
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementation uses TypeScript
- The `/metrics` route MUST be mounted before `authenticate` middleware in index.ts
- The `/api/metrics/summary` route uses standard JWT auth (same as all other `/api/` routes)
- MetricsService uses dependency injection (`getDeviceCount`, `getRuleCount`) for gauge accuracy
- `AUTOMATION_EXECUTION_COMPLETE` is the event for metrics counters/histograms (not `AUTOMATION_FIRED`)
- `AUTOMATION_FIRED` remains unchanged for WebSocket broadcast use case

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.4"] },
    { "id": 6, "tasks": ["6.3"] },
    { "id": 7, "tasks": ["6.5", "8.1"] },
    { "id": 8, "tasks": ["8.2"] },
    { "id": 9, "tasks": ["8.3"] }
  ]
}
```
