# Custom UI SDK: state, events and operator intent

A custom Automation Project UI talks to its paired Logic through a small host-provided SDK. The important design choice is that **state** and **events** are different things.

Use this rule of thumb:

| What the UI means | Use | What happens |
|---|---|---|
| "Show me the current application state" | `aeolus.read(key)` | Reads the UI's local mirror of private Automation State |
| "Remember this value for later" | `aeolus.save(key, value)` | Persists state; Logic does not run just because it was saved |
| "This happened; deal with it now" | `aeolus.fire(eventName, payload?)` | Runs the paired Logic immediately with a named UI event |
| "Remember this new value and react now" | `aeolus.saveAndFire(key, value)` | Atomically persists the value and runs Logic with a `state-set` event |

In shorter form:

```text
save()        = state
fire()        = event
saveAndFire() = state + event
```

This separation keeps the UI from turning every setting into an action or every action into hidden persistent state.

## Logic to UI: project state with `state.set()`

Logic owns the application's interpretation of devices and events. It can project the values its UI needs into private Automation State:

```ts
state.set("waterSummary", {
  tankLevel: 72,
  pumpRunning: true,
  healthy: true,
});
```

The paired UI reads that projection:

```tsx
const water = aeolus.read("waterSummary") as {
  tankLevel: number;
  pumpRunning: boolean;
  healthy: boolean;
} | undefined;
```

`state.set()` persists the value and Aeolus pushes changes to the paired UI. The UI does not need to understand the raw tank sensor, pump relay, flow sensor or fault inputs that produced the summary.

## `save()`: remember this

Use `save()` for durable application state or configuration when changing the value should **not by itself run Logic**.

```tsx
function TransferTarget(aeolus: CustomComponentProps) {
  const current = Number(aeolus.read("transferTargetLitres") ?? 500);

  return (
    <input
      type="number"
      defaultValue={current}
      onBlur={(event) => {
        aeolus.save("transferTargetLitres", Number(event.currentTarget.value));
      }}
    />
  );
}
```

Logic can read the stored value on a later trigger:

```ts
const targetLitres = Number(state.get("transferTargetLitres") ?? 500);
```

The meaning is:

> The transfer target is now 750 litres. Remember that setting.

It is **not**:

> Start transferring water now.

## `fire()`: this happened

Use `fire()` for a discrete operator intent or occurrence that Logic should handle immediately.

```tsx
<button onClick={() => aeolus.fire("start-transfer")}>
  Start transfer
</button>
```

Logic receives:

```ts
export default async function run(context: EventContext) {
  if (context.topic.endsWith("/start-transfer")) {
    const targetLitres = Number(state.get("transferTargetLitres") ?? 500);
    // Apply policy, check state and request the appropriate device action.
  }
}
```

A payload can carry data that belongs to that one event:

```tsx
aeolus.fire("send-hint", { strength: "medium" });
```

The payload arrives in `context.state`, but `fire()` does not make it durable application state.

## `saveAndFire()`: remember this and react now

Use `saveAndFire()` when a value is both durable state **and** its change should wake Logic immediately.

A setpoint or operating mode is a typical example:

```tsx
<button onClick={() => aeolus.saveAndFire("operatingMode", "automatic")}>
  Automatic
</button>
```

Aeolus performs one bounded server operation that:

1. persists `operatingMode = "automatic"`;
2. immediately fires Logic with topic `ui/<ruleId>/state-set`;
3. supplies `{ key: "operatingMode", value: "automatic" }` in `context.state`.

Logic handling the immediate event should use `context.state`. Future executions can read the persisted value with `state.get()`.

The important difference from calling `save()` and `fire()` separately is that `saveAndFire()` is the platform's atomic persist-and-wake operation.

## Choosing between `save()` and `saveAndFire()`

Ask one question:

> If the user changes this value, should Logic do work immediately?

If **no**, use `save()`:

```text
Transfer amount: 750 L
Logging preference: compact
Operator note: north tank inspected
```

If **yes**, use `saveAndFire()`:

```text
Operating mode: automatic
Desired tank level: 85%
Control strategy: drought
```

A UI can also separate state from action explicitly:

```text
Transfer amount
[ 750 L ]        -> save("transferTargetLitres", 750)

[ Start transfer ] -> fire("start-transfer")
```

That is often clearer than making every edit immediately execute Logic.

## Prefer intent through Logic when Logic owns the decision

Custom UIs also have `aeolus.control()` for direct operator device actions. Use it when the UI really is the direct control surface for that device.

When the action belongs to an automation's policy, prefer:

```text
UI
  ↓ aeolus.fire("start-transfer")
Logic
  ↓ policy / interlocks / current state
 devices.action(...)
  ↓
Command Service and Command Evidence
```

This keeps the decision in backend Logic, where the automation can apply policy and reason about physical state. It also keeps the UI focused on expressing operator intent rather than duplicating control rules.

The UI type declarations make the same distinction: `control()` is available for direct operator actions, while `fire()` is preferred when the decision belongs to the automation.

## How the four methods fit together

A typical full-stack Automation Project looks like this:

```text
physical devices / events
          ↓
        Logic
          ↓
state.set() projects clean application state
          ↓
     aeolus.read()
          ↓
          UI
       ↙      ↘
  save()      fire()
 setting       intent
       \      /
        Logic later / now

saveAndFire() is the deliberate combination when a durable state change
must also wake Logic immediately.
```

These methods all use the automation's private state and interaction boundary. They do not turn private Automation State into Shared State. Use [`shared`](data-and-storage.md#shared-automation-state) only when one automation intentionally needs to publish current truth for other automations.

## Related reference

- [Automation runtime](automations.md) for Logic execution, private state and the UI sandbox.
- [API and WebSocket](api.md) for the HTTP operations behind state writes and manual/UI firing.
- [Data and storage](data-and-storage.md) for private Automation State, Shared State, Collections and Events.
- [Why Aeolus?](../WHY_AEOLUS.md) for the product and architecture rationale behind paired Logic and UI.
