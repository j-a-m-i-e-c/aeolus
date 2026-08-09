# Requirements Document

## Introduction

Phase 1 establishes the runtime foundations needed before Aeolus's demo mock-device system and automation scenarios are reworked.

The current code already contains important pieces that must be preserved:

- `src/automations/command-service.ts` is the single physical-command boundary.
- `src/automations/command-lifecycle.ts` defines the existing command lifecycle and confirmation tiers.
- `src/automations/pending-command-tracker.ts` correlates acknowledgements and observed state.
- `src/connectors/action-router.ts` already has a generic MQTT dispatch path capable of adding correlation data and a response topic when correlation is supplied.
- `src/mqtt/mqtt-service.ts` routes acknowledgement topics to `PendingCommandTracker` and emits ordinary MQTT device state through `DEVICE_STATE_CHANGE`.
- `src/automations/command-result-collector.ts` already carries an automation `executionId` through `AsyncLocalStorage`.
- `src/automations/automation-engine.ts` already gives each execution its own identity and evaluates MQTT wildcard topic triggers.
- `src/core/device-registry.ts` persists MQTT state and command topics.

The goal is therefore not to create "Commands v2" beside the existing implementation. The goal is to complete the existing design so that later work can build believable independent automation silos, simulated hardware, and a UI that can prove what happened.

## Current gaps addressed by this spec

### Generic MQTT acknowledgement gap

`CommandService` only enables acknowledgement when `ConnectorManager.getAcknowledgementCapability(deviceId)` reports support. `ActionRouter.getAcknowledgementCapability()` currently resolves only a connector-owned device's capability. A device whose `integration === "mqtt"` therefore falls back to dispatch-only, even though `executeMqttAction()` already knows how to send a correlation envelope when one is provided.

### Durable lifecycle gap

The command boundary returns a terminal `ActionResult` and logs terminal states, while intermediate state in `PendingCommandTracker` is in-memory. There is no durable per-command transition timeline suitable for later audit/inspection UI.

### Restart truthfulness gap

`PendingCommandTracker` explicitly stores pending commands in an in-memory `Map`. A restart loses the pending wait. Phase 1 must make the persisted record truthful without automatically repeating a physical action.

### Provenance gap

`NormalizedEvent` and `EventContext` currently carry topic, device, state, and timestamp but no common event identity or causation metadata. Later cross-automation flows need to answer "what caused this?" without relying on log inference.

### Safe automation-to-automation MQTT gap

Raw MQTT publishing is intentionally forbidden for scoped automations. That security boundary should remain. However, later automation silos need a safe way to emit domain events over MQTT without receiving arbitrary topic access.

## Scope

In scope:

- durable verified-command records and transition history;
- stable `commandId` identity for every verified physical command;
- linkage to `correlationId`, automation rule, and automation execution where available;
- per-device generic MQTT command/acknowledgement profile persistence;
- generic MQTT acknowledgement through the existing `CommandService` / `PendingCommandTracker` path;
- explicit restart reconciliation for unresolved durable command records;
- additive event provenance/causation metadata;
- a reserved, safe MQTT automation-event contract and sandbox helper;
- ingestion of automation events without creating phantom devices;
- backend REST and WebSocket surfaces needed by later UI work;
- unit, integration, property/regression tests and technical documentation.

Out of scope:

- Phase 2 mock devices, mock sensors, mock actuators, scenario simulation, or demo event generators;
- Phase 3 rewrite of Farm, Mine, Spacecraft, Bunker, Wildlife, Stage, Live Space, or other seeded automations;
- Phase 4 command timeline UI, automation topology/flow visualisation, or dashboard redesign;
- automatic retry/replay of interrupted physical commands after restart;
- distributed multi-node command coordination;
- replacing MQTT with another broker/event system;
- removing raw `mqtt.publish()`;
- redesigning the existing lifecycle state vocabulary;
- broad changes to resource authorization beyond what is necessary to safely expose the new primitives.

## Glossary

- **Verified Command**: a physical device command issued through `CommandService` and represented by a command lifecycle result.
- **Command ID**: stable Aeolus identity assigned to every verified command, whether it is dispatch-only, acknowledgement-capable, or observed.
- **Correlation ID**: identifier used to correlate a tracked command with an acknowledgement/observation exchange. It may be absent for dispatch-only commands.
- **Command Record**: durable summary of a verified command, its source, target, requested/effective completion tier, current/terminal state, and timestamps.
- **Command Transition**: immutable durable record of one lifecycle transition for a command.
- **MQTT Command Profile**: persisted configuration that describes generic MQTT command behaviour not derivable from discovery alone, especially acknowledgement capability and optional QoS.
- **Event Metadata**: additive event identity and causation information, including `eventId`, source information, optional `causationId`, optional `correlationId`, and optional `executionId`.
- **Automation Event**: a domain event emitted by automation logic through a constrained Aeolus API and transported over the reserved Aeolus MQTT event namespace.
- **Reserved Automation Event Namespace**: MQTT topic space owned by Aeolus for automation-to-automation events. It must not participate in device discovery.
- **Interrupted Command**: a command that was durably nonterminal when Aeolus restarted and whose live in-memory confirmation wait can no longer be recovered safely.

# Requirements

## Requirement 1: Preserve one verified physical-command boundary and add stable command identity

**User story:** As a platform maintainer, I want every verified physical action to retain one authoritative execution path and one stable identity so that later observability features cannot disagree about what command they are describing.

### Acceptance criteria

1. THE `CommandService` SHALL remain the only boundary that represents a physical device action as a Verified Command.
2. WHEN `CommandService` accepts a physical device command for processing, IT SHALL assign a globally unique `commandId` before dispatch is attempted.
3. THE `commandId` SHALL exist for dispatch-only commands as well as acknowledgement/observation-tracked commands.
4. THE existing `correlationId` SHALL remain distinct from `commandId` and SHALL only be used where correlation/tracking is required.
5. WHEN a Verified Command returns an `ActionResult`, THE result SHALL include its `commandId`.
6. WHERE an `ActionResult` already contains a `correlationId`, THE result SHALL continue to expose it unchanged.
7. THE existing lifecycle states SHALL remain `REQUESTED`, `DISPATCHED`, `ACKNOWLEDGED`, `OBSERVED`, `FAILED`, `TIMED_OUT`, and `STATE_MISMATCH`.
8. THE implementation SHALL NOT introduce a second physical-command service or direct verified-command route around `CommandService`.
9. Raw `mqtt.publish()` SHALL remain an unverified messaging primitive and SHALL NOT receive a `commandId` merely because its topic resembles a device command topic.

## Requirement 2: Generic MQTT devices can declare acknowledgement capability

**User story:** As an Aeolus operator integrating an ESP32 or other generic MQTT device, I want to tell Aeolus that the device supports command acknowledgements so that the existing MQTT 5 correlation path can actually be used.

### Acceptance criteria

1. A registered generic MQTT device SHALL be able to persist an MQTT Command Profile.
2. THE profile SHALL support at minimum:
   - acknowledgement supported/not supported;
   - optional acknowledgement response topic override;
   - optional acknowledgement indicator field;
   - optional accepted acknowledgement indicator values;
   - optional MQTT QoS for device-command publish.
3. THE existing `Device.commandTopic` SHALL remain the canonical explicit command-topic field and SHALL NOT be duplicated inside a second independent command-topic configuration.
4. WHEN a generic MQTT device has acknowledgement support enabled, THE acknowledgement capability resolver used by `CommandService` SHALL report that capability without requiring a connector instance.
5. WHEN a generic MQTT device has acknowledgement support disabled or no profile, ITS capability SHALL remain dispatch-only unless observation is explicitly requested.
6. WHEN `CommandService` dispatches to an acknowledgement-capable generic MQTT device, THE outbound MQTT command SHALL include the existing correlation envelope and MQTT 5 correlation/response properties.
7. WHEN the configured acknowledgement is received, THE existing `PendingCommandTracker` SHALL resolve the command through the normal acknowledgement path rather than a special demo/MQTT-only path.
8. WHEN QoS is configured for the MQTT device command, THE MQTT publish path SHALL honour it; otherwise current/default behaviour SHALL remain unchanged.
9. THE MQTT profile SHALL survive process restart and device registry reload.
10. Updating a device's MQTT Command Profile SHALL require the same or stronger authorization as changing control-relevant device configuration.

## Requirement 3: Persist a truthful command lifecycle timeline

**User story:** As an operator or developer, I want to inspect the complete lifecycle of a command after it happened so that ACK and observation behaviour is demonstrable rather than hidden inside transient logs.

### Acceptance criteria

1. BEFORE or atomically with a command entering `REQUESTED`, Aeolus SHALL create a durable Command Record containing `commandId`.
2. A Command Record SHALL include at minimum:
   - `commandId`;
   - optional `correlationId`;
   - source kind and source identifier/label where available;
   - target device ID;
   - action type;
   - requested completion tier when supplied;
   - effective completion tier;
   - current lifecycle state;
   - success when terminal;
   - optional failure kind and error;
   - requested timestamp;
   - terminal timestamp when terminal;
   - automation rule ID when the source is an automation;
   - automation execution ID when available.
3. EVERY lifecycle change for a Verified Command SHALL create exactly one immutable Command Transition record.
4. A transition record SHALL include `commandId`, previous state where applicable, new state, and timestamp.
5. WHEN a command is tracked at the observed tier and receives an ACK before observation, BOTH the `ACKNOWLEDGED` transition and later terminal transition SHALL be persisted.
6. Duplicate or late acknowledgement messages SHALL NOT create duplicate valid lifecycle transitions.
7. Transition persistence SHALL obey the existing lifecycle transition guard rather than defining a competing transition table.
8. A terminal Command Record SHALL agree with the final `ActionResult.lifecycleState` and `ActionResult.success` returned by `CommandService`.
9. Persistence failure SHALL NOT cause Aeolus to report a stronger physical outcome than was actually established. The error SHALL be logged and surfaced according to the design's fail-safe policy.
10. Command history SHALL be queryable independently of automation execution history because REST/UI/system commands are also Verified Commands.

## Requirement 4: Make restart behaviour truthful without replaying physical actions

**User story:** As an operator, I want a restart during a pending acknowledgement to leave an honest audit trail without Aeolus silently repeating a pump/relay/valve command.

### Acceptance criteria

1. THE live `PendingCommandTracker` MAY remain in-memory in Phase 1.
2. Aeolus SHALL NOT automatically re-dispatch or replay a physical command solely because it was nonterminal when the process stopped.
3. DURING startup, before the runtime presents stale nonterminal command records as active, Aeolus SHALL reconcile command records that cannot still have a live pending tracker entry.
4. A reconciled interrupted command SHALL become terminal `FAILED` and SHALL record a machine-readable interruption/restart failure reason without adding a new lifecycle state.
5. Reconciliation SHALL create a corresponding transition record.
6. Commands already terminal before restart SHALL remain unchanged.
7. A dispatch-tier command already terminal at `DISPATCHED` SHALL NOT be marked interrupted merely because `DISPATCHED` is nonterminal for a different tier.
8. The reconciliation process SHALL be idempotent across repeated startups.

## Requirement 5: Add event identity, provenance, and causation metadata

**User story:** As an operator tracing a multi-automation workflow, I want events and commands to carry enough causal metadata to answer which event/execution caused the next action.

### Acceptance criteria

1. Aeolus SHALL define one additive Event Metadata contract usable by device events and Automation Events.
2. Event Metadata SHALL include a unique `eventId` and a timestamp.
3. Event Metadata SHALL identify a source kind and MAY identify a source ID.
4. Event Metadata SHALL support optional `causationId`, `correlationId`, `automationId`/rule ID, `executionId`, `traceId`, and causal depth where meaningful.
5. Existing `NormalizedEvent` and `EventContext` consumers SHALL remain source-compatible through optional/additive fields rather than a mandatory breaking wrapper rewrite.
6. WHEN an automation executes because of an event carrying metadata, ITS execution context SHALL retain the triggering `eventId` so that emitted Automation Events and commands can link back to it.
7. WHEN a command is issued inside an automation execution, THE durable Command Record SHALL include the automation execution ID and triggering causation/event ID when available.
8. Provenance fields received from an external MQTT client SHALL be treated as descriptive/untrusted input and SHALL NOT by themselves grant authorization.
9. Existing device-event ingestion SHALL continue to work for messages with no provenance metadata.

## Requirement 6: Provide a safe first-class automation-to-automation MQTT event contract

**User story:** As an automation author, I want one automation to emit a domain event that another automation can consume over MQTT without giving the first automation unrestricted MQTT publish authority.

### Acceptance criteria

1. Aeolus SHALL define a reserved MQTT topic namespace for Automation Events. Recommended default: `aeolus/events/<sourceRuleId>/<eventName>`.
2. The source rule portion of the topic SHALL be generated by Aeolus from the executing automation identity and SHALL NOT be caller-selectable.
3. An automation SHALL be able to emit an event through a constrained sandbox API such as `events.emit(eventName, payload)`.
4. A scoped automation SHALL be permitted to use the constrained Automation Event API even though it remains forbidden from arbitrary raw `mqtt.publish()`.
5. The event name SHALL be validated as a safe topic segment/path according to the design, preventing escape into arbitrary MQTT namespaces.
6. An Automation Event payload SHALL use a versioned envelope carrying event metadata plus the user payload.
7. The MQTT service SHALL subscribe to or otherwise ingest the reserved Automation Event namespace.
8. Automation Event topics SHALL be visible to the existing MQTT raw-message inspector/observability path.
9. Automation Event topics SHALL NOT be passed through normal device discovery and SHALL NOT create/update Device Registry entries.
10. The Automation Engine SHALL be able to trigger a rule whose topic pattern matches the Automation Event topic.
11. Automation Event admission SHALL NOT incorrectly apply the scoped device-ID gate, because an Automation Event is not a hidden device-state event.
12. A receiving automation SHALL receive an `EventContext` containing the user payload and Event Metadata.
13. Emitting an Automation Event SHALL NOT be represented as a Verified Command and SHALL NOT create a Command Record.
14. The new API SHALL preserve the existing raw `mqtt.publish()` semantics for unrestricted automations.
15. Aeolus SHALL enforce a bounded Automation Event causal depth/hop count so an A -> B -> A event cycle cannot publish indefinitely.
16. WHEN the maximum event depth is reached, Aeolus SHALL refuse the next Automation Event emission, log a bounded diagnostic, and SHALL NOT publish another event for that attempted hop.

## Requirement 7: Expose backend observability surfaces for later UI work

**User story:** As a frontend developer, I want stable backend surfaces for command history and live transition events so that Phase 4 can visualize real behaviour without reconstructing it from logs.

### Acceptance criteria

1. Aeolus SHALL expose an authenticated command-history API.
2. The API SHALL support retrieving a single command with its transition timeline.
3. The API SHALL support a bounded recent-command list with filters sufficient for at least target device, automation rule/execution, lifecycle state, and source kind.
4. The API SHALL never return an unbounded full command-history result by default.
5. Aeolus SHALL emit a typed internal event when a command lifecycle transition is durably recorded.
6. The WebSocket server SHALL map that event to a stable client message type for future UI consumption.
7. The lifecycle WebSocket payload SHALL include `commandId`, new state, transition timestamp, and correlation/source identifiers that are safe for the authenticated client to receive.
8. Aeolus SHALL emit/forward a live Automation Event signal suitable for future event-flow inspection.
9. Phase 1 SHALL NOT implement the visual command timeline or event graph itself.

## Requirement 8: Preserve security and compatibility boundaries

**User story:** As a maintainer, I want the new primitives to strengthen Aeolus without reopening security holes or breaking existing integrations.

### Acceptance criteria

1. Existing connector acknowledgement capability SHALL continue to work unchanged.
2. Existing generic MQTT devices with no profile SHALL continue to operate at their current dispatch tier.
3. Existing raw MQTT publishing SHALL remain unverified transport.
4. Scoped automations SHALL remain unable to publish arbitrary MQTT topics or invoke arbitrary webhooks solely because the Automation Event feature exists.
5. The Automation Event API SHALL publish only inside its reserved namespace.
6. Existing `DEVICE_STATE_CHANGE` device authorization/admission rules SHALL remain in force for device events.
7. Existing REST/dashboard/custom-UI/form/script physical commands SHALL continue to route through `CommandService`.
8. No new API SHALL bypass existing authentication/RBAC middleware.
9. Persisted MQTT command profile data SHALL be validated on write and sanitized on read.
10. Command/event metadata SHALL NOT contain secrets, MQTT credentials, authorization tokens, or full authenticated broker URLs.

## Requirement 9: Release gates and tests

**User story:** As a maintainer, I want Phase 1 proven end to end so that Phase 2 and Phase 3 can safely depend on it.

### Acceptance criteria

1. The existing test suite SHALL pass after Phase 1.
2. A unit test SHALL prove generic MQTT acknowledgement capability resolution from a persisted device profile.
3. An integration test SHALL start from a registered generic MQTT device, issue a Verified Command, inspect the outbound correlation envelope, route `{ correlationId, success: true }`, and reach `ACKNOWLEDGED`.
4. An integration test SHALL prove a tracked observed command persists `REQUESTED -> DISPATCHED -> ACKNOWLEDGED -> OBSERVED` when all stages occur.
5. Tests SHALL cover device-declared rejection, timeout, state mismatch, duplicate ACK, and late ACK without duplicate transitions.
6. A restart/reconciliation test SHALL prove unresolved tracked history becomes terminal failed/interrupted without command replay.
7. An integration test SHALL prove `events.emit()` publishes into the reserved namespace and triggers a second automation.
8. That event integration test SHALL prove the Automation Event does not create a Device Registry entry.
9. That event integration test SHALL prove causal metadata is preserved from triggering event -> Automation A execution -> emitted Automation Event -> Automation B context.
10. A security regression test SHALL prove scoped automations still cannot use arbitrary raw MQTT publish while they can use `events.emit()`.
11. Tests SHALL prove existing connector acknowledgement capability remains unaffected.
12. Kiro SHALL update relevant technical/reference documentation after the implementation, but SHALL NOT rewrite product/marketing documentation unless the product claim materially changes.
