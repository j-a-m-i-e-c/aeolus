# Design Document

## Overview

Phase 2 introduces an external MQTT simulated-hardware runtime for Aeolus.

The key design test is simple:

> If the Aeolus backend can tell that a device is simulated because it called a private simulator API instead of MQTT, the design has failed.

At runtime the simulator should look like ordinary generic MQTT hardware. It publishes state, subscribes to commands, returns acknowledgements when capable, and changes physical-model state after accepted commands. Aeolus remains responsible for device discovery, automation execution, command lifecycle tracking, provenance and UI/API observability.

Phase 2 deliberately does not migrate the polished demo tabs. It creates the substrate they will move onto in Phase 3.

## Target architecture

```text
Public/Local UI
     |
     | aeolus.fire(...) -- bounded by existing demo access
     v
Trusted seeded control automation
     |
     | events.emit("tank-low", {...})
     v
Phase 1 Automation Event service
     |
     | MQTT: aeolus/events/<ruleId>/tank-low
     v
+------------------------------------------------------+
| Separate Simulator Runtime                           |
|                                                      |
| Scenario receives bounded stimulus                   |
|      |                                               |
|      v                                               |
| simulated tank state changes                         |
|      |                                               |
|      +---- MQTT sensor/reference/header-tank ------+ |
|                                                    | |
| MQTT command <---- simulated pump model            | |
|      |                    |                         | |
|      |                    +--> ACK response topic   | |
|      |                    +--> pump state           | |
|      |                    +--> flow state           | |
+------|----------------------------------------------|-+
       |                                              |
       v                                              v
   Mosquitto ------------------------------------> Aeolus MQTT ingestion
                                                        |
                                                        +--> DeviceRegistry
                                                        +--> AutomationEngine
                                                        +--> PendingCommandTracker
                                                        +--> command history
```

The simulator must not shortcut the lower half of this diagram.

# 1. Process and package boundary

## 1.1 Separate process

Implement the simulator as a separately invokable Node process. Exact source placement should follow current repository conventions after Task 0 preflight. A reasonable shape is one of:

```text
src/demo-simulator/
  index.ts
  runtime.ts
  mqtt-client.ts
  types.ts
  scenarios/
```

or:

```text
tools/demo-simulator/
  ...
```

The architectural boundary is more important than the folder name.

The process may be built from the same repository/image, but it must have its own entry point and lifetime. In the public demo it should appear as a separate Compose service or an equivalent separately supervised process.

## 1.2 Runtime dependencies

Allowed runtime dependencies:

- MQTT client library;
- pure shared protocol types/constants/validators where useful;
- simulator-local scenario/model code;
- logging/configuration utilities that do not expose backend services.

Forbidden runtime dependencies:

- `CommandService`;
- `PendingCommandTracker`;
- `CommandHistoryStore`;
- `DeviceRegistry`;
- `AutomationEngine`;
- API route handlers;
- Aeolus SQLite repositories/stores;
- automation-local state stores.

Do not give the long-running simulator an Aeolus admin token just because bootstrap needs one.

## 1.3 Configuration

Recommended environment/config:

```text
AEOLUS_SIMULATOR_ENABLED=true
AEOLUS_SIMULATOR_SCENARIOS=reference-water
MQTT_BROKER_URL=mqtt://mosquitto:1883
AEOLUS_SIMULATOR_RANDOM_SEED=...
AEOLUS_SIMULATOR_MAX_DELAY_MS=15000
AEOLUS_SIMULATOR_MAX_PENDING_TIMERS=200
```

Use existing config/env conventions where possible.

Never log the full authenticated broker URL.

# 2. Simulator model API

## 2.1 Core types

Use code modules rather than a new DSL.

Suggested contracts:

```ts
export interface SimulatedDeviceDefinition<TState extends Record<string, unknown>> {
  key: string;
  name: string;
  stateTopic: string;
  commandTopic?: string;
  initialState: TState;
  retainState?: boolean;
  commandProfile?: SimulatedCommandProfile;
  createModel(ctx: DeviceModelFactoryContext<TState>): SimulatedDeviceModel<TState>;
}

export interface SimulatedCommandProfile {
  acknowledgement: {
    supported: boolean;
  };
  qos?: 0 | 1 | 2;
}

export interface SimulatedDeviceModel<TState extends Record<string, unknown>> {
  getState(): Readonly<TState>;
  onCommand?(command: SimulatedInboundCommand): Promise<SimulatedCommandOutcome> | SimulatedCommandOutcome;
  onStimulus?(stimulus: ScenarioStimulus): Promise<void> | void;
  dispose?(): Promise<void> | void;
}
```

The bootstrap layer translates `commandProfile` into the real Phase 1 MQTT Command Profile API. Do not create a second simulator-only profile inside Aeolus.

## 2.2 State ownership

The simulator owns simulated physical state.

Automation-private state may later cache/present derived values, but Phase 3 operational automations should treat MQTT device state as the physical source of truth.

Provide a runtime state helper similar to:

```ts
interface SimulatedStateController<TState> {
  read(): Readonly<TState>;
  update(patch: Partial<TState>, options?: {
    publish?: boolean;
    forcePublish?: boolean;
    delayMs?: number;
  }): void;
  publish(): void;
}
```

Requirements:

- merge/validate state through one per-device path;
- serialize updates per device;
- suppress identical publishes by default;
- retain current-state messages by default where appropriate;
- clamp delayed publish timers;
- cancel timers on shutdown.

## 2.3 Topic validation

At startup validate:

- non-empty state topics;
- non-empty command topics when present;
- no wildcard `+`/`#` in concrete device publish/command topics;
- no duplicate simulator device keys;
- no duplicate command-topic ownership;
- no accidental use of the reserved Automation Event namespace as a device state topic;
- no exact state/command topic collisions that would cause self-triggering.

Fail startup on invalid definitions.

# 3. MQTT runtime

## 3.1 Connection behaviour

The simulator MQTT client should:

1. connect using the same supported MQTT protocol version as Aeolus;
2. subscribe to all loaded device command topics;
3. subscribe to the Phase 1 Automation Event namespace required for scenario stimuli;
4. publish initial state after the connection is ready;
5. restore subscriptions after reconnect;
6. republish coherent state after reconnect if needed;
7. stop cleanly and clear timers on shutdown.

Use bounded reconnect/backoff consistent with project conventions.

## 3.2 No command replay on reconnect

The simulator must not retain an internal queue of old physical commands and replay them merely because MQTT reconnects.

Broker/client QoS semantics may redeliver a correlated command. The simulator's bounded correlation-id deduplication handles duplicates; it does not create new executions.

This aligns with Phase 1's no-physical-replay restart rule.

# 4. Command handling and acknowledgement

## 4.1 Inbound command normalization

Normalize an incoming MQTT command into a simulator-local structure:

```ts
interface SimulatedInboundCommand {
  topic: string;
  action?: string;
  params: Record<string, unknown>;
  rawPayload: unknown;
  correlationId?: string;
  responseTopic?: string;
  receivedAt: number;
}
```

Parse the actual Aeolus generic-MQTT wire payload. Do not require a simulator marker.

Correlation precedence should match the documented/implemented Phase 1 generic-device contract. Prefer MQTT 5 properties where the public contract says they are authoritative; support the mirrored JSON fields for firmware compatibility.

## 4.2 Outcome contract

Suggested model outcome:

```ts
type SimulatedCommandOutcome =
  | {
      accepted: true;
      acknowledgement?: { delayMs?: number };
      state?: {
        patch?: Record<string, unknown>;
        delayMs?: number;
        publish?: boolean;
      };
    }
  | {
      accepted: false;
      error?: string;
      acknowledgement?: { delayMs?: number };
    };
```

The runtime, not every scenario model, should implement the wire-level ACK formatting.

## 4.3 ACK sequencing

Normal acknowledged command:

```text
receive MQTT command
        ↓
dedupe correlationId
        ↓
model validates/accepts command
        ↓
optional bounded simulated actuation delay
        ↓
publish positive ACK
        ↓
optional independent state delay
        ↓
publish resulting device/sensor state
```

A positive ACK means only that the simulated device model accepted/executed its modelled command. Aeolus still decides whether `ACKNOWLEDGED` or `OBSERVED` is the required completion tier.

Negative path:

```text
receive command
      ↓
model rejects
      ↓
publish { correlationId, success: false, ... }
      ↓
DO NOT publish requested success state
```

## 4.4 ACK payload

Use the Phase 1 accepted device response shape. At minimum:

```json
{
  "correlationId": "...",
  "success": true
}
```

For rejection:

```json
{
  "correlationId": "...",
  "success": false,
  "error": "simulated interlock open"
}
```

If Phase 1's final implementation uses an optional configured indicator field/status mapping, the simulator bootstrap/model adapter should remain compatible with it. Do not invent a competing simulator acknowledgement schema.

## 4.5 Correlation deduplication

Maintain a bounded per-runtime or per-device recently-completed correlation cache:

```ts
Map<correlationId, {
  deviceKey: string;
  completedAt: number;
  ackPayload?: Buffer;
}>
```

On duplicate correlated command:

- never apply the physical state transition twice;
- optionally resend the same ACK if safe/appropriate;
- never manufacture a second state transition solely because of MQTT duplicate delivery.

Expire entries by age and enforce a max size.

# 5. Automation Event -> Scenario Stimulus boundary

## 5.1 Why Automation Events are the control plane

Do not add:

```text
POST /api/simulator/set-tank-level
POST /api/simulator/fail-next-command
```

for public/demo runtime.

Phase 1 already provides a bounded automation-owned MQTT event channel. Use it.

Later Phase 3 interaction:

```text
aeolus.fire("simulate-low-tank")
    ↓
trusted seeded automation
    ↓
events.emit("tank-low", { ...bounded... })
    ↓
MQTT Automation Event
    ↓
simulator scenario
    ↓
normal sensor MQTT state
```

This keeps public-user permissions at the existing `demoAccess.fireEvents` boundary.

## 5.2 Scenario declaration

Suggested scenario shape:

```ts
interface SimulatorScenario {
  key: string;
  devices: SimulatedDeviceDefinition<any>[];
  stimuli: Record<string, (ctx: ScenarioStimulusContext) => void | Promise<void>>;
  dispose?(): void | Promise<void>;
}
```

A stimulus name must pass the Phase 1 Automation Event validator and be explicitly declared by the loaded scenario.

Where multiple loaded scenarios use the same event name, either namespace the event names (preferred) or reject ambiguous startup definitions.

Example names:

```text
reference-water.tank-low
reference-water.reset
reference-water.pump-reject-next
```

If the Phase 1 validator does not allow dots, use an equivalent safe naming convention such as `reference-water/tank-low` or `reference-water-tank-low`. The implementation must reuse the actual Phase 1 event-name rules rather than weakening them for simulation.

## 5.3 Causation note

An Automation Event is causally traceable inside Aeolus through Phase 1 metadata. Once it crosses into the simulator and returns as a physical MQTT state observation, it behaves like an external physical-world event.

Do not invent a simulator-only metadata field solely to force a causal chain unless Phase 1 defines a supported generic MQTT provenance representation.

Instead:

- keep scenario stimuli bounded;
- suppress no-op state publications;
- make operational automations state-sensitive/idempotent;
- retain correlation metadata only through documented MQTT mechanisms if available.

This is intentionally faithful to a real actuator/sensor boundary: the physical world can create a new observation event.

# 6. Fault injection

## 6.1 Fault state

Keep fault injection simulator-local and bounded.

Suggested per-device state:

```ts
interface SimulatedFaultState {
  rejectNext?: { reason: string };
  dropNextAck?: boolean;
  suppressNextState?: boolean;
  mismatchNextState?: Record<string, unknown>;
  ackDelayMs?: number;
  stateDelayMs?: number;
}
```

These values must be clamped/validated.

## 6.2 Runtime application order

Recommended order:

```text
receive command
  ↓
dedupe
  ↓
consume rejectNext? ---- yes ---> negative ACK, stop
  ↓ no
run normal model outcome
  ↓
consume dropNextAck? --- yes ---> skip ACK
  ↓
ACK after bounded delay
  ↓
consume suppressNextState? --> skip resulting state
  ↓
consume mismatchNextState? --> publish mismatch patch
  ↓ otherwise
publish normal resulting state after bounded delay
```

One-shot faults clear as soon as they are consumed, even if the command later errors. That makes tests deterministic.

## 6.3 Resource bounds

Protect the shared public demo from interaction storms:

- max pending timers globally;
- optional max pending timers per device;
- max delay;
- max accepted Automation Event payload size;
- per-device serialized command queue with a bounded length or fail-fast policy;
- no unbounded historical state in the simulator.

# 7. Bootstrap and device profiles

## 7.1 Separation of bootstrap privilege

There are two components:

```text
seed/bootstrap job
    | authenticated Aeolus API access
    | configure command profiles
    v
Aeolus

long-running simulator
    | MQTT only
    v
Mosquitto
```

Do not merge them just because both are demo-related.

## 7.2 Bootstrap ordering

A robust public/local sequence is:

```text
1. Mosquitto healthy
2. Aeolus backend healthy
3. simulator connects and publishes initial device state
4. Aeolus discovers/registers generic MQTT devices
5. seed/bootstrap resolves those devices and applies MQTT Command Profiles
6. reference/demo automations can issue verified commands
```

If current seed infrastructure can deterministically create/register devices before simulator startup, Kiro may preserve that ordering, but profile configuration must still use the supported Phase 1 API/store path and the resulting runtime device topics must agree exactly with the simulator.

Bootstrap should poll/bound readiness rather than use arbitrary long sleeps.

# 8. Reference water-transfer system

## 8.1 Purpose

This is an integration fixture, not a public showcase redesign.

It proves the entire chain before Farm or another flagship tab depends on it.

## 8.2 Suggested devices

```text
sensor/reference-water/source-tank
sensor/reference-water/header-tank
switch/reference-water/transfer-pump
sensor/reference-water/flow
```

Suggested state:

```ts
sourceTank = { levelPct: 80, litres: 48000 };
headerTank = { levelPct: 60, litres: 3000 };
pump = { on: false, running: false };
flow = { litresPerMinute: 0 };
```

Pump command topic:

```text
switch/reference-water/transfer-pump/command
```

Exact topic shape should follow the current generic MQTT topic parser/command conventions after Task 0 audit.

## 8.3 Normal behaviour

Scenario stimulus:

```text
reference-water.tank-low
```

Simulator publishes:

```json
{ "levelPct": 25, "litres": 1250 }
```

A tiny test automation receives the low-tank event and requests:

```ts
await devices.action("<pump-device-id>", "on", {}, {
  completionTier: "observed",
  // use the real Phase 1 confirmation API shape after preflight
});
```

Simulator:

1. receives command;
2. positively ACKs;
3. publishes pump `running: true`;
4. publishes flow `litresPerMinute > 0` and/or changed tank state;
5. Aeolus reaches `OBSERVED` according to the automation's real observation condition.

Do not hardcode a fake lifecycle outcome in the simulator.

## 8.4 Failure fixtures

Stimuli used by tests may arm:

```text
reference-water.reject-next-pump
reference-water.drop-next-pump-ack
reference-water.suppress-next-flow
reference-water.mismatch-next-pump-state
reference-water.reset
```

These event names are examples; use Phase 1-valid names.

# 9. Public demo deployment

## 9.1 Compose/service boundary

Add the simulator only to the dedicated demo/development composition, not the default real-hardware deployment.

Conceptual:

```yaml
services:
  mosquitto:
    # internal broker

  backend:
    # existing Aeolus backend

  simulator:
    # same repository/image or dedicated small image
    # no ports:
    # depends on broker health
    # only simulation-specific environment
```

No `ports:` entry for simulator.

## 9.2 Reset

The public demo already uses a disposable/golden-state reset model. Extend the reset procedure so the simulator returns to baseline too.

Preferred Phase 2 approach:

```text
stop/restart simulator
replace/reset Aeolus demo DB as already designed
start backend/broker as required
start simulator
run seed/bootstrap/profile configuration
run health smoke test
```

Do not add a simulator persistence database just to survive nightly reset.

Per-scenario "reset" buttons in Phase 3 should use Automation Event stimuli and reset only that scenario's simulator state.

# 10. Testing strategy

## 10.1 Unit tests

Test independently of Aeolus backend:

- definition validation;
- topic collisions;
- command parser;
- MQTT 5 + JSON correlation extraction;
- positive/negative ACK formatting;
- per-device serialization;
- correlation dedupe;
- fault consumption;
- delay clamping;
- no-op suppression;
- timer cap;
- scenario event declaration/matching;
- deterministic pseudo-random/timer behaviour;
- clean dispose.

## 10.2 MQTT wire integration tests

Run simulator against a test broker and use an independent MQTT test client.

Prove:

- initial state publish;
- command subscription;
- response-topic ACK;
- JSON/correlation compatibility;
- resulting state;
- reconnect/resubscribe;
- duplicate command does not repeat state mutation.

This test is important because importing Phase 1 backend helpers into the simulator can accidentally hide wire-contract incompatibility.

## 10.3 Aeolus E2E tests

Use real Phase 1 services and the simulator process/client.

Minimum success cases:

```text
simulator state
  -> MqttService
  -> DeviceRegistry

CommandService
  -> ActionRouter generic MQTT
  -> broker
  -> simulator
  -> ACK
  -> PendingCommandTracker callback
  -> CommandHistoryStore
  -> ACKNOWLEDGED

observed command
  -> simulator ACK
  -> simulator resulting state
  -> MqttService observation
  -> OBSERVED
```

Minimum failure cases:

- negative ACK/rejection;
- dropped ACK timeout;
- state mismatch;
- suppressed observation timeout;
- duplicate correlated command;
- simulator reconnect while no replay occurs.

## 10.4 Vertical reference test

The strongest Phase 2 test is:

```text
Automation Event stimulus
        ↓
Simulator lowers header tank
        ↓
MQTT device state
        ↓
Automation Engine executes low-tank rule
        ↓
CommandService issues pump ON
        ↓
MQTT command
        ↓
Simulator ACKs
        ↓
Simulator publishes flow/pump state
        ↓
PendingCommandTracker observes result
        ↓
Durable command timeline ends OBSERVED
```

Assert the command record includes the automation `ruleId`, `executionId` and triggering causation ID supplied by Phase 1 where available.

# 11. Phase 3 migration contract

Phase 2 is complete when Phase 3 can migrate a current demo interaction from this:

```text
UI fire
  -> automation state.set(...)
  -> automation mqtt.publish(fake device state)
```

to this:

```text
UI fire
  -> trusted control automation
  -> events.emit(bounded scenario stimulus)
  -> simulator publishes sensor state
  -> operational automation reacts
  -> devices.action(...)
  -> CommandService
  -> simulator actuator
  -> ACK + observed state
  -> UI reads real Aeolus state/history
```

Phase 3 should not need to invent a new simulator API.
