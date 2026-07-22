# Requirements Document

## Introduction

Aeolus is a local-first IoT/automation platform for small, mostly-trusted deployments (a household, farm, or single site). It advertises a permission model built on tabs, groups, and roles, where a user's group is granted a permission level (`read`, `interact`, or `write`) on each tab.

The current permission middleware (`requireTabPermission`) authorizes against a tab identifier taken directly from the request (`req.params.tabId || req.body?.tabId || req.query.tabId`) rather than against the target resource. As a result, a non-admin user who holds `interact` (or higher) on **any** tab can supply that tab's identifier while targeting a device or automation that belongs to a **different** protected tab, bypassing the intended authorization boundary. This affects device actions, manual automation firing, automation enable/disable, and automation state writes.

This feature replaces caller-supplied-tab authorization with **resource-level authorization**. The system resolves which tabs expose a resource on the server side, using a mechanism chosen by resource kind because devices and automations are referenced differently in the dashboard layout. Automations are referenced by explicit rule identifier in a pane's configuration, so automation exposure is persisted as an explicit server-side ownership mapping (`automation_tab_assignments`). Devices are referenced by device-selection filter carried by purposeful connector/type-scoped panes (for example Hue lights via `hue-control`, Kasa devices via `kasa-control`, or sensors via `sensor-panel`), optionally narrowed by device type, rather than by explicit identifier, so device exposure is computed live at evaluation time from the current panes and their filters against the current device inventory, with no stored assignment. Only purposeful device panes contribute to device exposure; every other pane type is non-exposing by default, including the `device-grid` ("all devices") pane (which is being removed from the product) and any unknown or legacy pane type. Two new middleware components — `requireDevicePermission()` and `requireAutomationPermission()` — load the target resource server-side by its own identifier, resolve which tabs expose it, compute the requesting user's effective permission across those tabs, and reject the request when the user's permission is insufficient. The authorization decision is derived entirely from server-side resource identity and never from a caller-supplied tab identifier.

**Threat model context:** The target is small local-first deployments with a handful of mostly-trusted users, not a large multi-tenant public SaaS. The goal is to make the advertised authorization model actually hold, prevent accidental cross-tab/cross-user exposure, and prevent truthfulness violations. Priorities are correctness of the advertised authorization model first, hardening against determined insiders second.

**In scope:**
- Server-side automation ownership model persisted in `automation_tab_assignments`.
- Live, server-side resolution of device exposure from the current panes' device-selection filters against the current device inventory, with no persisted device assignment.
- New permission-resolving middleware (`requireDevicePermission`, `requireAutomationPermission`) applied to device actions, manual automation firing, automation enable/disable, and automation state writes.
- Effective permission computation when a resource is exposed by multiple tabs.
- Read-level filtering of device listing and detail reads by resource-level permission.
- One-time migration/backfill of existing automations into the `automation_tab_assignments` table (devices need no backfill because their exposure is computed live).
- Defined behavior for resources exposed by no tab, and for admin users.

**Scope note (device exposure and device-grid):** Device exposure derives solely from purposeful, scoped device panes (`hue-control`, `kasa-control`, `sensor-panel`). Any non-purposeful pane grants no device access to non-admin users; this includes the `device-grid` ("all devices") pane, which is slated for removal from the product, as well as any unknown or legacy pane type. A consequence is that a plain device shown only via a non-purposeful pane has no non-admin exposure path and fails closed until it is placed in a purposeful pane or driven through an automation — a deliberate outcome consistent with the platform's tailored-interface model. The actual removal of `device-grid` from the frontend/product is a separate, out-of-scope change; because the backend exposure model already grants nothing through non-purposeful panes, the security boundary established here does not depend on that removal.

**Out of scope (dependent items that build on this ownership foundation):**
- Raw MQTT publish namespace confinement (`POST /api/mqtt/publish`) — a separate critical backlog item. This feature does not change the MQTT publish authorization, but the resource ownership model introduced here is a prerequisite.
- WebSocket fail-closed visibility filtering — a separate critical backlog item.
- Adversarial end-to-end tests with a real non-admin user — blocked on and enabled by this work.

**Related resolution:** The "Frontend/backend permission alignment" backlog item is expected to resolve as a side effect: once authorization is derived from resource identity, ordinary non-admin UI calls no longer need to supply a tab identifier to succeed, and hand-crafted requests can no longer pass by supplying an unrelated permitted tab.

## Glossary

- **Aeolus**: The local-first IoT/automation platform being secured.
- **Permission_Level**: One of `read`, `interact`, or `write`, ordered `read` < `interact` < `write`. A higher level satisfies any requirement for a lower level.
- **User**: An authenticated principal with a role (`admin` or `user`) and an optional group.
- **Admin**: A User whose role is `admin`.
- **Group**: A named collection of Users. A User belongs to at most one Group. Permissions are assigned to Groups, not individual Users.
- **Tab**: A dashboard surface (row in the `tabs` table). A Group is granted a Permission_Level on a Tab via `group_tab_assignments`.
- **Device**: A controllable resource (row in the `devices` table) identified by its own device identifier. All Devices share one model regardless of source (MQTT devices and connector devices such as Hue and Kasa), distinguished only by an `integration` field.
- **Automation**: An automation rule (row in the `automation_rules` table) identified by its own rule identifier.
- **Target_Resource**: The specific Device or Automation identified by the request path parameter of a protected route.
- **Device_Selection_Filter**: The scoped device-selection criteria carried by a purposeful device Pane — that is, a connector/type control Pane such as `hue-control` (Hue lights), `kasa-control` (Kasa devices), or `sensor-panel` (sensors) — expressed as the Devices within that Pane's connector/type scope, optionally narrowed by device type, rather than as an explicit device identifier. A Device_Selection_Filter never denotes "all Devices". The `device-grid` ("all devices") Pane is being removed from the product and, like any non-purposeful Pane, does NOT carry a Device_Selection_Filter and does NOT contribute to any Device's Exposing_Tabs.
- **Device_Inventory**: The current set of Devices in the `devices` table at the moment of an authorization or read evaluation.
- **Automation_Tab_Assignment**: A record in `automation_tab_assignments` stating that a given Tab exposes a given Automation, derived from an explicit `config.ruleId` reference in a Pane on that Tab.
- **Exposing_Tabs**: The set of Tabs that expose a given Target_Resource, resolved per resource kind: for an Automation, the Tabs recorded in `automation_tab_assignments`; for a Device, the Tabs computed live by the Device_Exposure_Resolver.
- **Resource_Ownership_Store**: The server-side component that persists and reads the `automation_tab_assignments` table and resolves the Exposing_Tabs for an Automation.
- **Device_Exposure_Resolver**: The server-side component that computes a Device's Exposing_Tabs live at evaluation time by matching each Tab's Panes' Device_Selection_Filters against the current Device_Inventory, without reading or writing any persisted device assignment.
- **Permission_Resolver**: The server-side component that computes a User's Effective_Permission for a Target_Resource.
- **Effective_Permission**: The most permissive Permission_Level the User's Group holds across the Target_Resource's Exposing_Tabs; `none` if the User's Group holds no permission on any Exposing_Tab.
- **Authorization_Middleware**: The `requireDevicePermission` and `requireAutomationPermission` middleware components that gate protected routes.
- **Migration_Backfill**: The one-time process that populates the `automation_tab_assignments` table from the existing pane-to-tab layout before enforcement begins.
- **Pane**: A dashboard widget (row in the `panes` table) that belongs to a Tab. A Pane may reference an Automation by an explicit `config.ruleId` identifier, or reference Devices by a Device_Selection_Filter in its configuration.

## Requirements

### Requirement 1: Server-side automation ownership persistence

**User Story:** As a platform operator, I want the system to record which tabs expose which automations in a dedicated server-side table, so that automation authorization decisions can be based on resource identity rather than caller-supplied input.

#### Acceptance Criteria

1. THE Resource_Ownership_Store SHALL persist Automation_Tab_Assignment records in an `automation_tab_assignments` table that associates an automation rule identifier with a tab identifier.
2. THE `automation_tab_assignments` table SHALL enforce uniqueness of each (automation rule identifier, tab identifier) pair.
3. WHEN a Tab is deleted, THE Resource_Ownership_Store SHALL remove all Automation_Tab_Assignment records that reference the deleted Tab.
4. WHEN an Automation is deleted, THE Resource_Ownership_Store SHALL remove all Automation_Tab_Assignment records that reference the deleted Automation.
5. WHEN queried for an Automation rule identifier, THE Resource_Ownership_Store SHALL return the set of Exposing_Tabs recorded for that Automation.

### Requirement 2: Live device exposure resolution

**User Story:** As a security reviewer, I want a device's exposing tabs computed live from the current dashboard panes and the current device inventory, so that device authorization always reflects reality without any persisted assignment that could go stale.

#### Acceptance Criteria

1. WHEN the Device_Exposure_Resolver resolves the Exposing_Tabs for a Device, THE Device_Exposure_Resolver SHALL derive device exposure solely from purposeful device Panes (`hue-control`, `kasa-control`, or `sensor-panel`) and SHALL include a Tab if and only if that Tab has at least one purposeful device Pane whose Device_Selection_Filter resolves to include that Device.
2. WHEN the Device_Exposure_Resolver resolves the Exposing_Tabs for a Device, THE Device_Exposure_Resolver SHALL evaluate each purposeful device Pane's Device_Selection_Filter against the Device_Inventory as it exists at the moment of the evaluation.
3. WHEN a Device that matches an existing Tab's purposeful device Pane Device_Selection_Filter is added to the Device_Inventory, THE Device_Exposure_Resolver SHALL include that Tab in the Device's Exposing_Tabs on the next evaluation without any persisted assignment record and without any administrative action.
4. WHERE a Pane is not a purposeful device Pane, THE Device_Exposure_Resolver SHALL treat that Pane as contributing no device exposure and SHALL NOT contribute that Pane's Tab to any Device's Exposing_Tabs on the basis of that Pane, and this SHALL apply to the `device-grid` Pane (which is being removed from the product) and to any unknown or legacy Pane type, regardless of that Pane's configuration.
5. WHERE a Device is included by no purposeful device Pane's Device_Selection_Filter on any Tab, THE Device_Exposure_Resolver SHALL return an empty set of Exposing_Tabs for that Device, regardless of any non-purposeful Pane (including a legacy `device-grid` Pane) that might display that Device.
6. THE Device_Exposure_Resolver SHALL resolve a Device's Exposing_Tabs solely from the Device identity, the current purposeful device Panes and their Device_Selection_Filters, and the current Device_Inventory, and SHALL NOT read any tab identifier from the request parameters, body, or query.

### Requirement 3: Effective permission computation across tabs

**User Story:** As a security reviewer, I want a user's permission on a resource computed server-side from all tabs that expose that resource, so that multi-tab exposure produces a well-defined and predictable authorization result.

#### Acceptance Criteria

1. WHEN the Permission_Resolver computes Effective_Permission for a User and a Target_Resource, THE Permission_Resolver SHALL evaluate only the Target_Resource's Exposing_Tabs, resolved server-side by the Resource_Ownership_Store when the Target_Resource is an Automation or by the Device_Exposure_Resolver when the Target_Resource is a Device.
2. WHEN a Target_Resource is exposed by multiple Exposing_Tabs on which the User's Group holds different Permission_Levels, THE Permission_Resolver SHALL return the most permissive of those Permission_Levels as the Effective_Permission.
3. IF the User's Group holds no Permission_Level on any of the Target_Resource's Exposing_Tabs, THEN THE Permission_Resolver SHALL return an Effective_Permission of `none`.
4. IF the User has no Group, THEN THE Permission_Resolver SHALL return an Effective_Permission of `none`.
5. THE Permission_Resolver SHALL derive Effective_Permission solely from the Target_Resource identity and the User's server-side Group assignments, and SHALL NOT read any tab identifier from the request parameters, body, or query.

### Requirement 4: Device-level authorization middleware

**User Story:** As a security reviewer, I want device action requests authorized against the target device's server-side ownership, so that holding permission on an unrelated tab cannot authorize actions on a device the user is not entitled to operate.

#### Acceptance Criteria

1. THE Authorization_Middleware SHALL provide a `requireDevicePermission` component that accepts a required Permission_Level and returns a route handler.
2. WHEN a request reaches a route guarded by `requireDevicePermission`, THE Authorization_Middleware SHALL read the Target_Resource device identifier from the request path parameter.
3. WHEN authorizing a device request, THE Authorization_Middleware SHALL resolve the device's Exposing_Tabs live using the Device_Exposure_Resolver and compute the User's Effective_Permission using the Permission_Resolver.
4. IF the target device does not exist, THEN THE Authorization_Middleware SHALL reject the request with HTTP status 404 before evaluating the User's Effective_Permission.
5. IF the target device exists AND the computed Effective_Permission is at least the required Permission_Level, THEN THE Authorization_Middleware SHALL allow the request to proceed to the route handler.
6. IF the target device exists AND the computed Effective_Permission is below the required Permission_Level, THEN THE Authorization_Middleware SHALL reject the request with HTTP status 403.
7. THE Authorization_Middleware SHALL apply `requireDevicePermission` with a required Permission_Level of `interact` to the device action route (`POST /api/devices/:id/action`).
8. THE Authorization_Middleware SHALL determine device authorization without reading any tab identifier from the request parameters, body, or query.

### Requirement 5: Automation-level authorization middleware

**User Story:** As a security reviewer, I want automation firing, enable/disable, and state-write requests authorized against the target automation's server-side ownership, so that holding permission on an unrelated tab cannot authorize operations on an automation the user is not entitled to control.

#### Acceptance Criteria

1. THE Authorization_Middleware SHALL provide a `requireAutomationPermission` component that accepts a required Permission_Level and returns a route handler.
2. WHEN a request reaches a route guarded by `requireAutomationPermission`, THE Authorization_Middleware SHALL read the Target_Resource automation rule identifier from the request path parameter.
3. WHEN authorizing an automation request, THE Authorization_Middleware SHALL resolve the automation's Exposing_Tabs and compute the User's Effective_Permission using the Permission_Resolver.
4. IF the target automation does not exist, THEN THE Authorization_Middleware SHALL reject the request with HTTP status 404 before evaluating the User's Effective_Permission.
5. IF the target automation exists AND the computed Effective_Permission is at least the required Permission_Level, THEN THE Authorization_Middleware SHALL allow the request to proceed to the route handler.
6. IF the target automation exists AND the computed Effective_Permission is below the required Permission_Level, THEN THE Authorization_Middleware SHALL reject the request with HTTP status 403.
7. THE Authorization_Middleware SHALL apply `requireAutomationPermission` with a required Permission_Level of `interact` to the manual automation firing route (`POST /api/automations/:id/fire`).
8. THE Authorization_Middleware SHALL apply `requireAutomationPermission` with a required Permission_Level of `write` to the automation enable/disable route (`PATCH /api/automations/:id/toggle`).
9. THE Authorization_Middleware SHALL apply `requireAutomationPermission` with a required Permission_Level of `interact` to the automation state-write routes (`PUT /api/automations/:id/state` and `DELETE /api/automations/:id/state/:key`).
10. THE Authorization_Middleware SHALL determine automation authorization without reading any tab identifier from the request parameters, body, or query.

### Requirement 6: Fail-closed handling of unexposed resources

**User Story:** As a security reviewer, I want a resource that no tab exposes to be inaccessible to non-admin users, so that an unexposed resource cannot be operated by a user who happens to hold permission on some other tab.

#### Acceptance Criteria

1. IF a non-admin User targets a Device or Automation that has no Exposing_Tabs, THEN THE Authorization_Middleware SHALL reject the request with HTTP status 403.
2. WHEN the Authorization_Middleware rejects a request because the Target_Resource has no Exposing_Tabs, THE Authorization_Middleware SHALL record a log entry identifying the User and the Target_Resource identifier.

### Requirement 7: Admin authorization handling

**User Story:** As an administrator, I want to retain full access to all devices and automations regardless of tab assignments, so that I can operate and recover the system without being blocked by resource ownership mappings.

#### Acceptance Criteria

1. WHEN a User whose role is `admin` targets a Device or Automation, THE Authorization_Middleware SHALL allow the request to proceed regardless of the Target_Resource's Exposing_Tabs and regardless of whether the Target_Resource exists.
2. WHEN an Admin request is authorized, THE Authorization_Middleware SHALL grant access without computing an Effective_Permission from Exposing_Tabs, without querying the Resource_Ownership_Store, and without invoking the Device_Exposure_Resolver.
3. IF an Admin targets a Device or Automation that does not exist, THEN THE route handler SHALL return HTTP status 404 after the request has been authorized by the Authorization_Middleware.

### Requirement 8: Migration and backfill of existing automations

**User Story:** As a platform operator upgrading an existing deployment, I want current automations mapped into the `automation_tab_assignments` table based on the existing dashboard layout, so that resource-level authorization does not lock users out of automations they legitimately used before the upgrade.

#### Acceptance Criteria

1. THE Migration_Backfill SHALL create the `automation_tab_assignments` table if it does not already exist.
2. WHEN the Migration_Backfill runs, THE Migration_Backfill SHALL create an Automation_Tab_Assignment for each Automation referenced by a Pane's `config.ruleId`, associating that Automation with the Tab that owns the referencing Pane.
3. IF an Automation is referenced by Panes on multiple Tabs, THEN THE Migration_Backfill SHALL create one Automation_Tab_Assignment per distinct owning Tab.
4. WHEN the Migration_Backfill encounters a Pane whose `config.ruleId` references an Automation that no longer exists, THE Migration_Backfill SHALL skip that reference without creating an Automation_Tab_Assignment.
5. WHEN the Migration_Backfill has already been applied to a database, THE Migration_Backfill SHALL NOT create duplicate Automation_Tab_Assignment records on subsequent runs.
6. THE Migration_Backfill SHALL NOT create or require any persisted device assignment, because Device exposure is computed live by the Device_Exposure_Resolver.

### Requirement 9: Automation assignment maintenance during layout changes

**User Story:** As a platform operator, I want automation-to-tab assignments to stay consistent when the dashboard layout changes, so that automation authorization reflects the current set of tabs that expose each automation.

#### Acceptance Criteria

1. WHEN the dashboard layout is replaced through the layout persistence endpoint, THE Resource_Ownership_Store SHALL update Automation_Tab_Assignment records to match the Automation references (`config.ruleId`) in the new set of Panes.
2. WHEN a Pane that references an Automation is removed from a Tab and no other Pane on that Tab references the same Automation, THE Resource_Ownership_Store SHALL ensure that no Automation_Tab_Assignment for that (Automation, Tab) pair exists afterward.
3. WHEN a Pane that references an Automation is added to a Tab AND no Automation_Tab_Assignment for that (Automation, Tab) pair already exists, THE Resource_Ownership_Store SHALL create the corresponding Automation_Tab_Assignment record.
4. WHEN a Pane that references an Automation is added to a Tab AND an Automation_Tab_Assignment for that (Automation, Tab) pair already exists, THE Resource_Ownership_Store SHALL leave the existing Automation_Tab_Assignment record unchanged.
5. THE Resource_Ownership_Store SHALL NOT create, update, or remove any persisted device assignment during a layout change, because Device exposure is computed live by the Device_Exposure_Resolver and requires no maintenance.

### Requirement 10: Read-level authorization for device and automation visibility

**User Story:** As a security reviewer, I want device and automation listing and detail reads filtered by resource-level permission, so that a non-admin user only sees and inspects devices and automations exposed by tabs on which the user's group holds at least read permission.

#### Acceptance Criteria

1. WHEN a non-admin User requests the device listing route (`GET /api/devices`), THE Aeolus API SHALL return only Devices for which the User's Effective_Permission, computed with Exposing_Tabs resolved live by the Device_Exposure_Resolver, is at least `read`.
2. WHEN a non-admin User requests the device detail route (`GET /api/devices/:id`) for a Device that does not exist, THE Aeolus API SHALL respond with HTTP status 404 before evaluating the User's Effective_Permission.
3. WHEN a non-admin User requests the device detail route (`GET /api/devices/:id`) for a Device that exists AND whose Effective_Permission for the User is below `read`, THE Aeolus API SHALL reject the request with HTTP status 403.
4. WHEN an Admin requests the device listing route (`GET /api/devices`), THE Aeolus API SHALL return all Devices.
5. WHEN a non-admin User requests the automation listing route (`GET /api/automations`), THE Aeolus API SHALL return only Automations for which the User's Effective_Permission is at least `read`.
6. WHEN a non-admin User requests an automation detail-read route (`GET /api/automations/:id/state` or `GET /api/automations/:id/ui-module`) for an Automation that does not exist, THE Aeolus API SHALL respond with HTTP status 404 before evaluating the User's Effective_Permission.
7. WHEN a non-admin User requests an automation detail-read route (`GET /api/automations/:id/state` or `GET /api/automations/:id/ui-module`) for an Automation that exists AND whose Effective_Permission for the User is below `read`, THE Aeolus API SHALL reject the request with HTTP status 403.
8. WHEN an Admin requests the automation listing route (`GET /api/automations`), THE Aeolus API SHALL return all Automations.

### Requirement 11: No regression for unaffected access paths

**User Story:** As an existing user, I want admin configuration flows and legitimate in-scope non-admin actions to keep working after the authorization change, so that tightening resource-level authorization does not break legitimate existing behavior.

#### Acceptance Criteria

1. THE Aeolus API SHALL continue to gate destructive device history routes (`DELETE /api/devices/:id/history` and `DELETE /api/devices/history/all`) behind an `admin` role, and SHALL NOT apply resource-level permission checks in addition to the `admin` role requirement.
2. WHEN a non-admin User with sufficient Effective_Permission on a Target_Resource's Exposing_Tabs issues an in-scope request without supplying any tab identifier, THE Authorization_Middleware SHALL allow the request to proceed.
