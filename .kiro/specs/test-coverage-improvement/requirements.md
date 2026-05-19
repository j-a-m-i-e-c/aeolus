# Requirements Document

## Introduction

This feature improves the Aeolus backend test suite from 29.85% line coverage to a meaningful baseline by filling unit test gaps in partially-covered modules, adding integration tests for critical cross-module flows, establishing shared test infrastructure, and configuring coverage thresholds to prevent regression. The scope is backend-only, following a testing pyramid approach (unit tests at the base, integration tests in the middle, no E2E).

## Glossary

- **Test_Runner**: The Vitest test framework configured in `vitest.config.ts`
- **Coverage_Reporter**: The `@vitest/coverage-v8` tool that measures line, branch, and function coverage
- **Integration_Test**: A test that exercises multiple modules together with real SQLite (in-memory) and real internal services, without external network dependencies
- **Unit_Test**: A test that exercises a single module in isolation, mocking all external dependencies
- **Property_Test**: A test using fast-check that generates randomized inputs to verify invariants over 100+ iterations
- **Data_Store**: The time-series collection and key-value bucket persistence layer in `src/data-store/`
- **Automation_Engine**: The rule evaluation and action execution system in `src/automations/`
- **MQTT_Service**: The MQTT 5.0 client that receives device messages in `src/mqtt/mqtt-service.ts`
- **API_Router**: The Express route handlers in `src/api/routes/`
- **Service_Manager**: The service lifecycle orchestrator in `src/services/service-manager.ts`
- **Test_Helper**: A shared utility module providing factories, fixtures, and setup/teardown functions for tests
- **Coverage_Threshold**: A minimum coverage percentage configured in vitest that fails the test run if not met

## Requirements

### Requirement 1: Coverage Threshold Configuration

**User Story:** As a developer, I want coverage thresholds enforced in the test runner, so that coverage cannot silently regress below acceptable levels.

#### Acceptance Criteria

1. THE Coverage_Reporter SHALL measure line, branch, and function coverage for all source files in `src/`
2. WHEN the overall line coverage falls below 80%, THEN THE Test_Runner SHALL fail the test run with a non-zero exit code
3. WHEN line coverage for `src/core/` falls below 90%, THEN THE Test_Runner SHALL fail the test run
4. WHEN line coverage for `src/mqtt/` falls below 80%, THEN THE Test_Runner SHALL fail the test run
5. WHEN line coverage for `src/data-store/` falls below 80%, THEN THE Test_Runner SHALL fail the test run
6. WHEN line coverage for `src/automations/` falls below 70%, THEN THE Test_Runner SHALL fail the test run
7. THE Test_Runner SHALL exclude `src/index.ts`, `src/connectors/_template/`, and `src/coverage/` from coverage measurement

### Requirement 2: Integration Test Infrastructure

**User Story:** As a developer, I want shared test helpers and a dedicated integration test directory, so that integration tests are consistent, fast, and easy to write.

#### Acceptance Criteria

1. THE Test_Helper SHALL provide a factory function that creates an in-memory SQLite database with the full Aeolus schema applied
2. THE Test_Helper SHALL provide a factory function that creates a configured Data_Store instance backed by the in-memory database
3. THE Test_Helper SHALL provide a mock MQTT client that records published messages and allows simulating incoming messages
4. THE Test_Helper SHALL provide a factory function that creates a fully-wired Express app with all routes and middleware registered
5. THE Test_Helper SHALL provide a cleanup function that closes database connections and resets all shared state between tests
6. WHEN an integration test imports from the Test_Helper, THE Test_Helper SHALL complete setup in under 200ms per test
7. THE Test_Runner SHALL discover integration test files located in `src/__integration__/` matching the pattern `*.integration.test.ts`

### Requirement 3: Data Store Integration Tests

**User Story:** As a developer, I want integration tests for the Data Store write-query-retention cycle, so that I can verify the full data lifecycle works correctly across module boundaries.

#### Acceptance Criteria

1. WHEN data points are written to a time-series collection, THE Integration_Test SHALL verify that querying the same collection returns the written data points with correct timestamps and values
2. WHEN a retention policy is configured on a collection, THE Integration_Test SHALL verify that data points older than the retention period are removed after enforcement runs
3. WHEN multiple collections exist, THE Integration_Test SHALL verify that retention enforcement on one collection does not affect data in other collections
4. WHEN a key-value bucket entry is written and then overwritten, THE Integration_Test SHALL verify that only the latest value is returned on read
5. WHEN a query specifies a time range, THE Integration_Test SHALL verify that only data points within that range are returned

### Requirement 4: MQTT-to-Automation Pipeline Integration Tests

**User Story:** As a developer, I want integration tests for the MQTT message arrival through rule evaluation to action execution flow, so that I can verify the automation pipeline works end-to-end.

#### Acceptance Criteria

1. WHEN an MQTT message arrives matching a rule trigger topic, THE Integration_Test SHALL verify that the Automation_Engine evaluates the rule and executes the configured action
2. WHEN an MQTT message arrives that does not match any rule trigger, THE Integration_Test SHALL verify that no actions are executed
3. WHEN a rule has a condition that evaluates to false, THE Integration_Test SHALL verify that the action is not executed despite the trigger matching
4. WHEN an action execution fails, THE Integration_Test SHALL verify that the failure is logged in the execution log and does not crash the pipeline
5. WHEN multiple rules match the same MQTT topic, THE Integration_Test SHALL verify that all matching rules are evaluated

### Requirement 5: API Route Integration Tests

**User Story:** As a developer, I want integration tests for the API routes through the full Express stack, so that I can verify authentication, validation, and response formatting work together.

#### Acceptance Criteria

1. WHEN an authenticated request is sent to a data-store route, THE Integration_Test SHALL verify that the response contains correctly formatted data from the real Data_Store
2. WHEN an unauthenticated request is sent to a protected route, THE Integration_Test SHALL verify that a 401 status code is returned
3. WHEN a request with an invalid body is sent to a route with Zod validation, THE Integration_Test SHALL verify that a 400 status code and descriptive error message are returned
4. WHEN a valid request is sent to an automation route, THE Integration_Test SHALL verify that the automation is created and persisted in the database
5. WHEN a request is sent to the health route, THE Integration_Test SHALL verify that a 200 status code and system status are returned without authentication
6. WHEN a request is sent to the auth routes for login with valid credentials, THE Integration_Test SHALL verify that a JWT token is returned

### Requirement 6: Metrics History Integration Tests

**User Story:** As a developer, I want integration tests for the metrics sampling-aggregation-query cycle, so that I can verify that metrics flow correctly from collection through aggregation to retrieval.

#### Acceptance Criteria

1. WHEN metrics are sampled and stored in the Data_Store, THE Integration_Test SHALL verify that querying the metrics history returns the sampled values
2. WHEN aggregation runs over stored metrics, THE Integration_Test SHALL verify that the aggregated results (min, max, avg) are mathematically correct for the input data
3. WHEN a time range query is issued for metrics history, THE Integration_Test SHALL verify that only metrics within the specified range are returned

### Requirement 7: Unit Test Gap Coverage — Services Module

**User Story:** As a developer, I want unit tests for the services module, so that service lifecycle management is verified in isolation.

#### Acceptance Criteria

1. WHEN a service is registered with the Service_Manager, THE Unit_Test SHALL verify that the service appears in the service registry
2. WHEN the Service_Manager starts all services, THE Unit_Test SHALL verify that each registered service's start method is called
3. WHEN the Service_Manager stops all services, THE Unit_Test SHALL verify that each registered service's stop method is called
4. IF a service throws an error during start, THEN THE Unit_Test SHALL verify that the Service_Manager logs the error and continues starting other services
5. WHEN a cron service is registered with a schedule expression, THE Unit_Test SHALL verify that the cron job is scheduled with the correct expression

### Requirement 8: Unit Test Gap Coverage — API Routes

**User Story:** As a developer, I want unit tests for the untested API route handlers, so that request handling logic is verified in isolation.

#### Acceptance Criteria

1. THE Unit_Test SHALL verify that each route in `automation.routes.ts` returns the correct status code and response shape for valid inputs
2. THE Unit_Test SHALL verify that each route in `data-store.routes.ts` returns the correct status code and response shape for valid inputs
3. THE Unit_Test SHALL verify that each route in `device.routes.ts` returns the correct status code and response shape for valid inputs
4. THE Unit_Test SHALL verify that each route in `auth.routes.ts` returns the correct status code and response shape for valid inputs
5. THE Unit_Test SHALL verify that the metrics middleware records request duration and status code for each handled request
6. IF a route handler throws an unhandled error, THEN THE Unit_Test SHALL verify that the error handler middleware returns a 500 status with a structured error response

### Requirement 9: Unit Test Gap Coverage — Automations Module

**User Story:** As a developer, I want unit tests for the untested automations components, so that rule management and action execution are verified in isolation.

#### Acceptance Criteria

1. THE Unit_Test SHALL verify that the rule registry correctly adds, removes, and retrieves rules by ID
2. THE Unit_Test SHALL verify that the condition registry evaluates conditions against device state and returns boolean results
3. THE Unit_Test SHALL verify that the action executor dispatches actions to the correct handler (MQTT publish, HTTP webhook, device command)
4. IF the action executor receives an unknown action type, THEN THE Unit_Test SHALL verify that an error is logged and no action is dispatched
5. THE Unit_Test SHALL verify that the automation state store persists rule enabled/disabled state across restarts
6. THE Unit_Test SHALL verify that the cron timer manager schedules and cancels timers correctly

### Requirement 10: Unit Test Gap Coverage — MQTT Service

**User Story:** As a developer, I want unit tests for the MQTT service connection and message handling logic, so that reconnection and message routing are verified.

#### Acceptance Criteria

1. WHEN the MQTT_Service receives a message on a subscribed topic, THE Unit_Test SHALL verify that the message is emitted on the internal event bus with the correct topic and payload
2. WHEN the MQTT_Service loses connection, THE Unit_Test SHALL verify that it attempts reconnection with exponential backoff
3. WHEN the MQTT_Service reconnects successfully, THE Unit_Test SHALL verify that it resubscribes to all previously subscribed topics
4. IF the MQTT_Service receives a malformed message payload, THEN THE Unit_Test SHALL verify that the error is logged and the message is discarded without crashing

### Requirement 11: Test Execution Performance

**User Story:** As a developer, I want the full test suite to run quickly, so that the feedback loop remains fast during development.

#### Acceptance Criteria

1. THE Test_Runner SHALL complete all unit tests and integration tests in under 30 seconds on the development machine
2. THE Test_Runner SHALL run integration tests in parallel where tests do not share mutable state
3. WHEN a test exceeds 5 seconds of execution time, THE Test_Runner SHALL fail that individual test with a timeout error
