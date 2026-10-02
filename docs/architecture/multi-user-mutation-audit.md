# Multi-user mutation audit

This audit classifies mutable HTTP surfaces by *mutation semantics*, not simply by HTTP verb. Revision preconditions are valuable for shared editable documents; they are usually wrong for atomic commands, append operations or latest-value state writes.

## Protected document-like resources

| Resource | Mutation model | Current protection |
|---|---|---|
| Dashboard layout | Complete shared document (`tabs` + `panes` + derived assignments) | Singleton server revision; atomic `If-Match`; `409`; WebSocket invalidation |
| Automation Project + authoring metadata | One authored automation document with runtime projection | Per-rule server revision; atomic `If-Match`; `409`; local draft retained; WebSocket invalidation |

## Administrative configuration to review resource-by-resource

These are configuration surfaces where two administrators can plausibly edit the same durable object. They should not automatically inherit the layout revision; each needs a narrow decision about object granularity and existing atomicity.

- Connector instance configuration (`POST/PATCH/DELETE /api/connectors`).
- Users, groups, group membership and permission assignments (`/api/auth/...`).
- Data Store collection schema/configuration and global retention/config (`/api/data-store/collections...`, `/api/data-store/config`). Record appends are not document edits.
- MQTT private-topic policy and broker provisioning/security configuration (`/api/mqtt/private-topics`, `/api/mqtt/provisioning`).
- Device MQTT command profiles (`PUT /api/devices/:id/mqtt-command-profile`).
- Automation public-demo access configuration (`PATCH /api/automations/:id/demo-access`).

For each, the follow-up question is: can a stale client submit a whole or partial snapshot that silently restores an older value after another administrator committed a newer one? If yes, add a resource revision/precondition. If the endpoint is already an atomic field/command with intentional last-write semantics, document that instead.

## Atomic command, event and latest-value mutations

These should **not** be given document revisions merely because they mutate state:

- device actions;
- automation fire;
- automation enable/disable (an atomic latest-value switch and does not overwrite authored fields);
- Automation State and Shared State key writes/deletes;
- Data Store record append/write operations;
- connector retry/setup/search operations;
- MQTT publish;
- history clearing and similar explicit commands.

Where useful, these surfaces rely on command lifecycle, event streams or last-value semantics rather than edit conflict resolution.

## Delete semantics

Deletion is an explicit destructive command, not a mergeable document edit. Automation deletion broadcasts a tombstone invalidation using the server-derived tab exposure captured immediately before the row and its assignments disappear, so other authorized clients can converge without leaking the deleted resource to unrelated users.

## Release contract

Multi-user readiness means:

- no silent lost update for the shared dashboard or Automation Project authoring;
- a stale mutation is rejected server-side, not merely noticed by the browser;
- passive clients converge after a committed configuration change;
- active authors keep their local work and see an explicit conflict;
- no claim of CRDT/OT/live collaborative text editing.
