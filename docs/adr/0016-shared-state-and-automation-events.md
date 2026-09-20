# ADR-0016: Shared State for current truth, Automation Events for occurrences

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

A real Raspberry Pi run with a wildcard subscription produced this, repeating every few
seconds:

```text
sensor/bunker/supplies                        {"waterLitres":7442,...}
aeolus/events/<power-rule-id>/bunker/summary/power   {..."waterLitres":7442,...}
sensor/bunker/supplies                        {"waterLitres":7441,...}
aeolus/events/<power-rule-id>/bunker/summary/power   {..."waterLitres":7441,...}
```

The first line of each pair is a device reporting. The second is an internal overview
being handed a number it already had. Eleven showcase automations across three domains
computed a current snapshot — power, air, perimeter, atmosphere, ventilation, personnel,
CTD, ROV and so on — and published it with `events.emit()` so an overview automation
could compose it.

That is the wrong primitive, and the noise was a symptom rather than the problem.

An Automation Event answers **"what happened?"**. Every occurrence matters, ordering and
causation can matter, and Aeolus deliberately does not coalesce them: collapsing two
alarms into one because they share a topic would lose a fact. A subsystem summary answers
**"what is true now?"**. Only the newest value matters, and the intermediate ones are
safely discardable. Sending the second thing through the first thing's mechanism produced
three consequences:

1. **No safe coalescing.** A busy site ran the overview once per snapshot, including for
   snapshots identical to the one before.
2. **Internal composition on the broker.** `aeolus/events/...` is a reserved, documented
   namespace for real events. Filling it with UI composition traffic makes a wildcard
   trace useless for seeing what actually happened on a site.
3. **No durable current value.** An event is a moment. After a restart the overview knew
   nothing until every subsystem happened to publish again, so the product's model of
   "current state" only existed in whichever event arrived last.

Aeolus already had a durable current-value primitive much closer to what was needed:
key/value **Buckets**, described in the sandbox declarations as "cross-automation shared
state" and in the UI as values that survive restarts. Two capabilities were missing.
Buckets were not reactive — an automation could not be woken by one changing — and they
were presented as a storage mode of the optional historical Data Store, so they were
unavailable unless an operator had first configured storage limits for time-series
history they may not want.

Two smaller defects came from the same investigation and are recorded here because they
share its reasoning. Writing an unchanged value to a Bucket or to private automation
state still performed a SQLite write and a broadcast, so a projection recomputing the
same value every tick paid for saying nothing had changed. And the off-grid bunker
simulator advanced human water consumption on the 300× accelerated clock built to make
battery movement visible in a short demo, which made an 80-day water supply fall
visibly every few seconds.

## Decision

Aeolus distinguishes five concepts, and each has exactly one mechanism.

```text
Device State        current physical/integration truth
Automation State    private durable current truth, one automation
Shared State        shared durable current truth, reactive, internal
Collections         historical observations, optional, retention-bounded
Automation Events   discrete occurrences, never silently collapsed
```

Concretely:

**Buckets are promoted into a first-class `SharedStateStore`,** not a second new
abstraction beside them. An earlier draft of this work proposed an `Automation
Projection` primitive; it was rejected because it would have given Aeolus two overlapping
ways to express the same idea.

**Shared State is core, and always available.** It no longer depends on historical Data
Store enablement. Disabling the Data Store disables Collections, retention and storage
configuration; it does not take away a handful of durable shared values.

**Writes are idempotent.** `set()` compares the serialized value to what is stored and
returns whether anything changed. An identical write performs no SQLite write, does not
move `updated_at`, and emits nothing. `AutomationStateStore.set()` gained the same
contract, and the sandbox bridge broadcasts only when it reports a change.

**Changes are reactive and internal.** A real change emits `SHARED_STATE_CHANGE` on the
internal event bus. `shared-state` is a first-class automation trigger type whose pattern
is a `<bucket>/<key>` path, matched with the same `+`/`#` syntax as a trigger topic. That
is pattern syntax only: Shared State never reaches MQTT, under any namespace, and
`SharedStateStore` holds no MQTT dependency so this is structural rather than a
convention.

**Shared State triggers use keep-latest coalescing per bucket and key.** The durable value
already holds the newest state, so a pending execution for one key may be replaced by a
newer one. Different keys stay independent. Automation Events keep occurrence semantics
and are not coalesced.

**A Shared State trigger does not impersonate device state.** `context.deviceId` is empty,
`context.topic` is the path, and `context.meta.sharedState` names the bucket and key.
`deleted` is explicit, because `null` is a legitimate stored value and a removed key is a
different fact from one holding null.

**Shared State is bounded.** 64 KiB per serialized value, 200 characters per name, 5,000
entries total, and names may not contain `/`, `+` or `#` so one stored value has one
unambiguous reactive path. It is small current state, not a document store, and it is
deliberately not governed by the Data Store's `maxStorageMb`.

**The existing trust boundary is unchanged.** Global Shared State remains unrestricted /
admin-authored territory and REST management stays admin-only. A tab-scoped automation can
neither read Shared State nor be woken by a change to it — waking it would hand it the
data the boundary withholds.

**The storage table keeps its name.** Entries still live in `ds_buckets`. A rename would
add migration risk without changing behaviour, and a storage schema name is an
implementation detail rather than the product model. **Bucket** survives as the
user-facing word for a namespace *inside* Shared State.

**The user-facing name is "Shared Automation State".** Amended shortly after this ADR was
accepted: the dashboard originally said "Shared State", which never answered *shared
between what* — it could as easily have meant session or cluster state. Aeolus already has
Automation State, the private per-automation store, so naming the two as siblings is what
makes the distinction legible: one is private to an automation, the other is shared between
them. "Shared State" remains the shorthand in code and prose, and `shared`,
`/api/shared-state` and `SharedStateStore` are unchanged — the same reasoning as the table
name above applies, so this is one decision applied consistently rather than a new one.

The simulator fix is the same principle applied to time: accelerated simulation seconds
drive battery integration and generator fuel burn, wall-clock seconds drive human water
consumption. One clock per physical process it actually describes.

## Why this fits Aeolus

The platform's recurring argument is that a claim should be backed by the thing that
actually establishes it — ADR-0006 on command tiers, ADR-0011 on evidence, ADR-0013 on
physical movement. This is that argument applied to information rather than to actuation.
An event that says "this is happening now, again, unchanged" is the same category of
overstatement as a command that reports success because a contactor agreed it closed.

It also makes the honest version the convenient one. A projection can recompute on every
tick and cost nothing, so there is no incentive to hand-roll change detection. An overview
can read every subsystem's current value whenever it runs, so it does not have to assume
it saw every update — which is what makes restart behaviour correct rather than eventual.

## Alternatives considered

### Add an `Automation Projection` primitive

The original proposal for this work. Rejected because `projections.set("bunker/summary/
power", v)` and `db.set("bunker-summary", "power", v)` would both be "durable current
cross-automation state", and the resulting ambiguity is worse than the missing
reactivity. Finishing the existing abstraction was the smaller change and the clearer
model.

### Keep using Automation Events for current snapshots

No new concepts, no migration. Rejected because it is the defect. Every property that
makes an event correct for an alarm — no coalescing, every occurrence preserved,
broker-visible — is wrong for a value whose previous readings do not matter.

### Globally coalesce or throttle Automation Events

Would have quieted the broker in a few lines. Rejected outright: it fixes the symptom by
breaking the primitive. Two `perimeter-breached` events are two breaches.

### Use retained MQTT as the Shared State store

The broker already keeps a last-known value per topic. Rejected because it puts internal
coordination state on the wire, makes the broker a component Aeolus cannot function
without for its own internal state, and inherits MQTT's delivery semantics for something
that is a local durable read.

### Let automations read each other's private `state`

Cheapest of all: no new API. Rejected because private automation state is private by
design. Sharing would become implicit, every state key would become a public interface by
accident, and there would be no way to say what one automation deliberately publishes
versus what it happens to keep.

### Publish Shared State changes to MQTT for convenience

Tempting for debugging. Rejected because it recreates the original problem under a new
prefix — `aeolus/shared-state/...` instead of `aeolus/events/...` — and the fix would be
cosmetic. The Shared State UI is the place to inspect it.

### Require the Data Store to be enabled before Shared State works

The status quo, and it needed no work. Rejected because the two have nothing to do with
each other. Historical Collections are optional because unbounded accumulation can fill a
constrained edge device; bounded key/value state where a write replaces the previous value
carries no such risk.

### Rename `ds_buckets`

Considered for consistency with the new naming. Deferred: migration risk for no
behavioural gain.

## Consequences

### Positive

- Identical writes cost nothing: no SQLite write, no broadcast, no downstream execution.
- A wildcard broker trace shows device telemetry and real events, and nothing else.
- Overviews survive a restart: every subsystem's current value is durable and readable.
- Shared State works on a pristine install, which also removed an ordering constraint in
  the showcase seeder — it can read its own ownership ledger before deciding anything
  about historical storage.
- The information model is now stateable in five lines, which is what makes the next
  "where should this live?" question answerable without archaeology.

### Negative / accepted trade-offs

- **Change detection is exact serialized-JSON equality.** Two objects with the same
  entries in a different key order count as different. Deliberate: the alternative is a
  canonical-JSON dependency on a hot path, and the cost is an occasional redundant write.
- **`trigger_topic` now holds two kinds of pattern.** For an `mqtt` rule it is a broker
  topic; for a `shared-state` rule it is an internal path. The column name is historical
  and the trigger type is what gives the pattern meaning, but it is a place where the
  schema no longer reads the way the model does.
- **`db.get/set/delete` and `/api/data-store/buckets/*` survive as deprecated aliases**
  over the same store. Two names for one thing, for a while.
- **Scoped automations still cannot use Shared State at all.** This preserves the
  boundary honestly rather than widening it on a guess, but it means the composition
  pattern this ADR endorses is available only to admin-authored automations.
- **Shared State can be filled up.** The 5,000-entry cap makes a runaway
  `shared.set(bucket, uuid(), …)` fail loudly instead of filling the disk, which is the
  right failure — but it is a failure an author can cause.
- **Five showcase publishers were identified as current state and deliberately left as
  events.** `wildlife/response/status` and `farm/energy/permission` have no subscriber at
  all. `wildlife/detection/station`, `escape/observed/puzzles` and
  `escape/observed/room-look` each share a consumer's single trigger pattern with a
  genuine occurrence, so converting one would require splitting that automation in two.
  Recorded rather than guessed at.

## Revisit when

- A non-admin or tab-scoped automation genuinely needs to share state. That needs an
  explicit ownership model — bucket-to-tab ownership, or namespace grants — and
  specifically not authority inferred from a matching string prefix.
- The same value is wanted both as current state and as history often enough that writing
  `shared.set()` and `db.write()` side by side becomes repetitive. The separation is
  correct; the ergonomics might not be.
- A consumer needs to see a sequence of Shared State changes rather than the latest. That
  is a Collection, or an Automation Event, and wanting it from Shared State is a sign the
  value was modelled in the wrong place.
- The single trigger pattern per rule becomes the thing blocking further migration, as it
  does for the three publishers named above.

## Implementation anchors

- `src/shared-state/shared-state-store.ts`, `shared-state-limits.ts`, `shared-state-types.ts`
- `src/core/event-bus.ts` (`SHARED_STATE_CHANGE`), `src/core/types.ts`
  (`AUTOMATION_TRIGGER_TYPES`, `EventMetadata.sharedState`)
- `src/automations/automation-engine.ts` (`evaluateSharedStateChange`)
- `src/automations/automation-state-store.ts` (idempotent `set`)
- `src/automations/sandbox.ts`, `sandbox-types.d.ts` (the `shared` global)
- `src/api/routes/shared-state.routes.ts`
- `src/simulator/scenarios/off-grid-bunker.ts` (wall time vs accelerated power time)
- `docs/reference/data-and-storage.md`, `docs/reference/automations.md`
- `docs/adr/0006-truthful-command-lifecycle.md`, `docs/adr/0015-first-run-trust-and-mqtt-security.md`
