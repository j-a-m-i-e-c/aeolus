# Automation runtime

Aeolus automations can be created as simple form rules or as free-form Logic with an optional custom UI.

## Rule types

### Form rules

Form rules store a trigger, optional condition and action configuration. They are useful for straightforward behaviour without writing code.

### Script rules

Script rules contain TypeScript or JavaScript source. Source is transpiled with esbuild when saved, then executed in an isolated V8 context when triggered.

The Logic editor is the primary authoring surface. The `automation()` helper is optional shorthand, not a requirement.

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
- `db`
- `http`
- `log`
- `context`

The sandbox returns an explicit result for success, runtime failure, timeout, memory failure or runtime unavailability.

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

The command framework lives in:

```text
src/automations/action-executor.ts
src/automations/command-lifecycle.ts
src/automations/pending-command-tracker.ts
src/mqtt/command-envelope.ts
```

## Execution history

`ExecutionLog` records recent runs with:

- automation identity;
- trigger context;
- duration;
- success or failure;
- failure reason;
- terminal lifecycle state where relevant.

The current execution log and pending-command registry are process memory, while automation state is persistent.

## Main source files

```text
src/automations/automation-engine.ts
src/automations/sandbox.ts
src/automations/transpiler.ts
src/automations/automation-state-store.ts
src/automations/action-executor.ts
src/automations/command-lifecycle.ts
src/automations/pending-command-tracker.ts
frontend/src/components/ScriptEditor.tsx
frontend/src/components/UiEditor.tsx
frontend/src/sandbox/
```
