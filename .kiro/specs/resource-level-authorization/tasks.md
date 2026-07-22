# Implementation Plan: Resource-Level Authorization

## Overview

This plan replaces caller-supplied-tab authorization with resource-level authorization
for device and automation routes. Implementation is in TypeScript (the language of the
existing codebase) using `better-sqlite3`, the versioned `Migration` registry, the
in-memory `DeviceRegistry`, and the dependency-injected Express route factories.

The work builds bottom-up: schema first, then the pure derivation helpers
(`PaneReferenceExtractor`, `matchesDeviceFilter`), then the two exposing-tab resolvers
(`Resource_Ownership_Store` for automations, `Device_Exposure_Resolver` for devices),
then the `Permission_Resolver`, then the `Authorization_Middleware`, then route wiring
and layout maintenance, and finally the composition root that wires everything and the
end-to-end integration tests. Each step ends by integrating into the previous ones, so
no component is left orphaned.

Property-based tests use **fast-check** with a minimum of **100 iterations**, follow the
existing pattern in `src/core/device-registry.property.test.ts`, and are tagged
`// Feature: resource-level-authorization, Property N: <text>`. Test sub-tasks are marked
optional with `*`.

## Tasks

- [ ] 1. Create the `automation_tab_assignments` schema (migration 006)
  - [ ] 1.1 Add migration `src/db/migrations/006-automation-tab-assignments.ts`
    - Export a `Migration` with `id: 6`, `name: "automation-tab-assignments"`, following the `005-execution-history.ts` shape (synchronous `up(db)`)
    - In `up`, run `CREATE TABLE IF NOT EXISTS automation_tab_assignments (automation_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE, tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE, PRIMARY KEY (automation_id, tab_id))` plus `CREATE INDEX IF NOT EXISTS idx_automation_tab_assignments_tab ON automation_tab_assignments(tab_id)`
    - Table creation only in this task; the automation backfill is added in task 4.1 once the extractor and store exist
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.1_
  - [ ] 1.2 Register migration 006 in `src/db/migrations/index.ts`
    - Import `automationTabAssignments` and append it to the `migrations` array in ascending id order after `executionHistory`
    - _Requirements: 8.1_
  - [ ]* 1.3 Write unit tests for the migration schema
    - Apply migrations to a fresh `:memory:` DB and to a legacy DB (pre-006) and assert the `automation_tab_assignments` table exists with the expected columns and composite primary key
    - Assert a duplicate `(automation_id, tab_id)` insert via `INSERT OR IGNORE` is a no-op (uniqueness — R1.2)
    - Assert **no** `device_tab_assignments` table is created (R8.6)
    - _Requirements: 1.1, 1.2, 8.1, 8.6_

- [ ] 2. Implement the pure pane-derivation helpers
  - [ ] 2.1 Implement `PaneReferenceExtractor` in `src/auth/pane-reference-extractor.ts`
    - Pure function mapping an array of panes `{ tabId, paneType, config }` to `Map<tabId, Set<automationId>>`, contributing `config.ruleId` only for `automation` panes when `ruleId` is a non-empty string
    - Treat missing/empty/non-string `ruleId` as referencing no automation; contribute nothing for device or other pane types
    - Accept an optional set of existing automation ids so the caller can drop dangling references (used by backfill in task 4.1)
    - _Requirements: 8.2, 8.3, 8.4, 9.1_
  - [ ]* 2.2 Write unit/example tests for `PaneReferenceExtractor`
    - Cover single-tab, multi-tab (same automation on two tabs → both), dangling ref dropped, and malformed config → no reference
    - _Requirements: 8.2, 8.3, 8.4_
  - [ ] 2.3 Implement `matchesDeviceFilter` allowlist helper in `src/auth/device-filter.ts`
    - Pure `matchesDeviceFilter(pane: { paneType: string; config: PaneConfig }, device: Device): boolean`
    - Return `true` only for purposeful panes: `hue-control` → `integration === "hue" && type === "light"`, `kasa-control` → `integration === "kasa"`, `sensor-panel` → sensor-type device; narrow by `config.deviceType` (require `device.type === config.deviceType`) when present on those panes
    - Return `false` by default for every other pane type (non-device panes, `device-grid`, and any unknown/legacy type), regardless of config; treat an uninterpretable config as matching nothing (fail-closed)
    - _Requirements: 2.1, 2.4_
  - [ ]* 2.4 Write unit tests for `matchesDeviceFilter`
    - Assert `true` only for the three purposeful panes against matching devices, `deviceType` narrowing works, and `false` for a `device-grid` pane (including with `config.deviceType` set), a non-device pane, and an unknown/legacy pane type
    - _Requirements: 2.1, 2.4_

- [ ] 3. Implement the `Resource_Ownership_Store` (automations)
  - [ ] 3.1 Implement the store in `src/auth/resource-ownership-store.ts`
    - Use the DB singleton (`getDatabase()`) as in `permission-service.ts`; expose `getExposingTabs`, `getExposingTabsBatch`, `reconcileTab`, `reconcileAll`
    - `getExposingTabs(automationId)` selects `tab_id` for the automation; `getExposingTabsBatch(ids)` returns a `Map<automationId, string[]>` with empty arrays for unmapped ids
    - `reconcileTab(tabId, desired)` diffs current vs desired and issues `INSERT OR IGNORE` for additions and `DELETE` for removals (leaving matches untouched); `reconcileAll(desiredByTab)` runs all per-tab work in one `db.transaction(...)`, clearing tabs absent from the desired map
    - Use parameterized prepared statements only
    - _Requirements: 1.5, 9.1, 9.2, 9.3, 9.4_
  - [ ]* 3.2 Write property test — Property 3 (automation exposing-tabs read consistency)
    - **Property 3: Automation exposing-tabs read consistency**
    - Seed arbitrary `(automation, tab)` assignment subsets into `:memory:` and assert `getExposingTabs` returns exactly the recorded tab set
    - **Validates: Requirements 1.5**
  - [ ]* 3.3 Write property test — Property 9 (reconciliation matches derived desired set)
    - **Property 9: Automation reconciliation matches the derived desired set**
    - For arbitrary pane sets + automation inventory, run `PaneReferenceExtractor` then `reconcileAll`; assert stored assignments equal one record per (existing automation, distinct owning tab) and none for dangling refs
    - **Validates: Requirements 8.2, 8.3, 8.4, 9.1, 9.2, 9.3**
  - [ ]* 3.4 Write property test — Property 10 (reconciliation idempotent)
    - **Property 10: Automation reconciliation is idempotent**
    - Apply `reconcileAll` twice for any layout and assert the stored assignments after the second run equal those after the first, with no duplicates
    - **Validates: Requirements 8.5, 9.4**
  - [ ]* 3.5 Write property test — Property 11 (deletion cascades)
    - **Property 11: Automation deletion cascades remove dependent assignments**
    - With `foreign_keys = ON`, seed assignments, delete an arbitrary tab and an arbitrary automation, and assert exactly the referencing rows are removed while unrelated rows remain
    - **Validates: Requirements 1.3, 1.4**

- [ ] 4. Add automation backfill to migration 006
  - [ ] 4.1 Implement the backfill inside `006-automation-tab-assignments.ts` `up(db)`
    - After table creation, read all panes joined to `tab_id`, read current `automation_rules` ids, run `PaneReferenceExtractor` (passing existing ids so dangling refs are skipped) to build `desiredByTab`, and apply it with the store's `reconcileAll` semantics against the migration's `db` handle
    - Rely on `CREATE TABLE IF NOT EXISTS` + state-based reconciliation so re-runs create no duplicates; write no device table and no device rows
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_
  - [ ]* 4.2 Write unit/example tests for the backfill
    - Seed panes referencing existing automations (including one automation referenced on two tabs) and one pane referencing a deleted automation; assert one assignment per distinct owning tab, the dangling ref skipped, a second migration run adds no duplicates, and no device assignment rows/table exist
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 5. Implement the `Device_Exposure_Resolver` (live)
  - [ ] 5.1 Implement the resolver in `src/auth/device-exposure-resolver.ts`
    - Construct with an injected `DeviceRegistry`; read panes from the `panes` table with parameterized statements (normalizing malformed `config` to `{}`)
    - `getExposingTabs(deviceId)`: look up the device in the registry (return `[]` if absent), evaluate `matchesDeviceFilter(pane, device)` over all panes, and return the distinct set of matching `tab_id`s
    - `getExposingTabsBatch(deviceIds)`: load panes once and return a `Map<deviceId, string[]>`
    - Persist nothing and read no tab id from the request
    - _Requirements: 2.1, 2.2, 2.5, 2.6_
  - [ ]* 5.2 Write property test — Property 13 (device exposure = live purposeful-pane matches)
    - **Property 13: Device exposure equals live purposeful-pane filter matches against current inventory**
    - Generate tabs/panes mixing purposeful device panes with non-purposeful panes (including a legacy `device-grid` pane and an unknown pane type) plus a device inventory; assert a tab is in a device's exposing set iff it has a purposeful pane matching that device, and non-purposeful panes contribute nothing
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5**
  - [ ]* 5.3 Write property test — Property 14 (device exposure is fresh by construction)
    - **Property 14: Device exposure is fresh by construction**
    - For any pane layout, add a new device matching an existing tab's purposeful pane filter to the registry (no layout re-save) and assert the tab appears in the device's exposing set on the next `getExposingTabs` call, with no writes
    - **Validates: Requirements 2.3**
  - [ ]* 5.4 Write unit test for the fail-closed non-purposeful case
    - Assert a device shown only by non-purposeful panes (one or more `device-grid` panes and/or an unknown pane type) resolves to an empty exposing-tab set
    - _Requirements: 2.5_

- [ ] 6. Implement the `Permission_Resolver`
  - [ ] 6.1 Implement the resolver in `src/auth/permission-resolver.ts`
    - Construct with the `Resource_Ownership_Store` and `Device_Exposure_Resolver` injected; reuse `getGroupPermissions` and the `PERMISSION_RANK` table from `permission-service.ts` (`none` = rank 0)
    - `effectivePermission(userId, kind, resourceId)`: return `none` when the user has no group; else resolve exposing tabs by kind (store for `automation`, resolver for `device`) and return the max rank the group holds over the intersection, `none` if empty
    - `hasResourcePermission(...)` returns true iff effective rank ≥ required rank; `filterByPermission(userId, kind, ids, required)` loads the group map once, batches exposing-tab lookups, and returns ids reachable at ≥ required
    - Read no tab id from the request
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 10.1, 10.5_
  - [ ]* 6.2 Write property test — Property 1 (most-permissive across exposing tabs)
    - **Property 1: Effective permission is the most-permissive group level across exposing tabs**
    - **Validates: Requirements 3.1, 3.2, 3.5**
  - [ ]* 6.3 Write property test — Property 2 (fail-closed resolution)
    - **Property 2: Fail-closed resolution and denial**
    - Cover no-group, no-permission-on-any-exposing-tab, and no-exposing-tabs → `none`
    - **Validates: Requirements 3.3, 3.4, 6.1**
  - [ ]* 6.4 Write property test — Property 8 (read-filter correctness)
    - **Property 8: Read-filter correctness**
    - Assert `filterByPermission` returns exactly the resources reachable at ≥ `read` for non-admins (device exposure live, automation exposure from the store), across both kinds
    - **Validates: Requirements 10.1, 10.4, 10.5, 10.8**

- [ ] 7. Implement the `Authorization_Middleware` factories
  - [ ] 7.1 Add `requireDevicePermission` and `requireAutomationPermission` to `src/auth/auth-middleware.ts`
    - Each factory takes `(level, deps: { resolver, exists })` and returns a `RequestHandler`; export a shared `ResourceGuardDeps` type
    - Control flow: 401 if `!req.user`; admin → `next()` immediately without touching `exists`, the store, or the resolver (R7.1, R7.2); read `resourceId = req.params.id` (nothing from body/query); `!deps.exists(id)` → 404 before permission; else `deps.resolver.hasResourcePermission(userId, kind, id, level)` → 403 on insufficient/fail-closed, `next()` on success
    - On any 403 log at `warn` with `{ userId, kind, resourceId }`; on the fail-closed no-exposing-tabs case ensure the log entry identifies user and resource (R6.2)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.10, 6.1, 6.2, 7.1, 7.2_
  - [ ]* 7.2 Write property test — Property 4 (404 before 403)
    - **Property 4: Existence is checked before permission (404 before 403)**
    - Drive both factories with a fake req/res/next; for any non-existent id and any permission state assert 404 and never 403
    - **Validates: Requirements 4.4, 5.4, 10.2, 10.6**
  - [ ]* 7.3 Write property test — Property 5 (soundness without a caller-supplied tab)
    - **Property 5: Authorization soundness without a caller-supplied tab**
    - For any existing resource and non-admin with effective ≥ required, a request carrying no tab id in params/body/query proceeds
    - **Validates: Requirements 4.5, 5.5, 11.2**
  - [ ]* 7.4 Write property test — Property 6 (rejection below required level)
    - **Property 6: Authorization rejection below the required level**
    - **Validates: Requirements 4.6, 5.6, 10.3, 10.7**
  - [ ]* 7.5 Write property test — Property 7 (admin bypass is store-free and resolver-free)
    - **Property 7: Admin bypass is unconditional, store-free, and resolver-free**
    - Use spies on the store and resolver asserting zero calls for admin requests across any resource state
    - **Validates: Requirements 7.1, 7.2**
  - [ ]* 7.6 Write property test — Property 12 (invariant to caller-supplied tab identifiers)
    - **Property 12: Resolution and authorization are invariant to caller-supplied tab identifiers**
    - Inject/change/remove a `tabId` in params/body/query and assert neither the authorization outcome nor the resolved exposing-tab set changes, for both kinds
    - **Validates: Requirements 2.6, 3.5, 4.8, 5.10**
  - [ ]* 7.7 Write unit tests for logging and admin-missing behavior
    - Assert the fail-closed 403 logs `{ userId, resourceId }` (spy on `logger`), and that an admin targeting a missing resource passes the middleware so the handler returns 404
    - _Requirements: 6.2, 7.3_

- [ ] 8. Checkpoint — core resolution and middleware complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Wire resource authorization into device routes
  - [ ] 9.1 Update `src/api/routes/device.routes.ts`
    - Add a `requireDevice: (level: PermissionLevel) => RequestHandler` parameter to `createDeviceRoutes` and a `filterDevices: (userId, ids) => string[]` (or inject the resolver) for read filtering
    - Replace `requireTabPermission("interact")` on `POST /:id/action` with `requireDevice("interact")`; add non-admin read filtering to `GET /` (admins get the full set); enforce 404-before-403 at `read` on `GET /:id`
    - Leave `DELETE /:id/history` and `DELETE /history/all` on `requireAdmin` with no added resource check
    - _Requirements: 4.7, 10.1, 10.2, 10.3, 10.4, 11.1_
  - [ ]* 9.2 Write unit tests for device route wiring
    - Assert `POST /:id/action` is guarded at `interact`, `GET /` is filtered for non-admins and full for admins, `GET /:id` orders 404 before 403, and the destructive history routes stay admin-only (non-admin 403, admin proceeds, store/resolver not consulted)
    - _Requirements: 4.7, 10.1, 10.4, 11.1_

- [ ] 10. Wire resource authorization into automation routes
  - [ ] 10.1 Update `src/api/routes/automation.routes.ts`
    - Add a `requireAutomation: (level) => RequestHandler` parameter (built from the resolver and a `queryRuleById`-based existence predicate) and automation read filtering to `createAutomationRoutes`
    - Replace `requireTabPermission` with `requireAutomation("interact")` on `POST /:id/fire`, `requireAutomation("write")` on `PATCH /:id/toggle`, and `requireAutomation("interact")` on `PUT /:id/state` and `DELETE /:id/state/:key`
    - Add non-admin read filtering to `GET /` (admins full set) and 404-before-403 at `read` on `GET /:id/state` and `GET /:id/ui-module`; leave `POST /`, `PUT /:id`, `DELETE /:id` guards unchanged
    - _Requirements: 5.7, 5.8, 5.9, 10.5, 10.6, 10.7, 10.8_
  - [ ]* 10.2 Write unit tests for automation route wiring
    - Assert each guarded route uses the correct level, `GET /` is filtered for non-admins and full for admins, and the detail reads order 404 before 403
    - _Requirements: 5.7, 5.8, 5.9, 10.5, 10.8_

- [ ] 11. Maintain automation assignments on layout changes
  - [ ] 11.1 Update `src/api/routes/layout.routes.ts` (`PUT /api/layout`)
    - Add the `Resource_Ownership_Store` (or a `reconcileAll` callback) as a `createLayoutRoutes` parameter
    - After the panes are written, within the same `db.transaction(...)` as the atomic replace, run `PaneReferenceExtractor` over the new pane set and call `reconcileAll(desiredByTab)` so a partial failure rolls back both the layout and the assignments
    - Perform no device assignment work
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [ ]* 11.2 Write unit test for layout maintenance
    - Assert a layout save that adds/removes an automation pane updates the assignments accordingly and performs no device assignment writes (no `device_tab_assignments` table touched)
    - _Requirements: 9.1, 9.2, 9.3, 9.5_

- [ ] 12. Wire the composition root
  - [ ] 12.1 Construct and inject the components in `src/index.ts` and `src/__test-helpers__/app-factory.ts`
    - Build a single `Resource_Ownership_Store`, a `Device_Exposure_Resolver` (from the `DeviceRegistry`), and a `Permission_Resolver` (from both); derive `requireDevice`/`requireAutomation` from the resolver plus `registry.getById` and the automation existence lookup
    - Pass `requireDevice` and device read filtering into `createDeviceRoutes`, `requireAutomation` and automation read filtering into `createAutomationRoutes`, and the store into `createLayoutRoutes`; update the test app factory to match so existing suites keep compiling
    - _Requirements: 4.3, 4.7, 5.7, 5.8, 5.9, 10.1, 10.5_

- [ ] 13. End-to-end integration tests (HTTP + SQLite + DeviceRegistry)
  - [ ]* 13.1 Cross-tab bypass regression test
    - A non-admin with `interact` on tab A cannot act on a device/automation exposed only by tab B, even when supplying tab A's id in the body (reinforces Property 12)
    - _Requirements: 4.8, 5.10, 11.2_
  - [ ]* 13.2 Status-matrix test for guarded action routes
    - `POST /devices/:id/action`, `POST /automations/:id/fire`, `PATCH /:id/toggle`, `PUT /:id/state`, `DELETE /:id/state/:key` return the expected 200/403/404 for admin, permitted non-admin, unpermitted non-admin, and missing targets
    - _Requirements: 4.5, 4.6, 5.5, 5.6, 6.1, 7.1, 7.3_
  - [ ]* 13.3 Read-filtering and detail-read ordering test
    - `GET /api/devices` and `GET /api/automations` return filtered sets for non-admins and full sets for admins; detail reads enforce 404-before-403
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_
  - [ ]* 13.4 Live device freshness test
    - Seed a tab whose purposeful device pane would match a device, add a new matching device to the registry without re-saving the layout, and confirm a non-admin with `read` on that tab can immediately see/act on it; changing the device so it no longer matches removes access on the next request
    - _Requirements: 2.3_
  - [ ]* 13.5 Non-purposeful-pane grants-nothing test
    - A device exposed only by non-purposeful panes (a legacy `device-grid` pane and/or an unknown pane type) resolves to empty exposing tabs, so a non-admin holding `write` on that tab is 403 on `GET /devices/:id` and `POST /devices/:id/action` and the device is absent from that user's `GET /api/devices`; admins still reach it via bypass
    - _Requirements: 2.4, 2.5_

- [ ] 14. Final checkpoint — full suite green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation sub-tasks are never optional.
- Each task references the specific requirements (R1–R11) and/or design properties (1–14) it implements.
- Property tests use fast-check with `{ numRuns: 100 }` (or higher) and carry the `// Feature: resource-level-authorization, Property N: <text>` tag.
- Device exposure is computed live: there is intentionally no device assignment table, no device backfill, and no device layout maintenance.
- Checkpoints (tasks 8 and 14) provide incremental validation between the resolution layer, the wiring layer, and the end-to-end tests.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3"] },
    { "id": 1, "tasks": ["1.2", "3.1", "5.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "2.4", "3.2", "3.3", "3.4", "3.5", "4.1", "5.2", "5.3", "5.4", "6.1", "11.1"] },
    { "id": 3, "tasks": ["4.2", "6.2", "6.3", "6.4", "7.1", "11.2"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "9.1", "10.1"] },
    { "id": 5, "tasks": ["9.2", "10.2", "12.1"] },
    { "id": 6, "tasks": ["13.1", "13.2", "13.3", "13.4", "13.5"] }
  ]
}
```
