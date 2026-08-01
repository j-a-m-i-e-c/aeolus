# Implementation Plan: Scoped Automation Authoring

## Overview

This plan attaches an authorization scope to every automation and enforces it in the runtime, so a non-admin author's Logic is confined to the resources its owning tab exposes while admin-authored automations stay unrestricted. It builds bottom-up: schema/migration, then the scope-input helpers on the existing resolvers/stores, then the `AutomationScopeResolver`, then the exposing-tab union, then the two enforcement layers (`CommandService`, `Sandbox`), then route binding, the composition root, the frontend, and end-to-end tests.

Implementation is TypeScript on `better-sqlite3`, the versioned migration registry, the in-memory `DeviceRegistry`, the isolated-vm sandbox, and the DI route factories. Property tests use **fast-check** with **≥100 iterations**, tagged `// Feature: scoped-automation-authoring, Property N: <text>`. Test sub-tasks are marked optional with `*`; core implementation sub-tasks are never optional.

## Tasks

- [ ] 1. Add the scope columns and backfill (migration 011)
  - [ ] 1.1 Add `src/db/migrations/011-automation-authorization-scope.ts`
    - Export a `Migration` with `id: 11`, `name: "automation-authorization-scope"`, synchronous `up(db)`
    - `ALTER TABLE automation_rules ADD COLUMN authored_unrestricted INTEGER NOT NULL DEFAULT 0`; `ADD COLUMN owner_tab_id TEXT REFERENCES tabs(id) ON DELETE SET NULL`
    - Backfill `UPDATE automation_rules SET authored_unrestricted = 1` for all existing rows (preserve authority — R1.5, R10.2)
    - If the inline `REFERENCES` on `ADD COLUMN` is unsupported on the pinned SQLite, document and add an application-side SET-NULL on tab deletion instead (still satisfy R1.4)
    - _Requirements: 1.1, 1.5, 10.2_
  - [ ] 1.2 Register migration 011 in `src/db/migrations/index.ts`
    - Import `automationAuthorizationScope` and append it after `collectionTabAssignments` (id 10)
    - _Requirements: 1.1_
  - [ ]* 1.3 Unit tests for the migration
    - Fresh and legacy DBs get both columns; pre-existing rows become `authored_unrestricted = 1`; a new row defaults to `0`; deleting a tab nulls `owner_tab_id` for owned automations without flipping `authored_unrestricted`
    - _Requirements: 1.1, 1.4, 1.5, 10.2_

- [ ] 2. Add scope-input helpers to the existing resolvers/stores
  - [ ] 2.1 Add `getExposedDeviceIds(tabId)` to `src/auth/device-exposure-resolver.ts`
    - Load the tab's panes once; return the distinct ids of `registry.getAll()` devices matched by that tab's purposeful panes via `matchesDeviceFilter`
    - _Requirements: 5.1, 5.4_
  - [ ] 2.2 Add `getCollectionsForTab(tabId)` to `src/auth/collection-ownership-store.ts`
    - `SELECT collection_name FROM collection_tab_assignments WHERE tab_id = ?`, distinct
    - _Requirements: 7.1_
  - [ ]* 2.3 Unit tests for the two helpers
    - `getExposedDeviceIds` returns exactly the matched inventory ids (and updates live as inventory changes); `getCollectionsForTab` returns the tab's surfaced collections
    - _Requirements: 5.1, 5.4, 7.1_

- [ ] 3. Implement the AutomationScopeResolver
  - [ ] 3.1 Add `src/automations/automation-scope-resolver.ts`
    - `createAutomationScopeResolver(deviceExposureResolver, collectionOwnershipStore, dbOverride?)` returning `{ resolve(ruleId): AuthorizationScope }`
    - Read `authored_unrestricted, owner_tab_id`; map per the design (absent row and null owner ⇒ scoped-empty; flag ⇒ unrestricted; else scoped with live device/collection sets)
    - Export the `AuthorizationScope` type
    - _Requirements: 1.2, 1.3, 5.4, 9.1, 9.3_
  - [ ]* 3.2 Property test — Property 1 (unrestricted iff flagged)
    - **Property 1: Unrestricted iff explicitly flagged**
    - **Validates: Requirements 1.2, 1.3, 9.3**
  - [ ]* 3.3 Property test — Property 2 (scoped device set = live exposed devices)
    - **Property 2: Scoped device set equals the owning tab's live exposed devices**
    - **Validates: Requirements 5.1, 5.4, 9.1**

- [ ] 4. Union the owning tab into automation exposing tabs
  - [ ] 4.1 Update `src/auth/resource-ownership-store.ts`
    - `getExposingTabs(automationId)` returns the pane-derived tabs unioned with the automation's `owner_tab_id` when non-null; `getExposingTabsBatch` unions per id (one extra batched read of `id, owner_tab_id`)
    - _Requirements: 3.1, 3.5_
  - [ ]* 4.2 Property test — Property 8 (exposing tabs include owner)
    - **Property 8: Exposing tabs include the owning tab**
    - **Validates: Requirements 3.1, 3.5**
  - [ ]* 4.3 Unit test — resource-level access via owner tab
    - A scoped automation with no pane is reachable at read/interact/write for a user holding that level on the owning tab, and unreachable for an unrelated non-admin
    - _Requirements: 3.2, 3.3, 3.4_

- [ ] 5. Enforce scope at dispatch in CommandService
  - [ ] 5.1 Add scope enforcement to `src/automations/command-service.ts`
    - Add `scopeResolver: AutomationScopeResolver` to the deps; at the top of `execute`, resolve the scope by `ruleId`
    - Scoped: refuse `device_action`/`toggle` whose `target ∉ scope.deviceIds`, and refuse all `publish` and `webhook`, returning terminal `{ success:false, lifecycleState:"FAILED", failureKind:"unauthorized", error }` with a `warn` log and no dispatch/registration; unrestricted proceeds unchanged
    - Extend the `failureKind` union with `"unauthorized"`
    - _Requirements: 5.2, 5.5, 6.1, 6.3, 8.2, 5.3, 6.2, 8.3, 10.1_
  - [ ]* 5.2 Property test — Property 3 (dispatch refuses out-of-scope + publish)
    - **Property 3: Dispatch refuses out-of-scope devices and all scoped publishes**
    - **Validates: Requirements 5.2, 6.1, 8.2**
  - [ ]* 5.3 Property test — Property 4 (unrestricted dispatch unaffected)
    - **Property 4: Unrestricted dispatch is unaffected**
    - **Validates: Requirements 5.3, 6.2, 8.3, 10.1**
  - [ ]* 5.4 Unit test — no side effects on refusal
    - Spy the connector manager and mqtt service; assert zero calls for a scoped out-of-scope device action, a scoped publish, and a scoped webhook, and a `warn` log with `{ ruleId, target? }`
    - _Requirements: 5.2, 5.5, 6.1, 6.3, 8.2_

- [ ] 6. Enforce scope in the Sandbox
  - [ ] 6.1 Thread scope into `src/automations/sandbox.ts`
    - Add `scopeResolver` to `SandboxDeps`; in `execute`, resolve the scope once and pass it to the ref-wiring helpers
    - `setDevicesRefs`: inject only `scope.deviceIds` for scoped (full inventory for unrestricted / empty for null-owner scoped)
    - `setDataStoreRefs`: for scoped, gate `db.write`/`db.query` by `scope.collections`, filter `db.collections()`, and refuse `db.get/set/delete`; unrestricted unchanged
    - `setHttpRefs`/`setMqttRefs`: unchanged (HTTP keeps SSRF policy; publish denial is enforced in CommandService)
    - _Requirements: 5.1, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 9.2_
  - [ ]* 6.2 Property test — Property 5 (sandbox injects exactly the scoped set)
    - **Property 5: Sandbox injects exactly the scoped device set**
    - Drive `setDevicesRefs` device-selection with a fake registry + generated scope; assert the serialized device set
    - **Validates: Requirements 5.1, 5.3, 9.2**
  - [ ]* 6.3 Property test — Property 6 (scoped Data Store confined)
    - **Property 6: Scoped Data Store access is confined**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**
  - [ ]* 6.4 Property test — Property 7 (fail-closed on null owner)
    - **Property 7: Fail-closed on a null owning tab**
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [ ] 7. Checkpoint — resolver and both enforcement layers complete
  - Ensure all tests pass and the build is green; ask the user if questions arise.

- [ ] 8. Bind scope at authoring in the routes
  - [ ] 8.1 Update `POST /api/automations` in `src/api/routes/automation.routes.ts`
    - Determine role from `req.user`; for admin write `authored_unrestricted=1, owner_tab_id=null`; for non-admin write `authored_unrestricted=0, owner_tab_id=req.body.tabId` (the `requireTabPermission("write")` guard already enforced write on that tab and 403s a non-admin with no/insufficient tab)
    - Persist the two columns in both the script and form INSERTs; include `ownerTabId`/`authoredUnrestricted` in the create response
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ] 8.2 Guard scope immutability in `PUT /api/automations/:id`
    - Never write the scope columns for a non-admin; ignore any scope fields in the body
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ] 8.3 Surface scope on reads
    - Include `ownerTabId` and `authoredUnrestricted` in the automation list (`GET /`) and detail reads so the frontend can render scope
    - _Requirements: 11.3_
  - [ ]* 8.4 Property test — Property 9 (creation binds from role) and unit tests for routes
    - **Property 9: Creation binds scope from role, not the body** — admin ⇒ unrestricted; non-admin ⇒ scoped to named tab; never from a body flag
    - Unit: non-admin create without tab ⇒ 403; **Property 10: Non-admin update cannot change scope**
    - **Validates: Requirements 2.1, 2.2, 2.5, 4.1, 4.2**

- [ ] 9. Wire the composition root
  - [ ] 9.1 Construct and inject the resolver in `src/index.ts` and `src/__test-helpers__/app-factory.ts`
    - Build one `AutomationScopeResolver` from the existing `DeviceExposureResolver` and `CollectionOwnershipStore`; inject it into the `Sandbox` deps and the `CommandService` deps
    - _Requirements: 5.1, 5.2, 6.1, 7.1_

- [ ] 10. Frontend scoped authoring
  - [ ] 10.1 Owning-tab selection on create (`AutomationsPage.tsx`, `AutomationPane.tsx`)
    - For a non-admin, require choosing an Owning_Tab from tabs where `usePermissionsStore.canPerform(tabId, "write")` and send `tabId` in the create body; if the user has no write tab, hide authoring with an explanation; admin authoring unchanged (no tabId)
    - _Requirements: 11.1, 11.2, 11.4_
  - [ ] 10.2 Scope display and immutable scope on edit
    - Show the owning tab and a "limited to this tab's devices and collections" note when viewing/editing a scoped automation; do not render owner/unrestricted controls
    - _Requirements: 11.3, 11.5_
  - [ ]* 10.3 Frontend tests
    - Non-admin create sends the chosen `tabId`; no-write-tab hides authoring; scope note renders for a scoped automation; admin create sends no tabId
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [ ] 11. End-to-end integration tests (HTTP + SQLite + DeviceRegistry + isolate)
  - [ ]* 11.1 Escalation regression
    - Non-admin (write on tab A) creates a script automation; firing it, `devices.action` on a tab-B-only device is refused while a tab-A device succeeds
    - _Requirements: 5.1, 5.2_
  - [ ]* 11.2 Publish and Data Store scoping
    - Scoped `mqtt.publish` and scoped form-rule publish refused; scoped Data Store limited to owning-tab collections and buckets refused; unrestricted unaffected
    - _Requirements: 6.1, 6.2, 7.1, 7.4, 7.5_
  - [ ]* 11.3 Owner-tab exposure and fail-closed
    - Right after creation (no pane), the author can list/fire/edit their scoped automation; an unrelated non-admin cannot; after deleting the owning tab, firing performs no device action or publish
    - _Requirements: 3.2, 3.3, 3.4, 9.1, 9.2_
  - [ ]* 11.4 Freshness and admin-unchanged
    - Adding/removing a device that matches the owning tab's pane changes scope on the next fire with no layout save; an admin-authored automation touches any device/collection and publishes
    - _Requirements: 5.4, 10.1_

- [ ] 12. Final checkpoint — full suite green
  - Run backend + frontend suites and both builds; fix regressions; ask the user if questions arise.

## Notes

- Tasks marked `*` are optional test sub-tasks; core implementation sub-tasks are never optional.
- Defense in depth: device scope is enforced both by sandbox injection (task 6) and at dispatch in `CommandService` (task 5); the dispatch check is the security boundary.
- Scoped MQTT publish and scoped form-rule webhooks are denied in this feature; per-automation MQTT namespaces and consolidated SSRF-checked HTTP are separate follow-ups.
- Admin-authored and all pre-upgrade automations are unrestricted and unaffected.
- Property tests use fast-check with `{ numRuns: 100 }` (or higher) and the `// Feature: scoped-automation-authoring, Property N: <text>` tag.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.3", "3.1", "4.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.2", "4.3", "5.1", "6.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4", "6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["7", "8.1", "8.2", "8.3"] },
    { "id": 5, "tasks": ["8.4", "9.1"] },
    { "id": 6, "tasks": ["10.1", "10.2"] },
    { "id": 7, "tasks": ["10.3", "11.1", "11.2", "11.3", "11.4"] },
    { "id": 8, "tasks": ["12"] }
  ]
}
```
