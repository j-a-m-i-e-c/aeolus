# Aeolus Phase 2 — Kiro Handoff

## Goal

Implement the simulated-hardware runtime that Phase 3 will use to rebuild the public showcase automations.

Do **not** start by changing Farm, Mine, Stage, Spacecraft, Wildlife, Bunker, Escape Room, Research Vessel or Live Space.

Phase 2 is infrastructure.

## Read first

1. `.kiro/specs/phase-2-simulated-hardware-runtime/requirements.md`
2. `.kiro/specs/phase-2-simulated-hardware-runtime/design.md`
3. `.kiro/specs/phase-2-simulated-hardware-runtime/tasks.md`
4. the final implemented Phase 1 spec and any implementation notes/deviations
5. current demo seed/public-demo security specs

## Architecture that is already decided

Do not relitigate these points during implementation unless the current branch makes one technically impossible.

### 1. Simulator is external to the Aeolus backend

It is a separate process.

At runtime it speaks MQTT.

It does not call:

- `CommandService`
- `DeviceRegistry`
- `AutomationEngine`
- `PendingCommandTracker`
- `CommandHistoryStore`
- automation state persistence
- Aeolus SQLite

If it needs those to make a test pass, the implementation is bypassing the thing Phase 2 is intended to prove.

### 2. Simulated devices are ordinary generic MQTT devices

Sensors publish normal state topics.

Actuators subscribe to normal command topics.

Acknowledgement-capable devices use the final Phase 1 MQTT Command Profile and wire acknowledgement contract.

The simulator never writes command lifecycle states itself.

### 3. UI/demo stimuli do not directly mutate simulated hardware

The long-term Phase 3 chain is:

```text
bounded public UI fire
  -> trusted seeded automation
  -> events.emit(...)
  -> Phase 1 Automation Event over MQTT
  -> simulator changes physical/environment model
  -> simulator publishes ordinary MQTT sensor state
```

Phase 2 builds the receiving side of that contract and proves it with a small reference scenario.

### 4. Phase 1 refinements are dependencies

Use the final implemented Phase 1 semantics, including:

- handler/scope refusals have no `commandId`/record;
- `commandId` allocated after handler+scope acceptance;
- capability/effective-tier resolution occurs before the initial complete `REQUESTED` insert;
- `terminal_at` is authoritative for command completeness;
- `PendingCommandTracker` carries `commandId` but stays DB-free and reports transitions through callbacks;
- execution context is read through the narrow ALS/provider boundary and must exist on every automation-originated command path.

Do not add simulator-specific workarounds for missing Phase 1 context. If Phase 1 is incomplete, stop Phase 2 at the relevant checkpoint and fix the Phase 1 dependency first.

## First implementation target

Start at Task 0 and Task 1.

Do not start by writing a giant simulator framework or migrating all seeded devices.

The minimum early milestone is:

```text
separate process
  -> connect to Mosquitto
  -> publish one normal sensor state
  -> Aeolus discovers it normally
```

Then:

```text
Aeolus CommandService
  -> generic MQTT command
  -> simulator actuator
  -> real Phase 1 ACK
  -> durable ACKNOWLEDGED
```

Only after that works should you add scenario events and the reference water system.

## Reference system

Phase 2 includes one intentionally small water-transfer system for tests:

```text
source tank
header tank
transfer pump
flow sensor
```

This is not a new public tab. It is the conformance fixture that proves Phase 1 + Phase 2 before Phase 3 touches the polished demo.

## Important non-goals

Do not:

- build a visual simulator editor;
- invent a simulator DSL;
- add public simulator REST endpoints;
- give public users raw MQTT access;
- directly mutate Aeolus device state from simulator code;
- put simulator state in the Aeolus DB;
- add a second command path;
- rewrite public custom UIs yet;
- rewrite demo automation silos yet.

## Completion proof

The strongest Phase 2 acceptance test is:

```text
Automation Event stimulus
        ↓
simulator changes tank sensor
        ↓
MQTT device state
        ↓
Aeolus automation executes
        ↓
CommandService issues pump command
        ↓
MQTT
        ↓
simulator receives command
        ↓
ACK
        ↓
flow/pump state
        ↓
OBSERVED
```

The resulting durable Aeolus command record should retain Phase 1 automation/execution/causation metadata.

If this chain is green without direct backend simulator hooks, Phase 2 has achieved its purpose.
