# Implementation Plan

- [x] 1. Persist collection→tab assignments
  - Migration `010-collection-tab-assignments.ts` (+register) and `initSchema` `CREATE TABLE IF NOT EXISTS collection_tab_assignments`.
  - _Requirements: 2.2_

- [x] 2. CollectionOwnershipStore
  - `src/auth/collection-ownership-store.ts` with `getExposingTabs` + `reconcileAll` (mirror ResourceOwnershipStore) + unit tests.
  - _Requirements: 2.3, 5.1_

- [x] 3. Collection-assignment extractor
  - Add `extractCollectionAssignments(panes)` to `pane-reference-extractor.ts` (only `data-collection` panes with non-empty `config.collection`) + unit tests.
  - _Requirements: 2.1, 2.4, 5.1_

- [x] 4. Reconcile on layout save
  - In `PUT /api/layout`, reconcile collection assignments in the atomic-replace transaction alongside automations.
  - _Requirements: 2.2, 4.3_

- [x] 5. Scope Data Store events
  - Add `createDataStoreVisibility` (pure, testable) and wire it into both Data Store WS mappings in `index.ts`; construct the CollectionOwnershipStore.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 5.2_

- [x] 6. Frontend data-collection pane
  - `DataCollectionPane.tsx` (records view + live refresh via a per-collection realtime signal in the data-store store), registry entry, and a "Collection" field in `PaneConfigPanel`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 7. Tests
  - Backend: store, extractor, visibility, layout-route reconciliation. Frontend: pane render/empty/live-update, config save.
  - _Requirements: 5.1, 5.2_

- [x] 8. Docs
  - Documented the data-collection pane + live event visibility in `docs/reference/dashboard.md`; removed the resolved item (and the two earlier-completed UI-cleanup items) from `docs/BACKLOG.md`.
  - _Requirements: 3.1_
