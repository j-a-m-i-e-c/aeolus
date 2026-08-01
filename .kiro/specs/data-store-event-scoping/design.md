# Design Document

## Overview

Data Store events stay admin-only today because nothing tells the server which tabs surface a collection. Automations solved the identical problem: a pane's `config.ruleId` is extracted into `automation_tab_assignments`, and a visibility resolver scopes automation events to those tabs. This feature mirrors that pattern exactly for collections, and adds the missing pane that produces the `config.collection` reference.

Four backend pieces (all mirrors of existing automation code) plus one frontend pane:

1. `collection_tab_assignments` table (migration 010).
2. `CollectionOwnershipStore` — persist/query assignments (mirror of `ResourceOwnershipStore`).
3. `extractCollectionAssignments(panes)` — derive `{tab → collections}` from `data-collection` panes (mirror of `extractAutomationAssignments`).
4. `dataStoreVisibility` resolver wired into `WS_MAPPINGS`, plus reconciliation in `PUT /api/layout`.
5. Frontend `data-collection` pane + config field.

## Backend

### Migration 010 — `collection_tab_assignments`

```sql
CREATE TABLE IF NOT EXISTS collection_tab_assignments (
  collection_name TEXT NOT NULL,
  tab_id TEXT NOT NULL,
  PRIMARY KEY (collection_name, tab_id)
);
```

Additive; mirrors `automation_tab_assignments`. `initSchema` gains the same `CREATE TABLE IF NOT EXISTS` for fresh databases.

### `CollectionOwnershipStore` (`src/auth/collection-ownership-store.ts`)

A direct structural mirror of `ResourceOwnershipStore`, keyed by collection name instead of automation id:

```ts
export interface CollectionOwnershipStore {
  getExposingTabs(collectionName: string): string[];
  reconcileAll(desiredByTab: Map<string, Set<string>>): void; // tabId → collection names
}
export function createCollectionOwnershipStore(dbOverride?: DatabaseType): CollectionOwnershipStore;
```

`getExposingTabs` selects `tab_id` where `collection_name = ?`. `reconcileAll` runs the same insert-missing / delete-stale / clear-absent-tabs reconciliation as the automation store, in one transaction. (No batch form is needed — event scoping resolves one collection at a time, unlike automation read-filtering.)

### Extractor (`src/auth/pane-reference-extractor.ts`)

Add alongside `extractAutomationAssignments`:

```ts
const DATA_COLLECTION_PANE_TYPE = "data-collection";

export function extractCollectionAssignments(panes: PaneRef[]): Map<string, Set<string>> {
  const byTab = new Map<string, Set<string>>();
  for (const pane of panes) {
    if (pane.paneType !== DATA_COLLECTION_PANE_TYPE) continue;
    const collection = pane.config?.collection;
    if (typeof collection !== "string" || collection.length === 0) continue;
    // add collection → pane.tabId
  }
  return byTab;
}
```

Unlike automations there is no "existing ids" filter: a collection reference is valid even before any record is written (the pane can point at a not-yet-populated collection), and events only fire for collections that exist, so a dangling reference simply never scopes anything.

### Layout reconciliation (`PUT /api/layout`)

The handler already reconciles automation assignments inside the atomic-replace transaction. Add the parallel collection reconciliation in the same transaction: derive `extractCollectionAssignments(paneRefs)` and call `collectionOwnershipStore.reconcileAll(...)`. Because the store is constructed with the shared db singleton, no new route dependency is required beyond importing the extractor (the reconcile can run via the store or via inline SQL mirroring the automation block — the store's `reconcileAll` keeps it DRY).

### Visibility resolver (`src/index.ts`)

Mirror `automationVisibility`:

```ts
const dataStoreVisibility = (data: unknown): BroadcastEnvelope => {
  const collection = stringField(data, "collection");
  if (!collection) return { visibility: "admin" };
  return { visibility: "tabs", tabIds: collectionOwnershipStore.getExposingTabs(collection) };
};
```

Wire it into both Data Store mappings, replacing the unscoped (admin-only) entries:

```ts
{ eventName: DATA_STORE_WRITE, messageType: "data-store-write", visibility: dataStoreVisibility },
{ eventName: DATA_STORE_COLLECTION_DELETED, messageType: "data-store-collection-deleted", visibility: dataStoreVisibility },
```

`collectionOwnershipStore` is constructed next to `ownershipStore`. Empty `getExposingTabs` → `{ tabs: [] }` → `canObserve` grants admins only (Req 3.2), so unsurfaced collections behave exactly as today (Req 4.1).

### Testability of the resolver

To make the scoping decision unit-testable without standing up a WsServer, extract the resolver as a pure factory `createDataStoreVisibility(store)` in a small module (or test it through the store + a thin assertion). The store test proves tab resolution; a focused test asserts the envelope is `tabs` for a surfaced collection and `admin` for an unsurfaced one.

## Frontend

### `data-collection` pane

- New component `frontend/src/components/panes/DataCollectionPane.tsx`: reads `config.collection`, fetches recent records via the existing data-store store/api (`GET /api/data-store/collections/:name/records?limit=N`), renders a compact records table (timestamp + payload summary), and refreshes on `data-store-write` WebSocket messages whose `collection` matches. Reuses the live-message subscription pattern of existing live panes (e.g. EventLogPane). Empty/unknown collection → a muted prompt (Req 1.3).
- Registry entry in `pane-registry.ts` under the `monitoring` category, `defaultConfig: { collection: "" }`.
- `PaneConfigPanel.tsx`: add a "Collection" text field for `data-collection` (seeded from `config.collection`, saved to `config.collection`), and include `data-collection` in `hasConfig`.

The pane reads through the existing (authenticated-user-open) Data Store REST endpoints, so a non-admin can populate it; this feature adds the missing *live* updates via the scoped WS events.

## Out of scope

- Data Store REST authorization is unchanged (Req 4.2). It is currently open to any authenticated user; tightening collection reads to the same tab model is a separate, larger security change. The `CollectionOwnershipStore` introduced here is the groundwork that a future REST-scoping change would reuse.
- No new confirmation/aggregation UI beyond a simple records view.

## Testing strategy

- **Unit — CollectionOwnershipStore**: assignment round-trip, `reconcileAll` insert/delete/clear, empty result for an unsurfaced collection.
- **Unit — extractCollectionAssignments**: only `data-collection` panes with a non-empty string `config.collection` contribute; other pane types and empty/non-string configs contribute nothing.
- **Unit — data-store visibility**: `tabs` envelope with the store's tabs for a surfaced collection; `admin` for missing collection name or unsurfaced collection.
- **Layout route test**: saving a layout with a `data-collection` pane creates the assignment; removing it clears the assignment.
- **Frontend**: DataCollectionPane renders records, shows the empty state for a blank collection, and updates on a matching `data-store-write` message; PaneConfigPanel saves `config.collection`.

## Rollout

Additive and backward-compatible: new table, new pane, and a resolver that defaults to admin-only for any collection no pane surfaces. Existing deployments behave exactly as before until a `data-collection` pane is added to a tab.
