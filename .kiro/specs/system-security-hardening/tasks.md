# Implementation Plan: System Security Hardening

## Overview

Rewrite the Aeolus system routes to be purely read-only, remove the Docker socket mount and unnecessary packages from the production image, bake version info at build time, and simplify the frontend System page to a read-only diagnostic dashboard. Implementation uses TypeScript throughout with Vitest + supertest for unit tests and fast-check for property-based tests.

## Tasks

- [x] 1. Harden backend system routes
  - [x] 1.1 Rewrite `src/api/routes/system.routes.ts` to read-only GET-only router
    - Remove all POST route handlers (update, shutdown, reboot, docker-prune)
    - Remove imports of `spawn`, `spawnSync`, `exec`, `execFile`, `execFileSync`, `fork` from `child_process`
    - Keep only `execSync` import for the single `df -B1 / | tail -1` command
    - Remove all Docker-related code (docker socket, docker CLI calls, container spawn)
    - Remove all git-related code (git rev-parse, git log, etc.)
    - Remove any `setTimeout`/`setInterval` for version polling
    - Implement `GET /` diagnostics endpoint using Node.js `os` module
    - Implement `GET /logs` endpoint reading from `../../log-buffer.js`
    - Implement `GET /version` endpoint reading `process.env.BUILD_COMMIT` and `process.env.BUILD_DATE`
    - Implement `getCpuTemp()` helper reading `/sys/class/thermal/thermal_zone0/temp` with graceful null fallback
    - Implement `getDiskUsage()` helper using `execSync("df -B1 / | tail -1")` with graceful null fallback
    - Ensure `memory.usagePercent` and `disk.usagePercent` are clamped to 0–100
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 1.2 Write unit tests for hardened system routes
    - Create/update `src/api/routes/system.routes.test.ts` using Vitest + supertest
    - Test `GET /api/system` returns correct response shape with all required fields
    - Test `GET /api/system` does NOT return a `docker` field
    - Test `GET /api/system/version` returns `{ commit, buildDate }` shape
    - Test `GET /api/system/version` returns `"unknown"` defaults when env vars unset
    - Test `GET /api/system/logs` respects `count` parameter (1–200 range)
    - Test `GET /api/system/logs` filters by `level` parameter
    - Test `GET /api/system/logs` returns 100 entries by default
    - Test `GET /api/system/logs` returns empty array for invalid level
    - Test `POST /api/system/update` returns 404
    - Test `POST /api/system/shutdown` returns 404
    - Test `POST /api/system/reboot` returns 404
    - Test `POST /api/system/docker-prune` returns 404
    - Test `PUT`, `DELETE`, `PATCH` on `/api/system/*` paths return 404
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.3, 5.4, 5.5, 5.6, 6.1, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 1.3 Write property test: No POST endpoints on System Router
    - **Property 1: No POST Endpoints on System Router**
    - Create `src/api/routes/system.routes.property.test.ts`
    - Use fast-check to generate arbitrary HTTP methods and paths
    - Assert that non-GET methods to any `/api/system/*` path return 404
    - Assert the router stack contains only GET method handlers
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

  - [ ]* 1.4 Write property test: Version endpoint environment variable round-trip
    - **Property 7: Version Endpoint Environment Variable Round-Trip**
    - Use fast-check to generate arbitrary string values for BUILD_COMMIT and BUILD_DATE
    - Assert the version endpoint returns exact values from env vars
    - Assert unset/empty vars default to "unknown"
    - Assert no child processes are spawned during version resolution
    - **Validates: Requirements 5.3, 5.4, 5.5, 5.6, 5.7**

  - [ ]* 1.5 Write property test: Only df command executed
    - **Property 3: Only df Command Executed**
    - Use fast-check with source code static analysis
    - Assert all `execSync` calls in the module use exactly `"df -B1 / | tail -1"` as the command
    - Assert no docker, git, nsenter, or chroot strings appear in execSync calls
    - **Validates: Requirements 2.2, 2.3**

- [x] 2. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Harden Docker configuration
  - [x] 3.1 Update `Dockerfile` to remove docker-ce-cli, git, and add build args
    - Remove Docker apt repository setup (GPG keys, sources list entries)
    - Remove `docker-ce-cli` from apt-get install commands in production stage
    - Remove `git` from production stage apt-get install
    - Remove `git config --global --add safe.directory /aeolus-host`
    - Add `ARG BUILD_COMMIT=unknown` and `ARG BUILD_DATE=unknown`
    - Add `ENV BUILD_COMMIT=$BUILD_COMMIT` and `ENV BUILD_DATE=$BUILD_DATE`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.8_

  - [x] 3.2 Update `docker-compose.yml` to remove socket mount and host bind mount
    - Remove `/var/run/docker.sock:/var/run/docker.sock` volume mount from backend service
    - Remove `.:/aeolus-host` bind mount from backend service
    - Remove `AEOLUS_PROJECT_DIR` environment variable from backend service
    - Remove `DOCKER_HOST` environment variable if present
    - Add `BUILD_COMMIT` and `BUILD_DATE` to build args section
    - Retain only `backend_data:/app/data` named volume
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.3 Write property test: No Docker Socket Mount
    - **Property 4: No Docker Socket Mount**
    - Parse `docker-compose.yml` volumes section
    - Use fast-check to assert no generated volume string matches `/var/run/docker.sock`
    - Assert no bind mount references host project directory
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 3.4 Write property test: No Docker CLI or Git in Production Image
    - **Property 5: No Docker CLI or Git in Production Image**
    - Parse `Dockerfile` production stage apt-get install commands
    - Assert package lists never contain `docker-ce-cli` or `git`
    - Assert no Docker apt repo entries exist
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [ ]* 3.5 Write property test: No Host Project Directory Reference
    - **Property 6: No Host Project Directory Reference**
    - Parse `docker-compose.yml` backend service section
    - Assert no volume entry matches `.:/aeolus-host` pattern
    - Assert no environment variable named `AEOLUS_PROJECT_DIR` exists
    - **Validates: Requirements 3.2, 3.3**

- [x] 4. Checkpoint - Ensure Docker config tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Simplify frontend System page
  - [x] 5.1 Rewrite `frontend/src/components/SystemPage.tsx` to read-only
    - Remove Update, Reboot, Shutdown buttons and their click handlers
    - Remove Docker disk breakdown overlay and prune button
    - Remove all state/functions related to POST/PUT/DELETE mutations
    - Remove all mutation API calls (fetch with POST method)
    - Retain CPU, Memory, Disk (simple), Temperature, Network, Uptime diagnostic cards
    - Retain health summary bar (device count, automation count, uptime, MQTT status)
    - Retain log viewer component with level filtering and manual refresh
    - Add build version info display (commit + build date) from `GET /api/system/version`
    - Display "Not available" placeholder when `cpuTemp` or `disk` is null
    - Display error state when diagnostics endpoint request fails
    - Ensure all HTTP requests made by the component use GET method only
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

  - [ ]* 5.2 Write property test: Frontend has no system mutation calls
    - **Property 8: Frontend Has No System Mutation Calls**
    - Static analysis of `SystemPage.tsx` source
    - Use fast-check to assert no HTTP method other than GET appears in fetch/API calls
    - Assert no button elements trigger POST/PUT/DELETE requests
    - **Validates: Requirements 8.1, 8.2, 8.5**

- [x] 6. Integration wiring and static analysis
  - [x] 6.1 Write static analysis test: No spawn import in system routes
    - **Property 2: No Spawn Import**
    - Create a test that reads `src/api/routes/system.routes.ts` source
    - Assert `spawn`, `spawnSync`, `exec`, `execFile`, `execFileSync`, `fork` are not imported from `child_process`
    - Assert only `execSync` is imported
    - Assert no string containing `docker`, `git`, `nsenter`, `chroot`, or `--pid=host` exists in source
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 6.2 Write integration test for hardened system routes
    - Test the full Express app with hardened routes mounted
    - Verify `GET /api/system` returns valid diagnostics JSON
    - Verify `GET /api/system/version` with env vars set returns correct values
    - Verify removed endpoints return 404 through the full app
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.3, 5.4, 6.1_

- [x] 7. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all implementations use TypeScript strict mode
- Testing uses Vitest + supertest for HTTP tests and fast-check for property-based tests
- Static analysis properties (2, 3, 5, 6) can be implemented as simple source-reading tests that parse file content

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "3.2"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "3.3", "3.4", "3.5"] },
    { "id": 2, "tasks": ["5.1"] },
    { "id": 3, "tasks": ["5.2", "6.1"] },
    { "id": 4, "tasks": ["6.2"] }
  ]
}
```
