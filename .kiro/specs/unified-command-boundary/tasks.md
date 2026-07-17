# Implementation Plan: Unified Command Boundary

## Overview

This plan establishes **one physical-command boundary** — `CommandService` (the renamed `ActionExecutor`) — that every Command_Source routes through, and fixes truthful end-to-end result propagation via a single `AutomationExecutionResult` owned/recorded by one Execution_Owner (`ExecutionRecorder`). It also corrects `AUTOMATION_FIRED` (started) / `AUTOMATION_COMPLETED` (outcome) semantics and makes manual `/fire` await the eventual result.

Implementation language is **TypeScript** (matching the existing codebase; the design is expressed in concrete TypeScript, not pseudocode). Tests use `vitest` + `fast-check`, following the repo's existing conventions (`command-lifecycle.property.test.ts`, `pending-command-tracker.property.test.ts`, `action-executor.property.test.ts`). Each of the design's **13 correctness properties** maps to exactly one property-based test, tagged `// Feature: unified-command-boundary, Property {n}: {text}`, running at `{ numRuns: 200 }`.

Tasks build incrementally with no orphaned code: (1) pure/type modules first (`execution-types`, `assembleExecutionResult`, `CommandResultCollector`, the `AUTOMATION_COMPLETED` constant, config fields); (2) rename `ActionExecutor → CommandService` (drop its `AUTOMATION_FIRED` emission, add the `requiredTier` input); (3) the `ExecutionRecorder` Execution_Owner; (4) `AutomationEngine` assembly/recording, `executionId`, `AsyncLocalStorage` correlation, and `fire()` returning the result; (5) migration of every Command_Source onto the boundary; (6) the WebSocket mapping; then architecture/composition enforcement, the config bound assertion, and a final full build + test run.

> **Cross-spec dependency (script path).** Truthful script-path aggregation (Requirement 5.3, Property 8's script branch) is only fully accurate once the generated `automation()` helper `await`s asynchronous device actions — owned by the **async-await-in-scripts** spec. This plan builds the collection mechanism (task 6.4) and defines the target contract; the companion fix is **not** a task here. Until it lands, the Form_Rule path is fully truthful and the Script_Rule path is truthful for commands the script actually awaits.

> **Out of scope here.** The author-selectable completion-tier UI/persistence is a separate upcoming spec (**command-completion-tier**). Only the `requiredTier` input plumbing already present in this design (task 2.1) is in scope.

## Tasks

- [x] 1. Foundational pure and type modules
  - [x] 1.1 Add execution-result types (`execution-types.ts`)
    - Create `src/automations/execution-types.ts` with `export type CommandResult = ActionResult;` (alias documenting the per-command outcome value, reused from device-action-system-uplift / verified-command-execution — not redefined)
    - Add `export interface AutomationExecutionResult { executionId: string; success: boolean; commandResults: CommandResult[]; failureReason?: string }`
    - _Requirements: 4.1_
  - [x] 1.2 Implement `assembleExecutionResult` (`execution-result.ts`)
    - Create `src/automations/execution-result.ts` with `LogicOutcome { ok: boolean; error?: string }` and the pure function `assembleExecutionResult(executionId, logic, commandResults): AutomationExecutionResult`
    - `success === true` iff `logic.ok` AND every `commandResults[i].success === true`; empty list + `logic.ok` ⇒ `success:true` with empty `commandResults`
    - On any failing command ⇒ `success:false`, `failureReason` describing at least the first failing result; on `logic.ok === false` ⇒ `success:false` with the logic failure reason; a `null`/`undefined` entry (missing command result) ⇒ `success:false` with a missing-result reason; never pair a populated `failureReason` with `success:true`
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 5.2, 5.3, 5.4, 5.7_
  - [x]* 1.3 Write property test for execution-result assembly
    - New `src/automations/execution-result.property.test.ts`
    - **Property 8: Execution-result assembly is faithful**
    - **Validates: Requirements 4.1, 4.4, 4.5, 4.6, 4.7, 4.8, 5.2, 5.3, 5.4, 5.7**
  - [x] 1.4 Implement `CommandResultCollector` (`command-result-collector.ts`)
    - Create `src/automations/command-result-collector.ts` with `open(executionId)`, `push(executionId, result)`, `pushCurrent(result)`, `close(executionId): CommandResult[]`, and `readonly context: AsyncLocalStorage<string>`
    - Preserve push order so `close()` returns results in the exact order they were pushed; `pushCurrent` appends to the execution currently on the `AsyncLocalStorage` context
    - _Requirements: 4.3, 5.1, 5.3_
  - [x]* 1.5 Write property test for the collector
    - New `src/automations/command-result-collector.property.test.ts`
    - **Property 9: Command results are collected in issue order and fully incorporated**
    - **Validates: Requirements 4.3, 5.1**
  - [x] 1.6 Add the `AUTOMATION_COMPLETED` event constant
    - In `src/core/event-bus.ts` add `export const AUTOMATION_COMPLETED = "automation:completed" as const;` (existing constants unchanged; `AUTOMATION_FIRED` keeps its value but its meaning becomes "execution started")
    - _Requirements: 6.2_
  - [x] 1.7 Add REST/confirmation timeout config fields
    - In `src/config.ts` add `maxConfirmTimeoutMs` (default `DEFAULT_CONFIRM_TIMEOUT_MS` = 5000) and `restActionTimeoutMs` (default 7000), wired through the existing config loading/env parsing (the startup assertion is added later in task 8.1)
    - _Requirements: 3.7_

- [x] 2. Rename `ActionExecutor` to `CommandService`
  - [x] 2.1 Rename the boundary, drop `AUTOMATION_FIRED`, add `requiredTier`
    - Move `src/automations/action-executor.ts` to `src/automations/command-service.ts`; rename the class `ActionExecutor → CommandService`, `ActionExecutorDeps → CommandServiceDeps`, and update all import sites/references
    - Remove the internal `emitFired()` / `AUTOMATION_FIRED` emission entirely (the engine becomes the sole emitter of the started signal)
    - Add an optional `requiredTier?: ConfirmationTier` parameter to `execute(action, ruleId, confirm?, requiredTier?)`: validate against the device capability ceiling (`observed` needs `ConfirmOptions`; `acknowledged` needs a declared acknowledgement capability), clamp an over-request down to the highest provable tier and log the clamp, and never report a `lifecycleState` that was not actually reached
    - Preserve the "never throws; always returns one terminal `ActionResult`" contract
    - _Requirements: 1.5, 1.6, 6.3, 8.5_
  - [x]* 2.2 Write property test for source-independent processing
    - New `src/automations/command-service.property.test.ts` (spy `ConnectorManager`/handler + fake `PendingCommandTracker`, no real MQTT/network)
    - **Property 1: Source-independent command processing**
    - **Validates: Requirements 1.2, 2.10**
  - [x]* 2.3 Write property test for the single-terminal-result / no-reject contract
    - Extend `src/automations/command-service.property.test.ts`
    - **Property 2: Every command yields exactly one terminal Command_Result and never rejects**
    - **Validates: Requirements 1.3, 1.7**
  - [x]* 2.4 Write property test for capability-gated tier selection/clamping
    - Extend `src/automations/command-service.property.test.ts`
    - **Property 3: Tier is capability-gated and never exceeds the device ceiling**
    - **Validates: Requirements 1.5, and the author-selectable-tier Design Consideration (explicit tier input validated against capability)**
  - [x]* 2.5 Write property test for pre-connector validation rejection
    - Extend `src/automations/command-service.property.test.ts`
    - **Property 4: Validation rejects before the connector is reached**
    - **Validates: Requirements 1.8, 2.9**

- [x] 3. Execution_Owner — `ExecutionRecorder`
  - [x] 3.1 Implement `ExecutionRecorder` (`execution-recorder.ts`)
    - Create `src/automations/execution-recorder.ts` with `ExecutionRecorderDeps { eventBus; executionLog; logger }`, `ExecutionRecordInput { rule; result; durationMs }`, and the class
    - `record(input)` performs, in order and each exactly once, all derived from the single `AutomationExecutionResult`: (1) `ExecutionLog.push` with execution-level `success`, `failureReason`, and `duration = durationMs` (non-negative integer ms); (2) emit `AUTOMATION_EXECUTION_COMPLETE` metrics with `status` from `success`; (3) audit log at info/error from the same `success`; (4) emit `AUTOMATION_COMPLETED { result }`
    - `recordUnavailable(rule, executionId, durationMs, reason)` writes a single recording-failure log entry and emits none of metrics / `AUTOMATION_COMPLETED` / success history
    - Add the additive `success?` / `failureReason?` fields to `ExecutionLogEntry` in `src/automations/execution-log.ts`
    - _Requirements: 5.5, 5.6, 8.1, 8.2, 8.3, 8.4, 8.6, 8.7_
  - [x]* 3.2 Write property test for single-owner, exactly-once recording
    - New `src/automations/execution-recorder.property.test.ts` (spy `ExecutionLog` + captured event emissions)
    - **Property 12: Single-owner, exactly-once recording derived from one result**
    - **Validates: Requirements 5.5, 5.6, 8.1, 8.2, 8.3, 8.4, 8.6**

- [x] 4. `AutomationEngine` result assembly, correlation, and recording
  - [x] 4.1 Assemble, correlate, record, and return the execution result
    - In `src/automations/automation-engine.ts` update `AutomationEngineDeps` (`commandService`, `executionRecorder`, `collector`)
    - On each execution: assign `executionId = randomUUID()`; emit exactly one `AUTOMATION_FIRED { executionId, ... }` ("started"); remove the premature emission in `executeDirectRule()`
    - Establish the `executionId` in the collector's `AsyncLocalStorage` for the execution; `executeDirectRule()` awaits the form action's returned `CommandResult`, pushes it (or records a missing-result failure), assembles via `assembleExecutionResult`, and calls `ExecutionRecorder.record()`; `executeScriptRule()` runs the sandbox, reads collected results, combines sandbox outcome with command results, assembles, records
    - `fire()` returns the assembled `AutomationExecutionResult`; correlate `AUTOMATION_FIRED`/`AUTOMATION_COMPLETED` per `executionId`; guarantee `AUTOMATION_FIRED` precedes `AUTOMATION_COMPLETED`
    - _Requirements: 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.4, 6.6, 6.7, 7.1_
  - [x]* 4.2 Write property test for execution-id uniqueness
    - New `src/automations/automation-engine.property.test.ts` (in-memory event-bus model; fake `CommandService`; spy `ExecutionRecorder`)
    - **Property 10: Execution ids are unique across concurrently active executions**
    - **Validates: Requirements 4.2**
  - [x]* 4.3 Write property test for fired/completed event semantics
    - Extend `src/automations/automation-engine.property.test.ts`
    - **Property 11: Fired/completed event semantics**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.5**
  - [x]* 4.4 Write property test for manual fire resolving with the eventual result
    - Extend `src/automations/automation-engine.property.test.ts`
    - **Property 13: Manual fire resolves with the eventual result**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

- [x] 5. Checkpoint - boundary, recorder, and engine foundations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Migrate all command sources onto the boundary
  - [x] 6.1 Route the REST device-action route through `CommandService`
    - In `src/api/routes/device.routes.ts` change `createDeviceRoutes(registry, commandService, stateHistory?)` (was `connectorManager`); `POST /:id/action` calls `commandService.execute({ type, target: id, params }, ` + "`rest:${id}`" + `)` wrapped in `withTimeout(..., restActionTimeoutMs, () => ({ success:false, lifecycleState:"TIMED_OUT", error:"Device command timed out" }))`, returning the `Command_Result` unaltered with HTTP 200 for all domain outcomes
    - Keep the catalog endpoint working via an injected read-only `getActionCatalog: (id) => CapabilityDescriptor[]` accessor (bound from the manager at composition) instead of a full `ConnectorManager` reference; add the `withTimeout` helper
    - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.5, 3.6_
  - [x]* 6.2 Write property test for the truthful REST response
    - New `src/api/routes/device.routes.property.test.ts` (supertest against the route with a fake `CommandService` returning generated results)
    - **Property 6: The REST route returns the Command_Result truthfully over HTTP 200**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
  - [x] 6.3 Return the form-rule result and make `/fire` await the outcome
    - Widen `Rule.action` in `src/core/types.ts` to `(context) => void | CommandResult | Promise<void | CommandResult>`
    - In `src/api/routes/automation.routes.ts` `registerUiRule()` form branch, have the action `return commandService.execute(descriptor, stored.id)` instead of discarding it; change the manual `/fire` route to `await engine.fire(id, context)` and return the resulting `success`, `failureReason`, and `executionId`
    - _Requirements: 2.5, 5.1, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 6.4 Push script-issued command results into the collector
    - In `src/automations/sandbox.ts`, have the host callbacks (`__actionRef` / `__actionAllRef`) call `collector.pushCurrent(result)` for each issued `Command_Result` so script-path commands are aggregated for the running `executionId`; keep the host callback signatures unchanged
    - Note: full script-path truthfulness (Req 5.3) also depends on the **async-await-in-scripts** companion fix so the script awaits its actions before the sandbox resolves; that fix is out of scope for this plan
    - _Requirements: 2.4, 4.3, 5.3_
  - [x] 6.5 Return the structured Command_Result from the custom-UI broker
    - In `frontend/src/sandbox/sdk-broker.ts` change `BrokerDeps.control` and the `"control"` op to return `Promise<CommandResult>`; in `frontend/src/sandbox/sandbox-host.ts` parse and return the REST JSON body as `CommandResult` (resolving with `success:false` too) so `aeolus.control()` resolves with the structured outcome
    - _Requirements: 2.3, 3.4_
  - [ ]* 6.6 Write property test for custom-UI control resolution
    - New `frontend/src/sandbox/sdk-broker.property.test.ts` (fake `control` dep returning generated results; assert the RPC response echoes them)
    - **Property 7: Custom-UI control resolves with the structured outcome**
    - **Validates: Requirements 3.4**
  - [x] 6.7 Wire the composition root by construction
    - In `src/index.ts` construct `CommandResultCollector` and `ExecutionRecorder`, pass `commandService`/`executionRecorder`/`collector` into `AutomationEngine`, and grant the `ConnectorManager` reference to exactly one collaborator — the `CommandService` deps object
    - Stop passing `connectorManager` to `createDeviceRoutes`; pass `commandService` plus the bound `getActionCatalog` accessor; add a module-level note that `connectorManager.executeAction(` must appear only inside `command-service.ts` handlers
    - _Requirements: 1.1, 2.2, 2.6, 2.7, 2.8_

- [x] 7. WebSocket mapping and raw-MQTT observability
  - [x] 7.1 Broadcast `AUTOMATION_COMPLETED` to the frontend
    - In `src/index.ts` add `{ eventName: AUTOMATION_COMPLETED, messageType: "automation-completed" }` to `WS_MAPPINGS` (terminal outcomes only; no per-transition lifecycle events, per the design recommendation)
    - _Requirements: 6.2_
  - [x] 7.2 Add the raw-MQTT command-topic observability signal
    - In `src/mqtt/mqtt-service.ts` add a best-effort, non-blocking signal when `mqtt.publish()` targets a topic the device registry identifies as a device command topic; the raw publish is never blocked/rejected and produces no `Command_Result`/`lifecycleState`, and a signal failure never affects the publish
    - _Requirements: 2.13_
  - [ ]* 7.3 Write property test for raw MQTT staying unverified and unblocked
    - New `src/automations/raw-mqtt.property.test.ts` (spy `MqttService.publish`; assert publish-only, no `lifecycleState`)
    - **Property 5: Raw MQTT publishing stays unverified and unblocked**
    - **Validates: Requirements 2.11, 2.12, 2.13**

- [x] 8. Config bound assertion and single-boundary enforcement
  - [x] 8.1 Assert the REST timeout is an outer safety bound at startup
    - In `src/config.ts` add a startup assertion that rejects configuration where `restActionTimeoutMs < maxConfirmTimeoutMs`, so the REST timeout never preempts a command still legitimately awaiting acknowledgement/observation
    - _Requirements: 3.7_
  - [ ]* 8.2 Write example test for the config bound
    - Assert startup rejects `restActionTimeoutMs < maxConfirmTimeoutMs` and that the defaults (7000 >= 5000) satisfy the bound
    - _Requirements: 3.7_
  - [x]* 8.3 Write architecture test for the single `executeAction` call site
    - Scan the source tree asserting `connectorManager.executeAction(` (and `.executeAction(`) appears only inside `src/automations/command-service.ts` handlers
    - _Requirements: 1.1, 2.7_
  - [x]* 8.4 Write composition test for construction-enforced boundary
    - Assert `createDeviceRoutes` and the broker deps receive no `ConnectorManager`/`executeAction` reference, and that `CommandService` is the exported physical-command boundary (rename identity)
    - _Requirements: 1.6, 2.8_

- [x] 9. Final verification
  - [x] 9.1 Run the full build and test suite and fix any failures
    - Run the project build/typecheck and the full `vitest` suite single-run (not watch); resolve any type or test failures introduced by the feature
    - _Requirements: 1.1, 2.1, 2.7, 3.1, 4.1, 6.1, 6.2, 8.1_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but the design treats testing as first-class; each of Properties 1–13 maps to exactly one property-based test.
- Property tests use `fast-check` at `{ numRuns: 200 }`, tagged `// Feature: unified-command-boundary, Property {n}: {text}`, matching existing suites.
- Property → test-file mapping (from the design's Testing Strategy): P1–P4 in `command-service.property.test.ts`; P5 in `raw-mqtt.property.test.ts`; P6 in `device.routes.property.test.ts`; P7 in `sdk-broker.property.test.ts` (frontend); P8 in `execution-result.property.test.ts`; P9 in `command-result-collector.property.test.ts`; P10, P11, P13 in `automation-engine.property.test.ts`; P12 in `execution-recorder.property.test.ts`.
- The single-boundary invariant (Req 1.1, 2.7, 2.8) is enforced **by construction** (composition root grants the `ConnectorManager` reference to `CommandService` only) and verified by the architecture/composition tests (8.3, 8.4) rather than a runtime guard.
- Script-path aggregation (task 6.4) is fully truthful only once the **async-await-in-scripts** companion fix lands; that fix is intentionally not a task here.
- Checkpoint (task 5) and the final build (9.1) ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.6", "1.7", "2.1", "7.2"] },
    { "id": 1, "tasks": ["1.2", "1.4", "3.1", "6.5", "2.2", "8.1"] },
    { "id": 2, "tasks": ["1.3", "1.5", "3.2", "2.3", "4.1", "6.1", "6.6", "8.2", "7.3"] },
    { "id": 3, "tasks": ["2.4", "4.2", "6.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["2.5", "4.3", "6.7"] },
    { "id": 5, "tasks": ["4.4", "7.1", "8.3", "8.4"] },
    { "id": 6, "tasks": ["9.1"] }
  ]
}
```
