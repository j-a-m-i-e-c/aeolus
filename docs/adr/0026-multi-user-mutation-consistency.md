# ADR-0026: Multi-user mutation consistency and optimistic concurrency

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Aeolus already synchronizes operational state to multiple connected dashboards, but several configuration surfaces historically assumed one author at a time. The dashboard layout was persisted as a complete snapshot and a stale client could replace a newer snapshot. Automation authoring used a client-side read-before-write comparison, which detected ordinary stale editors but left a race in which two saves could both pass the read and then overwrite one another.

Aeolus does not need Google Docs-style collaborative text editing. It does need a clear multi-user contract: concurrent viewers/operators are normal, and administrative or authoring changes must never silently discard a committed change made by another client.

## Decision

Aeolus uses **optimistic concurrency with server-owned monotonic revisions** for document-like configuration.

- `GET /api/layout` returns the dashboard layout with its server revision.
- `PUT /api/layout` requires `If-Match`; the revision advance and complete layout replacement occur in one SQLite transaction. A mismatch returns `409 Conflict` and does not change the layout.
- Automation rules own the revision for their authored Automation Project and authoring metadata. Project reads return that revision. `PUT /api/automations/:id/project` and authoring `PUT /api/automations/:id` require `If-Match`; the rule/project write and revision advance are atomic. A mismatch returns `409 Conflict`.
- Configuration commits emit a WebSocket invalidation only after the database mutation succeeds. Passive clients refetch. A client with unsaved local authoring keeps its local work and is told that the server changed.
- Mutation IDs correlate an HTTP mutation with its WebSocket echo. Only the originating browser instance suppresses that echo; another tab signed in as the same user still observes the invalidation.
- Aeolus does not automatically merge conflicting layout snapshots or Automation Projects. The safe first response is to reject the stale mutation and reload/reconcile explicitly.

The product contract is therefore:

> Multiple users may concurrently view and operate an Aeolus site. Runtime state is synchronized live. Administrative and authoring changes use optimistic concurrency control; conflicting edits are never silently overwritten. Aeolus does not provide simultaneous collaborative text editing.

## Alternatives considered

- **Blind last-writer-wins:** simple, but permits silent loss of dashboard and authoring changes.
- **Client-side read-before-write only:** narrows the race but cannot make the check and write atomic.
- **Pessimistic edit locks:** require lock ownership, expiry and failure recovery, and make intermittent local networks more frustrating.
- **Automatic structural merge:** creates difficult conflict semantics for pane deletion/reassignment and authored code. Explicit failure is safer.
- **CRDT/OT collaborative editing:** far beyond the product need and would add large complexity to Monaco, metadata and dashboard composition.

## Consequences

- Stale configuration writes fail rather than overwrite newer committed state.
- A whole-layout persistence model remains acceptable because the revision precondition makes replacement atomic and conflict-safe.
- Local IndexedDB drafts from ADR-0025 remain recovery state, not shared drafts or revision authority.
- Clients must carry the revision obtained from the server and handle `409` as a recoverable authoring conflict.
- New document-like configuration APIs must decide explicitly whether they need the same revision contract; command/event APIs should not acquire revisions merely for consistency of style.
- A configuration invalidation contains identity/revision metadata, not the changed document. REST remains the authorization-filtered source of truth.

## Verification

Acceptance required the normal backend/frontend gates and `e2e/multi-user-consistency.spec.ts` to pass against the Compose stack. All three conditions were met on 2026-10-02:

1. **Simultaneous Automation Project saves.** Two independent Chromium contexts open the same project at the same revision, edit it differently, and save together. Exactly one editor returns to status; the other keeps its editor open, reports the conflict, and retains its draft. The stored source contains one operator's marker, never a blend.
2. **Concurrent layout replacement.** Two browsers writing the layout from the same revision produce exactly one `200` and one `409`.
3. **Stale delete.** A browser whose revision has been advanced elsewhere receives `409` rather than deleting.

Invalidation dispatch and own-echo suppression are covered by unit tests over `ws-client` and the invalidation store, and the layout concurrency paths — persist against a held revision, refusal to retry after `409`, and preserving pending local work when a remote commit lands — by `dashboard-store.concurrency.test.ts`.

Two qualifications. The browser suite ran against `e2e/docker-compose.e2e.yml`, the port-offset equivalent used where Docker Desktop cannot expose the host-networked backend; the behaviour under test is identical and CI exercises the base stack. And this establishes correctness under deliberate contention between two browsers, not a multi-operator field trial on a Raspberry Pi.

## Mutable-resource audit

The accompanying audit is `docs/architecture/multi-user-mutation-audit.md`. The important distinction is document mutation versus atomic command/event mutation. Layout and automation authoring are protected now; other administrative configuration remains explicitly catalogued for later resource-specific review rather than silently assumed safe.

## Revisit when

Revisit this decision if Aeolus adds true shared live authoring, cross-device drafts, server-side merge tooling, or a configuration resource whose edit semantics cannot be represented by a single revision.

## Implementation anchors

- `src/db/migrations/020-mutation-revisions.ts`
- `src/api/middleware/revision-precondition.ts`
- `src/api/routes/layout.routes.ts`
- `src/api/routes/automation.routes.ts`
- `src/automations/automation-project.ts`
- `src/core/event-bus.ts`
- `src/index.ts`
- `frontend/src/store/dashboard-store.ts`
- `frontend/src/store/configuration-invalidation-store.ts`
- `frontend/src/lib/mutation-id.ts`
- `frontend/src/lib/ws-client.ts`
- `frontend/src/components/AutomationsPage.tsx`
- `frontend/src/components/panes/AutomationPane.tsx`
- `e2e/multi-user-consistency.spec.ts`
