# ADR-0011: Command evidence read by the automation that issued the command

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

ADR-0006 committed Aeolus to reporting what physically happened rather than what
was requested. The runtime already keeps the proof: `CommandService` writes a
durable `command_records` row before dispatch and appends an immutable
`command_transitions` row for every lifecycle step, guarded by the central
transition table in `src/automations/command-lifecycle.ts`.

None of that proof reaches an operator.

- `GET /api/commands` and `GET /api/commands/:commandId`
  (`src/api/routes/command.routes.ts`) are `requireAdmin` with no tab scoping, and
  nothing in `frontend/src` calls them.
- The `command-lifecycle` WebSocket message is mapped in `src/index.ts` with no
  `visibility` resolver, so `ws-server.ts` treats it as admin-only by design
  (`ADMIN_ONLY` is the fail-closed default). Nothing consumes it either.
- `command_transitions.details` exists, is parsed on read (`rowToTransition`) and
  is typed on both the read and write interfaces — but every INSERT site passes
  `null`. No caller has ever supplied it.
- The lifecycle event payload (`CommandLifecycleTransitionEvent`) omits
  `actionType`, `effectiveTier`, `failureKind` and `error`, so a rung built from it
  cannot say which tier it was aiming for, or why it stopped.
- A sandboxed showcase UI has no path to any of it. The SDK op allowlist
  (`SDK_OPS` in `frontend/src/sandbox/rpc-types.ts`) is closed, only `state` and
  `props` events reach a frame, and the frame's CSP sets `connect-src 'none'`.

What showcase UIs display today is a collapsed verdict. Every project stores a
string and a timestamp — `lastOutcome`, `coolingVerifiedAt`, `interlockAt` — because
that is all `devices.action()` hands back. The evidence ladder that distinguishes
Aeolus from a dashboard that fires and hopes is invisible to the people the demo
exists for.

The obvious cheap answer does not work. `devices.action()` resolves **once**, at the
completion tier, so Logic never witnesses `DISPATCHED` and `ACKNOWLEDGED` as
separate moments. A ladder drawn from the resolved result alone would have to invent
timestamps for the rungs in the middle — the same class of fault as placing an
animal from the age of its detection event, or an ROV from a clamped altitude. A
plausible number that is not a measurement.

## Decision

Give **Logic** a read of the evidence for commands it issued, and let the existing
projection path carry it to the UI.

1. **Populate `command_transitions.details`** at every writer, built from a small
   named shape rather than whatever happens to be in scope: the tier being aimed
   for, the observed condition and the value that satisfied it, the applied timeout,
   the failure reason. No migration — the column and its read path already exist.
2. **Complete the lifecycle event payload** with `actionType`, `effectiveTier`,
   `failureKind` and `error`, so a rung can label itself. Remains admin-only.
3. **Add a `devices.commandEvidence(commandId)` host binding** to the Logic
   isolate, returning the record plus its chronological transitions as plain data.
   It resolves only commands whose `rule_id` matches the calling rule; anything else
   returns undefined.
4. **Derive the ladder in `@aeolus/ui`** as pure functions over a record and its
   transitions — rung labels, reached/pending/failed status, per-rung evidence text.
   Rendering stays in each project, so the module keeps its "no I/O, nothing
   privileged" guarantee.
5. **Type `aeolus.control` honestly.** It already resolves with a `CommandResult` at
   runtime, but both declarations say `Promise<void>` and the broker's
   `CommandResult` drops `commandId` and `failureKind`. Pass the whole body through
   and declare it.

Adoption is at least one automation per showcase tab, so the ladder is a property of
the platform rather than a flourish on one pane.

## Why this fits Aeolus

The evidence belongs to the automation that issued the command, and that automation
already runs with an authorization scope (`AutomationScopeResolver`) that
`CommandService.checkScope` enforces on `devices.action` itself. Reading back what
happened to a command it caused discloses nothing it did not already have the
authority to do. The check is one comparison against `command_records.rule_id`.

The timing works out because the store's writes are synchronous and land before the
action resolves: `DISPATCHED`, the tracker's `ACKNOWLEDGED`, and the terminal
transition are all durable by the time `devices.action()` returns. The moment Logic
receives its result is exactly the moment the full timeline exists.

Delivery then rides the path that already exists. Logic projects the rungs into its
own automation state; the pane reads them with the `read` op every showcase UI
already uses and every architecture test already enforces. No new HTTP surface, no
new sandbox capability, no CSP question, no new authorization decision.

## Alternatives considered

### A tab-scoped HTTP route plus a new UI-sandbox SDK op

This was the first shape of this ADR, and it was over-built. It added a non-admin
read path to command history, a new op in the sandbox allowlist, a composed
visibility resolver for the WebSocket broadcast, and a broker dependency — four new
security-relevant surfaces to reach evidence the server could simply hand to Logic,
which already had the authority for it.

It also widened disclosure in a way the goal did not require: any pane could read
its automation's whole command history, rather than the author choosing what the
pane says. Rejected in favour of decision 3.

### Project-state projection with no platform change

Logic writes richer evidence from the resolved `ActionResult` and the UI reads it.
No new binding at all.

Rejected as insufficient, for the reason in the context above: the resolved result
is a single rung. This ADR keeps the projection as the *delivery* mechanism — what
changes is that Logic projects transitions it actually read, instead of rungs it
inferred.

### Scope the `command-lifecycle` WebSocket broadcast to tabs

Deferred, not rejected. The resolver ingredients exist in `src/index.ts`, but
nothing on the dashboard renders the message, so scoping it now would be speculative
work on a security-sensitive path. Do it when there is a consumer.

### A generic authenticated fetch for the sandbox

Rejected outright. `connect-src 'none'` and the absence of a token in the frame are
load-bearing parts of ADR-0005.

## Consequences

### Positive

- The evidence ladder becomes visible from the same records the runtime already
  writes for its own correctness, with no fabricated rungs.
- `command_transitions.details` stops being dead schema.
- No new authorization model, HTTP route, or sandbox capability.
- A failure rung (`TIMED_OUT`, `STATE_MISMATCH`) becomes as legible as a success
  one, which is the more valuable half of the story.
- What a pane discloses stays an authoring decision, consistent with every other
  projected value.

### Negative / accepted trade-offs

- Evidence reaches the UI only for commands the automation chose to project. An
  operator cannot browse history the author did not surface. That is the intended
  boundary, but it does mean the platform has no general evidence browser yet.
- Anything projected into automation state is visible to anyone who can view the
  pane. Authors must not project device internals they would not otherwise show.
- `details` is free-form JSON. Without discipline it becomes a dumping ground, hence
  the named shape in decision 1.
- Six files change together across the store, the event payload, the Logic binding,
  the ui-kit and the declarations. A partial landing leaves a binding with no
  consumer.
- The `dispatch` tier has only two rungs (`REQUESTED` → `DISPATCHED`). The ladder
  must render an honestly short ladder rather than implying missing evidence.

## Revisit when

- Something on the dashboard needs to render command lifecycle live — then decide
  the WebSocket scoping and, if a frame needs it, the frame-side event subscription
  model deliberately.
- An operator needs to browse evidence the author did not project. That is a
  general evidence browser, and it needs the tab-scoped read path this ADR declined
  to build speculatively.
- Retention becomes a question. Nothing prunes `command_records` today; visible
  history makes its growth a product concern rather than only an operational one.
- Untrusted third-party UI authors become possible, at which point evidence access
  belongs in the per-project capability manifest ADR-0005 anticipates.

## Implementation anchors

- `src/automations/command-history-store.ts`
- `src/automations/command-service.ts`
- `src/automations/sandbox.ts` (Logic host bindings)
- `src/automations/command-lifecycle.ts`
- `frontend/src/sandbox/ui-kit/index.ts`
- `docs/adr/0006-truthful-command-lifecycle.md`
- `docs/reference/automations.md`
