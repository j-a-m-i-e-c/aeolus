# Requirements Document

## Introduction

Aeolus currently has no authentication — anyone on the network can access the API and dashboard. This feature adds a JWT-based authentication system with a group-based, tab-level permission model that protects the HTTP API, WebSocket connections, and MQTT broker. The system uses user groups where each group is assigned a set of tabs it can access. The admin is a special user created during first-run setup who bypasses all group restrictions and has full control. Authentication is always active — there is no disabled mode.

## Glossary

- **Auth_System**: The authentication subsystem within Aeolus responsible for user verification, token management, and access control
- **Auth_Middleware**: Express middleware that intercepts HTTP requests and verifies JWT tokens before allowing access to protected routes
- **Admin_User**: The first user created during setup who has full platform control, bypasses all group/tab restrictions, and manages users and groups
- **User_Group**: A named collection of tab assignments created by the admin. Each non-admin user belongs to exactly one group.
- **Tab_Assignment**: A mapping of tab IDs to permission levels ("read", "interact", or "write") within a User_Group. "Read" = view only, "interact" = can control devices and fire automations, "write" = full control including editing automation code and managing panes.
- **Access_Token**: A short-lived JWT (15 minutes) containing userId, username, role, and groupId, used to authenticate API requests
- **Refresh_Token**: A long-lived opaque random string (7 days) stored hashed in the database, used to obtain new access tokens without re-entering credentials
- **JWT_Secret**: A 256-bit cryptographic key used to sign and verify JWT access tokens
- **Setup_Screen**: A first-run UI page displayed when no admin account exists, allowing initial account creation
- **Login_Page**: The frontend page with username and password fields, shown when the user is not authenticated
- **MQTT_Credential**: A username/password pair used by devices or the backend to authenticate with the Mosquitto MQTT broker
- **Password_File**: The Mosquitto-format password file containing hashed MQTT credentials managed by Aeolus
- **Rate_Limiter**: Middleware that restricts the number of login attempts per IP address to prevent brute-force attacks
- **Pinned_Tabs**: The three built-in tabs (System, Connectors, Data) that always exist but are not inherently restricted — the admin decides which groups can see them
- **Admin_Only_Actions**: Actions that only the admin can perform regardless of tab assignment: managing users/groups, creating/deleting tabs, editing automation code, managing connectors/services

## Requirements

### Requirement 1: First-Run Admin Setup

**User Story:** As a new user, I want to be guided through creating my admin account on first launch, so that the platform is secured from the moment it starts.

#### Acceptance Criteria

1. WHEN the Auth_System starts and no Admin_User exists in the database, THE Auth_System SHALL serve the Setup_Screen on all frontend routes
2. WHEN the Setup_Screen receives a valid username and password submission, THE Auth_System SHALL hash the password using bcrypt with a cost factor of 12
3. WHEN the Setup_Screen receives a valid username and password submission, THE Auth_System SHALL store the Admin_User record in the `users` table with role "admin" and groupId null
4. WHEN the Admin_User is successfully created, THE Auth_System SHALL automatically log the user in and redirect to the dashboard
5. THE Auth_System SHALL reject setup submissions where the username is empty or the password is fewer than 8 characters
6. THE Auth_System SHALL always require authentication — there is no disabled mode or opt-out

### Requirement 2: Login Flow

**User Story:** As a user, I want to log in with my credentials and receive tokens, so that I can access the dashboard and API.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/auth/login` with valid username and password, THE Auth_System SHALL return an Access_Token and set the Refresh_Token as an httpOnly cookie
2. WHEN a POST request is made to `/api/auth/login` with invalid credentials, THE Auth_System SHALL return HTTP 401 with an error message
3. THE Auth_System SHALL generate Access_Tokens with a 15-minute expiry containing userId, username, role, and groupId claims
4. THE Auth_System SHALL generate Refresh_Tokens as opaque random strings with a 7-day expiry, stored hashed in the database
5. WHEN a POST request is made to `/api/auth/refresh` with a valid Refresh_Token cookie, THE Auth_System SHALL return a new Access_Token
6. WHEN a POST request is made to `/api/auth/refresh` with an invalid or expired Refresh_Token, THE Auth_System SHALL return HTTP 401
7. WHEN a POST request is made to `/api/auth/logout` with a valid Refresh_Token, THE Auth_System SHALL delete the Refresh_Token from the database and clear the cookie

### Requirement 3: API Route Protection

**User Story:** As the admin, I want all sensitive API routes protected by JWT verification and permission checks, so that unauthorized users cannot access resources outside their assigned tabs.

#### Acceptance Criteria

1. THE Auth_Middleware SHALL verify the `Authorization: Bearer <token>` header on all protected routes
2. WHEN the Authorization header is missing, invalid, or contains an expired token, THE Auth_Middleware SHALL return HTTP 401 Unauthorized
3. THE Auth_Middleware SHALL allow unauthenticated access to GET `/api/health`, POST `/api/auth/login`, POST `/api/auth/refresh`, and the setup endpoint
4. WHEN a valid Access_Token is provided, THE Auth_Middleware SHALL attach the decoded userId, username, role, and groupId to the request context
5. WHEN a non-admin user requests a resource belonging to a tab not assigned to the user's group, THE Auth_Middleware SHALL return HTTP 403 Forbidden
6. WHEN a user with role "admin" makes any request, THE Auth_Middleware SHALL allow the request regardless of tab assignment
7. THE Auth_Middleware SHALL restrict user management, group management, tab creation/deletion, automation code editing, connector management, and service management endpoints to admin-only access

### Requirement 4: WebSocket Authentication

**User Story:** As a user, I want WebSocket connections to require authentication, so that unauthorized clients cannot receive real-time device updates.

#### Acceptance Criteria

1. THE Auth_System SHALL require a `token` query parameter on WebSocket connection requests
2. WHEN a WebSocket connection request includes a valid Access_Token as the `token` query parameter, THE Auth_System SHALL accept the connection
3. WHEN a WebSocket connection request includes an invalid or expired token, THE Auth_System SHALL reject the connection with close code 4001
4. WHEN a WebSocket connection request has no `token` query parameter, THE Auth_System SHALL reject the connection with close code 4001
5. WHILE a non-admin user is connected via WebSocket, THE Auth_System SHALL only broadcast events relevant to tabs and devices assigned to the user's group
6. WHILE an admin user is connected via WebSocket, THE Auth_System SHALL broadcast all events regardless of tab assignment

### Requirement 5: Frontend Login Page

**User Story:** As a user, I want a login page that matches the Aeolus design system, so that I can authenticate before accessing the dashboard.

#### Acceptance Criteria

1. WHILE no valid Access_Token is held in memory, THE Login_Page SHALL be displayed instead of the dashboard
2. WHEN the user submits valid credentials on the Login_Page, THE Login_Page SHALL store the Access_Token in a JavaScript variable (not localStorage)
3. WHEN the user submits valid credentials on the Login_Page, THE Login_Page SHALL redirect to the dashboard
4. WHEN the Access_Token expires, THE Login_Page SHALL silently request a new Access_Token using the Refresh_Token cookie
5. WHEN the Refresh_Token exchange fails, THE Login_Page SHALL redirect the user to the Login_Page
6. THE Login_Page SHALL follow the Aeolus design system (dark theme, Inter font, Aeolus Blue accent, card-based layout)

### Requirement 6: User Group Management

**User Story:** As the admin, I want to create and manage user groups with per-tab read/write permissions, so that I can precisely control what each group of users can see and do.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/auth/groups` by an admin with a group name and a list of tab assignments (each with a tab ID and permission level: "read", "interact", or "write"), THE Auth_System SHALL create a new User_Group with those Tab_Assignments
2. WHEN a GET request is made to `/api/auth/groups` by an admin, THE Auth_System SHALL return a list of all User_Groups with their names and tab assignments (including permission levels)
3. WHEN a PUT request is made to `/api/auth/groups/:id` by an admin, THE Auth_System SHALL update the group name and Tab_Assignments (including permission levels)
4. WHEN a DELETE request is made to `/api/auth/groups/:id` by an admin, THE Auth_System SHALL delete the group
5. WHEN a User_Group is deleted, THE Auth_System SHALL revoke access for all users in that group until the admin reassigns them to a new group
6. THE Auth_System SHALL allow the admin to assign any tab (including Pinned_Tabs: System, Connectors, Data) to a group with either "read" or "write" permission — no tabs are hardcoded as restricted
7. WHEN a non-admin user requests any group management endpoint, THE Auth_System SHALL return HTTP 403 Forbidden

### Requirement 7: User Management

**User Story:** As the admin, I want to create and manage user accounts with group assignments, so that household members can access the platform with appropriate permissions.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/auth/users` by an admin with username, password, and groupId, THE Auth_System SHALL create a new user assigned to the specified User_Group
2. WHEN a GET request is made to `/api/auth/users` by an admin, THE Auth_System SHALL return a list of all users (username, role, groupId, createdAt — not passwords)
3. WHEN a PUT request is made to `/api/auth/users/:id` by an admin, THE Auth_System SHALL update the user's group assignment or reset the user's password
4. WHEN a DELETE request is made to `/api/auth/users/:id` by an admin, THE Auth_System SHALL delete the specified user and invalidate all their Refresh_Tokens
5. THE Auth_System SHALL prevent deletion of the last remaining Admin_User
6. WHEN a non-admin user requests any user management endpoint, THE Auth_System SHALL return HTTP 403 Forbidden
7. THE Auth_System SHALL hash new user passwords using bcrypt with a cost factor of 12

### Requirement 8: Tab-Level Access Control with Read/Interact/Write Permissions

**User Story:** As a non-admin user, I want to see only the tabs my group is assigned to with the appropriate permission level, so that I have a focused dashboard with the right level of control.

#### Acceptance Criteria

1. WHILE a non-admin user is authenticated, THE Frontend SHALL display only the tabs assigned to the user's group in the sidebar
2. WHEN a non-admin user has "read" permission on a tab, THE Frontend SHALL display the tab content in a view-only mode with all interactive controls disabled (no toggles, no buttons, no inputs — pure observation)
3. WHEN a non-admin user has "interact" permission on a tab, THE Frontend SHALL allow device control (toggles, sliders, buttons, firing automations) but hide editing controls (automation code editor, pane management, connector setup)
4. WHEN a non-admin user has "write" permission on a tab, THE Frontend SHALL allow full interaction including editing automation code, adding/removing panes, and managing connectors or settings on that tab
5. WHEN a non-admin user attempts a write API operation on a tab where they have "read" permission, THE Auth_System SHALL return HTTP 403 Forbidden
6. WHEN a non-admin user attempts a write API operation (create/edit automation, manage connector) on a tab where they have "interact" permission, THE Auth_System SHALL return HTTP 403 Forbidden
7. WHEN a non-admin user attempts a device control or automation fire operation on a tab where they have "interact" or "write" permission, THE Auth_System SHALL allow the request
8. WHEN a non-admin user requests any operation on a tab not in their group's Tab_Assignment, THE Auth_System SHALL return HTTP 403 Forbidden
9. WHILE an Admin_User is authenticated, THE Frontend SHALL display all tabs with full write access regardless of group assignments
10. WHEN a non-admin user's group is deleted or their group's Tab_Assignment changes, THE Auth_System SHALL reflect the updated permissions on the next token refresh

### Requirement 9: Admin-Only Actions

**User Story:** As the admin, I want user/group management and tab creation restricted to my account, so that non-admin users cannot alter the permission structure itself.

#### Acceptance Criteria

1. THE Auth_System SHALL restrict creating and deleting custom tabs to Admin_User only
2. THE Auth_System SHALL restrict managing users (create, edit, delete) to Admin_User only
3. THE Auth_System SHALL restrict managing groups (create, edit, delete) to Admin_User only
4. THE Auth_System SHALL restrict managing MQTT credentials to Admin_User only
5. WHEN a non-admin user attempts any of the above actions, THE Auth_System SHALL return HTTP 403 Forbidden
6. WHILE a non-admin user is authenticated, THE Frontend SHALL hide the user/group management UI and tab creation controls
7. ALL other actions (device control, automation editing, connector management, data store operations) SHALL be governed by the per-tab read/write permission level assigned to the user's group — not hardcoded as admin-only

### Requirement 10: MQTT Credential Management

**User Story:** As the admin, I want to manage MQTT credentials for my devices from the Aeolus dashboard, so that I can secure the MQTT broker without manual file editing.

#### Acceptance Criteria

1. WHEN a POST request is made to `/api/auth/mqtt-credentials` by an admin with a device name, THE Auth_System SHALL generate a username/password pair and store it in SQLite
2. WHEN a GET request is made to `/api/auth/mqtt-credentials` by an admin, THE Auth_System SHALL return a list of all device MQTT credentials (username and device name, not passwords)
3. WHEN a DELETE request is made to `/api/auth/mqtt-credentials/:id` by an admin, THE Auth_System SHALL revoke the specified credential and remove it from the Password_File
4. THE Auth_System SHALL maintain a dedicated "aeolus-backend" MQTT_Credential for the backend's own MQTT connection
5. WHEN MQTT credentials are created or revoked, THE Auth_System SHALL regenerate the Password_File in Mosquitto-compatible format

### Requirement 11: JWT Secret Management

**User Story:** As a self-hoster, I want the JWT signing secret to be managed automatically, so that I don't need to manually generate cryptographic keys.

#### Acceptance Criteria

1. WHEN the Auth_System starts for the first time and no JWT_Secret exists, THE Auth_System SHALL generate a random 256-bit key and store it in the database
2. WHEN the `JWT_SECRET` environment variable is set, THE Auth_System SHALL use the environment variable value instead of the stored key
3. WHEN the JWT_Secret changes (either via environment variable or regeneration), THE Auth_System SHALL invalidate all existing tokens (users must re-login)
4. THE Auth_System SHALL store the auto-generated JWT_Secret in the database (not in a file or hardcoded in source)

### Requirement 12: Password Change

**User Story:** As a user, I want to change my own password from the dashboard, so that I can rotate credentials without admin intervention.

#### Acceptance Criteria

1. WHEN a PUT request is made to `/api/auth/password` with a valid current password and a new password, THE Auth_System SHALL update the stored password hash using bcrypt with cost factor 12
2. WHEN a PUT request is made to `/api/auth/password` with an incorrect current password, THE Auth_System SHALL return HTTP 401
3. WHEN the password is successfully changed, THE Auth_System SHALL invalidate all existing Refresh_Tokens for that user
4. THE Auth_System SHALL reject password change requests where the new password is fewer than 8 characters

### Requirement 13: Login Rate Limiting

**User Story:** As a self-hoster, I want login attempts to be rate-limited, so that brute-force attacks are mitigated when my instance is publicly accessible.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL restrict the POST `/api/auth/login` endpoint to 5 requests per minute per IP address
2. WHEN the rate limit is exceeded, THE Rate_Limiter SHALL return HTTP 429 Too Many Requests with a Retry-After header
3. THE Rate_Limiter SHALL operate independently from the existing API rate limiter

### Requirement 14: Security Best Practices

**User Story:** As a self-hoster, I want the auth system to follow security best practices, so that my platform is protected against common attacks.

#### Acceptance Criteria

1. THE Auth_System SHALL hash all passwords using bcrypt with a minimum cost factor of 12
2. THE Auth_System SHALL sign Access_Tokens using the HS256 algorithm
3. THE Auth_System SHALL generate Refresh_Tokens as cryptographically random opaque strings (not JWTs)
4. THE Auth_System SHALL include only userId, username, role, and groupId in the Access_Token payload (no sensitive data such as passwords or secrets)
5. THE Auth_System SHALL store Refresh_Tokens as hashed values in the database (not plaintext)
6. THE Auth_System SHALL return the Refresh_Token in an httpOnly cookie with SameSite=Strict attribute

### Requirement 15: Frontend User Management UI

**User Story:** As the admin, I want a UI to manage users and groups with tab assignments, so that I can administer access control without using the API directly.

#### Acceptance Criteria

1. WHILE an Admin_User is authenticated, THE Frontend SHALL display a "Users" management section accessible from the System tab or a dedicated settings area
2. THE Frontend SHALL provide forms to create, edit, and delete users with username, password, and group assignment fields
3. THE Frontend SHALL provide forms to create, edit, and delete User_Groups with a name field and a multi-select of available tabs for Tab_Assignment
4. THE Frontend SHALL display a visual indicator showing which tabs each group can access
5. THE Frontend SHALL follow the Aeolus design system (dark theme, Inter font, Aeolus Blue accent, card-based layout)
6. WHEN a non-admin user is authenticated, THE Frontend SHALL hide the user management section entirely
