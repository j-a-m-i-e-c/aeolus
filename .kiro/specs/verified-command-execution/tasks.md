# Implementation Plan: Verified Command Execution

## Overview

This plan implements truthful execution reporting across two axes: (1) the Sandbox reporting real script outcomes so the AutomationEngine records failures, metrics, and events accurately, and (2) a capability-degrading command lifecycle (`REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED`, plus `FAILED`/`TIMED_OUT`/`STATE_MISMATCH`) owned by the ActionExecutor, backed by MQTT 5 command correlation and an in-memory `PendingCommandTracker`.

Implementation language is **TypeScript** (matching the existing codebase). Tests use `vitest` + `fast-check`, following the repo's existing conventions (`sandbox.property.test.ts`, `action-executor.property.test.ts`). Each of the design's 15 correctness properties is implemented as exactly one property-based test, tagged `// Feature: verified-command-execution, Property {n}: {text}`, running at `{ numRuns: 200 }`. Timeout-driven properties (P8, P15) use `vitest` fake timers.

Tasks build incrementally: pure helpers and type contracts first, then the tracker and MQTT plumbing, then the ActionExecutor integration that wires everything together, then observability and backward-compatibility verification. No orphaned code — every helper is consumed by a later integration task.

## Tasks

- [ ] 1. Truthful sandbox execution result contract
  - [ ] 1.1 Add `SandboxExecutionResult` type, `classifySandboxError` helper, and change `execute()` to return the result
    - In `src/automations/sandbox.ts` add `SandboxFailureReason = "runtime" | "timeout" | "memory" | "unavailable"` and the discriminated `SandboxExecutionResult` union
    - Add exported pure helper `classifySandboxError(err, isolateWasDisposed)` implementing chronological precedence: timeout signature (`/timed out/i`) first, then memory (`isolateWasDisposed === true` or `/memory limit|array buffer allocation failed|disposed/i`), else `runtime`; `error` is always `err.message`
    - Change `Sandbox.execute()` from `Promise<void>` to `Promise<SandboxExecutionResult>`: success → `{ success: true }`; classified failure → `{ success: false, error, reason }`; `ivm === null` handled before isolate creation → `{ success: false, reason: "unavailable", error: "Sandbox execution unavailable — isolated-vm is not installed" }`; still never rejects
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [ ]* 1.2 Write property tests for the classifier and non-rejection (extend `src/automations/sandbox.property.test.ts`)
    - **Property 1: Sandbox error classification is accurate and honors precedence** — validate `classifySandboxError` reason/precedence and non-empty `error` equal to the message
    - **Property 2: Sandbox execution always resolves** — for every simulated outcome (success/runtime/timeout/memory/unavailable) `execute()` resolves a `SandboxExecutionResult` and never rejects
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 1.8**
  - [ ]* 1.3 Write unit test for the `unavailable` branch (extend `src/automations/sandbox.property.test.ts` or `sandbox` example tests)
    - Assert that when `ivm` is `null`, `execute()` returns `{ success:false, reason:"unavailable" }` with the unavailable error string
    - _Requirements: 1.6_

- [ ] 2. AutomationEngine acts on the real sandbox result
  - [ ] 2.1 Branch `executeScriptRule()` on the result; remove dead `.catch()`; add additive execution-log fields
    - In `src/automations/automation-engine.ts` replace the resolution-means-success logic with a branch on `result.success`; delete the unreachable `.catch()` branch (the promise never rejects)
    - On success: record `ExecutionLog` entry with `success: true`; on failure: record `success: false` including the Sandbox `error` and `reason`; always record measured `duration` in ms
    - Gate emissions: emit `AUTOMATION_EXECUTION_COMPLETE` with status `success`/`error` per outcome (including duration); emit `AUTOMATION_FIRED` only on success
    - In `src/automations/execution-log.ts` add optional additive fields to `ExecutionLogEntry.actions[]`: `reason?: SandboxFailureReason` and `lifecycleState?: CommandLifecycleState` (keep `duration` required)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 8.3_
  - [ ]* 2.2 Write property test for execution-log fidelity (new `src/automations/automation-engine.property.test.ts`)
    - **Property 3: The engine faithfully mirrors the sandbox result into the execution log** — for any `SandboxExecutionResult`, logged `success` matches; failures include `error` and `reason`
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [ ]* 2.3 Write property test for metrics/event emission (extend `src/automations/automation-engine.property.test.ts`)
    - **Property 4: Metrics and events reflect the true script outcome** — `AUTOMATION_EXECUTION_COMPLETE` status is `success` iff `result.success`, and `AUTOMATION_FIRED` is emitted iff `result.success`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [ ] 3. Command lifecycle pure helpers and tier selection
  - [ ] 3.1 Add `CommandLifecycleState` and the `command-lifecycle.ts` transition module
    - In `src/core/types.ts` add the `CommandLifecycleState` string union (`REQUESTED | DISPATCHED | ACKNOWLEDGED | OBSERVED | FAILED | TIMED_OUT | STATE_MISMATCH`)
    - Create `src/automations/command-lifecycle.ts` with the central transition table and pure helpers `canTransition(from, to)`, `isTerminal(state)`, `isSuccessState(state)` (DISPATCHED | OBSERVED | ACKNOWLEDGED-as-terminal), and `selectRequiredTier(hasConfirm, hasAckCapability): "dispatch" | "acknowledged" | "observed"` following Observed > Acknowledged > Dispatch
    - _Requirements: 4.1, 4.5, 4.7, 4.8, 9.6_
  - [ ]* 3.2 Write property test for dispatch outcome mapping (new `src/automations/command-lifecycle.property.test.ts`)
    - **Property 5: Dispatch outcome maps to DISPATCHED or FAILED** — accepted → `DISPATCHED`; error → `FAILED` with non-empty message (exercised via the transition table)
    - **Validates: Requirements 4.3, 4.4**
  - [ ]* 3.3 Write property test for capability-gated ACKNOWLEDGED (extend `command-lifecycle.property.test.ts`)
    - **Property 6: ACKNOWLEDGED requires declared capability; dispatch-only terminates truthfully at DISPATCHED** — with no capability and no confirm, terminal state is `DISPATCHED` (success) or `FAILED`, never `ACKNOWLEDGED`
    - **Validates: Requirements 4.5, 4.7, 4.8, 9.2, 9.3, 9.5**
  - [ ]* 3.4 Write property test for terminal-state presence (extend `command-lifecycle.property.test.ts`)
    - **Property 7: Every reported outcome carries a terminal lifecycle state** — any outcome carries a `lifecycleState` that is one of the terminal states
    - **Validates: Requirements 4.9, 8.4**
  - [ ]* 3.5 Write property test for tier selection (extend `command-lifecycle.property.test.ts`)
    - **Property 10: Highest available confirmation tier is selected** — `selectRequiredTier` returns `observed` when confirm present, else `acknowledged` when capability declared, else `dispatch`
    - **Validates: Requirements 9.6**

- [ ] 4. Checkpoint - foundations
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Confirmation options and extended result types
  - [ ] 5.1 Add `ConfirmOptions`, default timeout, and extend `ActionResult`/`BulkActionResult`
    - In `src/core/types.ts` add `ConfirmOptions { deviceId?; condition: (state) => boolean; timeoutMs? }` and `export const DEFAULT_CONFIRM_TIMEOUT_MS = 5000`
    - Extend `ActionResult` with optional `lifecycleState?: CommandLifecycleState` and `correlationId?: string`; confirm `BulkActionResult.results` entries carry the embedded `ActionResult` (and thus `lifecycleState`)
    - Keep all new fields optional so existing readers of `success`/`data`/`error` are unaffected
    - _Requirements: 4.9, 5.1, 5.7, 6.2_
  - [ ]* 5.2 Write backward-compatibility type/shape test (extend `src/automations/action-executor.test.ts`)
    - Assert the pre-existing `success`/`data`/`error` fields remain and that the new optional fields do not break existing consumers
    - _Requirements: 6.2_

- [ ] 6. Acknowledgement capability surface on the Connector interface
  - [ ] 6.1 Add `AcknowledgementCapability` and optional `getAcknowledgementCapability?()`
    - In `src/connectors/connector.interface.ts` add the `AcknowledgementCapability` interface (`supported`, optional `responseTopic`, `ackIndicatorField` default `"status"`, `ackIndicatorValues`) and the optional `getAcknowledgementCapability?(deviceId): AcknowledgementCapability | undefined` method, following the existing `getActionCatalog?` pattern
    - _Requirements: 9.1_
  - [ ]* 6.2 Write unit test for capability declaration and Dispatch-tier fallback (new `src/connectors/connector.interface.test.ts` or extend an existing connector test)
    - Assert a connector without the method resolves to no acknowledgement (Dispatch tier) and one declaring it is surfaced
    - _Requirements: 9.1, 9.2_

- [ ] 7. PendingCommandTracker
  - [ ] 7.1 Implement `PendingCommandTracker` with timeouts and idempotent transitions
    - Create `src/automations/pending-command-tracker.ts` with `AckMessage`, `RequiredTier`, `PendingCommand`, `PendingResolution` and the class: `register(cmd)` returns a promise resolving once with the terminal resolution (never rejects) and arms an OS timer independent of MQTT connectivity; `route(msg)`, `observeState(deviceId, state)`, `has(id)`, `get size`
    - Transitions via `command-lifecycle.ts`: ack indicator → `ACKNOWLEDGED` at most once; predicate satisfied → `OBSERVED` (success) at most once; settled observation fails predicate → `STATE_MISMATCH`; predicate throws → `FAILED`; timer fires → `TIMED_OUT`; remove from map on resolution; late/unknown ids ignored
    - _Requirements: 5.2, 5.3, 5.4, 5.6, 5.8, 9.4, 10.4, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14_
  - [ ]* 7.2 Write property test for confirmation resolution using fake timers (new `src/automations/pending-command-tracker.property.test.ts`)
    - **Property 8: Confirmation resolves to the correct terminal state** — satisfy → `OBSERVED`/success; settled mismatch → `STATE_MISMATCH`; predicate throw → `FAILED` with message; no observation before timeout → `TIMED_OUT` (use `vitest` fake timers)
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.6, 5.9, 10.10, 10.12**
  - [ ]* 7.3 Write property test for correlated acknowledgement + combined satisfaction (extend `pending-command-tracker.property.test.ts`)
    - **Property 14: Correlated acknowledgement drives the ACKNOWLEDGED transition, including combined satisfaction** — an ack advances to `ACKNOWLEDGED`; a single message satisfying both drives `ACKNOWLEDGED` and `OBSERVED`
    - **Validates: Requirements 4.6, 10.9, 10.11**
  - [ ]* 7.4 Write property test for idempotent late/duplicate acks with fake timers (extend `pending-command-tracker.property.test.ts`)
    - **Property 15: Late and duplicate acknowledgements are idempotent** — any number of same-tier acks apply the transition at most once; messages after a terminal state cause no further transition (use `vitest` fake timers)
    - **Validates: Requirements 10.13, 10.14**

- [ ] 8. Command envelope and MQTT 5 publish extension
  - [ ] 8.1 Add `CommandEnvelope` and extend `MqttService.publish()` with MQTT 5 properties
    - Create `src/mqtt/command-envelope.ts` with `CommandEnvelope { correlationId; responseTopic; payload & { correlationId; responseTopic } }` (correlationId via `randomUUID()`), building the envelope so the id/topic are mirrored into both MQTT 5 properties and the JSON payload
    - Extend `MqttService.publish(topic, payload, options?)` in `src/mqtt/mqtt-service.ts` to accept `correlationData?: Buffer` and `responseTopic?: string` alongside the existing `messageExpiryInterval`, setting them on the same `properties` object only when provided (additive, existing callers unaffected)
    - _Requirements: 10.1_
  - [ ]* 8.2 Write property test for envelope mirroring (new `src/mqtt/command-envelope.property.test.ts`)
    - **Property 11: Command envelope mirrors correlation across both mechanisms** — MQTT 5 Correlation Data `correlationId` equals payload `correlationId`; Response Topic present in both property and payload
    - **Validates: Requirements 10.1**
  - [ ]* 8.3 Write integration test for publish properties (extend `src/mqtt/mqtt-service.integration.test.ts`)
    - With a mocked client, assert `publish()` sets `correlationData` + `responseTopic` alongside `messageExpiryInterval`
    - _Requirements: 10.1_

- [ ] 9. MQTT ack-ingestion routing
  - [ ] 9.1 Route response-topic messages to the tracker; add correlation-id resolver
    - In `src/mqtt/mqtt-service.ts` subscribe to the configured ack-topic space (e.g. `aeolus/acks/#`, injected as config) and in `handleMessage()` detect ack-topic matches via a prefix/wildcard test
    - Add an exported pure helper `resolveCorrelationId(correlationData?, payloadCorrelationId?)`: prefer MQTT 5 Correlation Data when present, else payload `correlationId`; return none when neither present
    - On ack topics, build an `AckMessage` and call `PendingCommandTracker.route()` (via the thin callback/reference set at composition, mirroring `ActionRouter.setMqttService()`); non-ack topics continue emitting `DEVICE_STATE_CHANGE` unchanged and also feed `PendingCommandTracker.observeState()`
    - _Requirements: 5.8, 9.4, 10.5, 10.6, 10.7, 10.8_
  - [ ]* 9.2 Write property test for correlation-id resolution precedence (extend `pending-command-tracker.property.test.ts`)
    - **Property 13: Correlation id resolution honors source precedence** — resolve from MQTT 5 Correlation Data when present, else payload `correlationId`; both present → MQTT 5 value; neither → no match
    - **Validates: Requirements 10.5, 10.6, 10.7, 10.8**
  - [ ]* 9.3 Write integration test for ack routing vs device-state (extend `src/mqtt/mqtt-service.integration.test.ts`)
    - Assert a message on `aeolus/acks/#` routes to the tracker rather than emitting an ordinary `DEVICE_STATE_CHANGE`, and normal topics still emit `DEVICE_STATE_CHANGE`
    - _Requirements: 9.4, 10.5, 10.8_

- [ ] 10. Checkpoint - correlation plumbing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. ActionExecutor lifecycle integration
  - [ ] 11.1 Own the lifecycle, assign correlation ids, evaluate confirm, and wire the tracker
    - In `src/automations/action-executor.ts` assign `REQUESTED` on entry; on connector/MQTT acceptance advance to `DISPATCHED`, on dispatch error to `FAILED` with message; assign a unique `correlationId` per command (per-device in bulk); select the required tier via `selectRequiredTier`
    - When capability and/or `confirm` applies, build the `CommandEnvelope`, `register` the pending command with the tracker, `await` its resolution, and return the final `ActionResult` (with `lifecycleState`, `correlationId`); missing observed device → `success:false` identifying error before registering; predicate throw → `FAILED`; apply `DEFAULT_CONFIRM_TIMEOUT_MS` when `timeoutMs` omitted
    - For `actionAll()`, produce one per-device `ActionResult` with its own lifecycle state, and compute `total`/`succeeded`/`failed` preserving `succeeded + failed === total`; zero matches → all zero, empty `results`
    - _Requirements: 4.2, 4.3, 4.4, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 6.1, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 9.6, 10.2, 10.3, 10.4_
  - [ ]* 11.2 Write property test for bulk arithmetic and per-device fidelity (extend `src/automations/action-executor.property.test.ts`)
    - **Property 9: Bulk action arithmetic and per-device fidelity** — one entry per matched device, `total`/`succeeded`/`failed` correct, invariant holds, each entry reflects its own outcome and a valid terminal `lifecycleState`; zero matches → all zero, empty `results`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**
  - [ ]* 11.3 Write property test for correlation-id uniqueness (extend `action-executor.property.test.ts`)
    - **Property 12: Correlation ids are unique across outstanding commands** — for any single/bulk dispatch sequence, assigned `correlationId` values are pairwise distinct across outstanding commands
    - **Validates: Requirements 10.2, 10.3**
  - [ ]* 11.4 Write unit tests for confirm edge cases and backward compatibility (extend `src/automations/action-executor.test.ts`)
    - Missing observed device → identifying error (5.5); default timeout applied when omitted (5.7); observation sourced from `DEVICE_STATE_CHANGE` state (5.8); initial `REQUESTED` assignment (4.2); 3-arg `devices.action()`/`devices.actionAll()` and unchanged bulk shape without confirm (6.1, 6.3, 6.4, 7 shape)
    - _Requirements: 4.2, 5.5, 5.7, 5.8, 6.1, 6.3, 6.4_

- [ ] 12. Sandbox host-callback confirm passthrough
  - [ ] 12.1 Accept an optional 4th `confirm` argument preserving the 3-arg form
    - In `src/automations/sandbox.ts` bootstrap, extend the `devices.action`/`devices.actionAll` wrappers to pass an optional 4th `confirm` argument; in `__actionRef`/`__actionAllRef` wrap the isolated-vm `Reference` predicate into a host function `(state) => predicateRef.applySync(...)` and pass it as `ConfirmOptions.condition`; when `confirm` is `undefined`, behavior is byte-for-byte the current dispatch-only path
    - _Requirements: 6.1, 6.3, 6.4_
  - [ ]* 12.2 Write backward-compatibility tests for the 3-arg and 4-arg forms (extend `src/automations/sandbox.property.test.ts`)
    - Assert 3-arg calls behave exactly as before and the 4-arg form threads `confirm` through to the executor
    - _Requirements: 6.1, 6.3, 6.4_

- [ ] 13. Observability of lifecycle and execution states
  - [ ] 13.1 Log terminal transitions, timeout/mismatch, and script failures
    - Add logging (via the existing logger) so terminal transitions log target, final state, and error (8.1); `TIMED_OUT`/`STATE_MISMATCH` additionally log the observed device id and applied timeout (8.2); and the ActionExecutor records the final `lifecycleState` in its Execution_Log entry (8.4). Script-failure logging (rule id, reason, error) is already added in task 2.1 (8.3) — verify it is present here
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [ ]* 13.2 Write logging example tests with a spied logger (extend `action-executor.test.ts` / `automation-engine.test.ts`)
    - Assert terminal-state, timeout/mismatch, and script-failure log calls fire with the expected fields
    - _Requirements: 8.1, 8.2, 8.3_

- [ ] 14. Backward-compatibility, migration verification, and final build
  - [ ]* 14.1 Write additive-field and additive-option migration checks
    - Assert `ExecutionLogEntry.actions[]` additions (`reason`, `lifecycleState`) are optional and tolerated by existing execution-log serialization; assert `ActionResult` additions (`lifecycleState`, `correlationId`) do not affect current `success`/`data`/`error` readers; assert `MqttService.publish()` behaves identically for callers passing no options or only `messageExpiryInterval`
    - _Requirements: 6.1, 6.2, 6.3, 10.1_
  - [ ] 14.2 Run the full build and test suite and fix any failures
    - Run the project build/typecheck and the full `vitest` suite (single-run, not watch); resolve any type or test failures introduced by the feature
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.9, 6.2_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but the design treats testing as first-class; each of Properties 1–15 maps to exactly one property-based test.
- Property tests use `fast-check` at `{ numRuns: 200 }`, tagged `// Feature: verified-command-execution, Property {n}: {text}`.
- P8 and P15 (timeout-driven) use `vitest` fake timers for deterministic `TIMED_OUT` coverage.
- Pure helpers (`classifySandboxError`, `command-lifecycle` transitions, `selectRequiredTier`, `resolveCorrelationId`, envelope construction) are tested in isolation without a live isolate or broker, mirroring existing test patterns.
- Checkpoints (tasks 4, 10) and the final build (14.2) ensure incremental validation.
- Property → test-file mapping follows the design's Testing Strategy: P1–P2 in `sandbox.property.test.ts`, P3–P4 in `automation-engine.property.test.ts`, P5–P7 & P10 in `command-lifecycle.property.test.ts`, P8, P13–P15 in `pending-command-tracker.property.test.ts`, P9 & P12 in `action-executor.property.test.ts`, P11 in `command-envelope.property.test.ts`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "6.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.2", "5.1", "6.2"] },
    { "id": 2, "tasks": ["1.3", "2.2", "3.3", "5.2", "7.1"] },
    { "id": 3, "tasks": ["2.3", "3.4", "7.2", "9.1"] },
    { "id": 4, "tasks": ["3.5", "7.3", "8.2", "8.3", "11.1"] },
    { "id": 5, "tasks": ["7.4", "9.3", "11.2", "12.1"] },
    { "id": 6, "tasks": ["9.2", "11.3", "11.4", "12.2", "13.1"] },
    { "id": 7, "tasks": ["13.2"] },
    { "id": 8, "tasks": ["14.1"] },
    { "id": 9, "tasks": ["14.2"] }
  ]
}
```
