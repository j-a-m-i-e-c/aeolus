# ADR-0011: Command evidence as an automation-scoped read capability

- **Status:** Proposed
- **Date:** 2026-09-03

## Context

ADR-0006 established that Aeolus reports what physically happened rather than what
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
  (`ADMIN_ONLY` is the fail-closed default). Nothing in `frontend/src` consumes it.
- `command_transitions.details` exists, is parsed on read
  (`rowToTransition`), and is typed on both the read and write interfaces — but
  every INSERT site passes `null`. No caller has ever supplied it.
- The lifecycle event payload (`CommandLifecycleTransitionEvent`) omits
  `actionType`, `effectiveTier`, `failureKind` and `error`, so a live ladder built
  from it cannot say which rung the command was aiming for, or why it stopped.
- A sandboxed showcase UI has no path to any of it. The SDK op allowlist
  (`SDK_OPS` in `frontend/src/sandbox/rpc-types.ts`) is closed, only `state` and
  `props` events reach a frame, and the frame's CSP sets `connect-src 'none'` so it
  cannot fetch anything itself.

What showcase UIs display today is a collapsed verdict. Every project stores a
string and a timestamp — `lastOutcome`, `coolingVerifiedAt`, `interlockAt` — because
that is all `devices.action()` hands back. The evidence ladder that makes Aeolus
different from a dashboard that fires and hopes is invisible to the people the
demo is for.

## Decision

Expose command evidence as a **read capability scoped to the automation that
issued the command**, reusing the existing visibility model rather than inventing
one. Concretely:

1. **Populate `command_transitions.details`.** Each rung carries the evidence for
   that rung: the tier being aimed for, the observed condition and the value that
   satisfied it, the applied timeout, the acknowledgement correlation. No
   migration — the column and its read path already exist.
2. **Complete the lifecycle event payload** with `actionType`, `effectiveTier`,
   `failureKind` and `error`, so a rung can label itself without a second fetch.
3. **Scope the `command-lifecycle` broadcast** with a visibility resolver
   composed from the resolvers already in `src/index.ts`: a transition is visible
   on the tabs that expose the issuing automation
   (`ownershipStore.getExposingTabs(ruleId)`) unioned with the tabs that expose the
   target device (`deviceExposureResolver.getExposingTabs(targetDeviceId)`). No
   rule id and no exposing tab stays admin-only, as now.
4. **Add one automation-scoped HTTP read**, leaving the admin routes untouched:
   the recent commands issued by a named rule, readable by a caller who can access
   a tab that exposes that rule.
5. **Add one SDK op, `commandEvidence`,** bound to the frame's own grant. The
   frame does not pass a rule id; the broker uses the immutable `entityId` from its
   `FrameGrant`, exactly as `read` already does. A `readOnly` grant still permits
   it, because it is a read.
6. **Type `aeolus.control` honestly.** It already resolves with a
   `CommandResult` at runtime, but both declarations say `Promise<void>` and the
   broker's `CommandResult` drops `commandId` and `failureKind`. Pass the whole
   body through and declare it.
7. **Derive the ladder in `@aeolus/ui`** as pure functions over a record and its
   transitions — rung labels, reached/pending/failed status, per-rung evidence
   text. Rendering stays in each project, so the module keeps its "no I/O, nothing
   privileged" guarantee.

## Why this fits Aeolus

The evidence belongs to the automation that issued the command. That is already a
first-class identity in the authorization model: `command_records.rule_id` is
populated for automation-sourced commands, and `automationVisibility` in
`src/index.ts` already answers "which tabs may see this rule's activity". Scoping
evidence the same way adds a consumer of the existing model rather than a second
model to keep consistent.

Binding the SDK op to the frame's own `entityId` means the capability introduces
**no new authorization decision**. The grant already establishes that the frame
speaks for one rule; asking "what happened to the commands that rule issued" is
within the authority the frame was given. A general "query command history" op
would have needed its own filtering, its own scoping, and its own failure modes.

Populating `details` rather than adding a table keeps the evidence attached to the
transition it explains, which is the thing that is immutable and append-only. An
evidence row that could drift from its transition would be worse than no evidence.

## Alternatives considered

### Project-state projection only, no platform change

`devices.action()` already returns the completion outcome, so Logic could write
richer evidence into its own automation state and the UI could read it with the
existing `read` op. This needs no new route, no new SDK op and no authorization
work, and it is how the showcase collapses evidence today.

Rejected as the whole answer because `devices.action()` resolves **once**, at the
completion tier. Logic never sees `DISPATCHED` and `ACKNOWLEDGED` as separate
moments with their own timestamps, so a ladder built this way can only show the
rung it landed on. It would have to fabricate the intermediate steps to draw them,
which is precisely the failure this ADR exists to remove. The projection is still
useful and stays — it is the offline/at-rest summary — but it cannot be the
evidence.

### Open `/api/commands` to non-admins with a tab filter

Simpler-sounding, but it widens the surface that already carries the "can disclose
device names and behaviour" warning, and a per-record filter on a list endpoint is
easy to get subtly wrong. An automation-scoped route answers the question the UI
actually asks and cannot accidentally return a neighbouring tab's commands.

### Forward `command-lifecycle` into frames as an RPC event

A live ladder pushed as an event would animate without polling. Deferred rather
than rejected: the broker currently forwards only `state` and `props`, and adding a
third event kind means deciding how a frame subscribes to a filtered stream. The
scoped WS broadcast in decision 3 is what the *dashboard* needs; a frame can read
on demand until there is a reason to stream.

### Give the sandbox a generic authenticated fetch

Rejected outright. `connect-src 'none'` and the absence of a token in the frame
are load-bearing parts of ADR-0005. A named, grant-scoped op preserves both.

## Consequences

### Positive

- The evidence ladder becomes visible to the operators the demo is for, from the
  same records the runtime already writes for its own correctness.
- `command_transitions.details` stops being dead schema.
- No new authorization model: one composed visibility resolver and one op bound to
  an existing grant.
- A failure rung (`TIMED_OUT`, `STATE_MISMATCH`) becomes as legible as a success
  one, which is the more valuable half of the story.

### Negative / accepted trade-offs

- Command history becomes reachable by non-admin viewers for the automations their
  tabs expose. That is the point, but it is a genuine widening: device names and
  command timing become visible where they were not. The scoping must be tested as
  carefully as the feature.
- Six layers change together (store, event payload, WS visibility, HTTP route, SDK
  protocol/broker, ui-kit). Each needs its own test; a partial landing would leave
  a route with no consumer, which is the state this ADR is fixing.
- `details` is free-form JSON. Without discipline it will become a dumping ground;
  the writer sites should build it from a small named shape rather than spreading
  whatever is in scope.
- Evidence read on demand can lag a live command by one interaction. Acceptable
  while the rungs are labelled honestly as pending.

## Revisit when

- A frame needs the ladder to animate live rather than on demand — then decide the
  frame-side event subscription model deliberately.
- Untrusted third-party UI authors become possible. At that point
  `commandEvidence` belongs in the per-project capability manifest ADR-0005 already
  anticipates, not in a global allowlist.
- Retention becomes a question. Nothing prunes `command_records` today; a visible
  history makes its growth a product concern rather than only an operational one.

## Implementation anchors

- `src/automations/command-history-store.ts`
- `src/automations/command-lifecycle.ts`
- `src/api/routes/command.routes.ts`
- `src/index.ts` (WS mappings and visibility resolvers)
- `frontend/src/sandbox/rpc-types.ts`, `sdk-broker.ts`, `sandbox-host.ts`
- `frontend/src/sandbox/ui-kit/index.ts`
- `docs/adr/0006-truthful-command-lifecycle.md`
- `docs/security/permissions.md`
