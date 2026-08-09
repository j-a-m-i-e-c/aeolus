# Design Document

## Overview

This design extends the current Aeolus command and event architecture. It deliberately avoids replacing working components.

The target is a backend capable of proving two things before later demo/UI work begins:

1. a generic MQTT command can move through the same verified lifecycle as a connector command and leave a durable transition trail;
2. one automation can emit a constrained domain event over MQTT and another automation can react to it without either automation being granted arbitrary control-plane access.

## Current architecture to preserve

```text
Command source
  |  script / form / REST / dashboard / custom UI / system
  v
CommandService
  |
  +-- resolve confirmation capability/tier
  +-- assign correlation when tracked
  +-- register PendingCommandTracker before dispatch
  v
ConnectorManager
  v
ActionRouter
  |                    |
  | connector device   | generic MQTT device
  v                    v
Connector.execute()   MqttService.publish()
                         |
                         +-- correlationData / responseTopic when supplied

MQTT ack topic ---------------------> PendingCommandTracker.route()
MQTT device state -----------------> PendingCommandTracker.observeState()
                                     |
                                     v
                                ActionResult
```

The weak point is not the envelope/ACK parser. The weak point is that generic MQTT devices do not currently return an acknowledgement capability from `ActionRouter.getAcknowledgementCapability()`.

## Design principles

1. **Extend, do not fork.** Use the existing lifecycle, `CommandService`, tracker, MQTT service, device registry, execution IDs, and event bus.
2. **Identity and transport correlation are separate.** `commandId` identifies the Aeolus command. `correlationId` identifies a confirmation exchange.
3. **Persist facts, not guesses.** The durable timeline records transitions that actually occurred.
4. **No physical replay on restart.** Recovery changes the audit record, not the physical world.
5. **Events are not commands.** Automation Events are domain messages and never claim physical acknowledgement.
6. **Scoped automation communication is capability-safe.** Add a narrow event emission capability rather than relaxing raw MQTT restrictions.
7. **Provenance is diagnostic, not authorization.** MQTT is a transport; a payload can be forged by a broker client.
8. **Backend first.** Phase 1 exposes data and events needed by a later UI but does not design that UI.

# 1. Command identity and persistent timeline

## 1.1 Types

Add a stable command identity to the existing result model.

Recommended additive type changes:

```ts
export interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  lifecycleState?: CommandLifecycleState;
  commandId?: string;
  correlationId?: string;
  failureKind?: ActionFailureKind;
}
```

`commandId` should be present on every result produced by `CommandService` for a Verified Command. Keep it optional at the shared interface boundary only if necessary for compatibility with connector-local `ActionResult` values that exist below the command boundary.

Add a command record model owned above `ConnectorManager`:

```ts
export type CommandSourceKind = "automation" | "rest" | "system";

export interface CommandRecord {
  commandId: string;
  correlationId?: string;
  sourceKind: CommandSourceKind;
  sourceId?: string;
  ruleId?: string;
  executionId?: string;
  causationId?: string;
  targetDeviceId: string;
  actionType: string;
  requestedTier?: ConfirmationTier;
  effectiveTier: ConfirmationTier;
  lifecycleState: CommandLifecycleState;
  success?: boolean;
  failureKind?: ActionFailureKind | "interrupted";
  error?: string;
  requestedAt: number;
  terminalAt?: number;
}

export interface CommandTransition {
  id: number;
  commandId: string;
  fromState?: CommandLifecycleState;
  toState: CommandLifecycleState;
  timestamp: number;
  details?: Record<string, unknown>;
}
```

Do not store the observation predicate/closure in SQLite. It is runtime code and is not safe/useful to deserialize after restart.

## 1.2 Persistence

Use the next available migration number at implementation time. At the reviewed baseline, `012-automation-demo-access.ts` is the latest migration, so this would likely begin at 013. Do not hardcode 013 if another branch change has already consumed it.

Recommended tables:

```sql
CREATE TABLE command_records (
  command_id TEXT PRIMARY KEY,
  correlation_id TEXT,
  source_kind TEXT NOT NULL,
  source_id TEXT,
  rule_id TEXT,
  execution_id TEXT,
  causation_id TEXT,
  target_device_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  requested_tier TEXT,
  effective_tier TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  success INTEGER,
  failure_kind TEXT,
  error TEXT,
  requested_at INTEGER NOT NULL,
  terminal_at INTEGER
);

CREATE TABLE command_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  details TEXT,
  FOREIGN KEY(command_id) REFERENCES command_records(command_id) ON DELETE CASCADE
);

CREATE INDEX idx_command_records_requested_at
  ON command_records(requested_at DESC);
CREATE INDEX idx_command_records_target_time
  ON command_records(target_device_id, requested_at DESC);
CREATE INDEX idx_command_records_execution
  ON command_records(execution_id, requested_at DESC);
CREATE UNIQUE INDEX idx_command_records_correlation
  ON command_records(correlation_id)
  WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_command_transitions_command
  ON command_transitions(command_id, id);
```

SQLite schema should use the project's existing migration/test conventions.

### Locked persistence invariants

These are decided, not advisory.

- **`terminal_at` is authoritative for lifecycle completeness, not the state name.** A command requires no further lifecycle transition **if and only if** `terminal_at IS NOT NULL`. Queries for "in-flight" commands (including restart reconciliation) MUST use `terminal_at IS NULL` plus `effective_tier`, never `lifecycle_state NOT IN (...)`. This is required because `DISPATCHED` is terminal for a dispatch-only command and non-terminal for an acknowledged/observed command.
  - dispatch-only, `DISPATCHED`, `terminal_at` set -> complete;
  - acknowledged/observed, `DISPATCHED`, `terminal_at = NULL` -> still in-flight.
- **A dispatch-only success MUST write `terminal_at` in the same transition that writes `DISPATCHED`.** If `terminal_at` is left `NULL` on a dispatch-only success, restart reconciliation cannot distinguish a finished dispatch-only command from a tracked command stalled at `DISPATCHED`, and would wrongly mark it interrupted.
- Every terminal transition (`FAILED`, `OBSERVED`, `TIMED_OUT`, `STATE_MISMATCH`, and dispatch-only `DISPATCHED`) sets `terminal_at`. Non-terminal transitions leave it `NULL`.

## 1.3 `CommandHistoryStore`

Add a small focused component rather than putting SQL throughout `CommandService`.

Suggested path:

`src/automations/command-history-store.ts`

Suggested API:

```ts
interface CommandHistoryStore {
  create(record: CommandRecord): void;
  setCorrelation(commandId: string, correlationId: string): void;
  transition(input: {
    commandId: string;
    fromState?: CommandLifecycleState;
    toState: CommandLifecycleState;
    timestamp: number;
    success?: boolean;
    failureKind?: string;
    error?: string;
    terminal: boolean;
    details?: Record<string, unknown>;
  }): void;
  get(commandId: string): CommandRecordWithTransitions | undefined;
  list(filter: CommandHistoryFilter): CommandRecord[];
  reconcileInterrupted(now: number): number;
}
```

`transition()` should update the summary row and append an immutable transition in one SQLite transaction. A `transition()` that reaches a terminal outcome (including dispatch-only `DISPATCHED`) MUST set `terminal_at`; a non-terminal transition MUST leave it `NULL`. This is what makes the `terminal_at`-authoritative invariant in §1.2 enforceable in one place.

The store must not define its own permissive lifecycle. Callers should continue to use `canTransition()` / existing lifecycle helpers.

### Store boundary is DB-owning; the tracker stays DB-free (locked)

`CommandHistoryStore` is the only component that talks to SQLite for command history. `PendingCommandTracker` MUST NOT depend on it and MUST NOT perform any database access during normal lifecycle processing. The tracker remains transport- and persistence-agnostic exactly as it is today (it owns an in-memory `Map` and `onResolve` / `onLateMessage` callbacks only).

Persistence is driven from the composition layer, not from inside the tracker:

```text
PendingCommand.commandId    attached at register()
        |
        v
tracker transition/resolution  -> onTransition({ commandId, fromState, toState, ... })
        |
        v
composition adapter          -> commandHistoryStore.transition(...)
```

This mirrors how `MqttService` receives an injected `ackRouter` rather than importing the tracker. It keeps both units independently unit-testable: the store without an MQTT runtime (Checkpoint 2) and the tracker without a database.

# 2. CommandService integration

## 2.1 Command creation (locked ordering)

`commandId` identifies a command Aeolus **accepted into the execution pipeline**, not every attempted API call. Handler-resolution and scope/authorization failures are request-level failures that happen *before* acceptance: they return a refusal with **no `commandId` and no command record**. Once a `commandId` exists, every subsequent failure is durable (`REQUESTED -> FAILED`).

The ordering is fixed:

1. resolve the handler; if none, return a request-level failure (no `commandId`, no record);
2. apply the scope/authorization gate; if refused, return the refusal (no `commandId`, no record);
3. allocate `commandId = randomUUID()` and determine source/provenance values;
4. resolve acknowledgement capability and effective tier — these are side-effect-free reads (registry lookup plus tier selection; an over-request clamp only logs), so they run **before** the first durable write;
5. create the durable `REQUESTED` record and `REQUESTED` transition, complete on first insert: `commandId`, `requestedTier`, `effectiveTier`, source/provenance, and `correlationId` when the command will be tracked. This avoids a write-then-update solely to backfill `effectiveTier` (Req 3.2);
6. proceed through the existing dispatch path.

Rationale for steps 3-5 (refinement A): `effectiveTier` is only known after capability resolution, and Req 3.2 requires it on the record. Because capability/tier resolution has no side effects, folding it in before the `REQUESTED` write lets the record be born complete in a single insert.

Any failure discovered **after** step 3 — for example the observed-device-not-found guard, invalid post-acceptance command metadata, transport failure, or connector rejection — is recorded as `REQUESTED -> FAILED` so later history explains the rejection. If the call is not a physical command at all (for example raw `publish`), no `commandId` is allocated and no command record is created.

Do not accidentally classify `handlePublish` as a Verified Command. The existing `CommandService` has built-in non-device actions; the history hook must be limited to physical `device_action`/`toggle` (and any future explicitly classified physical command types), not every handler registered in the service.

Consider introducing an explicit action classification helper rather than scattering string checks:

```ts
function isVerifiedPhysicalAction(action: ActionDescriptor): boolean {
  return action.type === "device_action" || action.type === "toggle";
}
```

If current form/device actions use another physical type, include it after repository audit.

## 2.2 Per-transition recording

`CommandService` directly owns `REQUESTED`, dispatch success/failure, and terminal return. `PendingCommandTracker` can observe an intermediate `ACKNOWLEDGED` transition before a later `OBSERVED`, so the tracker needs a transition callback rather than only its current final resolution hook.

Two decisions are locked here (decisions 6 and 7):

**`PendingCommand` carries `commandId` directly.** The tracker MUST NOT translate `correlationId -> commandId` through a database lookup during lifecycle processing. `CommandService` already knows the `commandId` when it registers the pending command, so it passes it in:

```ts
interface PendingCommand {
  commandId: string;
  correlationId: string;
  ...
}
```

**The tracker reports transitions; it does not persist them.** Add a transition callback alongside the existing hooks so intermediate transitions (e.g. `ACKNOWLEDGED` while still awaiting `OBSERVED`) can be attributed and recorded by the composition layer:

```ts
export interface PendingCommandTrackerDeps {
  onTransition?: (event: PendingCommandTransition) => void;
  onResolve?: (...existing...) => void;
  onLateMessage?: (...existing...) => void;
}
```

`PendingCommandTransition` MUST include `commandId` (carried from `PendingCommand`), and at least previous state, new state, timestamp, and optional error/details. Because `commandId` travels with the event, the composition adapter records the transition through `CommandHistoryStore` with no correlation-to-command DB lookup, keeping the tracker DB-free (§1.3).

Transition ordering for an observed MQTT command should be:

```text
REQUESTED
   |
   v
DISPATCHED
   |
   v
ACKNOWLEDGED     (if device ACK capability is used and ACK arrives)
   |
   v
OBSERVED
```

An observation-only command can legitimately go:

```text
REQUESTED -> DISPATCHED -> OBSERVED
```

A dispatch-only command is terminal at:

```text
REQUESTED -> DISPATCHED
```

Terminality is dependent on effective completion tier. Do not globally redefine `DISPATCHED` or `ACKNOWLEDGED` as always terminal/nonterminal.

## 2.3 Automation execution linkage

`CommandResultCollector` already uses `AsyncLocalStorage<string>` for the active `executionId`. Reuse this context instead of creating an unrelated global.

This is the highest-risk integration point in Phase 1. It is not merely `record.executionId = executionId`: it means the command boundary gains awareness of the automation execution context. The constraint (decision 3) is that `CommandService` **reads** an optional execution context through a narrow abstraction and does **not** become coupled back to the automation runtime. Avoid any dependency chain like `CommandService -> AutomationEngine -> ExecutionManager`.

Consume a narrow, read-only boundary — conceptually:

```ts
interface ExecutionContextProvider {
  current(): {
    executionId?: string;
    causationId?: string;
    automationId?: string;
  } | undefined;
}
```

Backed by the existing `AsyncLocalStorage` in `CommandResultCollector` (reuse the ALS helper directly if that stays clean). When `CommandService` builds command provenance it reads `current()` and attaches `executionId` / `causationId` when present. Commands originating outside an automation — dashboard controls, REST, connector operations — simply see `undefined` and carry no execution context, which preserves the single unified command path. Never pass execution IDs through user-authored script data.

**Silent-failure guard (required test).** The failure mode of this design is quiet: if any automation-originated command path runs *outside* the ALS scope, `current()` returns `undefined` and causation drops with no error. Add a test asserting the execution context is actually present on every automation-originated command path — sandbox host callbacks, form-rule closures, and `executeSequence` — so a future refactor cannot silently regress it.

# 3. Generic MQTT command profile

## 3.1 Device model

Keep the existing `Device.commandTopic` as the explicit command topic. Add only the data that is currently missing.

Recommended shared type:

```ts
export interface MqttCommandProfile {
  qos?: 0 | 1 | 2;
  acknowledgement?: {
    supported: boolean;
    responseTopic?: string;
    ackIndicatorField?: string;
    ackIndicatorValues?: string[];
  };
}

export interface Device {
  ...existing;
  mqttCommandProfile?: MqttCommandProfile;
}
```

Persist the profile as validated JSON in a new nullable device column, or in a dedicated table if repository conventions strongly favour that. A nullable JSON column is adequate for the current one-row-per-device registry model.

## 3.2 Capability resolution

Do not add a second acknowledgement resolver inside `CommandService` if the existing `ConnectorManager -> ActionRouter` path can be made generic.

Preferred change:

```ts
ActionRouter.getAcknowledgementCapability(deviceId)
```

should:

1. resolve the Device;
2. if `device.integration === "mqtt"`, translate `device.mqttCommandProfile?.acknowledgement` into the existing `AcknowledgementCapability` shape;
3. otherwise preserve current connector-owned lookup.

This also makes `ConnectorManager.getCompletionTierCapability()` correctly report acknowledged capability for MQTT devices without special casing elsewhere.

## 3.3 QoS

`MqttService.publish()` currently supports MQTT 5 properties and retain but not a QoS option. Add optional `qos?: 0 | 1 | 2` and pass it to the MQTT client publish options.

`ActionRouter.executeMqttAction()` should read `device.mqttCommandProfile?.qos` and pass it when publishing a device command.

Default behaviour must remain unchanged when no QoS is configured.

## 3.4 Profile API

Add authenticated routes following existing API/router conventions, for example:

```text
GET  /api/devices/:id/mqtt-command-profile
PUT  /api/devices/:id/mqtt-command-profile
```

Only generic MQTT devices should accept the profile. Validate:

- boolean `supported`;
- QoS only 0, 1, 2;
- response topic is a concrete publish topic, not a wildcard subscription;
- indicator field is bounded string;
- indicator values are bounded string array;
- no credentials/secrets accepted.

The exact authorization middleware should match existing control-relevant device mutation routes. Do not invent a weaker public path.

# 4. Restart reconciliation

`PendingCommandTracker` stays in-memory in Phase 1. Persisting arbitrary observation predicates across restart is not safe and physical action replay is not acceptable by default.

At startup, after migrations/store construction and before presenting the runtime as ready, call:

```ts
commandHistoryStore.reconcileInterrupted(Date.now())
```

Per the locked invariant in §1.2, the candidate set for reconciliation is defined by `terminal_at IS NULL`, never by the lifecycle state name. The query selects `WHERE terminal_at IS NULL` and then uses `effective_tier` to decide the interrupted outcome. It MUST NOT use `lifecycle_state NOT IN (...)`, because `DISPATCHED` is terminal for a dispatch-only command (its `terminal_at` is set) and non-terminal for an acknowledged/observed command.

Examples (note each hinges on `terminal_at`, not the state name):

- effective tier `dispatch`, state `DISPATCHED`, `terminal_at` set -> leave alone (already complete);
- effective tier `acknowledged`, state `DISPATCHED`, `terminal_at IS NULL` -> `FAILED` with `failure_kind = "interrupted"`;
- effective tier `observed`, state `ACKNOWLEDGED`, `terminal_at IS NULL` -> `FAILED` interrupted;
- any record with `terminal_at` set (`TIMED_OUT`/`FAILED`/`STATE_MISMATCH`/`OBSERVED`, or a completed dispatch-only `DISPATCHED`) -> leave alone.

Use the existing lifecycle guard for the transition, and set `terminal_at` on the interrupted `FAILED` write so reconciliation is idempotent across repeated startups. Add no `INTERRUPTED` lifecycle state in this phase.

# 5. Event provenance contract

## 5.1 Additive event metadata

Recommended type:

```ts
export type EventSourceKind =
  | "mqtt-device"
  | "connector"
  | "automation"
  | "ui"
  | "cron"
  | "rest"
  | "system";

export interface EventMetadata {
  eventId: string;
  timestamp: number;
  source: {
    kind: EventSourceKind;
    id?: string;
  };
  causationId?: string;
  correlationId?: string;
  ruleId?: string;
  executionId?: string;
  traceId?: string;
  depth?: number;
}
```

Add optional `meta?: EventMetadata` to `NormalizedEvent`, `EventContext`, and `SandboxContext` rather than wrapping/replacing their existing fields.

Where Aeolus originates an event, it should generate metadata. Where ordinary legacy MQTT state arrives with no Aeolus envelope, generate a fresh inbound `eventId` and identify it as `mqtt-device`.

When connector ingestion creates a `NormalizedEvent`, likewise attach a generated event ID and connector source identity where available.

## 5.2 Causation propagation

During automation execution, retain the triggering `context.meta?.eventId`.

Commands issued by that execution should persist:

- `executionId`;
- `ruleId`;
- `causationId = triggering eventId` where available.

Automation Events emitted by that execution should create a **new** event ID and set:

- `causationId = triggering eventId`;
- `ruleId = current rule`;
- `executionId = current execution`.

Do not reuse one event ID across multiple logical events. The first event in a chain should establish a `traceId` (normally its own `eventId`); descendants retain that `traceId` and increment `depth`.

# 6. Safe Automation Event service over MQTT

## 6.1 Reserved topic contract

Default reserved namespace:

```text
aeolus/events/<sourceRuleId>/<eventName>
```

Aeolus generates `<sourceRuleId>` from the executing rule. User code supplies only `<eventName>` and payload.

`eventName` may contain a small path if useful (for example `tank/low`), but validate every segment. Recommended rules:

- 1 to 128 characters total;
- segments contain alphanumeric, `_`, `-`, `.`;
- no `+`, `#`, NUL, leading `/`, trailing `/`, or `..` traversal-like segment;
- caller cannot prefix/escape `aeolus/events`.

## 6.2 Envelope

Recommended v1 envelope:

```ts
export interface AutomationEventEnvelopeV1 {
  schema: "aeolus.automation-event.v1";
  name: string;
  payload: Record<string, unknown> | unknown;
  meta: EventMetadata;
}
```

Keep payload JSON-serializable and enforce a bounded serialized size consistent with existing MQTT limits/security policy. Enforce a maximum causal depth (recommended default: 16). If `depth` is already at the maximum, `events.emit()` must refuse the next hop rather than publishing it. This is a runtime safety guard against A -> B -> A feedback loops, not a substitute for sensible automation logic.

## 6.3 `AutomationEventService`

Suggested path:

`src/automations/automation-event-service.ts`

Responsibilities:

- validate event name and payload;
- resolve trusted current `ruleId` / `executionId` from host context;
- generate event ID/causation metadata;
- construct the reserved topic;
- publish the versioned envelope through `MqttService`;
- return a small result (`eventId`, `topic`, `published: true/false`) without pretending it is a physical command result.

It should not depend on `CommandService`.

## 6.4 Sandbox API

Expose:

```js
const emitted = events.emit("tank.low", {
  level: 18,
  tankId: "header-tank"
});
```

Prefer a promise/result if MQTT publish can fail synchronously due to disconnection. The result should be truthful about broker/client acceptance only.

Scoped automations may call `events.emit()`. They remain blocked from arbitrary `mqtt.publish()` by `CommandService.checkScope()` / sandbox plumbing.

## 6.5 MQTT ingestion

`MqttService` currently:

1. emits `MQTT_RAW_MESSAGE`;
2. routes ACK topics specially;
3. ignores configured discovery-control topics;
4. otherwise parses device state and emits `DEVICE_STATE_CHANGE`.

Add an Automation Event branch after raw-message emission and before device discovery parsing:

```text
raw message signal
  |
  +-- ACK namespace -> ack router -> return
  |
  +-- automation event namespace -> validate envelope -> AUTOMATION_EVENT -> return
  |
  +-- ignored discovery/control topic -> return
  |
  +-- ordinary MQTT -> device normalization/discovery
```

This guarantees event topics remain visible in the MQTT inspector while never becoming phantom devices.

Add a typed internal constant, for example:

```ts
export const AUTOMATION_EVENT = "automation:event" as const;
```

The engine listens for it and topic-matches rules similarly to MQTT device events but does **not** call the device-scope admission check.

The resulting `EventContext` can use:

```ts
{
  topic,
  deviceId: "", // non-device event; keep existing shape
  state: envelope.payload as Record<string, unknown>,
  timestamp: envelope.meta.timestamp,
  meta: envelope.meta
}
```

If payload is not an object, normalize it to `{ value: payload }` so existing `EventContext.state` remains a record.

Do not pretend the source rule is a device ID.

## 6.6 External/spoofed event payloads

Because a broker client can publish to the namespace unless broker ACLs prevent it, the receiver must not use payload provenance as an authorization credential.

If the event was published by `AutomationEventService`, the metadata is host-generated. If the same envelope arrives from an external client, treat source metadata as descriptive only. Existing automation authorization still applies to any command the receiving automation attempts.

# 7. Backend observability

## 7.1 Internal events

Add:

```ts
COMMAND_LIFECYCLE_TRANSITION = "command:lifecycle-transition"
AUTOMATION_EVENT = "automation:event"
```

Emit lifecycle transition only after durable storage succeeds, so a WebSocket subscriber can immediately query the command record it was told exists.

Suggested lifecycle payload:

```ts
{
  commandId,
  correlationId?,
  targetDeviceId,
  sourceKind,
  ruleId?,
  executionId?,
  fromState?,
  state,
  timestamp,
  terminal,
  success?
}
```

## 7.2 REST API

Suggested endpoints:

```text
GET /api/commands?limit=50&deviceId=&ruleId=&executionId=&state=&sourceKind=
GET /api/commands/:commandId
```

Default limit: 50. Maximum: use an established repository convention, or 200 if none exists. Sort newest first for list; transitions chronological for detail.

Single-command detail:

```json
{
  "command": { "...": "CommandRecord" },
  "transitions": [
    { "toState": "REQUESTED", "timestamp": 123 },
    { "fromState": "REQUESTED", "toState": "DISPATCHED", "timestamp": 124 }
  ]
}
```

Use existing authentication/RBAC route patterns. Do not expose this unauthenticated simply because it is "read only"; command history can disclose device names/behaviour.

## 7.3 WebSocket

Add mappings consistent with the current data-driven WS event mapping style:

```text
COMMAND_LIFECYCLE_TRANSITION -> "command-lifecycle"
AUTOMATION_EVENT             -> "automation-event"
```

No frontend rendering belongs in Phase 1.

# 8. Failure and consistency rules

## Command history write failure

Avoid reporting a false success if the command history layer fails in a way that means Aeolus cannot establish the audit contract **before dispatch**. The safe policy is:

- failure to create the initial `REQUESTED` record -> do not physically dispatch; return `FAILED` with an internal/persistence failure;
- failure to append a transition **after physical dispatch may already have happened** -> do not re-dispatch. Log at error level, retain the physical outcome truth available in memory, and surface an observability degradation metric/log. Never repeat the command to "repair" history.

This asymmetry is intentional because avoiding duplicate physical actions is more important than making the audit log cosmetically complete.

## MQTT event publish failure

`events.emit()` should return/throw according to existing sandbox host-call conventions, but it must never claim delivery to another automation. At most it can report local MQTT publish acceptance.

## Invalid automation event envelope

- emit raw MQTT observability as usual;
- log bounded validation failure;
- do not create a device;
- do not trigger an automation from malformed envelope data.

# 9. Expected file impact

Exact paths may evolve, but Kiro should expect changes around:

```text
src/core/types.ts
src/core/event-bus.ts
src/core/device-registry.ts
src/db/migrations/<next>-*.ts
src/db/migrations/index.ts
src/automations/command-service.ts
src/automations/pending-command-tracker.ts
src/automations/command-history-store.ts          (new)
src/automations/automation-event-service.ts       (new)
src/automations/automation-engine.ts
src/automations/sandbox.ts
src/connectors/action-router.ts
src/connectors/connector-manager.ts                (possibly no functional change)
src/mqtt/mqtt-service.ts
src/api/routes/device.routes.ts                    or existing device router
src/api/routes/command.routes.ts                   (new, if router style supports it)
src/websocket/ws-server.ts / composition mapping
src/index.ts                                       composition/startup reconciliation
corresponding *.test.ts / *.property.test.ts files
docs/reference/* and docs/MICROCONTROLLERS.md
```

Do not move large unrelated modules merely to satisfy this spec.

# 10. End-to-end reference flows

## Generic MQTT acknowledged command

```text
REST / Automation / UI
       |
       v
CommandService
  commandId = C1
  REQUESTED persisted
       |
       +--> ActionRouter.getAcknowledgementCapability(device)
       |       -> MQTT profile says supported
       |
       +--> correlationId = K1
       +--> PendingCommandTracker.register(C1, K1)
       |
       v
ActionRouter.executeMqttAction
       |
       +--> payload contains K1 + responseTopic
       +--> MQTT 5 properties contain K1 + responseTopic
       v
MQTT device
       |
       +--> ACK success=true, correlation K1
       v
MqttService ack branch
       v
PendingCommandTracker
       v
ACKNOWLEDGED
       |
       +--> transition persisted
       +--> command record terminal success
       +--> command-lifecycle internal/WS event
       v
ActionResult { success: true, commandId: C1, correlationId: K1,
               lifecycleState: "ACKNOWLEDGED" }
```

## Automation-to-automation event

```text
incoming tank MQTT state
       |
       v
NormalizedEvent meta.eventId=E1
       |
       v
Automation A execution X1
       |
       +--> events.emit("tank.low", { level: 18 })
              host generates E2, causationId=E1,
              ruleId=A, executionId=X1
       |
       v
MQTT aeolus/events/A/tank.low
       |
       +--> MQTT_RAW_MESSAGE remains visible
       v
Automation event ingest branch
       |   no DeviceRegistry write
       v
AUTOMATION_EVENT
       v
Automation B topic match
       v
EventContext.meta.eventId=E2
EventContext.meta.causationId=E1
```

# 11. What Phase 2 will be able to assume

When this design is complete, the later mock-device work can implement a simulated device exactly like a real MQTT client:

- publish sensor state;
- receive a correlated command;
- emit an ACK;
- publish resulting state;
- appear in durable command history;
- participate in causal event chains.

No mock-specific shortcut needs to be added to `CommandService`.
