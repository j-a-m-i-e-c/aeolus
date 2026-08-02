# Requirements Document

## Introduction

Aeolus is a local-first IoT/automation platform for small, mostly-trusted
deployments (a household, farm, or single site). It advertises a permission
model built on tabs, groups, and roles, where a user's group is granted a
permission level (`read`, `interact`, or `write`) on each tab.

The `resource-level-authorization` feature made the **core** device and
automation surfaces enforce that model server-side: `GET /api/devices`,
`GET /api/devices/:id`, `GET /api/automations`, and the device/automation
mutation routes now resolve a resource's exposing tabs on the server and compute
the user's effective permission, never trusting a caller-supplied tab
identifier. It also made the **live** WebSocket broadcast path fail-closed, so a
non-admin only receives device/automation/data-store events for resources their
tabs expose.

Several **adjacent read surfaces were left on the old, unfiltered path** and now
contradict the documented model (`docs/security/permissions.md`). They disclose
out-of-scope resources to any authenticated user:

1. `GET /api/state` returns the full device registry (`registry.getAll()`) to
   every authenticated user, unfiltered.
2. The initial WebSocket `snapshot` message sends every registered device to
   every client. Live device updates are already scoped, so the snapshot and the
   live stream disagree — a client can learn about devices from the snapshot that
   it will never receive live updates for.
3. `GET /api/devices/:id/actions` returns a device's action catalog with only an
   existence check, no read-permission check.
4. `GET /api/devices/:id/completion-tiers` reports a device's capability ceiling
   with no read-permission check.
5. `GET /api/devices/:id/history` returns a device's state history with an
   existence check but no read-permission check.
6. `GET /api/automations/history` returns the global execution log, or an
   arbitrary `ruleId`'s history, with no resource filtering.
7. `GET /api/layout` returns every tab and every pane configuration to every
   authenticated user.

This feature closes those gaps by **reusing the authorization infrastructure the
previous feature already built** — the `Permission_Resolver`
(`hasResourcePermission` / `filterByPermission`), the `Device_Exposure_Resolver`,
the `requireDevicePermission` middleware, and the automation
`Resource_Ownership_Store`. It introduces no new persisted tables and no new
authorization concept: it applies the existing resolvers to the surfaces that
still bypass them. The one small addition is a server-side "which tabs can this
user reach" lookup for filtering the layout, derived from the same
`group_tab_assignments` data the resolver already reads.

**Threat model context:** The target is small local-first deployments with a
handful of mostly-trusted users, not a large multi-tenant public SaaS. The goal
is to make the advertised authorization model hold consistently across *all*
read surfaces and to prevent accidental cross-tab/cross-user disclosure.
Priorities are correctness of the advertised model first, hardening against
determined insiders second.

**In scope:**
- Device read-permission filtering of `GET /api/state`.
- Scoping the initial WebSocket snapshot to the devices the client may observe,
  identically to the already-scoped live device broadcasts.
- Read-permission enforcement on the device auxiliary detail reads
  (`:id/actions`, `:id/completion-tiers`, `:id/history`).
- Resource filtering of `GET /api/automations/history`, both the global list and
  the `ruleId`-scoped form.
- Filtering `GET /api/layout` tabs and panes to the tabs a non-admin user can
  reach.
- A server-side accessible-tabs lookup added to the `Permission_Resolver`.
- Admin bypass (full visibility) preserved on every surface above.

**Out of scope:**
- The named-trigger authorization fix (`POST /api/automations/trigger/:name`) —
  a separate release-gate item.
- Data Store REST access control — a separate release-gate item.
- Any change to the core routes already fixed by `resource-level-authorization`,
  or to the live WebSocket broadcast visibility (only the *snapshot* is changed).
- Splitting a separate admin-only layout endpoint; the existing single endpoint
  is filtered per requesting user instead.

## Glossary

- **Aeolus**: The local-first IoT/automation platform being secured.
- **Permission_Level**: One of `read`, `interact`, or `write`, ordered
  `read` < `interact` < `write`.
- **User**: An authenticated principal with a role (`admin` or `user`) and an
  optional group.
- **Admin**: A User whose role is `admin`.
- **Tab**: A dashboard surface (row in the `tabs` table). A Group is granted a
  Permission_Level on a Tab via `group_tab_assignments`.
- **Pane**: A dashboard widget (row in the `panes` table) that belongs to a Tab.
- **Device**: A controllable resource (row in the `devices` table) identified by
  its own device identifier.
- **Automation**: An automation rule (row in the `automation_rules` table)
  identified by its own rule identifier.
- **Execution_Log_Entry**: A record of one automation execution, carrying the
  `ruleId` of the automation that executed.
- **Exposing_Tabs**: The set of Tabs that expose a given Device or Automation,
  resolved server-side (devices via the Device_Exposure_Resolver, automations via
  the Resource_Ownership_Store).
- **Permission_Resolver**: The existing server-side component that computes a
  User's effective permission for a resource (`hasResourcePermission`,
  `filterByPermission`), never reading a tab identifier from the request.
- **Device_Exposure_Resolver**: The existing server-side component that computes a
  Device's Exposing_Tabs live from the current purposeful device Panes and the
  current device inventory.
- **Accessible_Tabs**: The set of Tab identifiers a User can reach — for a
  non-admin, the Tabs on which the User's Group holds any Permission_Level
  (equivalently, at least `read`); for an Admin, every Tab.
- **Client_Observable_Devices**: For a WebSocket client, the set of Devices whose
  Exposing_Tabs intersect the client's accessible tabs (all Devices for an
  Admin) — the same rule the live device broadcast path uses.

## Requirements

### Requirement 1: Device read filtering for the aggregated state endpoint

**User Story:** As a security reviewer, I want the aggregated state endpoint to
disclose only devices the requesting user may read, so that it matches the
already-filtered device listing route instead of leaking the full inventory.

#### Acceptance Criteria

1. WHEN a non-admin User requests `GET /api/state`, THE Aeolus API SHALL include
   in the response only those Devices for which the User's effective permission,
   computed from the Device's Exposing_Tabs, is at least `read`.
2. WHEN an Admin requests `GET /api/state`, THE Aeolus API SHALL include every
   Device in the response.
3. WHEN a non-admin User with no readable Device requests `GET /api/state`, THE
   Aeolus API SHALL respond with HTTP status 200 and an empty state object.
4. THE `GET /api/state` route SHALL determine device visibility without reading
   any tab identifier from the request parameters, body, or query.
5. THE filtered `GET /api/state` response SHALL contain the same set of Devices
   that the same User would receive from `GET /api/devices`.

### Requirement 2: Scoped initial WebSocket snapshot

**User Story:** As a security reviewer, I want the initial WebSocket snapshot to
carry only the devices a client may observe, so that the snapshot and the live
event stream are consistent and neither leaks out-of-scope devices.

#### Acceptance Criteria

1. WHEN a non-admin client completes WebSocket authentication, THE WebSocket
   server SHALL send an initial `snapshot` message containing only that client's
   Client_Observable_Devices.
2. WHEN an Admin client completes WebSocket authentication, THE WebSocket server
   SHALL send an initial `snapshot` message containing every registered Device.
3. THE set of Devices included in a client's initial snapshot SHALL equal the set
   of Devices for which that same client would receive a live device state-change
   broadcast (snapshot/live consistency).
4. WHEN a non-admin client has no Client_Observable_Devices, THE WebSocket server
   SHALL send a `snapshot` message with an empty device map.
5. THE snapshot scoping SHALL derive device visibility from server-side resource
   identity (the Device_Exposure_Resolver and the client's accessible tabs) and
   SHALL NOT trust any client-supplied scope.

### Requirement 3: Read-permission enforcement on device auxiliary detail reads

**User Story:** As a security reviewer, I want the device action-catalog,
completion-tier, and history reads gated by device read permission, so that a
non-admin cannot inspect a device they are not entitled to see.

#### Acceptance Criteria

1. WHEN a non-admin User requests `GET /api/devices/:id/actions`,
   `GET /api/devices/:id/completion-tiers`, or `GET /api/devices/:id/history` for
   a Device that does not exist, THE Aeolus API SHALL respond with HTTP status
   404 before evaluating the User's effective permission.
2. WHEN a non-admin User requests any of those three routes for a Device that
   exists AND whose effective permission for the User is below `read`, THE Aeolus
   API SHALL reject the request with HTTP status 403.
3. WHEN a non-admin User requests any of those three routes for a Device that
   exists AND whose effective permission for the User is at least `read`, THE
   Aeolus API SHALL allow the request to proceed and return the requested data.
4. WHEN an Admin requests any of those three routes, THE Aeolus API SHALL allow
   the request to proceed regardless of the Device's Exposing_Tabs, returning 404
   only if the Device does not exist.
5. THE three routes SHALL determine authorization without reading any tab
   identifier from the request parameters, body, or query.
6. THE `DELETE /api/devices/:id/history` and `DELETE /api/devices/history/all`
   routes SHALL remain gated behind the `admin` role and SHALL NOT have any
   additional resource-level check imposed by this feature.

### Requirement 4: Resource filtering of automation execution history

**User Story:** As a security reviewer, I want the automation execution history
filtered by automation read permission, so that a non-admin only sees execution
records for automations they may read.

#### Acceptance Criteria

1. WHEN a non-admin User requests `GET /api/automations/history` without a
   `ruleId`, THE Aeolus API SHALL return only Execution_Log_Entries whose `ruleId`
   identifies an Automation for which the User's effective permission is at least
   `read`.
2. WHEN a non-admin User requests `GET /api/automations/history?ruleId=<id>` for
   an Automation whose effective permission for the User is below `read` (including
   an Automation with no Exposing_Tabs), THE Aeolus API SHALL reject the request
   with HTTP status 403.
3. WHEN a non-admin User requests `GET /api/automations/history?ruleId=<id>` for
   an Automation whose effective permission for the User is at least `read`, THE
   Aeolus API SHALL return that Automation's Execution_Log_Entries.
4. WHEN an Admin requests `GET /api/automations/history` in either form, THE
   Aeolus API SHALL return the entries without resource filtering.
5. WHERE a `limit` is supplied on the non-`ruleId` form for a non-admin User, THE
   Aeolus API SHALL apply the read filter before applying the limit, so the User
   receives up to `limit` readable entries rather than up to `limit` entries of
   which some are then removed.
6. THE `GET /api/automations/history` route SHALL determine authorization without
   reading any tab identifier from the request parameters, body, or query.

### Requirement 5: Layout filtering by accessible tabs

**User Story:** As a security reviewer, I want the layout endpoint to return only
the tabs a non-admin user can reach and the panes on those tabs, so that the
dashboard structure does not disclose tabs and pane configuration the user has no
access to.

#### Acceptance Criteria

1. WHEN a non-admin User requests `GET /api/layout`, THE Aeolus API SHALL include
   only Tabs in the User's Accessible_Tabs.
2. WHEN a non-admin User requests `GET /api/layout`, THE Aeolus API SHALL include
   only Panes whose owning Tab is in the User's Accessible_Tabs.
3. WHEN an Admin requests `GET /api/layout`, THE Aeolus API SHALL include every
   Tab and every Pane.
4. WHEN a non-admin User with no Accessible_Tabs (including a User with no group)
   requests `GET /api/layout`, THE Aeolus API SHALL respond with HTTP status 200
   and empty `tabs` and `panes` arrays.
5. THE `PUT /api/layout` route SHALL remain gated behind the `admin` role,
   unchanged by this feature.
6. THE `GET /api/layout` route SHALL determine Accessible_Tabs from the User's
   server-side group assignments and SHALL NOT read any tab identifier from the
   request parameters, body, or query.

### Requirement 6: Server-side accessible-tabs resolution

**User Story:** As a developer, I want a single server-side helper that reports
which tabs a user can reach, so that the layout filter and any future
tab-scoped surface share one authoritative, testable derivation.

#### Acceptance Criteria

1. THE Permission_Resolver SHALL provide a method that, given a User identifier,
   returns the set of Tab identifiers on which the User's Group holds any
   Permission_Level.
2. IF the User has no Group, THEN THE Permission_Resolver SHALL return an empty
   set of Tab identifiers.
3. THE accessible-tabs method SHALL derive its result solely from the User's
   server-side group assignments (`group_tab_assignments`) and SHALL NOT read any
   tab identifier from the request.
4. THE accessible-tabs method SHALL read from the same database handle the
   Permission_Resolver was constructed with, so it is consistent with the
   resolver's other computations under an injected test database.

### Requirement 7: No regression for admins and legitimate non-admin access

**User Story:** As an existing user, I want admins to keep full visibility and
in-scope non-admins to keep working after this change, so that tightening these
read surfaces does not break legitimate behavior.

#### Acceptance Criteria

1. WHEN an Admin uses any surface changed by this feature, THE Aeolus API SHALL
   return the same complete data it returned before this feature.
2. WHEN a non-admin User with sufficient permission accesses an in-scope resource
   through any surface changed by this feature without supplying a tab identifier,
   THE Aeolus API SHALL allow the request to proceed.
3. THE changes in this feature SHALL NOT alter the response shape of any surface
   for the resources that remain visible to the requesting User.
