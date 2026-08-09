# Requirements Document

## Introduction

Phase 2 builds the simulated-hardware runtime that Aeolus needs before the seeded showcase automations are reworked.

Phase 1 establishes the runtime contracts Phase 2 depends on:

- one authoritative `CommandService` physical-command boundary;
- stable `commandId` plus durable command transition history;
- generic MQTT command profiles and acknowledgement capability;
- MQTT 5 correlation/response handling through the normal `PendingCommandTracker` path;
- event identity, provenance and automation execution causation;
- constrained `events.emit()` Automation Events over the reserved Aeolus MQTT namespace;
- backend observability surfaces for later UI work.

Phase 2 must use those public/wire-level contracts rather than adding demo-only shortcuts around them.

The existing demo seed contains polished interfaces, but many simulated interactions currently happen inside trusted automation Logic: a UI fire event changes automation-local state and directly publishes fake sensor/actuator state to MQTT. That is useful for presentation, but it collapses the automation and the simulated physical world into one process and makes command acknowledgement difficult to demonstrate truthfully.

The goal of Phase 2 is therefore to create a believable external simulated device layer. Aeolus should interact with it in materially the same way it would interact with ESP32s, relays, sensors, pumps, fans, lights, winches or other generic MQTT hardware.

## Locked architectural decisions

These are decisions, not suggestions.

1. **The simulator runs as a separate process from the Aeolus backend.**
2. **The simulator communicates with Aeolus through MQTT only during runtime.** It does not call `CommandService`, `DeviceRegistry`, `PendingCommandTracker`, automation state APIs or the Aeolus database.
3. **The simulator is not a second automation engine.** Operational decisions remain in Aeolus automations; the simulator models hardware and environmental behaviour.
4. **Simulated actuators receive ordinary generic-MQTT commands and use the Phase 1 acknowledgement contract.**
5. **Simulated sensors publish ordinary MQTT device state.** They are discovered/ingested through the same path as real generic MQTT devices.
6. **Scenario stimuli enter the simulator through explicit Phase 1 Automation Events**, not through a public raw-MQTT control endpoint and not through direct backend mutation.
7. **The simulator is disabled by default and is started explicitly for demo/development deployments.**
8. **The simulator itself owns no persistent production data.** Phase 2 simulator state is disposable and may reset on simulator restart. The public demo reset procedure must account for this.
9. **Phase 2 does not rewrite the public Farm, Mine, Spacecraft, Bunker, Wildlife, Stage, Escape Room, Research Vessel or Live Space automations.** That is Phase 3.
10. **Phase 2 must include one small reference end-to-end simulated system** solely to prove the contracts before Phase 3 migrates the showcase scenarios.

## Phase 1 dependency assumptions

Phase 2 starts only after the relevant Phase 1 contracts exist on the implementation branch.

The Phase 1 command ordering is assumed to be:

```text
handler + scope validation
        ↓
allocate commandId
        ↓
resolve capability + requested/effective tier (side-effect free)
        ↓
persist complete REQUESTED record
        ↓
remaining validation
        ↓
register-before-dispatch
        ↓
physical dispatch
```

Handler/scope refusals do not receive a `commandId` or durable command record.

`terminal_at` is authoritative for durable lifecycle completion. A dispatch-only command terminal at `DISPATCHED` must have `terminal_at` populated.

`PendingCommandTracker` carries `commandId` but remains DB-free. It reports transitions through callbacks; the composition layer persists them through `CommandHistoryStore`.

Automation-originated command paths are assumed to retain their ALS execution context so simulator-driven device events can later be traced through automation execution to commands.

## Current gap addressed by Phase 2

### Simulated hardware is currently mixed into automation Logic

Seeded automations can currently respond to UI events by directly changing automation state and publishing simulated sensor/switch values. That means a single automation can simultaneously pretend to be:

- the operator/control UI;
- the automation controller;
- the sensor;
- the actuator;
- and the physical process.

Phase 2 separates the final three responsibilities from the automation runtime.

### Existing demo interactions do not prove the physical command boundary

A visually changing pump/fan/light is not evidence that `CommandService`, MQTT command routing, correlation, ACK handling and observed-state confirmation were exercised.

Phase 2 makes those mechanisms part of the demo's actual runtime behaviour.

### Negative paths need a deterministic simulated source

Later UI work should be able to demonstrate:

- acknowledgement success;
- device rejection;
- acknowledgement timeout;
- observed-state success;
- state mismatch;
- offline/no-response behaviour.

Real hardware is a poor dependency for repeatable public demonstrations and CI. Phase 2 supplies deterministic failure injection without weakening the real command path.

## Scope

In scope:

- a separate Node-based simulated-device process;
- MQTT connection/reconnection and subscriptions;
- typed simulated-device/model interfaces;
- simulated sensor state publication;
- simulated actuator command handling;
- Phase 1 MQTT 5/JSON acknowledgement compatibility;
- resulting state publication suitable for observed confirmation;
- per-device command serialization and correlation-id deduplication;
- deterministic timing and bounded asynchronous work;
- explicit scenario-stimulus handling through Phase 1 Automation Events;
- bounded simulator-only fault injection used by trusted scenarios/tests;
- a reference simulated water-transfer system for integration tests;
- demo seed/bootstrap helpers needed to configure simulated generic-MQTT devices and their Phase 1 command profiles;
- public-demo Compose integration with no public simulator port;
- integration with the existing public-demo reset flow;
- unit, integration and end-to-end tests;
- technical documentation and a Phase 3 migration handoff.

Out of scope:

- rewriting the showcase domain automations;
- redesigning custom automation UIs;
- command timeline or topology UI;
- a visual simulator builder;
- a general digital-twin modelling language;
- per-visitor simulator instances;
- multi-tenant simulation;
- a public simulator HTTP/WebSocket API;
- simulator access to Aeolus SQLite/database internals;
- direct simulator access to `CommandService`, `DeviceRegistry`, `AutomationEngine` or `PendingCommandTracker`;
- connector-specific Hue/Kasa simulators;
- pretending simulated acknowledgement is cryptographic proof of physical action;
- automatic production enablement of the simulator.

## Glossary

- **Simulator Runtime**: the separate process that models fake MQTT hardware for demo/development use.
- **Simulated Device**: one fake sensor or actuator that uses normal Aeolus-compatible MQTT topics.
- **Device Model**: code describing a simulated device's state and its response to commands/stimuli.
- **Scenario Module**: a small collection of related device models and environmental interactions used by the simulator.
- **Scenario Stimulus**: a trusted, bounded Automation Event that tells the simulated physical world something external has happened, such as a tank level falling or a gas concentration rising.
- **Fault Injection**: deterministic simulator behaviour used to exercise rejection, timeout, mismatch and similar negative command paths.
- **Reference Water System**: the small Phase 2-only integration fixture used to prove sensor -> automation -> command -> ACK -> observed-state behaviour. It is not a public showcase tab.

# Requirements

## Requirement 1: Preserve a real external-device boundary

**User story:** As a platform maintainer, I want simulated devices to interact with Aeolus through the same MQTT boundary as real generic hardware so that the demo proves the platform rather than a demo shortcut.

### Acceptance criteria

1. THE Simulator Runtime SHALL execute as a separate OS/container process from the Aeolus backend.
2. DURING normal runtime, THE Simulator Runtime SHALL communicate with Aeolus through MQTT only.
3. THE Simulator Runtime SHALL NOT import or call `CommandService`, `DeviceRegistry`, `AutomationEngine`, `PendingCommandTracker`, `CommandHistoryStore`, automation state stores, route handlers, or Aeolus SQLite repositories.
4. THE Simulator Runtime SHALL NOT write directly to the Aeolus database.
5. Simulated sensor/actuator state SHALL enter Aeolus through ordinary MQTT ingestion.
6. Simulated actuator commands SHALL leave Aeolus through the existing generic-MQTT device command path.
7. Runtime success SHALL NOT depend on a simulator-only REST endpoint in the Aeolus backend.
8. The simulator MAY share pure protocol types/constants/validators where this does not create runtime service coupling, but wire-level interoperability SHALL be tested independently.
9. THE default production/local Aeolus startup SHALL NOT launch the simulator unless simulation/demo mode is explicitly selected.

## Requirement 2: Provide a small typed simulated-device runtime

**User story:** As a developer, I want a simple code model for simulated devices so that Phase 3 scenarios can model varied hardware without inventing a second automation language.

### Acceptance criteria

1. Phase 2 SHALL define a typed simulated-device/model contract.
2. A simulated device definition SHALL include at minimum:
   - stable simulator key;
   - human-readable name;
   - state topic;
   - optional command topic;
   - initial state;
   - command capability metadata needed by bootstrap/profile configuration;
   - a device-model handler when the device accepts commands.
3. Device models SHALL be normal TypeScript/JavaScript modules rather than a new general-purpose DSL.
4. Phase 2 SHALL NOT add a visual or persisted simulator-authoring system.
5. Multiple simulated devices SHALL be able to share one simulator MQTT client/process while retaining per-device state and command serialization.
6. On simulator startup/connect, each loaded device SHALL publish a coherent initial state through its normal state topic.
7. State publications intended to represent current device state SHOULD be retained unless the current Aeolus MQTT conventions make retention inappropriate for a particular device.
8. Command messages SHALL never be retained by the simulator.
9. A model SHALL avoid publishing an unchanged state repeatedly unless it represents intentional telemetry; no-op suppression SHALL be available to reduce accidental feedback loops/message storms.
10. Timers/intervals created by models SHALL be bounded and disposed on shutdown/reload.

## Requirement 3: Simulated actuators must honour the Phase 1 command/ACK contract

**User story:** As an operator, I want a simulated actuator to behave like documented generic MQTT firmware so that the command history and ACK UI later demonstrate real platform semantics.

### Acceptance criteria

1. A command-capable simulated device SHALL subscribe to its normal `Device.commandTopic`.
2. THE simulator SHALL parse the existing generic MQTT action payload produced by Aeolus rather than inventing a simulator-only command envelope.
3. WHERE an incoming command carries MQTT 5 Correlation Data and Response Topic, THE simulator SHALL use them according to the Phase 1/documented device contract.
4. WHERE correlation is mirrored in the JSON payload, THE simulator SHALL remain compatible with that representation.
5. A positive acknowledgement SHALL be published only after the simulated device model has accepted the command.
6. A model-declared rejection SHALL publish the documented negative acknowledgement shape and SHALL NOT pretend the requested physical state occurred.
7. A positive acknowledgement SHALL use the response topic supplied by Aeolus unless the configured Phase 1 device profile/documented contract explicitly requires another supported response path.
8. AFTER an accepted command, the simulator SHALL publish resulting device state through the device's normal state topic when the model says the physical state changed.
9. ACK and state delays SHALL be independently configurable/bounded so tests can exercise `ACKNOWLEDGED` followed by `OBSERVED`.
10. Commands without a correlation requirement MAY execute and publish state without manufacturing a fake tracked acknowledgement.
11. A simulated device SHALL serialize command handling per device unless its model explicitly supports safe concurrency.
12. The simulator SHALL remember recently completed correlation IDs for a bounded period and SHALL NOT apply the same correlated command twice when an MQTT duplicate/retry is received.
13. Correlation deduplication storage SHALL be bounded in size/time.
14. THE simulator SHALL not mark or write Aeolus command lifecycle state directly; Aeolus must infer/record lifecycle outcomes through its Phase 1 runtime.

## Requirement 4: Scenario stimuli enter through Automation Events

**User story:** As a demo author, I want to inject an external event into the simulated world without giving public users raw MQTT access or letting operational automations mutate fake hardware directly.

### Acceptance criteria

1. THE Simulator Runtime SHALL subscribe to the Phase 1 reserved Automation Event namespace needed for configured scenario stimuli.
2. THE simulator SHALL validate the Automation Event envelope/version before acting on it.
3. A Scenario Module SHALL explicitly declare the event names it accepts.
4. Automation Events not declared by any loaded scenario SHALL be ignored without changing simulated state.
5. A Scenario Module MAY optionally restrict a stimulus to a particular source automation/rule identity where the Phase 1 event envelope provides it.
6. A Scenario Stimulus SHALL modify only simulator-owned model/environment state and SHALL publish any resulting device observations through ordinary MQTT device topics.
7. Scenario stimuli SHALL NOT call Aeolus state APIs or directly alter Device Registry entries.
8. THE simulator SHALL NOT expose a public raw MQTT/HTTP endpoint merely to inject scenario events.
9. Public visitors MAY eventually cause a Scenario Stimulus only through the existing bounded public-demo interaction chain: allowlisted UI fire -> trusted seeded Logic -> `events.emit()` -> MQTT -> simulator.
10. Phase 2 SHALL provide tests for Automation Event -> simulator state transition without requiring the Phase 3 public automation rewrite.

## Requirement 5: Provide deterministic, bounded fault injection

**User story:** As a developer demonstrating verified commands, I want repeatable simulated failures so that acknowledgement and observation error paths can be tested and shown without breaking real hardware.

### Acceptance criteria

1. THE simulator SHALL support bounded fault behaviour sufficient to exercise at least:
   - reject next command;
   - drop/suppress next acknowledgement;
   - suppress next resulting state observation;
   - publish a mismatching resulting state;
   - bounded ACK latency;
   - bounded state/observation latency.
2. Fault injection SHALL be scoped to a named simulated device or scenario, not global arbitrary process mutation.
3. "Next command" faults SHALL automatically clear after they are consumed.
4. Delay values SHALL be clamped to configured safe maxima.
5. Fault configuration SHALL not be writable through an unauthenticated/public simulator API.
6. Faults used by demo scenarios SHALL be activated through explicit trusted Scenario Stimuli or test fixtures.
7. The simulator SHALL cap outstanding delayed operations so repeated public interactions cannot create unbounded timers/memory growth.
8. A simulator fault SHALL change only simulator behaviour. It SHALL NOT directly write a fake `FAILED`, `TIMED_OUT`, `STATE_MISMATCH` or other lifecycle transition into Aeolus.
9. Tests SHALL demonstrate that Phase 1 `CommandService`/tracker/history derives the expected lifecycle outcome from the simulator's wire behaviour.

## Requirement 6: Make simulator behaviour deterministic and operationally boring

**User story:** As a maintainer, I want repeatable simulator behaviour and resilient broker handling so that CI and the public demo do not depend on timing luck.

### Acceptance criteria

1. THE Simulator Runtime SHALL use the project's supported MQTT protocol/version and reconnect after broker interruption.
2. After reconnect, command/event subscriptions SHALL be restored.
3. After reconnect or simulator restart, loaded devices SHALL republish coherent current/initial state as defined by the runtime model.
4. Simulator startup SHALL fail clearly on invalid scenario/device definitions rather than silently skipping malformed command topics or duplicate keys.
5. State changes for a given device SHALL be processed deterministically in the same input order.
6. Any pseudo-random telemetry used by scenario models SHALL be seedable/deterministic in tests.
7. Phase 2 SHALL provide a controllable clock/timer abstraction or equivalent test mechanism so ACK/state timing tests do not rely on long wall-clock sleeps.
8. Broker URLs/credentials SHALL be redacted in simulator logs.
9. Simulator logs SHALL identify device key/topic and high-level command/stimulus outcome without logging credentials/tokens.
10. Payload size and event-name inputs handled by the simulator SHALL be bounded/validated.
11. The simulator SHALL shut down cleanly, unsubscribe/disconnect and clear timers.

## Requirement 7: Bootstrap simulated devices through normal Aeolus configuration

**User story:** As a demo maintainer, I want simulated devices to receive the same persisted generic MQTT command profile as real devices so that ACK support is configured through Phase 1 rather than hard-coded inside CommandService.

### Acceptance criteria

1. Phase 2 SHALL provide seed/bootstrap support that makes each command-capable simulated MQTT device known to Aeolus through normal supported mechanisms.
2. The bootstrap SHALL configure each simulated actuator's Phase 1 MQTT Command Profile through the authenticated API/store path created in Phase 1, not by directly editing SQLite.
3. `Device.commandTopic` SHALL remain the canonical command topic.
4. Simulator bootstrap SHALL be idempotent for repeated demo resets/seeds.
5. Existing real/non-simulated devices SHALL not be modified by simulator bootstrap.
6. The Simulator Runtime process itself SHALL NOT need Aeolus admin/database credentials merely to execute commands and publish state.
7. If bootstrap needs an authenticated Aeolus session, that privilege SHALL exist only in the seed/bootstrap job and SHALL not be exposed to public visitors or passed into the long-running simulator when avoidable.
8. Phase 2 SHALL document startup ordering for broker, backend, simulator initial state and seed/profile configuration.

## Requirement 8: Include one reference end-to-end simulated physical system

**User story:** As a maintainer, I want one small, non-showcase system that proves all Phase 1 + Phase 2 contracts before we migrate the visually complex public demos.

### Acceptance criteria

1. Phase 2 SHALL include a small reference water-transfer simulation used for automated tests and optional local developer inspection.
2. The reference system SHALL contain at minimum:
   - source-tank level sensor;
   - header/destination-tank level sensor;
   - transfer-pump actuator;
   - flow/transfer observation sensor or equivalent independently published observation.
3. The pump SHALL be configured as a normal generic MQTT command-capable device with Phase 1 ACK support.
4. A bounded Scenario Stimulus SHALL be able to lower the destination tank level through an Automation Event.
5. A minimal test automation SHALL react to the low-level sensor event and issue a pump command through `devices.action()` / `CommandService`.
6. The simulator SHALL receive that MQTT command, ACK it and publish resulting pump/flow/tank state.
7. A tracked observed-tier command SHALL be able to reach a durable sequence equivalent to:

```text
REQUESTED -> DISPATCHED -> ACKNOWLEDGED -> OBSERVED
```

8. The reference system SHALL include test cases for rejection, timeout/no ACK, suppressed observation and mismatching observation.
9. The reference system SHALL not become a new public demo tab during Phase 2.
10. No step in the reference E2E path SHALL directly mutate Aeolus device state or command history outside normal runtime contracts.

## Requirement 9: Integrate safely with public-demo deployment

**User story:** As the owner of the public Aeolus demo, I want simulated hardware to be available there without creating another internet-facing control surface.

### Acceptance criteria

1. The dedicated public-demo deployment SHALL run the simulator as an internal service/process.
2. The simulator SHALL expose no public host port.
3. The public-demo Mosquitto broker SHALL remain internal-only as required by the existing demo security design.
4. No real property/production device credentials SHALL be available to the simulator service.
5. Raw MQTT publish SHALL remain forbidden to public demo users.
6. Public users SHALL not receive simulator broker credentials.
7. The simulator SHALL not weaken the existing fail-closed `AEOLUS_PUBLIC_DEMO` route/method guard.
8. The default non-demo Compose deployment SHALL not gain a simulator service that starts automatically.
9. The public-demo reset process SHALL restore both the Aeolus golden state and simulator state to a coherent baseline.
10. Where simulator state is intentionally in-memory, the reset procedure MAY restart the simulator process rather than introducing a second persistent simulator database.
11. Health validation after reset/deploy SHALL include proof that the simulator has connected and its reference/seeded state is flowing through MQTT.

## Requirement 10: Preserve an honest product boundary

**User story:** As a reviewer, I want the public demo to make it clear that the devices are simulated while still exercising real Aeolus runtime behaviour.

### Acceptance criteria

1. Phase 2 technical documentation SHALL state that simulated devices use the same generic MQTT command/ACK/state contracts as real hardware but are software models.
2. The implementation SHALL not label a simulated ACK as proof that real physical equipment moved.
3. The existing public-demo banner/description that devices are simulated SHALL remain accurate.
4. Phase 2 SHALL not add marketing claims that all showcased specialist hardware integrations ship with Aeolus.
5. Phase 3 custom UIs MAY later present rich fictional/industrial scenarios, but their state/control chain must remain truthful to the simulator/automation boundary defined here.

## Requirement 11: Release gates and tests

**User story:** As a maintainer, I want Phase 2 proven at the MQTT wire level and end to end so that the Phase 3 scenario migration can rely on it.

### Acceptance criteria

1. Existing Phase 1/backend/frontend tests SHALL remain green.
2. Unit tests SHALL cover simulated-device definition validation and duplicate device/topic detection.
3. Unit tests SHALL cover command parsing, positive ACK, negative ACK and no-correlation dispatch behaviour.
4. Unit tests SHALL cover per-device command serialization and duplicate `correlationId` suppression.
5. Unit tests SHALL cover no-op state suppression, bounded timers and fault auto-clear behaviour.
6. Unit tests SHALL cover Automation Event validation and undeclared event rejection/ignore behaviour.
7. Integration tests SHALL use a real/local test MQTT broker where the repository's existing test conventions support it.
8. An integration test SHALL prove simulator-published state enters the normal Aeolus Device Registry through MQTT.
9. An end-to-end test SHALL prove `CommandService -> MQTT -> simulator -> ACK -> durable ACKNOWLEDGED` for a generic simulated actuator.
10. An end-to-end observed-tier test SHALL prove `CommandService -> MQTT -> simulator ACK -> simulator state/flow -> durable OBSERVED`.
11. Failure E2E tests SHALL prove simulator wire behaviour produces the correct rejection/timeout/mismatch outcomes without direct lifecycle writes.
12. An Automation Event E2E test SHALL prove a valid Phase 1 event can change simulator-owned sensor state, which then re-enters Aeolus as an ordinary device event.
13. A vertical reference-water-system test SHALL prove external stimulus -> sensor event -> automation execution -> verified pump command -> simulator ACK -> observed state.
14. A restart/reconnect test SHALL prove no stale command is replayed by the simulator merely because it reconnects.
15. A public-demo configuration test SHALL prove the simulator has no externally published port and is not present/enabled in default production startup.
16. Kiro SHALL update technical/developer documentation and add a Phase 3 migration handoff, but SHALL NOT rewrite the showcase automations in Phase 2.
