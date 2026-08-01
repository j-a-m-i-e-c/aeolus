# Requirements Document

## Introduction

Aeolus is a local-first IoT/automation platform for small, mostly-trusted deployments. It has an `admin` role and a `user` role. The very first admin is created through the first-run setup flow (`POST /api/auth/setup`). After that, admins can create and manage users through `POST /api/auth/users`, `PUT /api/auth/users/:id`, and `DELETE /api/auth/users/:id` — but every user created through those routes is forced to the `user` role (`createUser()` hardcodes `role = 'user'`), and there is no way to change an existing user's role (`updateUser()` only touches group and password). The result is that a deployment can have exactly one admin, ever, and that admin cannot be replaced without direct database editing.

This is a problem in practice. Admin authority is required for legitimate operation — connector management, MQTT credentials, layout editing, user management, and (per the related `scoped-automation-authoring` feature) unrestricted automation authoring. A single-admin installation has no redundancy: if the sole admin account is lost, the deployment is unrecoverable through the product, and there is no way to share administrative duties across trusted operators.

This feature lets an admin create additional admin users and change an existing user's role in both directions (promote a `user` to `admin`, demote an `admin` to `user`), while protecting the installation from removing its last remaining admin. The existing "cannot delete the last admin" protection is extended to cover demotion as well.

**Threat model context:** The target is small local-first deployments with a handful of mostly-trusted users. Admin is a trusted, powerful role; this feature is about letting a trusted operator delegate or share that role safely, not about fine-grained privilege partitioning. All user-management routes are, and remain, admin-only.

**In scope:**
- Creating a new user with an explicitly chosen role (`admin` or `user`) via `POST /api/auth/users`.
- Changing an existing user's role via `PUT /api/auth/users/:id`, in either direction.
- A "last admin" safeguard that prevents demoting or deleting the final remaining admin.
- Request-body validation for the new `role` field on the create and update schemas.
- A frontend control in the existing user-management UI to set a new user's role and to change an existing user's role, shown only to admins.

**Out of scope:**
- The scoped automation authoring model and any non-admin authoring capability (separate `scoped-automation-authoring` feature).
- Group-based permissions, tab assignments, or any change to the `read`/`interact`/`write` model.
- Self-service role changes by non-admins, invitations, email flows, SSO, or multi-factor auth.
- Any change to the first-run setup flow.
- Audit-log persistence beyond the existing application logging.

## Glossary

- **Aeolus**: The local-first IoT/automation platform being extended.
- **User**: An authenticated principal with a unique username, a hashed password, a role, and an optional group.
- **Role**: One of `admin` or `user`.
- **Admin**: A User whose Role is `admin`. Admins bypass tab-permission checks and may perform system-wide administration, including user management.
- **Non_Admin_User**: A User whose Role is `user`.
- **Requesting_Admin**: The authenticated Admin making a user-management request.
- **Target_User**: The User that a user-management request creates or modifies, identified for update/delete by the `:id` path parameter.
- **Last_Admin**: The state in which exactly one User in the system has the Role `admin`.
- **Promotion**: Changing a Target_User's Role from `user` to `admin`.
- **Demotion**: Changing a Target_User's Role from `admin` to `user`.
- **User_Management_Routes**: `GET/POST /api/auth/users` and `PUT/DELETE /api/auth/users/:id`, all gated by the `admin` role.

## Requirements

### Requirement 1: Create a user with an explicit role

**User Story:** As an admin, I want to create a new user as either an admin or an ordinary user, so that I can add additional administrators without editing the database directly.

#### Acceptance Criteria

1. WHEN a Requesting_Admin submits a create-user request with a `role` of `admin` or `user`, THE Aeolus API SHALL create the Target_User with the submitted Role.
2. IF a create-user request omits the `role` field, THEN THE Aeolus API SHALL create the Target_User with the Role `user`.
3. IF a create-user request supplies a `role` value other than `admin` or `user`, THEN THE Aeolus API SHALL reject the request with HTTP status 400 and SHALL NOT create a User.
4. WHEN THE Aeolus API creates a Target_User, THE Aeolus API SHALL store the password only as a hash and SHALL NOT return the password or password hash in the response.
5. IF a create-user request supplies a username that already exists, THEN THE Aeolus API SHALL reject the request with HTTP status 409 and SHALL NOT create a User.
6. THE Aeolus API SHALL restrict the create-user route to Admins, rejecting a Non_Admin_User with HTTP status 403.

### Requirement 2: Change an existing user's role

**User Story:** As an admin, I want to promote a user to admin or demote an admin to a user, so that I can adjust who holds administrative authority as trust and responsibilities change.

#### Acceptance Criteria

1. WHEN a Requesting_Admin submits an update-user request with a `role` of `admin` for a Target_User whose current Role is `user`, THE Aeolus API SHALL change the Target_User's Role to `admin` (Promotion).
2. WHEN a Requesting_Admin submits an update-user request with a `role` of `user` for a Target_User whose current Role is `admin`, THE Aeolus API SHALL change the Target_User's Role to `user` (Demotion), subject to the Last_Admin safeguard in Requirement 3.
3. IF an update-user request omits the `role` field, THEN THE Aeolus API SHALL leave the Target_User's Role unchanged and SHALL apply any other submitted updates (group, password) as it does today.
4. IF an update-user request supplies a `role` value other than `admin` or `user`, THEN THE Aeolus API SHALL reject the request with HTTP status 400 and SHALL NOT modify the Target_User.
5. IF an update-user request targets a User that does not exist, THEN THE Aeolus API SHALL respond with HTTP status 404.
6. THE Aeolus API SHALL restrict the update-user route to Admins, rejecting a Non_Admin_User with HTTP status 403.
7. WHEN THE Aeolus API changes a Target_User's Role, THE Aeolus API SHALL NOT return the password or password hash in the response.

### Requirement 3: Protect the last admin

**User Story:** As an operator, I want the system to prevent removing the last administrator, so that a deployment can never be left with no one able to administer it.

#### Acceptance Criteria

1. IF a Requesting_Admin attempts to demote a Target_User whose current Role is `admin` AND that Target_User is the Last_Admin, THEN THE Aeolus API SHALL reject the request with HTTP status 409 and SHALL leave the Target_User's Role as `admin`.
2. IF a Requesting_Admin attempts to delete a Target_User whose current Role is `admin` AND that Target_User is the Last_Admin, THEN THE Aeolus API SHALL reject the request with HTTP status 409 and SHALL NOT delete the Target_User.
3. WHEN more than one User holds the Role `admin`, THE Aeolus API SHALL allow demoting or deleting any one of them, leaving at least one Admin.
4. WHEN THE Aeolus API evaluates the Last_Admin safeguard, THE Aeolus API SHALL count the current number of Users with the Role `admin` at the time the request is processed.

### Requirement 4: Frontend role management for admins

**User Story:** As an admin using the dashboard, I want to set a new user's role and change an existing user's role from the user-management UI, so that I can manage administrators without crafting API requests by hand.

#### Acceptance Criteria

1. WHEN a Requesting_Admin creates a User through the user-management UI, THE frontend SHALL let the Requesting_Admin choose the new User's Role as `admin` or `user`.
2. WHEN a Requesting_Admin views the list of Users in the user-management UI, THE frontend SHALL display each User's current Role.
3. WHEN a Requesting_Admin changes a User's Role through the user-management UI, THE frontend SHALL send the change to the update-user route and reflect the updated Role on success.
4. WHEN the update-user or delete-user request is rejected by the Last_Admin safeguard (HTTP 409), THE frontend SHALL surface an error message and SHALL leave the displayed Role unchanged.
5. THE frontend SHALL present role-management controls only to Admins.

### Requirement 5: No regression for existing user-management behavior

**User Story:** As an existing operator, I want current user-management flows to keep working, so that adding role management does not break creating ordinary users, changing groups, or changing passwords.

#### Acceptance Criteria

1. WHEN a Requesting_Admin creates a User without specifying a `role`, THE Aeolus API SHALL behave as it does today, creating a `user`-role User with the submitted username, password, and group.
2. WHEN a Requesting_Admin updates a User's group or password without specifying a `role`, THE Aeolus API SHALL apply those updates without changing the Role.
3. THE Aeolus API SHALL continue to enforce the existing minimum password length on user creation and password updates.
4. THE Aeolus API SHALL continue to restrict all User_Management_Routes to Admins.
