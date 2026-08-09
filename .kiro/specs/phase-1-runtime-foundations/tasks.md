# Implementation Plan

> Implement in order. This spec builds on existing command/authorization specs. Do not start Phase 2 mock-device work or Phase 3 automation scenario rewrites while completing these tasks.

## Task 0: Preflight against the current branch

- [ ] Read `requirements.md` and `design.md` completely.
- [ ] Read existing dependent specs: `verified-command-execution`, `unified-command-boundary`, `command-completion-tier`, `command-outcome-status-codes`, `mqtt-topic-overhaul`, `resource-level-authorization`, `scoped-automation-authoring`.
- [ ] Confirm current `CommandService` remains the only verified physical-command boundary.
- [ ] Confirm `PendingCommandTracker` is still in-memory and note any branch changes.
- [ ] Confirm `ActionRouter.getAcknowledgementCapability()` still does not resolve MQTT device profiles.
- [ ] Confirm the current highest DB migration number and select the next free number.
- [ ] Run the existing backend test suite and record any pre-existing failures before changing code.
- [ ] Search for direct `connectorManager.executeAction(` calls and verify they are still limited to the intended command boundary/internals. Do not silently add another one.

**Checkpoint 0:** No implementation until the baseline is understood. If the branch has already implemented part of this spec, adapt tasks to verify/reuse it rather than duplicating it.

---

## Task 1: Add shared types and database migration

- [ ] Add `MqttCommandProfile` and its acknowledgement configuration type to the appropriate shared type module.
- [ ] Extend `Device` with optional `mqttCommandProfile` while preserving existing `commandTopic`.
- [ ] Add optional event metadata to `NormalizedEvent` and `EventContext`.
- [ ] Add `EventMetadata` / `EventSourceKind` types.
- [ ] Add `commandId` to the command result surface in the least breaking way consistent with the design.
- [ ] Add command record/transition types in a focused module (`command-history-store.ts` or adjacent types file).
- [ ] Add the next DB migration for:
  - MQTT command profile persistence;
  - `command_records`;
  - `command_transitions`;
  - required indexes.
- [ ] Register the migration in the migration index.
- [ ] Add migration tests following existing project conventions.
- [ ] Add serialization/deserialization tests for `mqttCommandProfile` in the Device Registry.

**Checkpoint 1:** migration up path works from the existing schema; existing devices load with an undefined profile; no current registry tests regress.

---

## Task 2: Implement `CommandHistoryStore`

- [ ] Create the store with transactional create/transition methods.
- [ ] Ensure transition writes update summary state and append immutable history atomically.
- [ ] Implement `get(commandId)` returning record + chronological transitions.
- [ ] Implement bounded `list()` with filters for device, rule/execution, state, source kind, and limit.
- [ ] Implement lookup/linkage by correlation ID if required by tracker composition.
- [ ] Implement `reconcileInterrupted(now)` using effective tier/terminal state, not state name alone.
- [ ] Ensure reconciliation writes `FAILED` with machine-readable `interrupted` failure kind/reason and a transition row.
- [ ] Make reconciliation idempotent.
- [ ] Unit test all operations, ordering, filter bounds, duplicate/invalid transition handling, and reconciliation.

**Checkpoint 2:** the store can represent dispatch-only, ACK-only, observed, failure, timeout, mismatch, and interrupted histories without any MQTT runtime.

---

## Task 3: Integrate command identity/history into `CommandService`

Follow the locked command-creation ordering in design §2.1. `commandId` identifies a command Aeolus accepted into the pipeline, not every attempted call.

- [ ] Explicitly classify which `ActionDescriptor` types are Verified Physical Commands so raw publish/webhook actions never create command history.
- [ ] Return handler-resolution and scope/authorization refusals as request-level failures with **no `commandId` and no command record** (decision 1).
- [ ] Allocate `commandId` only after handler resolution and the scope/authorization gate both pass (decision 2).
- [ ] Resolve acknowledgement capability and effective tier (side-effect-free reads) **before** the first durable write, then create the `REQUESTED` record and transition complete on first insert — `commandId`, `requestedTier`, `effectiveTier`, source/provenance, and `correlationId` when tracked (refinement A; avoids a write-then-update to backfill `effectiveTier`).
- [ ] Add `commandId` to every `CommandService` physical-command result produced once a record exists, including post-acceptance validation/transport/connector failures. (Pre-acceptance refusals return no `commandId`.)
- [ ] Persist `REQUESTED -> FAILED` for every failure discovered after `commandId` allocation (observed-device-not-found, invalid post-acceptance metadata, transport failure, connector rejection).
- [ ] Persist `REQUESTED -> DISPATCHED` only after the existing handler reports dispatch acceptance.
- [ ] For a dispatch-only success, write `terminal_at` in the same transition that writes `DISPATCHED` (decisions 4/5; see design §1.2).
- [ ] Preserve the current register-before-dispatch ordering for tracked commands.
- [ ] Persist final timeout/mismatch/failure/observed/acknowledged outcomes without changing existing lifecycle semantics.
- [ ] Link automation `ruleId`, active `executionId`, and triggering causation ID where available, reading them through the narrow execution-context boundary (design §2.3), not by coupling `CommandService` to the automation runtime.
- [ ] Ensure REST/system commands receive useful source metadata even without an automation execution (execution context is simply `undefined`).
- [ ] Add unit tests showing every physical `ActionResult` produced by `CommandService` has a `commandId` and agrees with durable history.
- [ ] Add a test proving handler/scope refusals produce no `commandId` and no command record.
- [ ] Add a regression test proving raw `mqtt.publish()` still has no Verified Command record.

**Checkpoint 3:** an accepted command request results in one `commandId`, one summary record, and a valid transition sequence; refusals before acceptance create no record. Existing unified-command-boundary tests still pass.

---

## Task 4: Expose intermediate tracker transitions and implement restart truthfulness

- [ ] Add `commandId` to `PendingCommand` so every transition can be attributed without a DB lookup (decision 6).
- [ ] Add an `onTransition` callback to the tracker; the tracker **reports** transitions carrying `commandId` and MUST NOT access the database itself (decision 7 / design §1.3).
- [ ] Compose the tracker with `CommandHistoryStore` via a composition-layer adapter that maps `onTransition` -> `commandHistoryStore.transition(...)`. Keep the tracker DB-free so it stays unit-testable without a database.
- [ ] Emit/record `ACKNOWLEDGED` even when the command continues waiting for `OBSERVED`.
- [ ] Preserve idempotence for duplicate/late ACK messages (no duplicate transitions).
- [ ] Ensure `cancel()` caused by dispatch failure does not create contradictory duplicate transitions.
- [ ] Run `reconcileInterrupted()` at safe startup time before stale in-flight records are presented as active.
- [ ] Implement `reconcileInterrupted()` against `terminal_at IS NULL` plus `effective_tier`, never `lifecycle_state NOT IN (...)` (decision 4 / design §1.2, §4); set `terminal_at` on the interrupted `FAILED` write for idempotency.
- [ ] Do not deserialize predicates or replay commands after restart.
- [ ] Add tests for restart at:
  - `REQUESTED`;
  - `DISPATCHED` awaiting ACK;
  - `ACKNOWLEDGED` awaiting observation;
  - already-terminal dispatch-only command (`DISPATCHED` with `terminal_at` set) — proving it is left untouched.
- [ ] Add a test proving reconciliation is idempotent across repeated startups.
- [ ] Add a test proving startup reconciliation performs zero physical/MQTT dispatches.

**Checkpoint 4:** interrupted histories become truthful terminal failures, completed dispatch-only commands are left alone, and no physical command is replayed.

---

## Task 5: Make generic MQTT acknowledgement capability real

- [ ] Update `ActionRouter.getAcknowledgementCapability()` so MQTT devices translate their persisted `mqttCommandProfile.acknowledgement` into the existing `AcknowledgementCapability` contract.
- [ ] Preserve connector-owned capability lookup exactly for non-MQTT devices.
- [ ] Confirm `ConnectorManager.getCompletionTierCapability()` now reports the correct ceiling for configured MQTT devices without a second special case.
- [ ] Extend `MqttService.publish()` with optional QoS while preserving current defaults/properties.
- [ ] Update `ActionRouter.executeMqttAction()` to use configured QoS.
- [ ] Keep existing command topic resolution logic, including explicit `Device.commandTopic` preference.
- [ ] Unit test MQTT profile -> capability translation.
- [ ] Unit test no-profile -> dispatch-only behaviour.
- [ ] Unit test connector acknowledgement behaviour is unchanged.
- [ ] Unit test response topic override, indicator values, and QoS.

**Checkpoint 5:** a generic MQTT device can truthfully advertise the acknowledged completion tier through the same capability API as connector devices.

---

## Task 6: Add MQTT command-profile API

- [ ] Add authenticated GET/PUT route(s) for a device's MQTT command profile using existing route conventions.
- [ ] Reject profile writes for non-MQTT devices.
- [ ] Validate QoS, response topic, indicator field, and indicator values.
- [ ] Reject wildcard response topics (`+`, `#`) and unsafe/bogus values.
- [ ] Persist through the Device Registry/store rather than maintaining route-local state.
- [ ] Apply existing control-relevant device authorization/RBAC.
- [ ] Add API tests for read, update, invalid profile, unauthorized access, non-MQTT device, and restart persistence.

**Checkpoint 6:** profile configuration can be created by backend/API clients without direct database editing.

---

## Task 7: Add event metadata and causal propagation

- [ ] Generate `EventMetadata` for ordinary inbound MQTT device events.
- [ ] Add equivalent metadata at connector event normalization where practical.
- [ ] Carry optional metadata into `EventContext` and sandbox `context` without breaking existing scripts.
- [ ] Ensure automation execution retains the triggering event ID.
- [ ] Reuse the existing execution `AsyncLocalStorage` or an equally scoped mechanism to associate commands/events with the active `executionId`.
- [ ] Persist command `causationId` when the command originated from a metadata-bearing automation trigger.
- [ ] Add tests for concurrent automation executions proving metadata/execution IDs do not leak across executions.

**Checkpoint 7:** a command issued by a triggered automation can be traced back to the execution and triggering event without parsing logs.

---

## Task 8: Implement safe Automation Events over MQTT

- [ ] Add `AUTOMATION_EVENT` internal event constant.
- [ ] Create `AutomationEventService` with event-name validation, versioned envelope creation, host-derived source identity, causation/trace metadata, causal depth enforcement, and MQTT publish.
- [ ] Choose/configure the reserved default namespace `aeolus/events` and ensure it is subscribed/ingested.
- [ ] Add the `events.emit(name, payload)` sandbox surface.
- [ ] Ensure scoped automations may call `events.emit()`.
- [ ] Keep scoped raw `mqtt.publish()` refusal unchanged.
- [ ] In `MqttService.handleMessage()`, route valid automation-event topics before device discovery normalization.
- [ ] Preserve `MQTT_RAW_MESSAGE` emission for those topics.
- [ ] Reject malformed Automation Event envelopes without creating a device or triggering a rule.
- [ ] Update `AutomationEngine` to evaluate `AUTOMATION_EVENT` topic matches without applying the device-ID scope gate.
- [ ] Normalize primitive event payloads to an `EventContext.state` record if necessary.
- [ ] Add tests for exact topic, `+`, and `#` wildcard receiving rules.
- [ ] Add tests proving no Device Registry entry is created from the reserved event namespace.
- [ ] Add a security test proving the event API cannot escape the reserved namespace.
- [ ] Add an event-cycle test proving emission is refused at the configured maximum causal depth rather than publishing indefinitely.

**Checkpoint 8:** Automation A can publish a constrained MQTT domain event and Automation B can react to it while both remain scoped and no phantom device is created.

---

## Task 9: Add backend observability API and WebSocket events

- [ ] Add `COMMAND_LIFECYCLE_TRANSITION` internal event constant.
- [ ] Emit the transition signal only after the durable transition write succeeds.
- [ ] Add authenticated bounded recent-command list endpoint.
- [ ] Add authenticated single-command detail endpoint including transition timeline.
- [ ] Validate list filters and clamp limit to a safe maximum.
- [ ] Add WebSocket mapping `COMMAND_LIFECYCLE_TRANSITION -> command-lifecycle` using the current data-driven mapping pattern.
- [ ] Add WebSocket mapping/signal for Automation Events suitable for future flow inspection.
- [ ] Add route/WebSocket tests.
- [ ] Do not add UI components in this task.

**Checkpoint 9:** a client can query a past command and can observe new transitions live without reading application logs.

---

## Task 10: End-to-end release gates

- [ ] Add an end-to-end generic MQTT ACK test:
  1. register a generic MQTT device;
  2. persist ACK-capable profile;
  3. issue a command through `CommandService`;
  4. assert outbound MQTT contains `correlationId` and `responseTopic` in JSON plus MQTT 5 correlation/response properties;
  5. publish/route `{ correlationId, success: true }`;
  6. assert terminal `ACKNOWLEDGED` result;
  7. assert durable `REQUESTED -> DISPATCHED -> ACKNOWLEDGED` timeline.
- [ ] Add observed-tier test with intermediate ACK and eventual state observation.
- [ ] Add failure tests for device `success:false`, timeout, mismatch, duplicate ACK, late ACK, and MQTT unavailable.
- [ ] Add restart test proving no physical replay.
- [ ] Add end-to-end Automation A -> MQTT event -> Automation B test with causation metadata.
- [ ] Assert the automation event appears on raw MQTT observability but not in Device Registry.
- [ ] Run backend unit/integration/property tests.
- [ ] Run frontend tests/build even though Phase 1 has no intended visual changes, catching contract/type regressions.
- [ ] Run lint/typecheck/format gates used by CI.
- [ ] Search again for physical `connectorManager.executeAction(` bypasses.
- [ ] Search for any new raw MQTT permission relaxation for scoped automations.

**Checkpoint 10:** all Phase 1 acceptance criteria are demonstrably green.

---

## Task 11: Documentation and handoff to Phase 2

- [ ] Update `docs/MICROCONTROLLERS.md` with the real generic MQTT ACK profile/configuration path and response example.
- [ ] Update the technical/reference command documentation with `commandId`, durable history, and restart semantics.
- [ ] Document `events.emit()` and the reserved Automation Event namespace for automation authors.
- [ ] Document that provenance is diagnostic metadata, not authorization.
- [ ] Document that pending commands are not replayed after restart.
- [ ] Avoid rewriting `WHY_AEOLUS.md`, marketing copy, or demo narratives unless a factual claim is now wrong.
- [ ] Add a short Phase 2 handoff note stating that mock actuators must use the same MQTT command/ACK/state contracts as real devices and must not call command internals directly.

## Final completion checklist

Phase 1 is not complete unless all are true:

- [ ] Generic MQTT ACK works end to end through the existing command boundary.
- [ ] Every verified physical command has a durable `commandId`.
- [ ] The complete ACK/observed transition sequence is queryable after the fact.
- [ ] Restart cannot leave command history pretending a dead in-memory wait is still active.
- [ ] Restart does not replay physical commands.
- [ ] Automation events carry causal metadata.
- [ ] Scoped automations can communicate over the reserved MQTT event channel without arbitrary MQTT access.
- [ ] Automation event topics never become devices.
- [ ] Backend APIs and WebSocket events exist for later UI work.
- [ ] Existing command sources, connector ACKs, scoped authorization, and raw MQTT semantics still pass regression tests.
