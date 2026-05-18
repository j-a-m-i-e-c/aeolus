# Implementation Plan: MQTT Device Provisioning

## Overview

Implement configurable MQTT security levels (Open, Shared Password, Per-Device) managed from the Aeolus dashboard. The implementation proceeds bottom-up: Mosquitto config writer, enhanced credential service with native hashes, broker reloader, provisioning orchestrator service, REST API routes, frontend store, and UI components. Each layer builds on the previous, ending with application wiring.

## Tasks

- [x] 1. Implement Mosquitto config writer
  - [x] 1.1 Create `src/mqtt/mosquitto-config-writer.ts`
    - Define `MosquittoConfigWriterOptions` interface with `configPath` property
    - Implement `writeOpenConfig()` — writes `listener 1883`, `allow_anonymous true`, persistence and log directives
    - Implement `writeAuthenticatedConfig(passwordFilePath: string)` — writes `allow_anonymous false` with `password_file` directive
    - Use atomic file writes (write to temp file, then `fs.renameSync`) to prevent partial reads
    - Export the class for use by the provisioning service
    - _Requirements: 1.5, 2.1, 2.2, 3.3, 4.1, 5.3_

  - [x]* 1.2 Write property test for Mosquitto config writer — Property 3: Config file correctness per security level
    - Create `src/mqtt/mosquitto-config-writer.property.test.ts`
    - Generate arbitrary security levels from ["open", "shared_password", "per_device"]
    - Assert: "open" produces `allow_anonymous true` and no `password_file` directive; "shared_password" and "per_device" produce `allow_anonymous false` and a `password_file` directive
    - Use fast-check with minimum 100 iterations
    - **Property 3: Mosquitto config file correctness per security level**
    - **Validates: Requirements 1.5, 2.1, 2.2, 3.3, 4.1**

  - [x]* 1.3 Write unit tests for Mosquitto config writer
    - Create `src/mqtt/mosquitto-config-writer.test.ts`
    - Test atomic write behavior (temp file created, renamed to target)
    - Test open mode config content matches expected template
    - Test authenticated mode config content matches expected template
    - _Requirements: 1.5, 5.3_

- [x] 2. Implement Mosquitto reloader
  - [x] 2.1 Create `src/mqtt/mosquitto-reloader.ts`
    - Implement `reload(): Promise<boolean>` method
    - First attempt: `docker kill --signal=SIGHUP aeolus-mosquitto` via `execSync`
    - Fallback on failure: `docker restart aeolus-mosquitto`
    - Return `true` on success, `false` if both fail
    - Log each attempt and outcome with pino
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x]* 2.2 Write unit tests for Mosquitto reloader
    - Create `src/mqtt/mosquitto-reloader.test.ts`
    - Mock `child_process.execSync`
    - Test SIGHUP success path returns true
    - Test SIGHUP failure triggers restart fallback
    - Test both-fail scenario returns false and logs error
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 3. Enhance MQTT credential service with Mosquitto-native hashes
  - [x] 3.1 Modify `src/auth/mqtt-credential-service.ts` to use `mosquitto_passwd`
    - Add `generatePasswordFileWithMosquittoPasswd(entries: PasswordFileEntry[])` function
    - Execute `docker exec aeolus-mosquitto mosquitto_passwd -b /dev/null <username> <password>` to get native hashes
    - Write password file atomically (temp + rename)
    - Add retry logic: if container unavailable, queue operation and retry every 10s up to 30 attempts
    - Keep existing `sanitizeUsername()` function, export it for reuse
    - Export `getPasswordFilePath()` for use by provisioning service
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 3.2 Write property test for username derivation — Property 13: Username derivation is deterministic and sanitized
    - Create `src/auth/mqtt-credential-service.property.test.ts`
    - Generate arbitrary device name strings (1-64 chars, unicode, spaces, special chars)
    - Assert: result is deterministic (same input → same output), prefixed with "mqtt-", contains only lowercase alphanumeric and hyphens, does not start or end with hyphen
    - **Property 13: Username derivation is deterministic and sanitized**
    - **Validates: Requirements 4.2**

  - [x]* 3.3 Write property test for password generation — Property 4: Password generation meets minimum entropy
    - In the same test file, add property test for password generation
    - Generate arbitrary credential creation calls
    - Assert: generated password is at least 32 characters, consists only of base64url-safe characters ([A-Za-z0-9_-])
    - **Property 4: Password generation meets minimum entropy**
    - **Validates: Requirements 3.1, 4.2**

  - [x]* 3.4 Write property test for credential list secrecy — Property 7: Credential secrecy in list responses
    - Generate arbitrary sets of credentials (create multiple)
    - Assert: `listCredentials()` returns id, deviceName, username, createdAt for each; does NOT include password or passwordHash fields
    - Assert: `createCredential()` returns password field exactly once
    - **Property 7: Credential secrecy in list responses**
    - **Validates: Requirements 4.4, 4.7**

- [x] 4. Checkpoint — Config writer, reloader, and credential service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement MQTT provisioning service
  - [x] 5.1 Create `src/mqtt/mqtt-provisioning-service.ts` — core orchestrator
    - Define `SecurityLevel` type and `SecurityStatus` interface
    - Implement constructor accepting dependencies: database, MqttService, MosquittoConfigWriter, MosquittoReloader
    - Implement `getStatus(): SecurityStatus` — read level from `system_settings`, include shared credential if applicable, include backend connection state
    - Implement `initialize(): Promise<void>` — read persisted level, regenerate password file and config to match, ensure backend credential exists if auth active, connect MQTT with correct credentials
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 10.1, 10.4, 10.5_

  - [x] 5.2 Implement `setSecurityLevel()` orchestration
    - Validate level is one of the three valid values
    - For "open": write open config, update MQTT client to no credentials, reload broker, persist level
    - For "shared_password": generate shared credential + backend credential, write password file, write authenticated config, update MQTT client with backend credential, reload broker, persist level + shared credential
    - For "per_device": ensure backend credential, write password file (all device creds + backend), write authenticated config, update MQTT client with backend credential, reload broker, persist level
    - Order: files → credentials → MQTT reconnect → broker reload → DB persist
    - _Requirements: 1.5, 1.6, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.6, 4.1, 4.8, 6.1, 6.2, 6.3, 6.4_

  - [x] 5.3 Implement shared password operations
    - Implement `regenerateSharedPassword(): Promise<{username, password}>` — generate new password, update password file, reload broker
    - Validate current mode is "shared_password" before allowing regeneration (throw ConflictError otherwise)
    - _Requirements: 3.5, 9.3, 9.7_

  - [x] 5.4 Implement per-device credential delegation
    - Implement `createDeviceCredential(deviceName)` — validate mode is "per_device", delegate to credential service, regenerate password file with mosquitto_passwd, reload broker
    - Implement `revokeDeviceCredential(id)` — validate mode is "per_device", delegate to credential service, regenerate password file, reload broker
    - Implement `listDeviceCredentials()` — delegate to credential service
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 9.4, 9.5, 9.6, 9.7_

  - [x] 5.5 Add `reconnectWithCredentials()` to existing MqttService
    - Modify `src/mqtt/mqtt-service.ts` to add `reconnectWithCredentials(credentials: {username?, password?} | null)` method
    - Disconnect current client, update connection options with new credentials, reconnect
    - If credentials is null, connect without auth (open mode)
    - _Requirements: 6.2, 6.3, 6.4, 6.5_

  - [x]* 5.6 Write property test — Property 1: Security level validation
    - Create `src/mqtt/mqtt-provisioning-service.property.test.ts`
    - Generate arbitrary strings; assert only "open", "shared_password", "per_device" are accepted; all others rejected with validation error
    - **Property 1: Security level validation**
    - **Validates: Requirements 1.1, 9.8**

  - [x]* 5.7 Write property test — Property 2: Security level persistence round-trip
    - Generate arbitrary valid security levels
    - Assert: after `setSecurityLevel(level)`, reading from DB and `getStatus().level` both return the same value
    - **Property 2: Security level persistence round-trip**
    - **Validates: Requirements 1.2, 10.1**

  - [x]* 5.8 Write property test — Property 5: Password file entry invariant
    - Generate arbitrary sequences of credential create/delete operations
    - Assert: password file contains exactly one entry per credential in DB, plus backend credential and shared credential when applicable
    - **Property 5: Password file entry invariant**
    - **Validates: Requirements 4.3, 5.2, 5.5, 10.2**

  - [x]* 5.9 Write property test — Property 6: Backend credential presence in authenticated modes
    - Generate arbitrary security levels
    - Assert: for "shared_password" and "per_device", password file contains `aeolus-backend` entry; for "open", password file may be empty
    - **Property 6: Backend credential presence in authenticated modes**
    - **Validates: Requirements 3.2, 4.8, 6.1**

  - [x]* 5.10 Write property test — Property 8: Credential revocation removes from database and password file
    - Generate credential creation then revocation sequences
    - Assert: revoked credential absent from DB and password file
    - **Property 8: Credential revocation removes from database and password file**
    - **Validates: Requirements 4.5**

  - [x]* 5.11 Write property test — Property 9: Shared password regeneration produces a distinct value
    - In shared_password mode, call regenerate multiple times
    - Assert: each new password differs from the previous; password file is updated
    - **Property 9: Shared password regeneration produces a distinct value**
    - **Validates: Requirements 3.5**

  - [x]* 5.12 Write property test — Property 12: Startup state reconstruction
    - Persist various security levels to DB, then call `initialize()`
    - Assert: config file and password file match expected state for that level; backend credential present if auth active
    - **Property 12: Startup state reconstruction**
    - **Validates: Requirements 10.4, 10.5**

- [x] 6. Checkpoint — Provisioning service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement REST API routes and Zod schemas
  - [x] 7.1 Create `src/api/schemas/provisioning.schemas.ts`
    - Define `setSecurityLevelSchema` — `z.object({ level: z.enum(["open", "shared_password", "per_device"]) })`
    - Define `createDeviceCredentialSchema` — `z.object({ deviceName: z.string().min(1).max(64).trim() })`
    - Export both schemas
    - _Requirements: 9.8_

  - [x] 7.2 Create `src/api/routes/provisioning.routes.ts`
    - `GET /api/mqtt/provisioning/status` — return current security status
    - `PUT /api/mqtt/provisioning/level` — change security level (validate with Zod, admin-only)
    - `POST /api/mqtt/provisioning/shared/regenerate` — regenerate shared password (admin-only)
    - `GET /api/mqtt/provisioning/credentials` — list device credentials (admin-only)
    - `POST /api/mqtt/provisioning/credentials` — create device credential (validate with Zod, admin-only)
    - `DELETE /api/mqtt/provisioning/credentials/:id` — revoke credential (admin-only)
    - Use existing `validate()` middleware for request body validation
    - Return appropriate HTTP status codes (200, 400, 401, 403, 404, 409, 502, 503)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x]* 7.3 Write property test — Property 10: Mode-mismatch operations return HTTP 409
    - Create `src/api/routes/provisioning.routes.property.test.ts`
    - Generate arbitrary mode-mismatch scenarios (credential creation in non-per_device, shared regeneration in non-shared_password)
    - Assert: HTTP 409 with descriptive error message
    - **Property 10: Mode-mismatch operations return HTTP 409**
    - **Validates: Requirements 9.7**

  - [x]* 7.4 Write property test — Property 11: Status endpoint reflects current state
    - Generate arbitrary valid security levels, set them, then query status
    - Assert: returned level matches set level; shared credential present only in shared_password mode
    - **Property 11: Status endpoint reflects current state**
    - **Validates: Requirements 1.4, 10.3**

  - [x]* 7.5 Write integration tests for provisioning routes
    - Create `src/api/routes/provisioning.routes.test.ts`
    - Use supertest with mocked provisioning service
    - Test full level change flow: open → shared_password → per_device → open
    - Test credential lifecycle: create → list → revoke
    - Test validation errors (400), mode mismatches (409), not found (404)
    - _Requirements: 9.1–9.8_

- [x] 8. Checkpoint — API routes and all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement frontend store
  - [x] 9.1 Create `frontend/src/store/mqtt-provisioning-store.ts`
    - Define `MqttProvisioningState` interface with level, sharedCredential, credentials, loading fields
    - Implement `fetchStatus()` — GET /api/mqtt/provisioning/status
    - Implement `setLevel(level)` — PUT /api/mqtt/provisioning/level
    - Implement `regenerateSharedPassword()` — POST /api/mqtt/provisioning/shared/regenerate
    - Implement `createCredential(deviceName)` — POST /api/mqtt/provisioning/credentials
    - Implement `revokeCredential(id)` — DELETE /api/mqtt/provisioning/credentials/:id
    - Implement `fetchCredentials()` — GET /api/mqtt/provisioning/credentials
    - Use Zustand with proper error handling and loading states
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 10. Implement frontend UI components
  - [x] 10.1 Create `frontend/src/pages/MqttSecurityPage.tsx`
    - Top-level page component for MQTT security management
    - Fetch status on mount via store
    - Render SecurityLevelSelector, conditionally render SharedPasswordPanel or DeviceCredentialList based on active level
    - Follow Aeolus design system (Tailwind tokens, Lucide icons, card layout)
    - _Requirements: 8.1, 8.2_

  - [x] 10.2 Create `frontend/src/components/mqtt/SecurityLevelSelector.tsx`
    - Radio-card UI for selecting between Open, Shared Password, and Per-Device modes
    - Visual indicators for each mode (Lucide icons: Unlock, Key, Shield)
    - Confirmation dialog when switching away from modes with active credentials
    - Call store `setLevel()` on selection
    - _Requirements: 1.7, 1.8, 8.1, 8.2_

  - [x] 10.3 Create `frontend/src/components/mqtt/SharedPasswordPanel.tsx`
    - Display shared username and password with copy-to-clipboard buttons
    - Regenerate button that calls store `regenerateSharedPassword()`
    - Show loading state during regeneration
    - Only visible when level is "shared_password"
    - _Requirements: 3.4, 8.3, 8.4_

  - [x] 10.4 Create `frontend/src/components/mqtt/DeviceCredentialList.tsx`
    - Table of device credentials showing device name, username, creation date
    - Revoke button per row with confirmation prompt
    - "Create Credential" form with device name input
    - Only visible when level is "per_device"
    - _Requirements: 4.7, 8.5, 8.6, 8.7_

  - [x] 10.5 Create `frontend/src/components/mqtt/CredentialCreatedDialog.tsx`
    - One-time-view modal showing generated username and password
    - Copy-to-clipboard buttons for both fields
    - Warning that password won't be shown again
    - Dismiss button to close
    - _Requirements: 4.4, 8.8_

- [x] 11. Application wiring and routing
  - [x] 11.1 Wire provisioning service into `src/index.ts`
    - Instantiate MosquittoConfigWriter, MosquittoReloader, MqttProvisioningService after database init
    - Call `provisioningService.initialize()` during startup (before MQTT connect)
    - Mount provisioning routes at `/api/mqtt/provisioning` on Express app
    - _Requirements: 10.4, 10.5_

  - [x] 11.2 Add frontend route and sidebar entry
    - Add route for MqttSecurityPage in `App.tsx`
    - Add navigation entry in sidebar (under Settings or as standalone)
    - _Requirements: 8.1_

- [x] 12. Final checkpoint — Full integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 13 universal correctness properties defined in the design
- Unit/integration tests validate specific examples, edge cases, and API behavior
- The config writer (task 1) and reloader (task 2) are pure utilities with no dependencies on each other
- The credential service enhancement (task 3) modifies existing code — test carefully
- The provisioning service (task 5) orchestrates all lower-level components
- Frontend components (tasks 9-10) depend on backend being complete (tasks 1-8)
- Application wiring (task 11) is the final step that connects all pieces
- Mock `docker exec` and `child_process` in all unit/property tests — never call real Docker in tests

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.2", "3.3", "3.4"] },
    { "id": 2, "tasks": ["5.1", "5.5", "7.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 4, "tasks": ["5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12"] },
    { "id": 5, "tasks": ["7.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 9, "tasks": ["11.1", "11.2"] }
  ]
}
```
