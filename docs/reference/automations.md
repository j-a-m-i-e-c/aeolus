# Automation runtime

Aeolus script automations are authored as bounded multi-file Automation Projects with backend Logic and an optional custom UI. See [Automation Projects](../architecture/AUTOMATION_PROJECTS.md) for the source, compilation and compatibility model.

## Rule types

### Form rules (runtime only)

Form rules store a trigger, optional condition and action configuration instead of user code. They predate the Logic editor and are no longer authored from the dashboard, but the runtime is fully retained: existing rows load, register, run, toggle and delete as before, and they dispatch through the same action layer as script rules.

### Script rules

Script rules contain an Automation Project. `logic/index.ts` is the default backend entrypoint and `ui/index.tsx` is the optional UI entrypoint. Relative imports resolve only within the project (with React provided externally to the UI sandbox). The project is bundled with esbuild in memory when saved, then the compiled Logic is executed in an isolated V8 context when triggered.

The editor presents one consistent project surface: **Logic**, optional **UI**, and **Files** are primary navigation, with the file tree available when an automation needs additional local modules.

For non-trivial projects, **Logic and UI should be readable orchestration entry points rather than implementation buckets**. They are also not meant to be empty forwarding shims. `logic/index.ts` should expose the important trigger routing and control flow; `ui/index.tsx` should expose state selection, operator intents and high-level composition. Policy internals, device/command plumbing, data projection, demo scaffolding, SVGs and substantial visual components belong in named local modules. The goal is that a reader can understand the project before opening Files, then use Files to inspect how it is implemented.

New Logic uses a normal module entrypoint:

```ts
export default async function run(context: EventContext) {
  log.info(`Triggered by ${context.topic}`);
}
```

The compiler registers the exported function with Aeolus' completion wrapper internally. Existing Project source that explicitly calls `automation({...})` remains accepted for pre-release compatibility, but it is not a second authoring model.

## Triggers

A rule can use:

- an MQTT topic pattern, including `+` and `#` wildcards;
- a five-field cron schedule;
- manual-only mode;
- a UI event fired by its paired custom component.

Cron rules are managed by `CronTimerManager`. The engine creates a normal event context when the schedule fires, so scheduled and MQTT rules use the same execution pipeline.

## Event context

Logic receives a `context` object containing the trigger topic, state payload and timing information. UI-fired events use:

```text
ui/{ruleId}/{eventName}
```

with the UI payload available as `context.state`.

## Isolated Logic execution

`src/automations/sandbox.ts` uses `isolated-vm`.

Each execution receives:

- a fresh isolate;
- a 32 MB memory limit;
- a five-second timeout;
- copied device and event data;
- a restricted set of host functions.

It does not receive Node.js globals, filesystem access, `process` or arbitrary module imports.

The exposed API includes:

- `devices`
- `mqtt`
- `state`
- `db` when Data Store is available
- `events` when the automation-event service is available
- `http`
- `log`
- `context`

Optional capabilities are omitted when their backing service is unavailable; their absence does not prevent otherwise-valid Logic from starting.

The sandbox returns an explicit result for success, runtime failure, timeout, memory failure or runtime unavailability.

Authored `http.get/post` uses the same outbound policy as runtime webhook actions: only public HTTP(S) destinations are allowed; localhost, LAN/private, link-local and reserved addresses are rejected after DNS preflight; redirects are disabled; requests time out after roughly ten seconds; and request/response bodies are bounded. DNS is preflighted before `fetch`, but the transport can resolve again at connection time, leaving a documented DNS preflight-to-connect TOCTOU limitation rather than a claim of perfect DNS pinning.

For module-style Automation Projects, the compiler routes the exported Logic function through the same internal completion machinery used by `automation()`. The host waits for the exported function and drains in-flight device-command promises before resolving, bounded by a 30-second completion budget separate from the 5-second CPU timeout.

Inside a normal `run(context)` function, `devices.action()` returns an `ActionResult`; author code decides whether to throw/return after a failed result before executing later statements. For the compatibility `automation({ actions: [...] })` helper, separate action callbacks are awaited in order and fail-fast after a logical command failure unless `continueOnFailure: true` is set.

## Logic and UI state

Each script automation has private persistent state.

### Logic to UI

```javascript
state.set("mode", "armed");
```

The value is written to SQLite and emitted over WebSocket. The paired UI can read it with:

```javascript
await aeolus.read("mode");
```

### UI to Logic, passive

```javascript
await aeolus.save("target", 25);
```

This stores the value. Logic reads it on a later trigger:

```javascript
const target = state.get("target");
```

### UI to Logic, immediate

```javascript
await aeolus.fire("target-changed", { value: 25 });
```

This runs the Logic immediately with the payload in `context.state`.

`saveAndFire()` is a convenience that performs both operations. Logic handling the immediate event should use `context.state`; persisted state is available to later runs.

## Custom UI sandbox

Custom UI source is transpiled to an ES module and served to a sandbox runtime.

The browser boundary is:

```text
Dashboard
   ↕ MessageChannel
Host SDK broker
   ↕ validated RPC
Opaque-origin iframe
   ↕
Custom React component
```

The iframe uses `sandbox="allow-scripts"` without `allow-same-origin`. It cannot directly access the dashboard DOM, authentication store or access token.

The host exposes a bounded SDK for:

- automation state;
- firing the paired Logic;
- device reads and control;
- MQTT publishing;
- selected history and platform data.

## Actions

Built-in action handlers include:

- MQTT publish;
- device toggle;
- arbitrary device action;
- log;
- delay;
- webhook.

Connectors may contribute additional action handlers and condition factories while enabled.

## Command result model

Aeolus distinguishes several possible stages of a physical command:

```text
REQUESTED
  ├─ FAILED
  └─ DISPATCHED
       ├─ ACKNOWLEDGED
       ├─ OBSERVED
       ├─ TIMED_OUT
       └─ STATE_MISMATCH
```

A command only uses the tiers supported by its path:

- dispatch confirms that Aeolus handed the request to the transport;
- acknowledgement requires a device or connector capable of correlating a response;
- observation uses a specified device-state condition, which may be on another device such as a flow sensor.

The required tier is chosen per command, not per automation: `devices.action(id, type, params, { tier })`. Omitting it is the normal case and means each device independently resolves to the strongest tier it can prove, which is what an automation commanding a mixed fleet wants. A tier the target device cannot prove is clamped down at dispatch, so a reported lifecycle state is always one that was actually reached. Device capability comes from the device itself — `mqtt_command_profile.acknowledgement` for generic MQTT devices, or the owning connector — and is readable via `GET /api/devices/:id/completion-tiers`.

The command framework lives in:

```text
src/automations/command-service.ts
src/automations/command-lifecycle.ts
src/automations/pending-command-tracker.ts
src/automations/command-history-store.ts
src/mqtt/command-envelope.ts
```

### Command identity and durable history

Every verified physical command accepted by `CommandService` is assigned a
stable `commandId` before dispatch, and its `ActionResult` carries it. This is
distinct from `correlationId`, which identifies a confirmation exchange and is
present only for tracked commands.

`CommandHistoryStore` persists one durable record per command plus an immutable
row for each lifecycle transition, so the full `REQUESTED → DISPATCHED →
ACKNOWLEDGED → OBSERVED` (or failure) timeline is queryable after the fact —
independent of automation execution history, since REST and system commands are
also verified commands. Query it through the command API (see
[API reference](api.md)). Handler-resolution and authorization refusals happen
before acceptance and therefore receive no `commandId` and no record.

Completion of the configured wait is recorded by the durable `terminal_at` column (a historical schema name), not by treating every success tier as lifecycle-final. `DISPATCHED` can satisfy a dispatch-only request and `ACKNOWLEDGED` can satisfy an acknowledgement request, while later evidence may still advance the lifecycle when that command remains under observation. Only `OBSERVED`, `FAILED`, `TIMED_OUT` and `STATE_MISMATCH` are lifecycle-final states.

### Restart semantics (no physical replay)

`PendingCommandTracker` is in-memory, so a restart loses live confirmation
waits. At startup Aeolus reconciles any command record whose configured completion wait was still unresolved
(`terminal_at IS NULL`): it becomes lifecycle-final `FAILED` with failure reason
`interrupted` and a matching transition row. Aeolus never re-dispatches or
replays a physical command after a restart — reconciliation only corrects the
audit trail. Reconciliation is idempotent.

## Automation events

An automation can emit a domain event that other automations react to, without
being granted arbitrary MQTT publish authority:

```javascript
events.emit("tank.low", { level: 18, tankId: "header-tank" });
```

Aeolus publishes a versioned envelope to a reserved namespace it owns:

```text
aeolus/events/<sourceRuleId>/<eventName>
```

The `<sourceRuleId>` segment is generated from the executing automation and is
not caller-selectable, so an event can never escape the reserved namespace.
`events.emit()` is available to scoped automations even though raw
`mqtt.publish()` remains forbidden for them — it is not a verified command,
creates no command record, and only ever publishes inside `aeolus/events`.

Another automation subscribes with an ordinary MQTT topic trigger (for example
`aeolus/events/#`); the user payload arrives as `context.state` and causal
metadata as `context.meta`. Automation events never create Device Registry
entries. A bounded causal depth stops an `A → B → A` cycle from publishing
forever.

Provenance metadata (`context.meta`: `eventId`, `causationId`, `traceId`,
`source`, …) is diagnostic only. Because any broker client could forge an
envelope, Aeolus never treats provenance as an authorization credential — a
receiving automation's own authorization scope still governs every command it
attempts.

Source: `src/automations/automation-event-service.ts`.

## Execution history

`ExecutionLog` records recent runs with:

- automation identity;
- trigger context;
- duration;
- success or failure;
- failure reason;
- command completion/lifecycle state where relevant.

The execution log and the live pending-command registry are process memory. Automation state and durable command history (records and transitions) are persistent.

## Main source files

```text
src/automations/automation-engine.ts
src/automations/sandbox.ts
src/automations/transpiler.ts
src/automations/automation-state-store.ts
src/automations/command-service.ts
src/automations/command-result-collector.ts
src/automations/command-lifecycle.ts
src/automations/pending-command-tracker.ts
src/automations/automation-project.ts
frontend/src/components/AutomationProjectEditor.tsx
frontend/src/components/AutomationAuthoringFields.tsx
frontend/src/components/automation-authoring.ts
frontend/src/sandbox/
```
