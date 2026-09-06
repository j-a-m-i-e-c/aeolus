# ADR-0013: Timed physical transitions as a simulator primitive

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

The simulator's job is to behave enough like real hardware that the distinctions
Aeolus makes — dispatched, acknowledged, observed — actually matter. Physical things
move: a winch pays out, a fan spins up, an animal walks across a paddock. Publishing a
single state patch makes them teleport, and a teleporting world quietly destroys the
thing the platform is trying to demonstrate. If a pump reaches full flow in the same
instant the command is accepted, there is no gap for evidence to live in.

`DeviceStateController` offered two ways to move state, and both were wrong for this.

**A delayed update.** `update(patch, { delayMs })` schedules one patch. But
`clampDelay` caps `delayMs` at the controller's `maxDelayMs`, so a movement longer than
the clamp cannot be expressed at all. Scenarios worked around it by chaining several
delayed updates at hand-computed offsets — the research vessel's CTD cast was four
`update` calls at 450/1050/1750/2600 ms, with the winch mirroring them 40 ms later.

**A hand-rolled `setTimeout`.** Most scenarios grew a private `later()` helper and a
`Set` of timer handles. Those timers escaped the controller entirely: they were not
charged to the shared `TimerBudget`, not subject to the delay clamp, and leaked unless
the scenario remembered to clear every handle on dispose. The budget exists because the
public demo is shared and repeated interaction must not grow memory without bound, so a
mechanism that routes around it defeats its purpose.

Both approaches also lacked two things the scenarios kept needing:

- **Identity, so a movement can be replaced.** A repeated interaction raced its own
  animation. Concretely: a predator that flees when the deterrent spins up and an animal
  that wanders off on its own are the same creature moving; without a way to say "this
  supersedes that", both sequences write to `distanceM` and the animal jitters between
  two positions.
- **A settle hook.** "What happens when the movement finishes" needed yet another
  hand-rolled timer at a hand-computed offset, which drifts the moment the movement's
  duration changes.

## Decision

Add `transition()` to `SimulatedStateController` as the supported way to move physical
state over time.

```ts
controller.transition({
  durationMs: 9000,
  steps: 14,
  group: "den-temp",
  frame: (progress) => ({ temp: from + (to - from) * progress }),
  onSettled: (completed) => { if (completed) heatLoadPassed(); },
});
```

- **One outstanding timer per transition, not per step.** A long movement costs a single
  `TimerBudget` slot regardless of how many steps it has.
- **`durationMs` may exceed `maxDelayMs`.** Each step's interval is clamped
  individually and the total is reached by chaining them, so the clamp still bounds how
  long the runtime can be made to wait for any one publish while a movement remains
  free to take as long as the physics needs.
- **`group` gives a movement identity.** Starting a transition in a group cancels any
  running transition on that device in the same group, so a repeated interaction
  replaces its animation instead of fighting it. `cancelTransitions(group?)` scopes a
  reset to one domain — a scenario reset can stop the animal moving without disturbing
  the fan spinning down.
- **`onSettled(completed)`** fires exactly once, with `false` when cancelled, so a
  follow-on effect is expressed as a consequence of the movement ending rather than as
  a second timer racing it.
- **`forcePublish` defaults to true.** Interpolated steps frequently round to the same
  serialized payload, and the controller's no-op suppression would silently drop them —
  movement the operator is meant to watch must not be optimised away as unchanged.
- **Budget exhaustion collapses rather than queues.** When the shared budget is spent,
  every frame is applied at once and only the final state is published. The end state
  stays correct, an interaction storm cannot grow memory, and the operator sees the
  outcome instead of a burst of intermediate publishes.
- **`dispose()` cancels transitions first,** which releases their budget slots. A
  scenario can no longer leak a movement by forgetting to track a handle.

## Why this fits Aeolus

The controller is already the single path through which physical state changes: it
serializes updates, suppresses no-op publishes, clamps delays and charges the timer
budget. A movement is a sequence of state changes, so it belongs behind that same door.
Every property the controller was built to guarantee then holds for movements too,
without each scenario re-deriving them.

It also makes the honest version of a scenario the easy one. Before, "the fan reaches
speed over 1.1 seconds and the animal reacts when it does" was a chain of timers and
offsets; now it is a transition whose frame reports the tachometer and calls the
reaction when the reading crosses the threshold. The physical cause and the physical
effect end up adjacent in the code, which is the property that stops panes inventing
their own motion.

## Alternatives considered

### Keep chaining delayed updates

No new API, and it works for short movements. Rejected because `maxDelayMs` bounds each
one, so the pattern forces hand-computed offset arithmetic that has to be re-derived
whenever a duration changes, and it still offers no cancellation or settle hook. The
CTD cast is the evidence: four hard-coded offsets that could not express "the wire moves
at 0.9 m/s, so a deeper cast takes proportionally longer".

### A scenario-level animation helper

Each scenario keeps its `later()` and a shared utility interpolates for it. Cheapest to
add, and it was effectively the status quo. Rejected because the timers stay outside the
controller: still unbudgeted, still unclamped, still leakable. The problem was never the
interpolation arithmetic.

### One global tick loop driving all animations

A single interval advancing every active movement. Attractive for coordination and it
caps total timers at one. Rejected because it couples unrelated devices to a shared
clock, makes per-device disposal awkward, and turns a per-device concern into global
mutable scheduling state. The per-controller design keeps a movement owned by the device
it belongs to, which is also what makes `group` cancellation local and obvious.

### Let the UI interpolate between known states instead

The panes could animate smoothly between telemetry points, leaving the simulator to
publish sparsely. This remains legitimate for *visual smoothing* and the showcase rules
say so. Rejected as the answer here because the interpolated values would exist only in
the browser: two panes watching the same device would invent different positions, and no
automation could act on the movement. The analysis pass was largely about removing
exactly that class of fiction.

## Consequences

### Positive

- Movements are bounded, cancellable, budgeted and disposed by construction.
- A scenario reset can stop one domain without disturbing others.
- Physical cause and effect sit together, which is what let the wildlife deterrent be
  verified by its tachometer and the den fan by the temperature actually falling.
- Duration can express real speed, so a 420 m CTD cast genuinely takes longer than a
  60 m one and depth cannot disagree with time.

### Negative / accepted trade-offs

- `frame` runs on the host and can have side effects. That is deliberately useful for
  cross-device consequences — a fan reaching speed turning an animal away — but it is
  power that can be misused. A frame doing I/O, or writing to a device unrelated to the
  movement, would be a bug the type system does not prevent.
- Behaviour differs under load. With the budget exhausted a movement collapses to its
  end state, so a heavily-used public demo shows less motion than a quiet one. Correct
  for a shared box, but it means "what the operator sees" is not purely a function of
  the scenario.
- **`maxDelayMs: 0` collapses every transition into a single tick.** Test harnesses use
  that setting, so any `advanceTimersByTime` runs a whole movement to completion and
  there is no mid-movement state to observe. Tests that need to interrupt a movement
  must pass a real clamp instead. This is the sharpest edge in practice and cost real
  time during the scenario work before it was understood.
- Two moving parts now bound a movement — `durationMs`/`steps` and the clamp — so a
  scenario author has to think about step granularity rather than just an end state.

## Revisit when

- A movement needs to be driven by something other than elapsed time, such as a
  simulated flow integrating to a volume. That is a different primitive, and expressing
  it as a time-based transition with a computed frame would be a lie about what is
  driving it.
- Coordinated movement across devices becomes common enough that per-device groups are
  the wrong unit. Today the cross-device cases are one-directional consequences, which
  frames handle; a genuine multi-device choreography would justify revisiting the
  rejected shared-scheduler design.
- The budget-exhaustion fallback starts being hit in normal use rather than under abuse,
  which would mean the budget is sized wrong rather than the fallback being wrong.

## Implementation anchors

- `src/simulator/state-controller.ts` (`transition`, `cancelTransitions`, `dispose`)
- `src/simulator/types.ts` (`StateTransitionOptions`, `StateTransition`)
- `src/simulator/timer-budget.ts`
- `src/simulator/scenarios/agriculture.ts`, `wildlife.ts`, `research-vessel.ts`,
  `off-grid-bunker.ts` (adopters)
- `docs/adr/0006-truthful-command-lifecycle.md`
