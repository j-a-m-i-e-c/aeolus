# Implementation Plan: Authentication

## Overview

Implement a JWT-based authentication system with group-based, tab-level permissions (read/interact/write). The implementation proceeds bottom-up: database schema and error classes, core services (token, user, group, permission, MQTT credentials), auth middleware, API routes, WebSocket auth enhancement, frontend auth store and login/setup pages, user management UI, and finally application wiring. New runtime dependencies: `jsonwebtoken`, `bcrypt`.

## Tasks

- [x] 1. Install dependencies and set up auth module structure
  - [x] 1.1 Install runtime dependencies and create auth directory structure
    - Run `npm install jsonwebtoken bcrypt` and `npm install -D @types/jsonwebtoken @types/bcrypt`
    - Create `src/auth/` directory
    - Create placeholder files: `auth-service.ts`, `token-service.ts`, `user-service.ts`, `group-service.ts`, `permission-service.ts`, `mqtt-credential-service.ts`, `auth-middleware.ts`
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 1.2 Add auth database schema and error classes
    - Add auth tables to `src/db/` schema initialization: `users`, `groups`, `group_tab_assignments`, `refresh_tokens`, `mqtt_credentials`, `system_settings`
    - Create indexes on `refresh_tokens(user_id)`, `refresh_tokens(token_hash)`
    - Create error classes in `src/api/middleware/error-handler.ts`: `UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409)
    - _Requirements: 2.4, 3.2, 7.5, 14.5_

- [x] 2. Implement Token Service
  - [x] 2.1 Create `src/auth/token-service.ts` with JWT and refresh token logic
    - Implement `getSecret()`: check `JWT_SECRET` env var first, then load from `system_settings` table, generate 256-bit random key on first run and store it
    - Implement `generateAccessToken(payload)`: sign with HS256, 15-minute expiry, include userId, username, role, groupId claims
    - Implement `verifyAccessToken(token)`: verify signature and expiry, return decoded payload
    - Implement `generateRefreshToken(userId)`: generate 32 bytes `crypto.randomBytes` as base64url, store SHA-256 hash in `refresh_tokens` table with 7-day expiry
    - Implement `validateRefreshToken(token)`: hash the raw token, lookup in DB, check expiry
    - Implement `revokeRefreshToken(token)`: delete by hash
    - Implement `revokeAllUserTokens(userId)`: delete all refresh tokens for user
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 11.1, 11.2, 11.3, 11.4, 14.2, 14.3, 14.4, 14.5_

  - [ ]* 2.2 Write property test for Token Service — Property 1: Access token structure and signing
    - Create `src/auth/__tests__/token-service.property.test.ts`
    - Generate arbitrary userId, username, role ("admin"|"user"), groupId (string|null)
    - Assert: generated token decodes to matching claims, exp - iat = 900, signed with HS256
    - **Property 1: Access token structure and signing**
    - **Validates: Requirements 2.3, 3.4, 14.2, 14.4**

  - [ ]* 2.3 Write property test for Token Service — Property 2: Refresh token opacity and secure storage
    - Generate arbitrary userIds, create refresh tokens
    - Assert: raw token is NOT a valid JWT (cannot split into 3 dot-separated base64 parts that decode), stored hash ≠ raw token
    - **Property 2: Refresh token opacity and secure storage**
    - **Validates: Requirements 2.4, 14.3, 14.5**

- [x] 3. Implement User Service
  - [x] 3.1 Create `src/auth/user-service.ts` with user CRUD and password operations
    - Implement `createUser(username, password, groupId)`: validate password ≥ 8 chars, hash with bcrypt cost 12, generate UUID, insert into `users` table
    - Implement `getUser(id)`, `getUserByUsername(username)`, `listUsers()` (exclude passwordHash from list)
    - Implement `updateUser(id, updates)`: update groupId and/or reset password (hash new password)
    - Implement `deleteUser(id)`: check not last admin (count admins), delete user and cascade refresh tokens
    - Implement `changePassword(userId, currentPassword, newPassword)`: verify current, validate new ≥ 8 chars, hash and update, revoke all refresh tokens
    - Implement `verifyPassword(user, password)`: bcrypt.compare with timing-safe behavior
    - _Requirements: 1.2, 1.3, 1.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 12.1, 12.2, 12.3, 12.4, 14.1_

  - [ ]* 3.2 Write property test for User Service — Property 3: Password minimum length enforcement
    - Create `src/auth/__tests__/user-service.property.test.ts`
    - Generate arbitrary strings with length < 8
    - Assert: createUser, setupAdmin, and changePassword all reject with error, state unchanged
    - **Property 3: Password minimum length enforcement**
    - **Validates: Requirements 1.5, 12.4**

  - [ ]* 3.3 Write property test for User Service — Property 10: User listing excludes secrets
    - Generate sets of users with various passwords
    - Assert: listUsers() response never contains passwordHash field
    - **Property 10: User and credential listing excludes secrets**
    - **Validates: Requirements 7.2, 10.2**

  - [ ]* 3.4 Write property test for User Service — Property 11: Last admin protection invariant
    - Generate sequences of user creation (some admin, some user) and deletion attempts
    - Assert: system always rejects deletion of the last admin, at least one admin always exists
    - **Property 11: Last admin protection invariant**
    - **Validates: Requirements 7.5**

  - [ ]* 3.5 Write property test for User Service — Property 12: Password change round-trip
    - Generate valid passwords (≥ 8 chars), perform password change
    - Assert: verifyPassword succeeds with new password, fails with old password
    - **Property 12: Password change round-trip**
    - **Validates: Requirements 12.1**

- [x] 4. Implement Group Service and Permission Service
  - [x] 4.1 Create `src/auth/group-service.ts` with group CRUD
    - Implement `createGroup(name, tabAssignments)`: generate UUID, insert into `groups` and `group_tab_assignments`
    - Implement `getGroup(id)`: join groups with tab assignments
    - Implement `listGroups()`: return all groups with their tab assignments
    - Implement `updateGroup(id, name, tabAssignments)`: update name, delete old assignments, insert new ones
    - Implement `deleteGroup(id)`: delete group (CASCADE removes assignments), set affected users' groupId to null
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 4.2 Create `src/auth/permission-service.ts` with tab-level access control
    - Implement `getGroupPermissions(groupId)`: query group_tab_assignments for the group
    - Implement `hasPermission(userId, tabId, required)`: lookup user's group, get tab assignment, check hierarchy (write > interact > read)
    - Implement `getUserTabPermission(userId, tabId)`: return the permission level or null
    - Implement `getUserAccessibleTabs(userId)`: return all tab assignments for user's group
    - Admin users always return true for hasPermission (bypass check)
    - _Requirements: 3.5, 3.6, 8.1, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 4.3 Write property test for Group Service — Property 8: Group CRUD round-trip
    - Create `src/auth/__tests__/group-service.property.test.ts`
    - Generate valid group names and tab assignment sets
    - Assert: create then get returns same name and assignments; update then get returns updated values
    - **Property 8: Group CRUD round-trip**
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [ ]* 4.4 Write property test for Group Service — Property 9: Group deletion cascades to member access
    - Generate groups with member users, delete the group
    - Assert: all former members have null groupId and no tab access
    - **Property 9: Group deletion cascades to member access**
    - **Validates: Requirements 6.5**

  - [ ]* 4.5 Write property test for Permission Service — Property 4: Permission hierarchy enforcement
    - Create `src/auth/__tests__/permission-service.property.test.ts`
    - Generate non-admin users with tab assignments at various levels, and operations requiring various levels
    - Assert: allowed when P ≥ R, forbidden when P < R, forbidden when tab not assigned
    - **Property 4: Permission hierarchy enforcement**
    - **Validates: Requirements 3.5, 8.5, 8.6, 8.7, 8.8**

  - [ ]* 4.6 Write property test for Permission Service — Property 5: Admin bypasses all permission checks
    - Generate admin users and arbitrary tab/operation combinations
    - Assert: hasPermission always returns true for admin regardless of tab or level
    - **Property 5: Admin bypasses all permission checks**
    - **Validates: Requirements 3.6, 9.7**

  - [ ]* 4.7 Write property test for Permission Service — Property 6: Admin-only endpoint restriction
    - Generate non-admin users with various groups and tab assignments
    - Assert: admin-only operations always return forbidden for non-admin users
    - **Property 6: Admin-only endpoint restriction**
    - **Validates: Requirements 3.7, 6.7, 7.6, 9.1, 9.2, 9.3, 9.4, 9.5**

  - [ ]* 4.8 Write property test for Permission Service — Property 13: Permission propagation on token refresh
    - Create `src/auth/__tests__/group-service.property.test.ts` (append)
    - Generate users, modify their group's tab assignments, then refresh token
    - Assert: new access token reflects updated groupId and permission checks use new assignments
    - **Property 13: Permission propagation on token refresh**
    - **Validates: Requirements 8.10**

- [x] 5. Implement MQTT Credential Service
  - [x] 5.1 Create `src/auth/mqtt-credential-service.ts`
    - Implement `createCredential(deviceName)`: generate username (e.g., `mqtt-<deviceName>`), generate random password, store hashed in `mqtt_credentials`, regenerate password file
    - Implement `listCredentials()`: return all credentials without passwords
    - Implement `deleteCredential(id)`: remove from DB, regenerate password file
    - Implement `ensureBackendCredential()`: create or return existing "aeolus-backend" credential
    - Implement `regeneratePasswordFile()`: read all credentials, write Mosquitto-format `username:hash` file to `mosquitto/password_file`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 5.2 Write property test for MQTT Credential Service — Property 14: MQTT password file consistency
    - Create `src/auth/__tests__/mqtt-credential-service.property.test.ts`
    - Generate sets of credentials (create and delete operations)
    - Assert: password file contains exactly one entry per active credential in `username:hash` format
    - **Property 14: MQTT password file consistency**
    - **Validates: Requirements 10.5**

- [x] 6. Checkpoint — Core services complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Auth Service and Auth Middleware
  - [x] 7.1 Create `src/auth/auth-service.ts` orchestrating login/setup/refresh/logout
    - Implement `needsSetup()`: check if any admin user exists in DB
    - Implement `setupAdmin(username, password)`: validate no admin exists (ConflictError if exists), validate inputs, create admin user with role "admin" and null groupId, return login result
    - Implement `login(username, password)`: lookup user, verify password (timing-safe), generate access + refresh tokens, return LoginResult
    - Implement `refresh(refreshToken)`: validate refresh token, lookup user (get current role/groupId), generate new access token
    - Implement `logout(refreshToken)`: revoke the refresh token
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.5, 2.6, 2.7_

  - [x] 7.2 Create `src/auth/auth-middleware.ts` with route protection
    - Implement `authenticate`: extract Bearer token from Authorization header, verify with TokenService, attach user context to `req.user`, return 401 if missing/invalid/expired
    - Implement `requireAdmin`: check `req.user.role === "admin"`, return 403 if not
    - Implement `requireTabPermission(level)`: extract tabId from request (param, body, or resource lookup), check permission via PermissionService, admin always passes, return 403 if insufficient
    - Implement `setupGuard`: skip auth if `needsSetup()` is true, otherwise require auth
    - Define public routes list: `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/setup`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 7.3 Write unit tests for auth middleware
    - Create `src/auth/__tests__/auth-middleware.test.ts`
    - Test: missing token → 401, invalid token → 401, expired token → 401
    - Test: valid token attaches user context
    - Test: non-admin on admin endpoint → 403
    - Test: admin bypasses tab permission checks
    - Test: public routes pass without token
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 8. Implement Auth API Routes
  - [x] 8.1 Create `src/api/routes/auth.routes.ts` with auth endpoints
    - `POST /api/auth/setup`: setupGuard, validate body (username non-empty, password ≥ 8), call authService.setupAdmin, return tokens + set refresh cookie
    - `POST /api/auth/login`: validate body, call authService.login, return access token + set refresh cookie (HttpOnly, SameSite=Strict, Path=/api/auth, Max-Age=604800)
    - `POST /api/auth/refresh`: read refresh token from cookie, call authService.refresh, return new access token + new refresh cookie
    - `POST /api/auth/logout`: read refresh token from cookie, call authService.logout, clear cookie
    - `PUT /api/auth/password`: authenticate, validate body (currentPassword, newPassword ≥ 8), call userService.changePassword
    - `GET /api/auth/me`: authenticate, return current user info + accessible tabs
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.5, 2.6, 2.7, 12.1, 12.2, 12.3, 12.4, 14.6_

  - [x] 8.2 Add user management endpoints to auth routes
    - `GET /api/auth/users`: authenticate + requireAdmin, call userService.listUsers
    - `POST /api/auth/users`: authenticate + requireAdmin, validate body (username, password ≥ 8, groupId), call userService.createUser
    - `PUT /api/auth/users/:id`: authenticate + requireAdmin, validate body, call userService.updateUser
    - `DELETE /api/auth/users/:id`: authenticate + requireAdmin, call userService.deleteUser
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 8.3 Add group management endpoints to auth routes
    - `GET /api/auth/groups`: authenticate + requireAdmin, call groupService.listGroups
    - `POST /api/auth/groups`: authenticate + requireAdmin, validate body (name, tabAssignments with tabId + permission level), call groupService.createGroup
    - `PUT /api/auth/groups/:id`: authenticate + requireAdmin, validate body, call groupService.updateGroup
    - `DELETE /api/auth/groups/:id`: authenticate + requireAdmin, call groupService.deleteGroup
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 8.4 Add MQTT credential endpoints to auth routes
    - `GET /api/auth/mqtt-credentials`: authenticate + requireAdmin, call mqttCredentialService.listCredentials
    - `POST /api/auth/mqtt-credentials`: authenticate + requireAdmin, validate body (deviceName), call mqttCredentialService.createCredential
    - `DELETE /api/auth/mqtt-credentials/:id`: authenticate + requireAdmin, call mqttCredentialService.deleteCredential
    - _Requirements: 10.1, 10.2, 10.3, 9.4_

  - [x] 8.5 Create Zod validation schemas for auth routes
    - Create `src/api/schemas/auth.schemas.ts`
    - Define schemas: setupSchema, loginSchema, passwordChangeSchema, createUserSchema, updateUserSchema, createGroupSchema, updateGroupSchema, createMqttCredentialSchema
    - Validate permission levels as enum: "read" | "interact" | "write"
    - Apply `validate()` middleware on all POST/PUT routes
    - _Requirements: 1.5, 12.4, 14.1_

  - [x] 8.6 Add login rate limiter
    - Create dedicated rate limiter for `POST /api/auth/login`: 5 requests per minute per IP
    - Return HTTP 429 with Retry-After header when exceeded
    - Operate independently from the existing global rate limiter
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 8.7 Write integration tests for auth API routes
    - Create `src/auth/__tests__/auth.routes.test.ts`
    - Use supertest with in-memory database
    - Test: setup flow, login success/failure, refresh, logout, password change
    - Test: user CRUD (admin only), group CRUD (admin only), MQTT credential CRUD
    - Test: rate limiting (6th request within 1 minute → 429)
    - Test: cookie attributes (HttpOnly, SameSite=Strict)
    - _Requirements: 1.1–1.6, 2.1–2.7, 6.1–6.7, 7.1–7.7, 10.1–10.5, 12.1–12.4, 13.1–13.3_

- [x] 9. Implement WebSocket Authentication
  - [x] 9.1 Enhance WebSocket server with token verification and event filtering
    - Modify `src/websocket/ws-server.ts` to require `token` query parameter on connection upgrade
    - Verify token using TokenService before accepting connection
    - Reject with close code 4001 if token is missing, invalid, or expired
    - Store `AuthenticatedClient` context per connection (userId, role, groupId, accessibleTabIds)
    - Filter broadcast messages: non-admin users only receive events for tabs in their group's assignment
    - Admin users receive all events
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 9.2 Write property test for WebSocket — Property 7: WebSocket event filtering by tab assignment
    - Create `src/auth/__tests__/ws-auth.property.test.ts`
    - Generate non-admin users with various tab assignments and events associated with various tabs
    - Assert: user receives event only if tab is in their assignment; admin receives all events
    - **Property 7: WebSocket event filtering by tab assignment**
    - **Validates: Requirements 4.5, 4.6**

- [x] 10. Checkpoint — Backend auth complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Frontend Auth Store and Login Page
  - [x] 11.1 Create `frontend/src/store/auth-store.ts` with Zustand
    - Define AuthState interface: accessToken, user, isAuthenticated, needsSetup
    - Implement `login(username, password)`: POST to /api/auth/login, store access token in memory (not localStorage)
    - Implement `logout()`: POST to /api/auth/logout, clear state
    - Implement `refresh()`: POST to /api/auth/refresh, update access token, return success/failure
    - Implement `setup(username, password)`: POST to /api/auth/setup, store tokens
    - Implement `checkSetupNeeded()`: GET /api/auth/me or check setup endpoint
    - Add silent refresh timer: refresh access token before expiry (e.g., at 13 minutes)
    - On refresh failure, redirect to login
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 11.2 Create Login Page component
    - Create `frontend/src/pages/LoginPage.tsx`
    - Username and password fields with form validation
    - Submit calls auth store login action
    - Display error messages on failure
    - Follow Aeolus design system: dark theme, Inter font, Aeolus Blue accent, card-based layout, centered form
    - _Requirements: 5.1, 5.2, 5.3, 5.6_

  - [x] 11.3 Create Setup Page component
    - Create `frontend/src/pages/SetupPage.tsx`
    - Username and password fields with validation (password ≥ 8 chars)
    - Welcome message explaining first-run setup
    - On success, redirect to dashboard
    - Follow Aeolus design system
    - _Requirements: 1.1, 1.4, 5.6_

  - [x] 11.4 Add auth routing guard to App
    - Modify `frontend/src/App.tsx` to check auth state on mount
    - If needsSetup → show SetupPage
    - If not authenticated → show LoginPage
    - If authenticated → show Dashboard
    - Add Authorization header to all API requests (fetch wrapper or interceptor)
    - Add token query parameter to WebSocket connection URL
    - _Requirements: 5.1, 5.4, 5.5, 4.1_

- [x] 12. Implement Frontend Permission Enforcement and User Management UI
  - [x] 12.1 Add tab filtering and permission-based UI controls
    - Filter sidebar tabs based on user's accessible tabs (from /api/auth/me response)
    - For "read" permission: disable all interactive controls (toggles, buttons, inputs)
    - For "interact" permission: enable device controls, hide editing controls (automation editor, pane management)
    - For "write" permission: enable all controls
    - Admin sees all tabs with full access
    - Hide user/group management UI for non-admin users
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.9, 9.6_

  - [x] 12.2 Create User Management UI components
    - Create `frontend/src/pages/UserManagementPage.tsx` (or section within System tab)
    - User list table: username, role, group name, created date
    - Create user form: username, password, group assignment dropdown
    - Edit user modal: change group, reset password
    - Delete user with confirmation dialog
    - _Requirements: 15.1, 15.2, 15.5_

  - [x] 12.3 Create Group Management UI components
    - Group list with visual indicator of tab assignments
    - Create group form: name field + multi-select of available tabs with permission level picker (read/interact/write)
    - Edit group modal: update name and tab assignments
    - Delete group with confirmation (warns about affected users)
    - _Requirements: 15.3, 15.4, 15.5_

- [x] 13. Application wiring — integrate auth into existing backend
  - [x] 13.1 Wire auth services into `src/index.ts` startup
    - Instantiate TokenService, UserService, GroupService, PermissionService, MqttCredentialService, AuthService after database initialization
    - Ensure backend MQTT credential exists on startup (ensureBackendCredential)
    - Mount auth routes at `/api/auth`
    - Apply authenticate middleware globally (with public route exclusions)
    - Apply requireTabPermission middleware on existing tab-scoped routes (devices, automations, etc.)
    - _Requirements: 1.1, 1.6, 3.1, 3.3, 10.4_

  - [x] 13.2 Update existing routes with permission checks
    - Add requireTabPermission to device control routes (interact level)
    - Add requireTabPermission to automation CRUD routes (write level for edit, interact for fire)
    - Add requireAdmin to connector management, service management, tab creation/deletion routes
    - Add requireTabPermission to data-store routes scoped to tabs
    - _Requirements: 3.5, 3.7, 8.5, 8.6, 8.7, 9.1, 9.2, 9.3, 9.4, 9.7_

  - [x] 13.3 Update Docker configuration for MQTT auth
    - Update `docker-compose.yml` Mosquitto service to mount the password file volume
    - Add `password_file` directive to Mosquitto config
    - Ensure backend uses its own MQTT credential for broker connection
    - _Requirements: 10.4, 10.5_

- [x] 14. Checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Create authentication documentation
  - [x] 15.1 Create `docs/AUTHENTICATION.md` with architecture diagrams and usage guide
    - Document the overall auth architecture with Mermaid diagrams (request flow, token refresh, permission model)
    - Document the permission hierarchy (write > interact > read) with examples
    - Document the first-run setup flow
    - Document API endpoints with request/response examples
    - Document MQTT credential management workflow
    - Document environment variables (JWT_SECRET)
    - Document the group/tab permission model with clear examples
    - Include troubleshooting section (token expired, locked out, reset admin)
    - _Requirements: 1.1, 2.1, 3.1, 6.1, 7.1, 8.1, 10.1, 11.1_

- [x] 16. Final checkpoint — All tests pass, documentation complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 14 universal correctness properties defined in the design
- Unit/integration tests validate specific examples, edge cases, and API behavior
- The Token Service (task 2) and User Service (task 3) have no cross-dependencies and can be built in parallel
- Group Service and Permission Service (task 4) depend on the database schema from task 1
- Auth Middleware (task 7) depends on Token Service and Permission Service
- Frontend tasks (11-12) depend on backend being complete (tasks 1-10)
- Application wiring (task 13) connects all backend pieces to the existing Express app
- The MQTT device provisioning flow is implemented as designed but may need revisiting post-MVP
- Documentation task (15) should be completed last to capture the final implementation accurately

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2", "5.2"] },
    { "id": 3, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "4.8"] },
    { "id": 4, "tasks": ["7.1", "7.2"] },
    { "id": 5, "tasks": ["7.3", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6"] },
    { "id": 6, "tasks": ["8.7", "9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 9, "tasks": ["11.4", "12.1"] },
    { "id": 10, "tasks": ["12.2", "12.3"] },
    { "id": 11, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 12, "tasks": ["15.1"] }
  ]
}
```
