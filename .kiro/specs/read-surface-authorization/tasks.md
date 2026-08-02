# Implementation Plan: Read-Surface Authorization

## Overview

This plan applies the existing resource-authorization stack (`Permission_Resolver`,
`Device_Exposure_Resolver`, `requireDevicePermission`, `canReadAutomation`) to the
seven read surfaces that still bypass it. Implementation is in TypeScript against
the existing dependency-injected Express route factories, the `DeviceRegistry`,
and the `WsServer`. There is no schema change and no migration.

The work builds bottom-up: the one new resolver primitive first, then each surface
(state, snapshot, device aux reads, automation history, layout), then the
composition-root wiring that hands existing objects to the changed factories, then
verification. Each surface is integrated as it is implemented so nothing is left
orphaned.

Test sub-tasks are marked optional with `*`. They use Vitest with the in-memory DB
and `createTestApp` from `src/__test-helpers__/app-factory.ts`, mirroring the
existing `resource-level-authorization` route tests.

## Tasks

- [ ] 1. Add `accessibleTabIds` to the Permission_Resolver
  - [ ] 1.1 Extend `src/auth/permission-resolver.ts`
    - Add `accessibleTabIds(userId: string): string[]` to the `PermissionResolver`
      interface and implement it in `createPermissionResolver` by reusing the
      existing `getUserGroupId` and `groupRankByTab` helpers: return `[]` when the
      user has no group, else `Array.from(groupRankByTab(groupId).keys())`
    - Add it to the returned object; keep it `dbOverride`-aware (no `getDatabase()`
      singleton use)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [ ]* 1.2 Unit-test `accessibleTabIds`
    - With an injected `:memory:` DB: a user whose group has assignments on a
      subset of tabs returns exactly those tab ids; a groupless user returns `[]`;
      a user whose group has no assignments returns `[]`
    - _Requirements: 6.1, 6.2, 6.4_

- [ ] 2. Filter `GET /api/state` by device read permission
  - [ ] 2.1 Update `src/api/routes/state.routes.ts`
    - Add a `resolver: PermissionResolver` parameter to `createStateRoutes`
    - Admin → all devices; non-admin → keep only ids returned by
      `resolver.filterByPermission(userId, "device", ids, "read")`; build the state
      map from the visible set
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [ ]* 2.2 Route tests for `/api/state`
    - Admin sees all; non-admin sees only readable devices and the set equals
      `GET /api/devices` for the same user; a no-group non-admin gets `{}`
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [ ] 3. Scope the initial WebSocket snapshot
  - [ ] 3.1 Update `src/websocket/ws-server.ts`
    - Add a `Device_Exposure_Resolver` parameter to the `WsServer` constructor and
      store it on the instance
    - In `authenticateAndSetup`, build the snapshot from the client's observable
      devices: admin → all; non-admin → `getExposingTabsBatch(ids)` then include a
      device iff `canObserve(client, { visibility: "tabs", tabIds })`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ]* 3.2 WS snapshot tests
    - Admin snapshot contains all devices; non-admin snapshot contains only
      observable devices and equals the set for which a live `state-change`
      broadcast reaches the same client; a non-admin with no observable devices
      gets an empty snapshot map
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 4. Enforce read permission on device auxiliary reads
  - [ ] 4.1 Update `src/api/routes/device.routes.ts`
    - Insert `requireDevice("read")` as middleware on `GET /:id/actions`,
      `GET /:id/completion-tiers`, and `GET /:id/history`
    - Leave the handler bodies (existence/`501`/empty-history branches) intact;
      leave `DELETE /:id/history` and `DELETE /history/all` on `requireAdmin`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 4.2 Route tests for the three aux reads
    - For each route: non-admin 404 (missing), 403 (exists without read), 200
      (exists with read); admin proceeds (404 only when missing); destructive
      history routes remain admin-only (non-admin 403)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

- [ ] 5. Filter `GET /api/automations/history`
  - [ ] 5.1 Update `src/api/routes/automation.routes.ts`
    - `ruleId` form: gate on `canReadAutomation(req, ruleId)` → 403 when not
      readable; else return `getByRuleId` sliced to `limit`
    - No-`ruleId` form: admin → `executionLog.list(limit)`; non-admin → list all,
      dedupe rule ids, `filterByPermission(userId, "automation", ids, "read")`,
      filter entries to the readable set, then apply `limit` (filter before limit)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ]* 5.2 Route tests for `/api/automations/history`
    - Non-admin global list filtered to readable rules; filter-before-limit
      honored; `ruleId` form 403 (no read) / 200 (read); admin unfiltered in both
      forms
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 6. Filter `GET /api/layout` by accessible tabs
  - [ ] 6.1 Update `src/api/routes/layout.routes.ts`
    - Add a `resolver: PermissionResolver` parameter to `createLayoutRoutes`
    - Admin → all tabs/panes; non-admin → `accessibleTabIds(userId)`, keep tabs in
      the set and panes whose `tabId` is in the set
    - Leave `PUT /api/layout` unchanged (`requireAdmin`)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [ ]* 6.2 Route tests for `/api/layout`
    - Admin sees all; non-admin sees only accessible tabs and their panes; no-group
      non-admin gets empty arrays; `PUT` still admin-only
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 7. Wire the composition root and the test app factory
  - [ ] 7.1 Update `src/index.ts` and `src/__test-helpers__/app-factory.ts`
    - Pass `permissionResolver` into `createStateRoutes` and `createLayoutRoutes`
    - Pass `deviceExposureResolver` into the `WsServer` constructor
    - Ensure the device-routes call applies `requireDevice("read")` to the three
      aux routes (task 4) and that the automation-routes call is unchanged
    - Update every other call site of the changed signatures (route/WS test
      helpers) so the suite compiles
    - _Requirements: 1.*, 2.*, 3.*, 5.*_

- [ ] 8. Verify and document
  - [ ] 8.1 Run `tsc --noEmit` and the full backend suite; fix any regressions
  - [ ] 8.2 Update `docs/BACKLOG.md` release-gate item 2 to DONE with a short
    summary of which surfaces were filtered and how
  - [ ]* 8.3 If `docs/security/permissions.md` describes these surfaces, align its
    wording with the new behavior

## Notes

- Tasks marked `*` are optional test sub-tasks; core implementation sub-tasks are
  never optional.
- No schema change, no migration, no new persisted state.
- The snapshot is intentionally scoped with the same inputs as the live device
  broadcast so snapshot/live consistency holds by construction.
- Admin bypass is performed at each call site before any resolver work, matching
  the existing device/automation list routes.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "3.1"] },
    { "id": 2, "tasks": ["7.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.2", "5.2", "6.2"] },
    { "id": 4, "tasks": ["8.1", "8.2", "8.3"] }
  ]
}
```
