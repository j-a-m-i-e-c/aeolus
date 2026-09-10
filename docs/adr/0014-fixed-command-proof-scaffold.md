# ADR-0014: A fixed four-stage command proof, explained from a snapshot

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

ADR-0011 gave Logic a read of the evidence for commands it issued, and derived a
ladder from it in `@aeolus/ui`. The delivery path it chose was right and is unchanged
by this ADR. What it got wrong was the shape of the thing rendered.

ADR-0011 closed with this accepted trade-off:

> The `dispatch` tier has only two rungs (`REQUESTED` → `DISPATCHED`). The ladder
> must render an honestly short ladder rather than implying missing evidence.

A variable-length ladder is honest and useless. It reports what happened and hides
what could not. A dispatch-only command rendered as two ticks and a full stop, so a
visitor had no way to learn that `ACKNOWLEDGED` and `OBSERVED` exist, and no way to
tell "this relay cannot acknowledge" from "this command did not ask for one" from
"one was required and never arrived". Those are three different facts about a system.
All three rendered as the same absence.

Three further problems came from the same root — the presentation had less
information than the runtime did.

**A skipped stage cannot be explained from the present.** The reason a stage was
unreachable is a fact about the device profile *at the time the command ran*. Read
back a month later, deriving it from the device's current profile silently rewrites
history: enable acknowledgement on an MQTT device today and last month's dispatch-only
command starts claiming its device could have acknowledged.

**A command could not name its own operation.** `actionType` is `device_action`. It
names the mechanism, not the operation, so a pane with seven buttons showed seven
byte-identical proof blocks differing only in a muted hex id, under a heading that
named no action.

**An operation was assumed to be one command.** Every adopter kept a single
`lastCommand` state key. Where one trigger caused several physical actions — a stage
cue driving a lighting desk and then an effects rack — the second command overwrote
the first. The pane reported half the operation and looked complete doing it. The
platform already stamped `execution_id` on every command; nothing read it.

## Decision

Render a **fixed** four-stage scaffold, and give it enough recorded context to
explain every stage it did not reach.

1. **`commandProof()` always returns four stages** — `REQUESTED`, `DISPATCHED`,
   `ACKNOWLEDGED`, `OBSERVED` — in that order, whatever the command proved. An
   unreached stage is still rendered and must state why. The statuses are distinct
   because the facts are: `unavailable` (the hardware cannot), `not-required` (it
   could, but this command did not ask), `not-configured` (no observation contract
   was attached), `pending`, `failed`, `not-reached` (an earlier stage failed), and
   `not-recorded` (the command predates the snapshot). Replaces `commandLadder()`.

2. **Snapshot the capability context at acceptance** (migration 017): the capability
   ceiling, whether acknowledgement was available, whether *this command* carried an
   observation contract, the observing device, the condition as accepted, the
   transport, and both device display names. Never re-derived from the device's
   current profile. Every column nullable, no backfill: NULL means *not recorded*,
   which must never be read as `false`.

3. **Snapshot the trigger at acceptance** (migration 018): the originator's kind and
   id when the triggering event carried metadata, and the topic the execution fired
   on. The topic is the dependable one — the manual and operator fire paths build a
   context without event metadata, so `kind` is absent for exactly the executions a
   visitor is most likely to be looking at.

4. **Let authors name the operation, and nothing else.** `devices.action(...)` accepts
   `evidence: { intent, observedLabel }`, sanitised and bounded at the boundary. The
   lifecycle state, tier, devices, condition and verdict stay platform-owned, so a
   caption can never dress a dispatch up as an observation.

5. **Group by execution.** `devices.executionEvidence()` returns every command one
   execution issued, oldest first, with its trigger. The execution id is resolved on
   the host, not accepted from the isolate, because authored Logic has no way to learn
   its own. Scoped by `rule_id` exactly as `commandEvidence` is.

6. **A group has no tier of its own.** A cue whose lighting desk reached `OBSERVED`
   and whose effects rack reached `ACKNOWLEDGED` has no single tier between them.
   The group reports how many commands proved what was asked (`2 OF 2 PROVEN`); each
   command keeps its own tier and its own hardware chain.

7. **One shared component per shape.** `CommandProofCard` and
   `CommandExecutionCard` live in `@aeolus/ui`, which stays pure — no I/O, nothing
   privileged. Eight panes had each carried a copy of the same block, which is how
   the presentation drifted per tab.

## Why this fits Aeolus

The distinction Aeolus exists to make is between asking and proving. A scaffold that
only shows the rungs a command reached cannot teach that distinction, because the
interesting part — the ceiling this device could never exceed — is exactly what it
omits. Rendering the gap, with its reason, is the difference between reporting an
outcome and explaining a system.

Snapshotting rather than deriving is the same principle the rest of the platform
already follows. ADR-0012 verifies authored reads against observed telemetry rather
than a declared schema; ADR-0013 makes the simulator move things over time rather
than teleport them. In each case the rule is that the answer comes from a recorded
measurement, not from a plausible reconstruction. A capability ceiling inferred from
today's device profile is a plausible reconstruction.

The scope story needs no new decision. Both reads resolve only commands whose
`rule_id` matches the calling rule, which is the boundary ADR-0011 established and
`CommandService.checkScope` already enforces on dispatch. Delivery still rides
automation state projection: no new HTTP surface, no new sandbox capability, no CSP
question.

## Alternatives considered

### Keep the variable ladder and add a separate capability panel

Render what happened, then explain separately what the device could have done.
Rejected: it splits one thought across two surfaces, and the reader has to do the
join. The gap belongs on the stage that has it, or nobody reads it.

### Derive the skipped-stage reason at read time from the device profile

Cheapest option, no migration. Rejected because it is wrong rather than merely
imprecise: the answer changes when an unrelated device profile is edited, so
historical evidence becomes a function of the present. This is the fault ADR-0013
calls out in a different guise.

### Default `observationConfigured` to `false` for pre-017 records

Rejected. It asserts that an old command's device lacked capabilities it may well
have had. `not-recorded` is a distinct status precisely so the scaffold can say "this
predates the snapshot" instead of inventing a limitation.

### Let authors supply per-stage text

Rejected. Author text that can reach a stage label can overstate a tier, which
defeats the whole model. Authors get the operation's name and the meaning of an
observation; the platform owns everything that decides whether it was proven.

### Derive the group's trigger in the UI from the button that was clicked

Rejected. It produces nothing for a device-triggered execution, and it disagrees with
the record whenever the two drift. The trigger exists in the execution context at
acceptance; persisting it there is the only version that is true for every execution
rather than just the ones a human began.

### Give the execution group a single tier

Rejected as the same class of error the fixed scaffold exists to fix. Reporting the
highest tier overstates the weakest command; reporting the lowest understates the
strongest. A count is a true statement about a group.

## Consequences

### Positive

- A visitor can learn the whole model from any single command, including the stages
  it could not reach and why.
- Historical evidence stays true across device profile edits, renames and removals.
- A pane with several controls says which operation each receipt belongs to.
- A multi-command operation reports all of it, with each command's tier intact.
- A command whose honest ceiling is `ACKNOWLEDGED` or `DISPATCHED` reads as correct
  rather than as a weaker demo needing cosmetic upgrade.

### Negative / accepted trade-offs

- Two migrations add thirteen nullable columns to `command_records`. They are write-once
  at acceptance, so the cost is storage rather than contention, but the table is wider
  for a presentation concern.
- The scaffold is taller. A dispatch-only command now renders four lines where it
  rendered two, and two of those lines say nothing happened. That verbosity is the
  feature, but it costs vertical space on dense panes.
- Pre-017 and pre-018 records render `not-recorded` and carry no trigger. The
  scaffold degrades honestly, but early history is permanently less explanatory.
- `intentLabel` is author-supplied, so an author can still name an operation badly.
  Sanitisation bounds the damage to a poor caption, not a false tier.
- Adopting the grouped card is a per-project decision. A project that issues several
  commands per execution and keeps `CommandProofCard` still loses commands; the
  adoption test pins which projects are which, but the platform cannot detect it.
- `command-lifecycle` is no longer admin-only. The scope is the automation's own
  exposing tabs and the payload adds nothing readable at that scope, but it is a
  widening, and an automation placed on a tab now discloses its command timing there.
- The live feed is bounded per automation and starts empty on mount, so a pane cannot
  show a command that settled before it loaded. That is a real limitation, accepted
  because the alternative is a backfill read surface this ADR does not need.
- Two sources now describe the same command: the live feed and the projected receipt.
  They agree, being built from the same durable transitions, but a pane must choose
  which to render, and choosing the live one for a settled command would show
  `not-recorded` where the snapshot has the answer.

## Live progression

Decision 1 fixes the shape of a receipt. It does not by itself let a pane show a
command *becoming* proven, because `devices.action()` resolves at the completion tier
and Logic projects afterwards — so the projected receipt is always complete by the time
it exists. A pane could therefore only ever report that a transfer was verified, never
that it is being verified.

8. **Push the real transitions to the frame.** The durable store already emits a
   transition event after each write commits. Scope that broadcast to the tabs
   exposing the issuing automation — the same resolver as that automation's state and
   execution history — accumulate it per rule on the client, and expose it to the frame
   as `aeolus.commands` through the existing MessagePort: a new read op on the
   allowlist, a new event kind, no token in the frame, no new HTTP surface.

9. **Same shape, one renderer.** The accumulated live record is the shape
   `commandEvidence()` returns, so `commandProof()` reads it unchanged and a pane needs
   one rendering path for live and settled commands.

10. **No fabricated timing.** Stages appear when the runtime records them. No
    client-side staggered timers, and no interpolation between recorded stages.

The live feed carries **no capability snapshot**, because a transition does not report
one. An unreached stage on an in-flight command therefore reads `not-recorded` rather
than claiming the device cannot acknowledge — the honest degradation, and the reason a
pane should prefer the projected receipt once a command settles.

Scoping the broadcast is the decision ADR-0011 deferred as "speculative work on a
security-sensitive path" while nothing rendered it. That reasoning was right then and
is spent now: there is a consumer. It discloses nothing new at that scope — the payload
carries a device id, an action type and a lifecycle state, and a client who can reach
the exposing tab already reads the automation's state, its execution history with
per-action targets, and the exposed devices. A command with no `ruleId` belongs to no
pane and stays admin-only.

The read-only neutralisation was rewritten from a denylist of mutating ops to an
allowlist of reads while adding this. With a denylist a future op is permitted by
omission and the failure is silent; with an allowlist omission denies.

## Revisit when

- A pane needs a command's capability context while it is still in flight. That means
  carrying the snapshot on the transition event, which widens what the broadcast
  discloses and should be decided on its own terms rather than added for convenience.
- A pane needs command history it did not observe live. The live feed is bounded and
  starts empty on mount, deliberately: a backfill is a rule-scoped read surface, which
  is the tab-scoped HTTP route ADR-0011 declined to build speculatively.
- Retention becomes a question. Wider rows make `command_records` growth a product
  concern sooner.
- A third proof shape appears — a receipt spanning several executions, say. Two
  components is a pattern; three is a signal the model wants restating.

## Implementation anchors

- `src/db/migrations/017-command-capability-snapshot.ts`
- `src/db/migrations/018-command-trigger-provenance.ts`
- `src/automations/command-history-store.ts`
- `src/automations/command-service.ts`
- `src/automations/sandbox.ts` (Logic host bindings)
- `frontend/src/sandbox/ui-kit/command-proof.ts`
- `frontend/src/sandbox/ui-kit/command-execution.ts`
- `frontend/src/store/command-activity-store.ts`
- `frontend/src/sandbox/sdk-broker.ts` (the read-only allowlist)
- `src/index.ts` (the `command-lifecycle` visibility scope)
- `docs/adr/0011-command-evidence-surface.md`
- `docs/adr/0006-truthful-command-lifecycle.md`
- `docs/reference/automations.md`
