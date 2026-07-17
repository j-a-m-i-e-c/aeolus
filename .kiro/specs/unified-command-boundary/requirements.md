# Requirements Document

## Introduction

Aeolus has a well-designed command lifecycle (defined in the **verified-command-execution** spec), but only one path actually reaches it. Grounded in the current code, the situation is:

- `ActionExecutor.execute()` (`src/automations/action-executor.ts`) owns the lifecycle (REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED, plus FAILED / TIMED_OUT / STATE_MISMATCH). Only the script path (`devices.action()` in `src/automations/sandbox.ts` → `ActionExecutor.execute()`) and form rules registered in `registerUiRule()` (`src/api/routes/automation.routes.ts`) call it.
- The REST route `POST /api/devices/:id/action` (`src/api/routes/device.routes.ts`) calls `connectorManager.executeAction()` **directly**, skipping the lifecycle boundary entirely.
- Dashboard device controls and custom-UI `aeolus.control()` both reach devices **through that same REST route**, so they also bypass the boundary.
- The result is two divergent paths: `Script → ActionExecutor → ConnectorManager` versus `Dashboard / Custom UI / REST → ConnectorManager` (direct).

This spec establishes a **single physical-command boundary** that every command source routes through, so correlation, dispatch, acknowledgement, and observation are applied uniformly before `ConnectorManager` is reached. Following the third-party review's recommendation, the boundary is the evolution of `ActionExecutor` renamed to reflect its grown responsibility (**Command_Service** / physical-command orchestrator).

The feature also fixes truthful end-to-end result propagation. Grounded in the current code:

- The form-rule closure in `registerUiRule()` does `await actionExecutor.execute(descriptor, stored.id)` and **ignores the returned `ActionResult`**. Because `ActionExecutor` returns `{ success: false, error }` rather than throwing, the closure's promise resolves and `AutomationEngine.executeDirectRule()` records the automation as **successful even when the physical command failed**.
- `executeDirectRule()` emits `AUTOMATION_FIRED` **before** the async action outcome is known, and `ActionExecutor.execute()` emits `AUTOMATION_FIRED` **again** on success — so a successful form action produces a **duplicate** fired event, and a failed form action still produces an **initial** fired event.
- The manual `/fire` route (`src/api/routes/automation.routes.ts`) does `await engine.fire(id, context)` and then returns `{ success: true }` without awaiting the eventual automation outcome.

To fix this, a single structured **Automation_Execution_Result** (`{ executionId, success, commandResults, failureReason? }`) flows through both form-rule and script-rule execution, and exactly one component (**Execution_Owner**) owns execution history, success/failure metrics, the completion event, and audit logging for a full execution. `AUTOMATION_FIRED` is redefined to mean "execution started" and is paired with a new `AUTOMATION_COMPLETED` event carrying the outcome.

### Scope

**In scope:** one physical-command boundary (Command_Service) that Script, Dashboard, Custom_UI, REST, CLI, and future fleet sources all route through; migrating the REST device-action route, dashboard controls, custom-UI control, and form-rule actions onto that boundary; a single Automation_Execution_Result contract propagated through form and script rule execution; correct `AUTOMATION_FIRED` (started) and `AUTOMATION_COMPLETED` (outcome) semantics with no duplicate or premature fired events; the manual `/fire` route awaiting the eventual result; and one component owning execution history, metrics, completion event, and audit for a full execution.

**Out of scope (owned by other specs / efforts):** the command lifecycle states and their transitions, the truthful Sandbox result, MQTT correlation, and the `PendingCommandTracker` (**verified-command-execution**); the `ActionResult` / `BulkActionResult` types and `ConnectorManager.executeAction()` semantics (**device-action-system-uplift**) — referenced, not redefined; the generated `automation()` helper not awaiting async actions (**async-await-in-scripts**, a dependency for full script-path propagation); raw `mqtt.publish()` messaging, which is intentionally retained as unverified transport rather than treated as a bypass to be eliminated (its verified-versus-raw boundary is governed by the Requirement 2 criteria in this spec); the register-before-dispatch race (separate spec); connector-generic observation/provenance, command/automation concurrency policy, and resource-level RBAC (separate efforts).

### Cross-Spec Dependencies

This feature interlocks with companion specs; the following dependencies are intentional, not gaps:

- **Truthful script-path propagation depends on the async-await-in-scripts fix.** Requirement 5.3 requires a Script_Rule's Automation_Execution_Result to reflect the Command_Results of the commands it issued. This is only accurate once the generated `automation()` helper awaits asynchronous device actions (owned by the async-await-in-scripts spec). Until then, the Form_Rule path is fully truthful, while the Script_Rule path is truthful only for commands the script actually awaits. This spec defines the target contract; the async-await-in-scripts spec makes the script path able to satisfy it.
- **Lifecycle states and confirmation come from verified-command-execution.** The Command_Lifecycle_State values, the PendingCommandTracker, MQTT correlation, and confirmation timeouts are defined there and reused here.
- **Raw MQTT publishing remains transport-only by design.** `mqtt.publish()` is a raw messaging primitive, not a verified device command. It intentionally continues to work for arbitrary topics without routing through the Command_Service (see Requirement 2). The Command_Service is the sole path that represents a device command as *verified* execution; raw publishing never claims more than broker acceptance and is never recorded as a verified device command. This preserves Aeolus's flexibility as an IoT messaging layer while keeping verified-execution claims truthful.

### Design Considerations (non-normative)

These items are recorded for the design phase to evaluate. They are not requirements of this feature and do not expand its normative scope.

1. **Live lifecycle progress streaming.** The requirements guarantee a "started" signal (`AUTOMATION_FIRED`) and a terminal per-command outcome (`AUTOMATION_COMPLETED` carrying each Command_Result's final Command_Lifecycle_State), which is sufficient for a final-state UI. A richer experience — a live view showing each command advance through `REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED` as transitions occur — would require the Command_Service to emit a per-transition lifecycle event and the WebSocket broadcast mapping to forward it. The design should decide whether the boundary emits per-transition lifecycle events (enabling live progress) or only terminal outcomes (final-state badges only).

2. **Author-selectable completion tier.** The confirmation tier that counts as "complete/success" for a command (Dispatch, Acknowledged, or Observed) is bounded by a device's capability ceiling: a device can prove at most the highest tier its connector declares, plus Observed where an observation source exists. Within that ceiling an author may legitimately want to require a *lower* tier (for example, treat `DISPATCHED` as success for a fire-and-forget action even when observation is possible) or explicitly require a higher tier for critical actions. The mechanism for selecting the required tier is owned by the verified-command-execution feature (Confirmation_Options and tier selection, which today auto-selects the highest available tier); this boundary consumes the resulting required tier when deciding a Command_Result's success. The design should account for the required tier being an explicit input rather than always the highest available, and for validating an author's requested tier against device capability — rejecting or clearly downgrading a request that exceeds what the device can prove, and never reporting a tier that was not actually reached.

## Glossary

- **Command_Service**: The single physical-command boundary that all command sources route through. It is the evolution of the current `ActionExecutor` (`src/automations/action-executor.ts`), renamed to reflect that its responsibility has grown beyond executing automation actions. It owns correlation, dispatch, acknowledgement handoff, and observation handoff before delegating to `ConnectorManager`.
- **Command_Source**: Any origin that requests a physical device command — a Script_Rule, a Dashboard_Control, a Custom_UI_Control, a REST_Device_Action_Request, a command-line client, or a future fleet service.
- **Script_Rule**: An automation rule with `compiled_js` present, executed through the Sandbox.
- **Form_Rule**: An automation rule without `compiled_js`, whose action is dispatched through the Command_Service via the closure built in `registerUiRule()`.
- **Dashboard_Control**: A device control in the Aeolus dashboard UI that currently issues `POST /api/devices/:id/action`.
- **Custom_UI_Control**: The sandboxed custom-UI `aeolus.control()` operation, which reaches devices through the REST device-action route.
- **Raw_MQTT_Message**: A message published to an arbitrary MQTT topic through `mqtt.publish()` as transport, not as a device command. It is unverified: it produces no Command_Result and no Command_Lifecycle_State, and terminates semantically at broker acceptance.
- **REST_Device_Action_Request**: A request to `POST /api/devices/:id/action` handled in `src/api/routes/device.routes.ts`.
- **ConnectorManager**: The `ConnectorManager` service (`src/connectors/connector-manager.ts`) whose `executeAction()` routes an action to the correct connector or the MQTT command path. Defined by **device-action-system-uplift**; referenced here, not redefined.
- **Command_Result**: The per-command outcome value returned by the Command_Service — the `ActionResult` (from **device-action-system-uplift**) carrying the `lifecycleState` (from **verified-command-execution**). Referenced here, not redefined.
- **Command_Lifecycle_State**: One of `REQUESTED`, `DISPATCHED`, `ACKNOWLEDGED`, `OBSERVED`, `FAILED`, `TIMED_OUT`, `STATE_MISMATCH`, as defined by **verified-command-execution**. Referenced here, not redefined.
- **Automation_Execution**: A single evaluation-and-execution of one rule from one trigger, which may issue zero or more physical commands through the Command_Service.
- **Automation_Execution_Result**: The structured result of one Automation_Execution, with fields `executionId: string`, `success: boolean`, `commandResults: CommandResult[]`, and optional `failureReason?: string`.
- **Execution_Owner**: The single component responsible for recording execution history, emitting success/failure metrics, emitting the `AUTOMATION_COMPLETED` event, and writing audit logging for a full Automation_Execution.
- **AUTOMATION_FIRED**: The existing event, redefined by this feature to mean "an Automation_Execution has started" rather than "an automation succeeded".
- **AUTOMATION_COMPLETED**: A new event emitted when an Automation_Execution reaches an outcome, carrying the Automation_Execution_Result.
- **Execution_Log**: The `ExecutionLog` component (`src/automations/execution-log.ts`) that stores execution history entries.
- **Metrics_Service**: The service that consumes `AUTOMATION_EXECUTION_COMPLETE` events to update counters and histograms.
- **Verified_Device_Command**: A device command issued through the Command_Service, which produces a Command_Result carrying a final Command_Lifecycle_State. Distinct from a Raw_MQTT_Message.

## Requirements

### Requirement 1: Single physical-command boundary

**User Story:** As a platform maintainer, I want exactly one component through which all physical device commands pass, so that correlation, dispatch, acknowledgement, and observation are applied consistently regardless of where the command originated.

#### Acceptance Criteria

1. THE Command_Service SHALL be the only component that invokes `ConnectorManager.executeAction()` to execute a physical device command.
2. WHEN any Command_Source requests a physical device command, THE Command_Service SHALL process that command through the identical dispatch-and-confirmation path used for script-originated commands, applying no branching that depends on the originating Command_Source.
3. WHEN the Command_Service completes processing of a command, THE Command_Service SHALL return exactly one Command_Result carrying the final Command_Lifecycle_State, for both successfully executed and failed commands.
4. WHEN the Command_Service processes a command, THE Command_Service SHALL apply command dispatch before the command reaches `ConnectorManager`, reusing the lifecycle behavior defined by the verified-command-execution feature.
5. WHERE the target device declares an acknowledgement capability or the command supplies confirmation options, THE Command_Service SHALL apply the corresponding correlation, acknowledgement, and observation handoffs, and WHERE neither applies THE Command_Service SHALL omit those handoffs and treat dispatch as the terminal outcome, consistent with the capability-gated degradation defined by the verified-command-execution feature.
6. THE Command_Service SHALL expose the renamed identity of the current `ActionExecutor` so that its responsibility as the physical-command boundary is explicit in the code.
7. IF `ConnectorManager.executeAction()` reports a failure or raises an error, THEN THE Command_Service SHALL return a Command_Result carrying the terminal failure Command_Lifecycle_State together with an error indication describing the failure cause, without propagating an unhandled error to the Command_Source.
8. IF a command request fails validation because it omits a target device or specifies an action the target device does not support, THEN THE Command_Service SHALL reject the command before invoking `ConnectorManager.executeAction()` and return a Command_Result carrying the terminal failure Command_Lifecycle_State with an error indication, leaving device state unchanged.

### Requirement 2: All command sources route through the boundary

**User Story:** As an operator, I want dashboard controls, custom-UI controls, REST calls, and command-line invocations to be verified the same way scripts are, so that no control surface can silently bypass verified execution.

#### Acceptance Criteria

1. WHEN a REST_Device_Action_Request is received, THE REST_Device_Action_Route SHALL execute the requested command through the Command_Service rather than calling `ConnectorManager.executeAction()` directly.
2. WHEN a Dashboard_Control issues a device command, THE Dashboard_Control SHALL reach the device through the Command_Service.
3. WHEN a Custom_UI_Control invokes `aeolus.control()`, THE Custom_UI_Control SHALL reach the device through the Command_Service.
4. WHEN a Script_Rule invokes a device action, THE Script_Rule SHALL reach the device through the Command_Service.
5. WHEN a Form_Rule action is dispatched, THE Form_Rule SHALL reach the device through the Command_Service.
6. WHERE a future fleet service or command-line client issues a device command, THE Command_Service SHALL process that command through the same path as all other Command_Sources.
7. THE Command_Service SHALL be the only path by which a Command_Source reaches `ConnectorManager` for physical command execution.
8. IF a Command_Source attempts to reach `ConnectorManager` for physical command execution without passing through the Command_Service, THEN THE Command_Service SHALL prevent that command from reaching `ConnectorManager` and the device state SHALL remain unchanged.
9. IF the Command_Service cannot verify a command received from any Command_Source, THEN THE Command_Service SHALL reject the command, SHALL NOT forward it to `ConnectorManager`, and SHALL return a rejection indication to the originating Command_Source identifying the command as unverified.
10. WHEN the Command_Service processes a command from any Command_Source, THE Command_Service SHALL apply identical verification steps regardless of which Command_Source originated the command.
11. THE Command_Service SHALL be the only path that represents a device command as verified execution, carrying a Command_Result and a final Command_Lifecycle_State.
12. WHERE a Command_Source performs raw MQTT messaging, such as a Script_Rule calling `mqtt.publish()`, rather than issuing a device command, THE raw MQTT message SHALL remain available without routing through the Command_Service and SHALL NOT be represented as a verified device command, and SHALL NOT produce a Command_Result or a Command_Lifecycle_State.
13. WHERE a raw MQTT message is published directly to a topic that the device registry identifies as a device command topic, THE system MAY record an observability signal indicating an unverified device command, and SHALL NOT block or reject the raw MQTT message.

### Requirement 3: Truthful REST device-action result

**User Story:** As a custom-UI author, I want `aeolus.control()` and the REST device-action response to reflect the real command outcome, so that a UI does not report success when the physical command failed.

#### Acceptance Criteria

1. WHEN the REST_Device_Action_Route receives a Command_Result from the Command_Service, THE REST_Device_Action_Route SHALL return that Command_Result in its response body without altering its `success` value or failure reason.
2. WHEN the REST_Device_Action_Route returns a response, THE REST_Device_Action_Route SHALL include in the response body the final Command_Lifecycle_State, and that value SHALL be one of the defined Command_Lifecycle_State values.
3. IF a command processed through the Command_Service fails, THEN THE REST_Device_Action_Route SHALL return a response body with `success` equal to `false` and a human-readable failure reason identifying the cause of the failure.
4. WHEN a Custom_UI_Control receives the response to `aeolus.control()`, THE Custom_UI_Control SHALL resolve with the structured Command_Result, including cases where `success` is `false`, rather than resolving as success independently of the outcome.
5. THE REST_Device_Action_Route SHALL respond with HTTP 200 for domain-level command failures, communicating failure through the `success` field of the Command_Result rather than an HTTP error status.
6. IF the Command_Service does not produce a Command_Result within the configured REST device-action timeout after the REST_Device_Action_Route submits the command, THEN THE REST_Device_Action_Route SHALL return a Command_Result with `success` equal to `false` and a failure reason indicating the command timed out.
7. THE configured REST device-action timeout SHALL be greater than or equal to the maximum confirmation timeout the Command_Service can apply to a command, so that the REST device-action timeout acts as an outer safety bound and does not preempt a command still awaiting acknowledgement or observation.

### Requirement 4: Structured automation execution result

**User Story:** As a platform maintainer, I want one structured result that carries the outcome of an entire automation execution and its commands, so that every upper layer reads the same truthful outcome.

#### Acceptance Criteria

1. THE Automation_Engine SHALL represent the outcome of an Automation_Execution as an Automation_Execution_Result containing `executionId`, `success`, `commandResults`, and an optional `failureReason`.
2. WHEN an Automation_Execution begins, THE Automation_Engine SHALL assign the execution an `executionId` that is not equal to the `executionId` of any other Automation_Execution that is active at the same time, and that is not reused while the assigned execution remains active.
3. WHEN an Automation_Execution issues one or more physical commands, THE Automation_Engine SHALL include each command's Command_Result in the `commandResults` field of the Automation_Execution_Result in the order the commands were issued.
4. WHEN every Command_Result in an Automation_Execution reports `success` equal to `true` and the execution logic completes without error, THE Automation_Engine SHALL set the Automation_Execution_Result `success` to `true`.
5. IF one or more Command_Result in an Automation_Execution report `success` equal to `false`, THEN THE Automation_Engine SHALL set the Automation_Execution_Result `success` to `false` and SHALL populate `failureReason` with a description that identifies at least the first Command_Result reporting `success` equal to `false`.
6. IF the execution logic of an Automation_Execution fails before or independently of issuing commands, THEN THE Automation_Engine SHALL set the Automation_Execution_Result `success` to `false` and SHALL populate `failureReason` with a description of the execution logic failure.
7. WHEN an Automation_Execution issues no physical commands and its execution logic completes without error, THE Automation_Engine SHALL set the Automation_Execution_Result `success` to `true` with an empty `commandResults` collection.
8. WHERE an Automation_Execution_Result carries a `failureReason`, THE Automation_Engine SHALL set that result's `success` to `false`, so that a populated failure reason is never paired with a successful outcome.

### Requirement 5: Result propagation through form and script rules

**User Story:** As an operator reviewing automation history, I want a form or script automation to be recorded as failed when its physical command failed, so that the history reflects what actually happened rather than that the promise resolved.

#### Acceptance Criteria

1. WHEN a Form_Rule dispatches a command through the Command_Service, THE Automation_Engine SHALL read the returned Command_Result and incorporate it into the Automation_Execution_Result rather than discarding it.
2. IF the Command_Result returned to a Form_Rule reports `success` equal to `false`, THEN THE Automation_Engine SHALL record the Automation_Execution as unsuccessful and SHALL populate `failureReason` from that Command_Result.
3. WHEN a Script_Rule execution completes with a successful Sandbox outcome and every Command_Result it issued reports `success` equal to `true`, THE Automation_Engine SHALL set the Automation_Execution_Result `success` to `true`.
4. IF a Script_Rule Sandbox execution reports failure, OR any Command_Result issued during the script reports `success` equal to `false`, THEN THE Automation_Engine SHALL record the Automation_Execution as unsuccessful with the corresponding failure reason.
5. WHEN the Automation_Engine records an Automation_Execution in the Execution_Log, THE Automation_Engine SHALL record the `success` value carried by the Automation_Execution_Result.
6. WHEN an Automation_Execution is recorded as unsuccessful, THE Automation_Engine SHALL include the `failureReason` in the recorded execution entry.
7. IF the Command_Service returns no Command_Result for a command dispatched by a Form_Rule or Script_Rule, THEN THE Automation_Engine SHALL record the Automation_Execution as unsuccessful with a failure reason indicating the missing command result.

### Requirement 6: Correct fired and completed event semantics

**User Story:** As an operator monitoring Aeolus, I want a "started" signal and a separate "outcome" signal with no duplicate or premature events, so that dashboards and the event log are not misled into treating a started automation as a successful one.

#### Acceptance Criteria

1. WHEN an Automation_Execution begins, THE Automation_Engine SHALL emit exactly one `AUTOMATION_FIRED` event for that execution, denoting that the execution started.
2. WHEN an Automation_Execution reaches an outcome, THE Automation_Engine SHALL emit exactly one `AUTOMATION_COMPLETED` event carrying the Automation_Execution_Result for that execution.
3. THE Command_Service SHALL NOT emit an `AUTOMATION_FIRED` event when processing an individual command.
4. WHEN a single Automation_Execution issues multiple commands, THE Automation_Engine SHALL emit no more than one `AUTOMATION_FIRED` event and no more than one `AUTOMATION_COMPLETED` event for that execution.
5. IF an Automation_Execution fails, THEN THE `AUTOMATION_COMPLETED` event for that execution SHALL report `success` equal to `false`.
6. THE Automation_Engine SHALL emit the `AUTOMATION_FIRED` event for an execution before it emits the `AUTOMATION_COMPLETED` event for the same execution.
7. WHEN multiple Automation_Executions run concurrently, THE Automation_Engine SHALL correlate each `AUTOMATION_FIRED` and `AUTOMATION_COMPLETED` event to its originating execution by `executionId`.

### Requirement 7: Manual fire awaits the eventual result

**User Story:** As an operator manually firing a rule, I want the response to reflect the real execution outcome, so that the manual-fire result is as truthful as an event-triggered execution.

#### Acceptance Criteria

1. WHEN a rule is manually fired, THE Automation_Engine SHALL return the manual-fire response only after the Automation_Execution reaches an outcome and its Automation_Execution_Result is available.
2. WHEN a manually fired execution completes, THE manual-fire response SHALL report the `success` value of that execution's Automation_Execution_Result.
3. IF a manually fired execution fails, THEN THE manual-fire response SHALL report `success` equal to `false`.
4. IF a manually fired execution fails, THEN THE manual-fire response SHALL include a non-empty `failureReason` indicating the cause of the failure.
5. WHEN a rule is manually fired, THE manual-fire response SHALL include the `executionId` of the Automation_Execution created for that manual fire.

### Requirement 8: Single owner of execution history, metrics, and audit

**User Story:** As a platform maintainer, I want exactly one component to record execution history, emit metrics, emit the completion event, and write audit logs for a full execution, so that outcomes are recorded once and consistently.

#### Acceptance Criteria

1. THE Execution_Owner SHALL be the single component that records an Automation_Execution in the Execution_Log, and SHALL record each Automation_Execution exactly once.
2. THE Execution_Owner SHALL be the single component that emits the `AUTOMATION_EXECUTION_COMPLETE` metrics event for an Automation_Execution, and SHALL emit that metrics event exactly once per Automation_Execution.
3. THE Execution_Owner SHALL be the single component that emits the `AUTOMATION_COMPLETED` event for an Automation_Execution, and SHALL emit that event exactly once per Automation_Execution.
4. WHEN the Execution_Owner records an Automation_Execution, THE Execution_Owner SHALL derive the recorded success, metrics status, and audit outcome from the same Automation_Execution_Result, and the recorded success, the metrics status, and the audit outcome SHALL each match the `success` value of that Automation_Execution_Result.
5. THE Command_Service SHALL NOT record Automation_Execution history, emit automation-execution metrics, or emit the `AUTOMATION_COMPLETED` event.
6. WHEN the Execution_Owner records an Automation_Execution, THE Execution_Owner SHALL include the measured execution duration as a non-negative integer number of milliseconds.
7. IF the Automation_Execution_Result required to record an Automation_Execution is unavailable, THEN THE Execution_Owner SHALL NOT record the Automation_Execution in the Execution_Log, SHALL NOT emit the `AUTOMATION_EXECUTION_COMPLETE` metrics event, SHALL NOT emit the `AUTOMATION_COMPLETED` event, and SHALL write an Execution_Log entry indicating the recording failure.
