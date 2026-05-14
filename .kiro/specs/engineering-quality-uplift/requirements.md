# Requirements Document

## Introduction

This specification covers a set of engineering quality improvements for the Aeolus IoT platform backend and frontend. The platform is self-hosted on Raspberry Pi hardware, running on a local network with a single-user threat model. These requirements focus on reliability, maintainability, developer experience, and operational robustness — not on defending against external attackers.

The improvements span parameterized SQL queries, input validation, rate limiting, CORS configuration, graceful shutdown, MQTT reconnection, Docker optimization, CI/CD pipelines, test coverage, linting, structured errors, database performance, frontend code splitting, log rotation, and production deployment documentation.

## Glossary

- **Backend**: The Node.js/Express server process (`src/index.ts`) that provides the REST API, WebSocket server, MQTT integration, automation engine, and connector framework.
- **Frontend**: The React single-page application served by the frontend Docker container.
- **API_Router**: The Express.js router layer that handles incoming HTTP requests and dispatches them to route handlers.
- **Database**: The sql.js SQLite database used for persistent storage of devices, automations, connectors, services, layouts, and data store collections.
- **MQTT_Service**: The service class (`MqttService`) responsible for connecting to the Mosquitto MQTT broker, subscribing to topics, and publishing messages.
- **Automation_Engine**: The subsystem that loads, evaluates, and executes automation rules in response to device state changes and scheduled triggers.
- **Connector_Manager**: The subsystem that manages connector lifecycle (enable, disable, poll, retry) for integrations like Hue and Kasa.
- **WebSocket_Server**: The `WsServer` class that maintains persistent connections with the frontend for real-time state updates.
- **Docker_Image**: The OCI container image built from the project Dockerfile for the backend service.
- **CI_Pipeline**: The GitHub Actions workflow that runs automated checks on pull requests and builds artifacts on the main branch.
- **Health_Endpoint**: The `/api/health` route that reports system status including MQTT connectivity, device count, and uptime.
- **Rate_Limiter**: An express-rate-limit middleware instance that throttles incoming HTTP requests per IP address.
- **Validator**: A Zod schema validation layer applied to API route handler inputs.
- **Shutdown_Handler**: The process signal handler that orchestrates graceful termination of all subsystems.
- **Log_Rotator**: A mechanism that limits log file growth by rotating or capping log output size.
- **Code_Splitter**: React.lazy + Suspense configuration that defers loading of heavy frontend modules until needed.

## Requirements

### Requirement 1: Parameterized SQL Queries

**User Story:** As a developer, I want all database queries to use parameterized statements, so that accidental bugs from string interpolation are prevented and the codebase follows defense-in-depth practices.

#### Acceptance Criteria

1. THE Backend SHALL use parameterized placeholders for all dynamic values passed to `db.exec()`, `db.run()`, and `db.prepare()` calls.
2. THE Backend SHALL NOT use string concatenation or template literal interpolation to embed user-supplied values into SQL query strings.
3. WHEN a new database query is added, THE Backend SHALL enforce parameterized query usage through code review and linting guidance in the contributing documentation.

### Requirement 2: Input Validation with Schema Validation

**User Story:** As a developer, I want all API endpoints to validate incoming request bodies against defined schemas, so that malformed data is rejected early and the API is self-documenting.

#### Acceptance Criteria

1. THE Validator SHALL validate request bodies against Zod schemas for all POST and PUT route handlers in the API_Router.
2. WHEN a request body fails schema validation, THE API_Router SHALL respond with HTTP 400 and a JSON body containing `{ error: string, details: unknown }` describing the validation failures.
3. THE Validator SHALL enforce maximum string lengths for all string fields accepted by the API.
4. THE Validator SHALL enforce numeric range constraints for all numeric fields accepted by the API.
5. THE Validator SHALL reject request bodies exceeding 1MB in size before route handler execution.
6. THE Validator SHALL reject automation script bodies exceeding 100KB in size.
7. THE Validator SHALL enforce required field presence for all mandatory fields defined in each route schema.

### Requirement 3: Rate Limiting

**User Story:** As a platform operator, I want API rate limiting in place, so that a runaway automation script calling the API in a tight loop does not overwhelm the backend.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL limit HTTP requests to 200 requests per minute per source IP address by default.
2. WHEN a client exceeds the rate limit, THE Rate_Limiter SHALL respond with HTTP 429 and a JSON body containing `{ error: string }` indicating the limit has been exceeded.
3. THE Rate_Limiter SHALL allow a higher threshold for WebSocket upgrade requests than for standard HTTP requests.
4. WHERE the `RATE_LIMIT_RPM` environment variable is set, THE Rate_Limiter SHALL use the specified value as the requests-per-minute limit.

### Requirement 4: CORS Configuration

**User Story:** As a developer, I want CORS configured to allow the frontend origin and localhost by default with support for additional origins via environment variable, so that the platform is ready for future reverse proxy and tunnel configurations.

#### Acceptance Criteria

1. THE Backend SHALL configure CORS to allow requests from the same host and from `localhost` origins on any port.
2. WHERE the `CORS_ORIGINS` environment variable is set, THE Backend SHALL include the specified comma-separated origins in the CORS allowed origins list.
3. THE Backend SHALL reject cross-origin requests from origins not in the allowed list by omitting CORS headers from the response.

### Requirement 5: Graceful Shutdown

**User Story:** As a platform operator, I want the backend to shut down gracefully on SIGINT and SIGTERM, so that in-flight requests complete, data is persisted, and no connections are dropped abruptly.

#### Acceptance Criteria

1. WHEN a SIGINT or SIGTERM signal is received, THE Shutdown_Handler SHALL stop accepting new HTTP connections.
2. WHEN a SIGINT or SIGTERM signal is received, THE Shutdown_Handler SHALL wait up to 5 seconds for in-flight HTTP requests to complete before forcibly closing them.
3. WHEN a SIGINT or SIGTERM signal is received, THE Shutdown_Handler SHALL send WebSocket close frames to all connected clients.
4. WHEN a SIGINT or SIGTERM signal is received, THE Shutdown_Handler SHALL stop all active timers including retention timers, polling intervals, and cron schedules.
5. WHEN a SIGINT or SIGTERM signal is received, THE Shutdown_Handler SHALL persist the Database to disk before exiting.
6. WHEN a SIGINT or SIGTERM signal is received, THE Shutdown_Handler SHALL disconnect from the MQTT broker cleanly.
7. WHEN a SIGINT or SIGTERM signal is received, THE Shutdown_Handler SHALL exit the process with code 0 after all cleanup completes or after the 5-second timeout elapses.

### Requirement 6: MQTT Reconnection with Exponential Backoff

**User Story:** As a platform operator, I want the MQTT service to automatically reconnect with exponential backoff when the broker disconnects, so that temporary network issues do not require manual intervention.

#### Acceptance Criteria

1. WHEN the MQTT broker connection is lost, THE MQTT_Service SHALL automatically attempt reconnection.
2. THE MQTT_Service SHALL use exponential backoff delays of 1s, 2s, 4s, 8s, up to a maximum of 30s between reconnection attempts.
3. WHEN a reconnection attempt succeeds, THE MQTT_Service SHALL re-subscribe to all configured topics.
4. WHEN the MQTT connection state changes, THE MQTT_Service SHALL emit an event on the event bus indicating the new connection state.
5. THE MQTT_Service SHALL log each reconnection attempt with the attempt number and delay.
6. THE MQTT_Service SHALL continue reconnection attempts indefinitely until the connection is restored or the process is shut down.

### Requirement 7: Docker Health Check for Backend

**User Story:** As a platform operator, I want Docker to monitor the backend container health, so that unhealthy containers are automatically restarted.

#### Acceptance Criteria

1. THE Docker_Image SHALL include a healthcheck directive in the docker-compose configuration for the backend service.
2. THE healthcheck SHALL query the Health_Endpoint (`/api/health`) via HTTP.
3. WHEN the Health_Endpoint does not respond with HTTP 200 within 5 seconds, THE healthcheck SHALL report the container as unhealthy.
4. THE healthcheck SHALL execute at an interval of 30 seconds with a start period of 10 seconds and 3 retries before marking unhealthy.

### Requirement 8: Docker Image Optimization

**User Story:** As a developer, I want the production Docker image to exclude unnecessary build tools, so that the image is smaller and has a reduced surface area.

#### Acceptance Criteria

1. THE Docker_Image SHALL use a multi-stage build where native dependency compilation occurs in a builder stage.
2. THE Docker_Image production stage SHALL NOT include `python3`, `make`, or `g++` packages.
3. THE Docker_Image production stage SHALL retain `git` and `docker-cli` packages required for the self-update feature.
4. THE Docker_Image production stage SHALL copy only compiled runtime artifacts and production `node_modules` from the builder stage.

### Requirement 9: CI/CD Pipeline

**User Story:** As a developer, I want automated checks on pull requests and automated image builds on main, so that regressions are caught early and deployable artifacts are always available.

#### Acceptance Criteria

1. WHEN a pull request is opened or updated, THE CI_Pipeline SHALL run TypeScript compilation checking (`tsc --noEmit`).
2. WHEN a pull request is opened or updated, THE CI_Pipeline SHALL run the Vitest test suite.
3. WHEN a pull request is opened or updated, THE CI_Pipeline SHALL run ESLint if an ESLint configuration is present.
4. WHEN a commit is pushed to the main branch, THE CI_Pipeline SHALL build Docker images for the backend and frontend services.
5. WHEN a commit is pushed to the main branch, THE CI_Pipeline SHALL tag built Docker images with the commit SHA.

### Requirement 10: Test Coverage Expansion

**User Story:** As a developer, I want comprehensive test coverage for core subsystems, so that regressions are caught automatically and refactoring is safe.

#### Acceptance Criteria

1. THE Backend SHALL have integration tests for all REST API route handlers using supertest, covering at least one happy-path scenario per endpoint.
2. THE Backend SHALL have unit tests for the Connector_Manager lifecycle operations (enable, disable, retry).
3. THE Backend SHALL have unit tests for the Automation_Engine rule evaluation logic.
4. THE Backend SHALL have integration tests for the WebSocket_Server covering connection establishment, snapshot delivery, and event broadcast.
5. THE Frontend SHALL have component render tests for key pages including the dashboard, device detail, and automation editor.

### Requirement 11: ESLint Configuration

**User Story:** As a developer, I want ESLint configured with TypeScript-aware rules, so that common code quality issues are caught automatically during development and CI.

#### Acceptance Criteria

1. THE Backend SHALL include an ESLint configuration with the TypeScript ESLint plugin enabled.
2. THE ESLint configuration SHALL enable the `no-unused-vars` rule as an error.
3. THE ESLint configuration SHALL enable the `no-explicit-any` rule as a warning.
4. THE ESLint configuration SHALL enable the `consistent-return` rule.
5. THE CI_Pipeline SHALL run ESLint as part of pull request checks.
6. THE ESLint configuration SHALL allow incremental adoption by not failing the build on pre-existing violations in legacy code during the initial rollout.

### Requirement 12: Structured Error Responses

**User Story:** As a frontend developer, I want all API errors to return a consistent JSON structure, so that error handling in the UI is predictable and reliable.

#### Acceptance Criteria

1. THE API_Router SHALL return all error responses as JSON with the shape `{ error: string, details?: unknown }`.
2. WHILE the `NODE_ENV` environment variable is set to `production`, THE API_Router SHALL NOT include stack traces in error response bodies.
3. WHEN an unexpected error occurs, THE Backend SHALL log the full error details including stack trace server-side.
4. THE API_Router SHALL return appropriate HTTP status codes: 400 for validation errors, 404 for missing resources, 409 for conflicts, and 500 for unexpected errors.

### Requirement 13: Database WAL Mode

**User Story:** As a platform operator, I want SQLite to use Write-Ahead Logging mode, so that concurrent read/write performance is improved and crash recovery is more robust.

#### Acceptance Criteria

1. WHEN the Database is initialized, THE Backend SHALL execute `PRAGMA journal_mode=WAL` to enable Write-Ahead Logging.
2. THE Database SHALL maintain WAL mode across application restarts.

### Requirement 14: Frontend Code Splitting

**User Story:** As a user, I want the frontend to load quickly on Raspberry Pi hardware, so that the initial page render is not blocked by large unused modules.

#### Acceptance Criteria

1. THE Frontend SHALL lazy-load the Monaco Editor component using `React.lazy` and `Suspense`.
2. THE Frontend SHALL lazy-load the DataStorePage route component using `React.lazy` and `Suspense`.
3. WHILE a lazy-loaded component is loading, THE Frontend SHALL display a loading indicator within the `Suspense` fallback.
4. THE Code_Splitter SHALL reduce the initial JavaScript bundle size by deferring modules not required for the first meaningful paint.

### Requirement 15: Log Rotation

**User Story:** As a platform operator, I want log output to be bounded, so that log files do not fill the Raspberry Pi SD card over time.

#### Acceptance Criteria

1. THE Backend SHALL configure Docker log rotation using the `json-file` logging driver with a maximum file size of 10MB and a maximum of 5 rotated files per container.
2. IF the Docker logging configuration is not applied, THEN THE Log_Rotator SHALL limit application-level log files to 50MB total or 7 days of retention, whichever threshold is reached first.

### Requirement 16: Production Deployment Documentation

**User Story:** As a platform operator, I want a production deployment guide, so that I can harden and operate the platform with confidence.

#### Acceptance Criteria

1. THE documentation SHALL describe how to configure MQTT broker authentication.
2. THE documentation SHALL describe how to set up HTTPS via a reverse proxy.
3. THE documentation SHALL describe recommended firewall rules for the host.
4. THE documentation SHALL describe a backup strategy for the SQLite database and configuration files.
5. THE documentation SHALL describe monitoring recommendations including the Health_Endpoint and Docker health checks.
6. THE documentation SHALL document the Docker socket mount as a conscious trade-off required for the self-update feature, with associated risk mitigation guidance.

### Requirement 17: Eliminate Explicit `any` Types

**User Story:** As a developer, I want all `any` type annotations replaced with proper types, so that the TypeScript compiler catches type errors at build time and the codebase is safe to refactor.

#### Acceptance Criteria

1. THE Backend SHALL replace all explicit `any` type annotations with specific types, `unknown`, or properly narrowed generics.
2. THE Backend SHALL enable `noImplicitAny: true` in `tsconfig.json` to prevent new `any` types from being introduced.
3. THE Backend SHALL replace the `IvmGlobal = any` type alias in `sandbox.ts` with a proper interface or `unknown` with type narrowing.
4. THE Backend SHALL replace `Record<string, any>` patterns with `Record<string, unknown>` and add type guards where values are accessed.
5. THE Frontend SHALL replace all explicit `any` type annotations with specific types or `unknown`.
6. WHERE a third-party library lacks type definitions, THE codebase SHALL use a minimal typed wrapper or `unknown` with documented type assertions rather than `any`.
7. WHEN `any` is unavoidable due to library constraints, THE codebase SHALL annotate it with an `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment explaining why.
