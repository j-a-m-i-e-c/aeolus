# Implementation Plan: Test Coverage Improvement

## Overview

Bring Aeolus backend test coverage from 29.85% to 80%+ by building shared test infrastructure, writing integration tests for critical cross-module flows, filling unit test gaps in partially-covered modules, adding property-based tests for universal invariants, and configuring coverage thresholds to prevent regression. Implementation proceeds bottom-up: test helpers first, then unit tests, integration tests, property tests, and finally coverage configuration.

## Tasks

- [x] 1. Set up shared test infrastructure
  - [x] 1.1 Create `src/__test-helpers__/database-factory.ts`
    - Implement `createTestDatabase()` that creates an in-memory SQLite database with the full Aeolus schema applied via `initSchema()`
    - Set WAL journal mode and enable foreign keys
    - Each call returns an independent database instance
    - _Requirements: 2.1_

  - [x] 1.2 Create `src/__test-helpers__/data-store-factory.ts`
    - Implement `createTestDataStore(db, eventBus, config?)` that creates a configured DataStore instance backed by the in-memory database
    - Default config: enabled=true, maxStorageMb=100, maxRecordsPerCollection=10000, maxCollections=50
    - _Requirements: 2.2_

  - [x] 1.3 Create `src/__test-helpers__/mock-mqtt.ts`
    - Implement `createMockMqttClient(eventBus)` returning a `MockMqttClient`
    - Record all published messages in a `published` array
    - Implement `simulateMessage(topic, payload)` that emits MQTT_RAW_MESSAGE and DEVICE_STATE_CHANGE events on the event bus
    - Implement `reset()` to clear recorded messages
    - _Requirements: 2.3_

  - [x] 1.4 Create `src/__test-helpers__/app-factory.ts`
    - Implement `createTestApp(db, eventBus)` that creates a fully-wired Express app with all routes and middleware registered
    - Implement `createAuthToken(options?)` that generates a valid JWT token for test requests
    - Wire auth middleware, validation, error handler, CORS, and all route handlers with injected dependencies
    - _Requirements: 2.4_

  - [x] 1.5 Create `src/__test-helpers__/automation-factory.ts`
    - Implement `createTestAutomationEngine(eventBus)` returning an engine and execution log
    - No sandbox (isolated-vm) — tests use direct action rules only
    - _Requirements: 2.4_

  - [x] 1.6 Create `src/__test-helpers__/cleanup.ts` and `src/__test-helpers__/index.ts`
    - Implement `cleanup(targets)` that closes database connections, disposes DataStores, and disposes engines
    - Create index.ts that re-exports all test helper functions
    - _Requirements: 2.5_

  - [ ]* 1.7 Write property test for mock MQTT client
    - Create `src/__test-helpers__/mock-mqtt.property.test.ts`
    - **Property 19: Mock MQTT client records all published messages**
    - For any sequence of publish calls, the `published` array contains exactly those messages in order with correct topic and payload
    - **Validates: Requirements 2.3**

- [x] 2. Checkpoint — Test infrastructure compiles and basic smoke test passes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Unit tests — Services module
  - [x] 3.1 Create `src/services/service-manager.test.ts`
    - Test service registration appears in registry
    - Test `restoreFromStore()` calls `start()` on each registered service
    - Test `disposeAll()` calls `stop()` on each running service
    - Test that a service throwing during start is logged and other services still start
    - Test cron service scheduling with correct expression
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 3.2 Write property tests for Service Manager lifecycle
    - Create `src/services/service-manager.property.test.ts`
    - **Property 12: Service Manager lifecycle calls start/stop on all instances**
    - For any set of N registered services, `restoreFromStore()` invokes `start()` on each, `disposeAll()` invokes `stop()` on each
    - **Validates: Requirements 7.2, 7.3**

  - [ ]* 3.3 Write property test for Service Manager failure isolation
    - In same file as 3.2
    - **Property 13: Service start failure does not prevent other services from starting**
    - For any set of services where one or more throw during `start()`, all remaining services still get `start()` called
    - **Validates: Requirements 7.4**

- [x] 4. Unit tests — Automations module
  - [x] 4.1 Create `src/automations/rule-registry.test.ts`
    - Test add, remove, and retrieve rules by ID
    - Test retrieving non-existent rule returns undefined
    - _Requirements: 9.1_

  - [x] 4.2 Create `src/automations/action-executor.test.ts`
    - Test dispatching to correct handler for mqtt_publish, http_webhook, device_command action types
    - Test unknown action type logs error and does not dispatch
    - _Requirements: 9.3, 9.4_

  - [x] 4.3 Create `src/automations/automation-state-store.test.ts`
    - Test persisting rule enabled/disabled state
    - Test reading state back after re-instantiation with same database
    - _Requirements: 9.5_

  - [x] 4.4 Create `src/automations/cron-timer-manager.test.ts`
    - Test scheduling timers with cron expressions
    - Test cancelling timers
    - Test that cancelled timers do not fire
    - _Requirements: 9.6_

  - [x] 4.5 Create `src/automations/condition-registry.test.ts`
    - Test evaluating conditions against device state returns boolean results
    - _Requirements: 9.2_

  - [ ]* 4.6 Write property test for rule registry CRUD
    - Create `src/automations/rule-registry.property.test.ts`
    - **Property 14: Rule registry CRUD round-trip**
    - For any valid rule object, registering and retrieving by ID returns the same rule; unregistering causes retrieval to return undefined
    - **Validates: Requirements 9.1**

  - [ ]* 4.7 Write property test for action executor routing
    - Create `src/automations/action-executor.property.test.ts`
    - **Property 15: Action executor routes to correct handler and rejects unknown types**
    - For any known action type, dispatch goes to corresponding handler; for unknown types, error is logged and no dispatch occurs
    - **Validates: Requirements 9.3, 9.4**

  - [ ]* 4.8 Write property test for automation state persistence
    - Create `src/automations/automation-state-store.property.test.ts`
    - **Property 16: Automation state persists across store re-instantiation**
    - For any rule ID and enabled/disabled state, creating a new store instance backed by the same database returns the previously written state
    - **Validates: Requirements 9.5**

- [x] 5. Unit tests — MQTT service
  - [x] 5.1 Create or extend `src/mqtt/mqtt-service.test.ts`
    - Test that receiving a message on a subscribed topic emits DEVICE_STATE_CHANGE on the event bus with correct topic, device ID, device type, and state
    - Test reconnection attempts with exponential backoff on connection loss
    - Test resubscription to all previously subscribed topics on reconnect
    - Test that malformed message payloads are logged and discarded without crashing
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 5.2 Write property tests for MQTT message handling
    - Create or extend `src/mqtt/mqtt-service.property.test.ts`
    - **Property 17: MQTT message receipt emits correct event on bus**
    - For any valid MQTT topic and JSON payload, the event bus emits DEVICE_STATE_CHANGE with parsed device ID, device type, state, and topic
    - **Validates: Requirements 10.1**

  - [ ]* 5.3 Write property test for malformed MQTT payload handling
    - In same file as 5.2
    - **Property 18: Malformed MQTT payloads are discarded safely**
    - For any payload that is empty, whitespace-only, or unparseable, no DEVICE_STATE_CHANGE is emitted and no exception is thrown
    - **Validates: Requirements 10.4**

- [x] 6. Unit tests — API routes
  - [x] 6.1 Create `src/api/routes/automation.routes.test.ts`
    - Test each route returns correct status code and response shape for valid inputs
    - Mock dependencies (automation engine, database)
    - _Requirements: 8.1_

  - [x] 6.2 Create `src/api/routes/data-store.routes.test.ts`
    - Test each route returns correct status code and response shape for valid inputs
    - Mock DataStore dependency
    - _Requirements: 8.2_

  - [x] 6.3 Create `src/api/routes/device.routes.test.ts`
    - Test each route returns correct status code and response shape for valid inputs
    - Mock device registry dependency
    - _Requirements: 8.3_

  - [x] 6.4 Create `src/api/routes/auth.routes.test.ts`
    - Test login with valid credentials returns JWT token
    - Test registration and token refresh flows
    - _Requirements: 8.4_

  - [x] 6.5 Create `src/metrics/metrics-middleware.test.ts`
    - Test that middleware records request duration and status code for each handled request
    - _Requirements: 8.5_

  - [x] 6.6 Test error handler middleware
    - Verify that unhandled route handler errors return 500 with structured error response
    - Add to existing or new test file for error handling middleware
    - _Requirements: 8.6_

- [x] 7. Checkpoint — All unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integration tests — Data Store lifecycle
  - [x] 8.1 Create `src/__integration__/data-store.integration.test.ts`
    - Test write-then-query round-trip returns correct data with timestamps and values
    - Test retention enforcement removes expired data points
    - Test retention on one collection does not affect other collections
    - Test key-value bucket overwrite returns only latest value
    - Test time range query returns only in-range data points
    - Use test helpers: createTestDatabase, createTestDataStore, cleanup
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 8.2 Write property tests for Data Store integration
    - Create `src/__integration__/data-store.property.test.ts`
    - **Property 1: Data Store write-query round-trip**
    - For any valid collection name, payload, and timestamp, writing then querying returns the written data point
    - **Validates: Requirements 3.1**

  - [ ]* 8.3 Write property test for retention enforcement
    - In same file as 8.2
    - **Property 2: Retention enforcement removes only expired data without cross-collection effects**
    - For any two collections (one with retention, one without), enforcement removes only expired records in the policy-bearing collection
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 8.4 Write property test for key-value last-write-wins
    - In same file as 8.2
    - **Property 3: Key-value bucket last-write-wins**
    - For any bucket, key, and sequence of distinct values, reading returns the last value written
    - **Validates: Requirements 3.4**

  - [ ]* 8.5 Write property test for time range filtering
    - In same file as 8.2
    - **Property 4: Time range query returns only in-range data**
    - For any collection and time range, query returns exactly records within [from, to] inclusive
    - **Validates: Requirements 3.5, 6.3**

  - [ ]* 8.6 Write property test for aggregation correctness
    - In same file as 8.2
    - **Property 11: Aggregation produces mathematically correct results**
    - For any numeric data points and aggregation function (min, max, avg, count), result equals independently computed value
    - **Validates: Requirements 6.2**

- [x] 9. Integration tests — MQTT-to-Automation pipeline
  - [x] 9.1 Create `src/__integration__/mqtt-automation-pipeline.integration.test.ts`
    - Test MQTT message matching rule trigger topic evaluates rule and executes action
    - Test MQTT message not matching any rule trigger results in no action execution
    - Test rule with false condition does not execute action despite trigger match
    - Test action execution failure is logged and does not crash pipeline
    - Test multiple rules matching same topic all evaluate
    - Use test helpers: createTestDatabase, createMockMqttClient, createTestAutomationEngine, cleanup
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 9.2 Write property tests for automation pipeline
    - Create `src/__integration__/automation-pipeline.property.test.ts`
    - **Property 5: Matching MQTT message triggers rule action**
    - For any registered rule with matching topic and true condition, action executes exactly once
    - **Validates: Requirements 4.1**

  - [ ]* 9.3 Write property test for non-matching prevention
    - In same file as 9.2
    - **Property 6: Non-matching topic or false condition prevents action execution**
    - For any rule where topic doesn't match OR condition is false, no action executes
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 9.4 Write property test for action failure resilience
    - In same file as 9.2
    - **Property 7: Action failure does not crash the automation pipeline**
    - For any rule whose action throws, error is recorded in execution log and pipeline continues
    - **Validates: Requirements 4.4**

  - [ ]* 9.5 Write property test for multi-rule evaluation
    - In same file as 9.2
    - **Property 8: All matching rules fire for a single message**
    - For any N rules matching a topic with true conditions, exactly N actions execute
    - **Validates: Requirements 4.5**

- [x] 10. Integration tests — API routes
  - [x] 10.1 Create `src/__integration__/api-routes.integration.test.ts`
    - Test authenticated request to data-store route returns correctly formatted data from real DataStore
    - Test unauthenticated request to protected route returns 401
    - Test invalid body with Zod validation returns 400 with descriptive error
    - Test valid request to automation route creates and persists automation in database
    - Test health route returns 200 without authentication
    - Test auth login with valid credentials returns JWT token
    - Use test helpers: createTestDatabase, createTestApp, createAuthToken, cleanup
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 10.2 Write property tests for API authentication
    - Create `src/__integration__/api-validation.property.test.ts`
    - **Property 9: Unauthenticated requests to protected routes return 401**
    - For any protected route, a request without valid Bearer token receives 401
    - **Validates: Requirements 5.2**

  - [ ]* 10.3 Write property test for API validation
    - In same file as 10.2
    - **Property 10: Invalid request bodies return 400 with error details**
    - For any route with Zod validation and any non-conforming body, response is 400 with structured error
    - **Validates: Requirements 5.3**

- [x] 11. Integration tests — Metrics history
  - [x] 11.1 Create `src/__integration__/metrics-history.integration.test.ts`
    - Test metrics sampled and stored can be queried back from metrics history
    - Test aggregation (min, max, avg) produces mathematically correct results for input data
    - Test time range query returns only metrics within specified range
    - Use test helpers: createTestDatabase, createTestDataStore, cleanup
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 12. Checkpoint — All integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Configure coverage thresholds and test runner settings
  - [x] 13.1 Update `vitest.config.ts` with coverage thresholds and test discovery
    - Configure v8 coverage provider with reporters: text, html, clover
    - Set global thresholds: lines 80%, branches 70%, functions 75%
    - Set per-directory thresholds: `src/core/` 90% lines, `src/mqtt/` 80% lines, `src/data-store/` 80% lines, `src/automations/` 70% lines
    - Exclude from coverage: `index.ts`, `connectors/_template/**`, `coverage/**`, test files, test helpers
    - Configure test discovery to include `**/*.test.ts`, `**/*.property.test.ts`, `__integration__/**/*.integration.test.ts`
    - Set testTimeout to 5000ms
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 11.3_

  - [x] 13.2 Verify test execution performance
    - Run full test suite and confirm completion under 30 seconds
    - Verify integration tests run in parallel where they don't share mutable state (each test has its own in-memory DB)
    - Verify individual test timeout of 5 seconds is enforced
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 14. Final checkpoint — Full test suite passes with coverage thresholds met
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 19 universal correctness properties defined in the design
- Unit tests validate specific examples, edge cases, and error conditions
- Integration tests exercise cross-module flows with real in-memory SQLite and real internal services
- Test helpers use in-memory SQLite (`:memory:`) — no disk I/O, no cleanup between runs
- All test dependencies (vitest, fast-check, supertest, better-sqlite3) are already in devDependencies
- No new runtime dependencies are introduced by this feature

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 1, "tasks": ["1.7", "3.1", "4.1", "4.2", "4.3", "4.4", "4.5", "5.1", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.6", "4.7", "4.8", "5.2", "5.3"] },
    { "id": 3, "tasks": ["8.1", "9.1", "10.1", "11.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6", "9.2", "9.3", "9.4", "9.5", "10.2", "10.3"] },
    { "id": 5, "tasks": ["13.1"] },
    { "id": 6, "tasks": ["13.2"] }
  ]
}
```
