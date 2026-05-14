# Implementation Plan: Engineering Quality Uplift

## Overview

Implement a comprehensive set of engineering quality improvements for the Aeolus IoT platform. The implementation proceeds in logical phases: foundation (ESLint, tsconfig strictness, WAL mode), middleware layer (rate limiter, CORS, Zod validation, structured errors), reliability (graceful shutdown, MQTT reconnection), infrastructure (Docker health check, image optimization, log rotation, CI/CD), type safety (eliminate `any` types), testing (integration tests, property tests), frontend (code splitting), and documentation (production deployment guide).

Each phase builds on the previous — ESLint and strict types come first so subsequent code is written correctly from the start. Middleware is grouped together since the components share a pipeline. Infrastructure changes are independent and can be applied in parallel.

## Tasks

- [ ] 1. Foundation — ESLint, tsconfig strictness, and WAL mode
  - [ ] 1.1 Create ESLint flat config with TypeScript-aware rules
    - Create `eslint.config.js` using `typescript-eslint` flat config
    - Enable `@typescript-eslint/no-unused-vars` as error with `argsIgnorePattern: "^_"`
    - Enable `@typescript-eslint/no-explicit-any` as warning
    - Enable `consistent-return` as error
    - Add ignores for `dist/`, `node_modules/`, `automations/`
    - Install `typescript-eslint` as a dev dependency if not present
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_

  - [ ] 1.2 Enable `noImplicitAny` in tsconfig.json
    - Add `"noImplicitAny": true` to `compilerOptions` in `tsconfig.json`
    - Run `npx tsc --noEmit` to identify all new type errors
    - Do NOT fix the errors yet — they will be addressed in the type safety phase (task 7)
    - _Requirements: 17.2_

  - [ ] 1.3 Enable WAL mode in database initialization
    - Add `database.run("PRAGMA journal_mode=WAL;")` as the first PRAGMA in the schema initialization function
    - Ensure it runs before `PRAGMA foreign_keys = ON`
    - WAL mode is idempotent and persists across restarts
    - _Requirements: 13.1, 13.2_

- [ ] 2. Middleware layer — Rate limiter, CORS, Zod validation, and structured errors
  - [ ] 2.1 Add rate limiter and CORS config values to application config
    - Add `rateLimitRpm` field parsed from `RATE_LIMIT_RPM` env var (default 200)
    - Add `corsOrigins` field parsed from `CORS_ORIGINS` env var (comma-separated, default empty array)
    - _Requirements: 3.4, 4.2_

  - [ ] 2.2 Implement rate limiter middleware
    - Create `src/api/middleware/rate-limiter.ts`
    - Use `express-rate-limit` with `windowMs: 60_000` and `max` from config
    - Return `{ error: "Too many requests, please try again later" }` on 429
    - Enable `standardHeaders: true`, disable `legacyHeaders`
    - Install `express-rate-limit` as a dependency
    - _Requirements: 3.1, 3.2, 3.4_

  - [ ] 2.3 Implement CORS middleware
    - Create `src/api/middleware/cors-config.ts`
    - Build allowed origins list: regex for `localhost` and `127.0.0.1` on any port, plus entries from `CORS_ORIGINS`
    - Use the `cors` package with `credentials: true`
    - Requests from non-allowed origins will have CORS headers omitted (default `cors` behavior)
    - Install `cors` and `@types/cors` if not present
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 2.4 Implement Zod validation middleware factory
    - Create `src/api/middleware/validate.ts`
    - Export `validate(schemas: { body?: ZodSchema; params?: ZodSchema; query?: ZodSchema })` middleware factory
    - On validation failure, respond with `{ error: "Validation failed", details: zodError.errors }` and HTTP 400
    - Pass through to `next()` on success, replacing `req.body`/`req.params`/`req.query` with parsed values
    - _Requirements: 2.1, 2.2, 2.7_

  - [ ] 2.5 Create Zod schemas for all API routes
    - Create `src/api/schemas/` directory with schema files per route group (automation, device, connector, service, layout, data-store)
    - Enforce `max()` on all string fields and numeric range constraints
    - Enforce 100KB limit on automation `script_source` field
    - Add 1MB body size limit via Express `json({ limit: "1mb" })` middleware
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ] 2.6 Wire validation middleware into all POST/PUT route handlers
    - Apply `validate()` middleware to each POST and PUT route
    - Use the corresponding Zod schema for each route
    - Ensure route handlers receive typed, validated data
    - _Requirements: 2.1, 2.7_

  - [ ] 2.7 Implement structured error handler middleware
    - Update or create `src/api/middleware/error-handler.ts`
    - All error responses return `{ error: string, details?: unknown }` shape
    - Suppress stack traces when `NODE_ENV=production` (return generic "Internal server error")
    - Log full error details server-side via pino
    - Map status codes: 400 validation, 404 not found, 409 conflict, 429 rate limit, 500 unexpected
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ] 2.8 Wire middleware into Express app in correct pipeline order
    - Apply middleware in order: CORS → Rate Limiter → Body Parser (with 1MB limit) → Request Logger → Routes → Error Handler
    - Rate limiter before body parsing to reject over-limit requests cheaply
    - Error handler as the last middleware
    - _Requirements: 2.5, 3.1, 4.1, 12.1_

- [ ] 3. Checkpoint — Ensure middleware layer works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Reliability — Graceful shutdown and MQTT reconnection
  - [ ] 4.1 Implement graceful shutdown handler
    - Register handlers for `SIGINT` and `SIGTERM` signals
    - Stop accepting new HTTP connections via `server.close()`
    - Send WebSocket close frames to all connected clients
    - Stop all active timers (retention timers, polling intervals, cron schedules)
    - Disconnect MQTT cleanly
    - Persist database to disk
    - Set a 5-second timeout — force `process.exit(0)` if cleanup exceeds it
    - Exit with code 0 after all cleanup completes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ] 4.2 Implement MQTT reconnection with exponential backoff
    - Add `MqttConnectionState` type: `"disconnected" | "connecting" | "connected" | "waiting_retry"`
    - Implement `computeRetryDelay(attempt, baseDelayMs, maxDelayMs)` — returns `min(baseDelayMs × 2^(attempt-1), maxDelayMs)`
    - Use base delay 1000ms, max delay 30000ms
    - On connection loss, enter reconnection loop with indefinite retries
    - On successful reconnection, re-subscribe to all configured topics
    - Emit connection state change events on the event bus
    - Log each reconnection attempt with attempt number and delay
    - Stop reconnection loop when `disconnect()` is called (during shutdown)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 4.3 Write property test for exponential backoff computation
    - Create `src/mqtt/mqtt-service.property.test.ts`
    - Generate random attempt numbers (1 to 1000)
    - Assert: `computeRetryDelay(n, 1000, 30000) === Math.min(1000 * 2^(n-1), 30000)`
    - Assert: result is always between 1000 and 30000 inclusive
    - Assert: result is monotonically non-decreasing with attempt number
    - Use fast-check with minimum 100 iterations
    - **Property 5: Exponential Backoff Computation**
    - **Validates: Requirements 6.2**

- [ ] 5. Infrastructure — Docker, log rotation, and CI/CD
  - [ ] 5.1 Add Docker health check to docker-compose.yml
    - Add `healthcheck` directive to the backend service in `docker-compose.yml`
    - Use `wget --no-verbose --tries=1 --spider http://localhost:3001/api/health`
    - Configure: interval 30s, timeout 5s, start_period 10s, retries 3
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 5.2 Optimize Dockerfile with multi-stage build
    - Restructure Dockerfile with `builder` stage (includes python3, make, g++) and `production` stage
    - Production stage: only `git`, `docker-cli`, `docker-cli-compose`, `util-linux`
    - Copy only compiled dist artifacts and production `node_modules` from builder
    - Add `npm cache clean --force` to reduce layer size
    - Add `HEALTHCHECK` directive in Dockerfile as well
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 5.3 Configure Docker log rotation for all services
    - Add `logging` configuration to backend, frontend, and mosquitto services in `docker-compose.yml`
    - Use `json-file` driver with `max-size: "10m"` and `max-file: "5"`
    - This caps total log storage at 50MB per container
    - _Requirements: 15.1_

  - [ ] 5.4 Create GitHub Actions CI/CD pipeline
    - Create `.github/workflows/ci.yml`
    - On pull request to main: run `npm ci`, `npx tsc --noEmit`, `npm test`, `npx eslint .` (non-blocking with `|| true`)
    - On push to main: build Docker images for backend and frontend, tag with commit SHA
    - Use `actions/checkout@v4`, `actions/setup-node@v4` (node 22), `docker/setup-buildx-action@v3`, `docker/build-push-action@v5`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 11.5_

- [ ] 6. Checkpoint — Ensure infrastructure changes are valid
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Type safety — Eliminate explicit `any` types
  - [ ] 7.1 Replace `any` types in backend core modules
    - Replace `IvmGlobal = any` in `src/automations/sandbox.ts` with a proper interface describing the sandbox API shape
    - Replace `(ctx.state as any).value` in `src/automations/condition-registry.ts` with typed `DeviceState` interface
    - Replace `Record<string, any>` in `src/connectors/connector.interface.ts` with `Record<string, unknown>` + type guards
    - _Requirements: 17.1, 17.3, 17.4_

  - [ ] 7.2 Replace `any` types in API route handlers
    - Replace `any` annotations in route handler request/response types with Zod-inferred types from validation schemas
    - Replace action params `any` in `src/automations/action-executor.ts` with union type of known action param shapes
    - Add type guards where `unknown` values are accessed
    - _Requirements: 17.1, 17.4_

  - [ ] 7.3 Replace `any` types in remaining backend files
    - Audit all remaining `any` annotations in `src/` directory
    - Replace with specific types, `unknown`, or properly narrowed generics
    - For third-party libraries lacking type definitions, use minimal typed wrappers or `unknown` with documented type assertions
    - Add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` with explanation where truly unavoidable
    - _Requirements: 17.1, 17.6, 17.7_

  - [ ] 7.4 Replace `any` types in frontend code
    - Audit all `any` annotations in `frontend/src/` directory
    - Replace with specific types or `unknown`
    - Apply same strategy: specific types preferred, `unknown` as fallback, eslint-disable with explanation as last resort
    - _Requirements: 17.5, 17.6, 17.7_

  - [ ] 7.5 Verify TypeScript compilation passes with strict settings
    - Run `npx tsc --noEmit` and ensure zero errors
    - Confirm `noImplicitAny: true` is active and no regressions exist
    - _Requirements: 17.2_

- [ ] 8. Parameterized SQL queries
  - [ ] 8.1 Audit and fix all database queries to use parameterized statements
    - Search all `db.exec()`, `db.run()`, and `db.prepare()` calls for string interpolation or template literals with dynamic values
    - Replace any string-concatenated queries with parameterized placeholders (`?` or `$name`)
    - Ensure all user-supplied values are passed as bind parameters
    - _Requirements: 1.1, 1.2_

  - [ ] 8.2 Add parameterized query guidance to contributing documentation
    - Add a section to `CONTRIBUTING.md` documenting the parameterized query requirement
    - Include examples of correct (parameterized) and incorrect (interpolated) patterns
    - Reference the ESLint guidance for code review
    - _Requirements: 1.3_

- [ ] 9. Testing — Integration tests and property tests
  - [ ] 9.1 Write integration tests for REST API route handlers
    - Create test files using supertest for all API route groups
    - Cover at least one happy-path scenario per endpoint
    - Cover error cases (400 validation, 404 not found, 429 rate limit)
    - _Requirements: 10.1_

  - [ ] 9.2 Write unit tests for Connector Manager lifecycle
    - Test enable, disable, and retry operations
    - Mock external dependencies (network calls, timers)
    - Verify state transitions and error handling
    - _Requirements: 10.2_

  - [ ] 9.3 Write unit tests for Automation Engine rule evaluation
    - Test rule matching logic with various trigger conditions
    - Test action execution for different action types
    - Test edge cases (disabled rules, invalid scripts, missing targets)
    - _Requirements: 10.3_

  - [ ] 9.4 Write integration tests for WebSocket Server
    - Test connection establishment and upgrade
    - Test snapshot delivery on connect
    - Test event broadcast to connected clients
    - _Requirements: 10.4_

  - [ ]* 9.5 Write property test for validation constraint enforcement
    - Create `src/api/middleware/validate.property.test.ts`
    - Generate random strings exceeding max length, numbers outside ranges, objects with missing required fields
    - Assert: all constraint-violating inputs receive HTTP 400
    - Use fast-check with minimum 100 iterations
    - **Property 1: Validation Constraint Enforcement**
    - **Validates: Requirements 2.3, 2.4, 2.7**

  - [ ]* 9.6 Write property test for validation error response shape
    - In the same test file, add property for response shape
    - Generate random invalid request bodies against each schema
    - Assert: response has status 400 and body matches `{ error: string, details: unknown[] }` where details is non-empty
    - **Property 2: Validation Error Response Shape**
    - **Validates: Requirements 2.2**

  - [ ]* 9.7 Write property test for rate limiter threshold enforcement
    - Create `src/api/middleware/rate-limiter.property.test.ts`
    - Generate random request counts above the configured limit
    - Assert: the (limit + 1)th request receives HTTP 429
    - Assert: requests at or below the limit receive non-429 responses
    - **Property 3: Rate Limiter Threshold Enforcement**
    - **Validates: Requirements 3.1**

  - [ ]* 9.8 Write property test for CORS origin validation
    - Create `src/api/middleware/cors.property.test.ts`
    - Generate random origin strings: localhost with random ports, 127.0.0.1 with random ports, random non-matching domains
    - Assert: matching origins get `Access-Control-Allow-Origin` header, non-matching origins do not
    - **Property 4: CORS Origin Validation**
    - **Validates: Requirements 4.1, 4.3**

  - [ ]* 9.9 Write property test for error response shape consistency
    - Create `src/api/middleware/error-handler.property.test.ts`
    - Generate random error types (AppError with various status codes, generic Error, string throws)
    - Assert: response body is valid JSON matching `{ error: string, details?: unknown }`
    - Assert: no stack traces in response when `NODE_ENV=production`
    - **Property 6: Error Response Shape Consistency**
    - **Validates: Requirements 12.1, 12.2**

- [ ] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Frontend — Code splitting and component tests
  - [ ] 11.1 Implement code splitting with React.lazy and Suspense
    - Lazy-load the Monaco Editor component using `React.lazy(() => import(...))`
    - Lazy-load the DataStorePage route component using `React.lazy(() => import(...))`
    - Wrap lazy components in `<Suspense fallback={<LoadingSpinner />}>` 
    - Ensure a loading indicator is displayed while chunks load
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 11.2 Write frontend component render tests
    - Create render tests for dashboard, device detail, and automation editor pages
    - Use `@testing-library/react` with Vitest
    - Verify components render without errors
    - Verify lazy-loaded components render after loading
    - Verify Suspense fallback appears during load
    - _Requirements: 10.5, 14.3_

- [ ] 12. Documentation — Production deployment guide
  - [ ] 12.1 Create production deployment documentation
    - Create `docs/production-deployment.md`
    - Document MQTT broker authentication configuration
    - Document HTTPS setup via reverse proxy (e.g., nginx, Caddy)
    - Document recommended firewall rules for the host
    - Document backup strategy for SQLite database and configuration files
    - Document monitoring recommendations (Health_Endpoint, Docker health checks)
    - Document Docker socket mount trade-off for self-update feature with risk mitigation guidance
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

- [ ] 13. Final checkpoint — Ensure all tests pass and build succeeds
  - Run `npx tsc --noEmit`, `npm test`, and `npx eslint .`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between phases
- Property tests validate universal correctness properties from the design document
- The exponential backoff property test (4.3) is placed close to its implementation for early error detection
- ESLint is configured first (task 1.1) so all subsequent code benefits from linting
- Type safety phase (task 7) depends on Zod schemas (task 2.5) being in place for inferred types
- Parameterized SQL (task 8) is placed after type safety since the audit may surface type issues
