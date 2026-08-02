# Implementation Plan: Data Store Access Control

## Overview

Add authorization to the Data Store REST API by reusing `requireAdmin`, the
`Permission_Resolver.accessibleTabIds` lookup, and the `Collection_Ownership_Store`.
No schema change, no migration. Management, mutations, and buckets become
admin-only; non-admin collection reads are filtered by collection→tab
accessibility.

Test sub-tasks are marked optional with `*` and use Vitest with `createTestApp`.

## Tasks

- [ ] 1. Add authorization to `createDataStoreRoutes`
  - [ ] 1.1 Update `src/api/routes/data-store.routes.ts`
    - Add `resolver: PermissionResolver` and `collectionOwnership: CollectionOwnershipStore`
      parameters
    - Add a `canReadCollection(req, name)` closure: admin → true; else the
      collection's `getExposingTabs(name)` intersects `resolver.accessibleTabIds(userId)`
    - Apply `requireAdmin` middleware to: `POST /collections`, `PATCH /collections/:name`,
      `DELETE /collections/:name`, `POST /collections/:name/records`, all four bucket
      routes, `GET /config`, `PUT /config`, `GET /stats`, `POST /enable`, `POST /disable`
    - Filter `GET /collections` for non-admins; prepend a `canReadCollection` 403 gate
      to `GET /collections/:name/records` and `GET /collections/:name/export`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3_

- [ ] 2. Wire the composition root and test app factory
  - [ ] 2.1 Update `src/index.ts` and `src/__test-helpers__/app-factory.ts`
    - Pass `permissionResolver` and `collectionOwnershipStore` into
      `createDataStoreRoutes` (both already constructed at each site)
    - _Requirements: 1.*, 2.*, 3.*_

- [ ] 3. Keep the existing unit suite green
  - [ ] 3.1 Update `src/api/routes/data-store.routes.test.ts`
    - Mock the auth middleware to pass through (or set an admin `req.user`) and pass
      stub `resolver`/`collectionOwnership` so the route-logic tests run as admin
    - _Requirements: 4.2_

- [ ]* 4. Integration tests for Data Store authorization
  - [ ]* 4.1 Add `src/__integration__/data-store-access-control.integration.test.ts`
    - Seed a group/tab topology and a data-collection pane surfacing one collection;
      enable the Data Store (as admin) and write a record (as admin)
    - Assert non-admin 403 on create/delete collection, record write, a bucket route,
      config, stats, enable, disable
    - Assert `GET /collections` returns only the surfaced collection for the non-admin
      and all for the admin; `GET records`/`export` 200 for the accessible collection,
      403 for an unsurfaced/unreachable one; admin unrestricted
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1_

- [ ] 5. Verify and document
  - [ ] 5.1 Run `tsc --noEmit` and the full backend suite; fix regressions
  - [ ] 5.2 Update `docs/BACKLOG.md` release-gate item 4 to DONE

## Notes

- Tasks marked `*` are optional test sub-tasks; core implementation is never optional.
- No schema change, no migration, no new persisted state.
- Buckets and writes are admin-only by design; non-admin reads are collection→tab
  scoped, consistent with the live WebSocket Data Store visibility.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["5.1", "5.2"] }
  ]
}
```
