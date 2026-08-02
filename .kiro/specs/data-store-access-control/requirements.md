# Requirements Document

## Introduction

Aeolus is a local-first IoT/automation platform for small, mostly-trusted
deployments (a household, farm, or single site). It advertises a permission
model built on tabs, groups, and roles, where a user's group is granted a
permission level (`read`, `interact`, or `write`) on each tab.

The Data Store is an optional local time-series + key/value store. Its REST API
(`createDataStoreRoutes`, `src/api/routes/data-store.routes.ts`) currently has
**no authorization beyond authentication**. Any authenticated user — regardless
of role or group — can create and delete collections, write and export records,
modify shared key/value buckets, change quotas, and enable or disable the entire
Data Store. This contradicts the permission model Aeolus advertises and lets a
non-admin reshape or wipe installation-wide state.

Aeolus already records which tabs surface which collections in
`collection_tab_assignments`, resolved server-side by the
`Collection_Ownership_Store`. That mapping already scopes live Data Store
WebSocket events (a collection surfaced by no pane stays admin-only,
fail-closed). This feature applies the **same** server-side ownership model to
the REST surface, and admin-gates the management, mutation, bucket, and
lifecycle operations that have no per-collection scoping.

**Design stance.** Data Store *management* (collections lifecycle, quotas,
enable/disable), *all mutations* (record writes, bucket writes/deletes), and the
*shared key/value buckets* (which have no tab mapping) are treated as
admin/trusted operations. Non-admins retain **read** access, filtered to the
collections surfaced on tabs they can reach — exactly what a data-collection
pane on one of their tabs needs. This mirrors the decision already made for the
live WebSocket Data Store events.

**Threat model context:** The target is small local-first deployments with a
handful of mostly-trusted users, not a large multi-tenant public SaaS. The goal
is to make the advertised authorization model hold on the Data Store surface and
prevent a non-admin from reshaping installation-wide state or reading
collections no tab exposes to them. Priorities are correctness of the advertised
model first, hardening against determined insiders second.

**In scope:**
- Admin-gating Data Store management: create/update/delete collection, config
  read/update, stats, enable, disable.
- Admin-gating all mutations: record writes and all bucket routes.
- Admin-gating shared key/value buckets entirely (no tab mapping exists).
- Non-admin read filtering of the collection list and per-collection record and
  export reads, by collection→tab accessibility resolved server-side.
- Admin bypass (full access) on every route.

**Out of scope:**
- Per-collection *write* permission for non-admins (writes stay admin-only for
  now; automations write through the sandbox `db.*` API, not this REST surface).
- Non-admin bucket access (buckets stay admin-only until a bucket→tab ownership
  model exists).
- Any change to the live WebSocket Data Store visibility (already scoped) or to
  `collection_tab_assignments` maintenance on layout save (already implemented).
- The alternative of documenting the Data Store as installation-global instead
  of enforcing access; this feature enforces access.

## Glossary

- **Aeolus**: The local-first IoT/automation platform being secured.
- **User**: An authenticated principal with a role (`admin` or `user`) and an
  optional group.
- **Admin**: A User whose role is `admin`.
- **Tab**: A dashboard surface; a Group is granted a permission level on a Tab
  via `group_tab_assignments`.
- **Collection**: A Data Store time-series collection identified by its name.
- **Bucket**: A Data Store shared key/value namespace. Buckets have no tab
  ownership mapping.
- **Collection_Ownership_Store**: The existing server-side component that resolves
  the set of Tabs surfacing a given Collection from `collection_tab_assignments`.
- **Permission_Resolver**: The existing server-side component; here its
  `accessibleTabIds(userId)` method reports the Tabs a User's Group can reach.
- **Accessible_Collection**: For a non-admin User, a Collection whose surfacing
  Tabs intersect the User's accessible Tabs. For an Admin, every Collection.
- **Management_Route**: A Data Store route that creates, updates, deletes, or
  configures Data Store state (collections lifecycle, config, stats, enable,
  disable).
- **Mutation_Route**: A Data Store route that writes data (record writes, bucket
  set/delete).

## Requirements

### Requirement 1: Admin-gate Data Store management and lifecycle

**User Story:** As a security reviewer, I want Data Store management and
lifecycle operations restricted to admins, so that a non-admin cannot create,
delete, or reconfigure installation-wide Data Store state.

#### Acceptance Criteria

1. WHEN a non-admin User calls `POST /collections`, `PATCH /collections/:name`,
   or `DELETE /collections/:name`, THE Aeolus API SHALL reject the request with
   HTTP status 403.
2. WHEN a non-admin User calls `GET /config`, `PUT /config`, `GET /stats`,
   `POST /enable`, or `POST /disable`, THE Aeolus API SHALL reject the request
   with HTTP status 403.
3. WHEN an Admin calls any Management_Route, THE Aeolus API SHALL allow the
   request to proceed.
4. THE Management_Routes SHALL determine authorization from the User's
   server-side role and SHALL NOT read any tab identifier from the request.

### Requirement 2: Admin-gate all Data Store mutations and buckets

**User Story:** As a security reviewer, I want record writes and all bucket
operations restricted to admins, so that a non-admin cannot alter Data Store
contents or the shared key/value namespace that has no per-tab ownership.

#### Acceptance Criteria

1. WHEN a non-admin User calls `POST /collections/:name/records`, THE Aeolus API
   SHALL reject the request with HTTP status 403.
2. WHEN a non-admin User calls any bucket route (`GET /buckets`,
   `GET /buckets/:bucket`, `PUT /buckets/:bucket/:key`,
   `DELETE /buckets/:bucket/:key`), THE Aeolus API SHALL reject the request with
   HTTP status 403.
3. WHEN an Admin calls any Mutation_Route or bucket route, THE Aeolus API SHALL
   allow the request to proceed.
4. THE Mutation_Routes and bucket routes SHALL determine authorization from the
   User's server-side role and SHALL NOT read any tab identifier from the
   request.

### Requirement 3: Non-admin collection read filtering

**User Story:** As a non-admin user, I want to read the Data Store collections
surfaced on tabs I can reach, so that a data-collection pane on my tab works
while collections outside my reach stay hidden.

#### Acceptance Criteria

1. WHEN a non-admin User calls `GET /collections`, THE Aeolus API SHALL return
   only the Accessible_Collections for that User.
2. WHEN an Admin calls `GET /collections`, THE Aeolus API SHALL return every
   Collection.
3. WHEN a non-admin User calls `GET /collections/:name/records` or
   `GET /collections/:name/export` for a Collection that is not an
   Accessible_Collection for that User (including a Collection surfaced by no
   Tab, and a Collection that does not exist), THE Aeolus API SHALL reject the
   request with HTTP status 403.
4. WHEN a non-admin User calls `GET /collections/:name/records` or
   `GET /collections/:name/export` for an Accessible_Collection, THE Aeolus API
   SHALL allow the request and return the collection's data.
5. WHEN an Admin calls `GET /collections/:name/records` or
   `GET /collections/:name/export`, THE Aeolus API SHALL allow the request
   regardless of the Collection's surfacing Tabs.
6. THE collection read routes SHALL resolve Accessible_Collections from the
   Collection_Ownership_Store and the User's server-side group assignments, and
   SHALL NOT read any tab identifier from the request.

### Requirement 4: Fail-closed and no-regression behavior

**User Story:** As a security reviewer, I want the Data Store to fail closed for
unmapped collections and to preserve existing admin behavior, so that tightening
access does not create new leaks or break admin flows.

#### Acceptance Criteria

1. WHERE a Collection is surfaced by no Tab, THE Aeolus API SHALL treat it as not
   an Accessible_Collection for any non-admin User (it is absent from that User's
   `GET /collections` and yields 403 on its record/export reads).
2. THE Aeolus API SHALL preserve the existing response shapes and status codes
   for admins on every Data Store route.
3. WHEN the Data Store is disabled and an authorized caller invokes a route that
   requires it, THE Aeolus API SHALL continue to surface the existing
   "Data Store is not enabled" (HTTP 503) behavior after the authorization check
   passes.
