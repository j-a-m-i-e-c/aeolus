# Requirements Document

## Introduction

Aeolus currently reports success in places where success has not actually happened. Two verified defects motivate this feature:

1. **Swallowed script-execution failures.** `Sandbox.execute()` wraps all isolate execution in try/catch, logs on error, and resolves with `void` regardless of outcome. `AutomationEngine.executeScriptRule()` then treats resolution as success, so runtime throws, 5-second timeouts, and 32 MB memory-limit failures are recorded as successful executions in the execution log, in the `AUTOMATION_EXECUTION_COMPLETE` metrics event, and gate the `AUTOMATION_FIRED` emission incorrectly.

2. **Dispatch is conflated with physical reality.** `devices.action()` → `ActionExecutor.execute()` → connector/MQTT returns `{ success: true }` once a command is *accepted and dispatched*. It does not — and today cannot — confirm that the physical device changed state.

This feature establishes the principle that **Aeolus only claims success when success actually happened**. Grounding this in the actual code, a command can be confirmed at up to three distinct tiers, and the lifecycle must degrade honestly to whatever tier a given device can actually support:

1. **Dispatch (universal).** The broker or hub accepted the command. `Connector.execute()` returning without throwing means the external hub/API (Hue, Kasa) *accepted* the command; `MqttService.publish()`'s success callback confirms only that the *broker* accepted the publish at the negotiated QoS. Neither confirms the physical device acted. Every device supports this tier. It maps to `DISPATCHED` (success) or `FAILED`.
2. **Acknowledged (optional, capability-gated).** The device itself confirms it received or executed the command. This is not universal: it applies only to devices or connectors that *declare* an acknowledgement capability. For MQTT devices this requires firmware that publishes an acknowledgement back to a topic Aeolus already subscribes to — Aeolus reuses its existing state-ingestion path and does not invent a separate ack channel. Devices that do not declare this capability skip the `ACKNOWLEDGED` state entirely.
3. **Observed (universal, recommended confirmation path).** A sensor or state reading confirms the physical effect through the optional `confirm` mechanism. This is protocol-agnostic, reuses the existing `DEVICE_STATE_CHANGE` ingestion, and works regardless of whether the actuator can acknowledge, provided some observable device reports the resulting state. Because it does not depend on the target actuator having any feedback ability, observation is the recommended way to confirm critical commands.

The two confirmation tiers above dispatch (acknowledged and observed) are opt-in, so simple devices are never forced to wait. A device with neither an acknowledgement capability nor Confirmation_Options terminates truthfully at `DISPATCHED` — Aeolus never fabricates an `ACKNOWLEDGED` result from broker or hub receipt. All existing automations continue to work unchanged.

### Scope

**In scope:** truthful sandbox execution results; accurate execution-log, metrics, and event emission for script rules; a command execution lifecycle with explicit states that degrade by device capability; a lightweight acknowledgement-capability declaration surface for connectors/devices; an optional per-action confirmation/observation mechanism; backward compatibility for existing `devices.action()` / `devices.actionAll()` callers; per-device outcome reporting for bulk actions; observability of the new lifecycle states.

**Out of scope:** fleet/multi-site management, new connectors (Modbus/Deye), frontend UI sandboxing, database migration overhaul, and licensing/business concerns.

## Glossary

- **Sandbox**: The `Sandbox` class that executes compiled user script rules inside an isolated-vm V8 isolate.
- **Automation_Engine**: The `AutomationEngine` class that evaluates rules and dispatches script and form rules.
- **Action_Executor**: The `ActionExecutor` class that dispatches a single action descriptor to the appropriate connector or MQTT service.
- **Execution_Log**: The `ExecutionLog` component that stores `ExecutionLogEntry` records describing rule executions.
- **Metrics_Service**: The service that consumes `AUTOMATION_EXECUTION_COMPLETE` events to update counters and histograms.
- **Sandbox_Execution_Result**: A discriminated result value returned by `Sandbox.execute()` describing whether isolate execution succeeded and, on failure, the failure reason.
- **Failure_Reason**: The categorized cause of a script failure — one of `runtime`, `timeout`, or `memory`.
- **Command_Lifecycle**: The ordered set of states a device command passes through: `REQUESTED`, `DISPATCHED`, the optional `ACKNOWLEDGED`, `OBSERVED`, plus the terminal failure states `FAILED`, `TIMED_OUT`, and `STATE_MISMATCH`. The reachable states for a given command depend on the target device's capabilities and whether Confirmation_Options are supplied.
- **Confirmation_Tier**: One of the three levels at which a command outcome can be truthfully established — Dispatch (universal), Acknowledged (capability-gated), and Observed (via Confirmation_Options).
- **Dispatch_Outcome**: The result of handing a command to a connector or MQTT service — success means the broker or hub *accepted/sent* the command, not that the physical device acted or confirmed.
- **Broker_Acceptance**: Confirmation that the MQTT broker accepted a publish at the negotiated QoS (the `MqttService.publish()` success callback). Broker_Acceptance is a form of dispatch success and is distinct from device acknowledgement.
- **Hub_Acceptance**: Confirmation that an external hub or API (e.g. Hue bridge, Kasa) accepted a command, indicated by `Connector.execute()` resolving without throwing. Hub_Acceptance is a form of dispatch success and is distinct from device acknowledgement.
- **Acknowledgement_Capability**: A declared capability indicating that a connector or device can confirm receipt or execution of a command by itself (for MQTT, by publishing to a topic Aeolus subscribes to). Only devices declaring this capability can reach the `ACKNOWLEDGED` state.
- **Device_Acknowledgement**: A message originating from the device itself confirming it received or executed a command, ingested through the existing `DEVICE_STATE_CHANGE` path. Distinct from Broker_Acceptance and Hub_Acceptance.
- **Confirmation_Options**: The optional `confirm` object on a device action specifying a device to observe, a condition predicate, and a timeout used to verify a physical effect.
- **Observed_Device**: The device whose state is inspected to confirm a command's physical effect (may differ from the command's target device).
- **Action_Result**: The `ActionResult` value returned by `devices.action()` and `Action_Executor.execute()`.
- **Bulk_Action_Result**: The `BulkActionResult` value returned by `devices.actionAll()` describing per-device outcomes.
- **Script_Rule**: An automation rule with `compiled_js` present, dispatched through the Sandbox.
- **Correlation_Id**: A value uniquely identifying a single dispatched command, used to match an incoming Device_Acknowledgement to the command that produced it. Carried in the MQTT 5 Correlation Data property and/or mirrored in the published command payload.
- **Response_Topic**: The MQTT topic on which a device is instructed to publish its acknowledgement/observation for a command (for example `aeolus/acks/controller-1`). Supplied via the MQTT 5 Response Topic property and/or mirrored in the published command payload. Aeolus subscribes to the response-topic space (for example `aeolus/acks/#`) through the existing MqttService client.
- **Command_Envelope**: The dispatched command together with its Correlation_Id and Response_Topic, expressed via MQTT 5 message properties and/or mirrored in the JSON payload so that firmware reading either mechanism can respond.
- **Pending_Command**: An outstanding dispatched command awaiting acknowledgement and/or observation, tracked by the system and keyed by Correlation_Id, with an associated timeout.
- **Ack_Message**: A message a device publishes to a Response_Topic in reply to a Command_Envelope, carrying the matching Correlation_Id and one or more indicator fields — an acknowledgement indicator (for example `status`, such as `"executed"`) confirming receipt/execution, and/or an observation indicator (for example `state`, such as `"running"`) reporting the physical effect.
- **Acknowledgement_Indicator**: The field of an Ack_Message (for example `status`) whose value confirms the device received or executed the command, driving the transition to the `ACKNOWLEDGED` state.
- **Observation_Indicator**: The field of an Ack_Message or subsequent device state (for example `state`) evaluated against the Confirmation_Options predicate to confirm the physical effect, driving the transition to the `OBSERVED` state.

## Requirements

### Requirement 1: Truthful sandbox execution result contract

**User Story:** As an automation platform operator, I want the Sandbox to report whether a script actually ran to completion, so that the rest of the system can act on the true outcome rather than assuming success.

#### Acceptance Criteria

1. WHEN a compiled script runs to completion without error, THE Sandbox SHALL return a Sandbox_Execution_Result with `success` equal to `true`.
2. IF a compiled script throws a runtime error, THEN THE Sandbox SHALL return a Sandbox_Execution_Result with `success` equal to `false` and Failure_Reason equal to `runtime`.
3. IF a compiled script exceeds the 5000 millisecond execution timeout, THEN THE Sandbox SHALL return a Sandbox_Execution_Result with `success` equal to `false` and Failure_Reason equal to `timeout`.
4. IF a compiled script exceeds the 32 megabyte isolate memory limit, THEN THE Sandbox SHALL return a Sandbox_Execution_Result with `success` equal to `false` and Failure_Reason equal to `memory`.
5. WHEN THE Sandbox returns a Sandbox_Execution_Result with `success` equal to `false`, THE Sandbox SHALL include a human-readable `error` string describing the failure.
6. IF the isolated-vm runtime is unavailable, THEN THE Sandbox SHALL return a Sandbox_Execution_Result with `success` equal to `false` and an `error` string indicating that sandbox execution is unavailable.
7. THE Sandbox SHALL resolve its returned promise for every execution outcome rather than rejecting the promise.
8. IF more than one failure condition applies to a single execution, THEN THE Sandbox SHALL report the Failure_Reason of the condition detected first in chronological order.

### Requirement 2: Accurate execution outcome recording for script rules

**User Story:** As an operator reviewing automation history, I want failed, timed-out, and memory-exhausted script executions recorded as failures, so that the execution log reflects what actually happened.

#### Acceptance Criteria

1. WHEN THE Sandbox returns a Sandbox_Execution_Result with `success` equal to `true`, THE Automation_Engine SHALL record the execution in the Execution_Log with `success` equal to `true`.
2. WHEN THE Sandbox returns a Sandbox_Execution_Result with `success` equal to `false`, THE Automation_Engine SHALL record the execution in the Execution_Log with `success` equal to `false` and SHALL include the Sandbox-provided `error` string.
3. WHEN THE Automation_Engine records a failed Script_Rule execution, THE Automation_Engine SHALL include the Failure_Reason in the recorded execution entry.
4. WHEN THE Automation_Engine records any Script_Rule execution, THE Automation_Engine SHALL record the measured execution duration in milliseconds.

### Requirement 3: Accurate metrics and event emission for script rules

**User Story:** As an operator monitoring Aeolus, I want metrics and downstream events to reflect true execution outcomes, so that dashboards and alerts are not misled by false successes.

#### Acceptance Criteria

1. WHEN THE Sandbox returns a Sandbox_Execution_Result with `success` equal to `true`, THE Automation_Engine SHALL emit an `AUTOMATION_EXECUTION_COMPLETE` event with status `success`.
2. WHEN THE Sandbox returns a Sandbox_Execution_Result with `success` equal to `false`, THE Automation_Engine SHALL emit an `AUTOMATION_EXECUTION_COMPLETE` event with status `error`.
3. WHEN a Script_Rule execution succeeds, THE Automation_Engine SHALL emit an `AUTOMATION_FIRED` event for that rule.
4. WHEN a Script_Rule execution fails, THE Automation_Engine SHALL NOT emit an `AUTOMATION_FIRED` event for that rule.
5. WHEN THE Automation_Engine emits an `AUTOMATION_EXECUTION_COMPLETE` event, THE Automation_Engine SHALL include the measured execution duration in milliseconds.

### Requirement 4: Command execution lifecycle states

**User Story:** As an automation author controlling physical equipment, I want each command to carry an explicit lifecycle state that reflects what the target device can actually confirm, so that I can distinguish a command that was merely sent from one the device acknowledged or whose effect was observed.

#### Acceptance Criteria

1. THE Action_Executor SHALL represent the progress of a command using the Command_Lifecycle states `REQUESTED`, `DISPATCHED`, `ACKNOWLEDGED`, `OBSERVED`, `FAILED`, `TIMED_OUT`, and `STATE_MISMATCH`.
2. WHEN a command is received for dispatch, THE Action_Executor SHALL assign the command the `REQUESTED` state.
3. WHEN a connector or MQTT service accepts a command without error, THE Action_Executor SHALL advance the command to the `DISPATCHED` state, where acceptance means Hub_Acceptance for connector commands and Broker_Acceptance for MQTT commands.
4. IF dispatch of a command to a connector or MQTT service produces an error, THEN THE Action_Executor SHALL assign the command the `FAILED` state and SHALL include a human-readable error message.
5. THE Action_Executor SHALL NOT report Broker_Acceptance or Hub_Acceptance as the `ACKNOWLEDGED` state.
6. WHERE the target device's connector declares an Acknowledgement_Capability and a Device_Acknowledgement is received after the `DISPATCHED` state, THE Action_Executor SHALL advance the command to the `ACKNOWLEDGED` state.
7. WHERE the target device's connector does not declare an Acknowledgement_Capability, THE Action_Executor SHALL omit the `ACKNOWLEDGED` state from that command's lifecycle.
8. WHEN a command reaches the `DISPATCHED` state, the target device's connector does not declare an Acknowledgement_Capability, and no Confirmation_Options are provided, THE Action_Executor SHALL treat `DISPATCHED` as the successful terminal state for that command.
9. WHEN THE Action_Executor reports a command outcome, THE Action_Executor SHALL include the final Command_Lifecycle state in the Action_Result.

### Requirement 5: Optional confirmation of physical effect

**User Story:** As an automation author, I want to optionally require confirmation that a command produced an observable effect, so that critical actions like starting a pump are only reported successful when reality agrees — even when the actuator itself cannot acknowledge.

#### Acceptance Criteria

1. WHERE Confirmation_Options are provided on a device action, THE Action_Executor SHALL evaluate the supplied condition predicate against the state of the Observed_Device after the command reaches the `DISPATCHED` state.
2. WHERE Confirmation_Options are provided and the condition predicate evaluates to `true` within the specified timeout, THE Action_Executor SHALL advance the command to the `OBSERVED` state and SHALL return an Action_Result with `success` equal to `true`.
3. WHERE Confirmation_Options are provided and the specified timeout elapses before the condition predicate evaluates to `true`, THE Action_Executor SHALL assign the command the `TIMED_OUT` state and SHALL return an Action_Result with `success` equal to `false`.
4. WHERE Confirmation_Options are provided and the Observed_Device reports a settled state that fails the condition predicate, THE Action_Executor SHALL assign the command the `STATE_MISMATCH` state and SHALL return an Action_Result with `success` equal to `false`.
5. WHERE Confirmation_Options specify an Observed_Device that is not present in the device registry, THE Action_Executor SHALL return an Action_Result with `success` equal to `false` and an `error` string identifying the missing device.
6. IF a Confirmation_Options condition predicate throws during evaluation, THEN THE Action_Executor SHALL assign the command the `FAILED` state and SHALL return an Action_Result with `success` equal to `false` and the thrown error message.
7. WHERE Confirmation_Options omit a timeout value, THE Action_Executor SHALL apply a default confirmation timeout.
8. THE Action_Executor SHALL evaluate Confirmation_Options using the Observed_Device state maintained by the existing `DEVICE_STATE_CHANGE` ingestion path rather than a confirmation-specific state channel.
9. WHERE Confirmation_Options are provided, THE Action_Executor SHALL advance the command to the `OBSERVED` state independently of whether the target device's connector declares an Acknowledgement_Capability.

### Requirement 6: Backward compatibility for existing device actions

**User Story:** As an owner of existing automations, I want my current `devices.action()` and `devices.actionAll()` calls to keep working without changes, so that adding lifecycle and confirmation features does not break deployed scripts.

#### Acceptance Criteria

1. WHEN `devices.action()` is called without Confirmation_Options, THE Action_Executor SHALL return an Action_Result whose `success` field carries the same dispatch-based meaning as before this feature.
2. THE Action_Result SHALL retain its existing `success`, `data`, and `error` fields so that scripts reading those fields continue to function.
3. WHEN `devices.actionAll()` is called without Confirmation_Options, THE Action_Executor SHALL return a Bulk_Action_Result with the same structure produced before this feature.
4. WHERE a device action is invoked with the pre-existing three-argument form (device identifier, action type, params), THE Action_Executor SHALL execute the action without requiring Confirmation_Options.

### Requirement 7: Per-device outcome reporting for bulk actions

**User Story:** As an automation author acting on many devices at once, I want to know the outcome for each individual device, so that I can detect and respond to partial failures.

#### Acceptance Criteria

1. WHEN `devices.actionAll()` dispatches commands to matched devices, THE Action_Executor SHALL return a Bulk_Action_Result containing one per-device entry for each matched device.
2. THE Bulk_Action_Result SHALL report `total` equal to the number of matched devices, `succeeded` equal to the number of per-device entries with `success` equal to `true`, and `failed` equal to the number of per-device entries with `success` equal to `false`.
3. THE Bulk_Action_Result SHALL satisfy the invariant that `succeeded` plus `failed` equals `total`.
4. WHEN individual device commands within a bulk action produce differing outcomes, THE Action_Executor SHALL record each device's own Action_Result independently.
5. WHERE Confirmation_Options are provided to `devices.actionAll()`, THE Action_Executor SHALL apply confirmation to each matched device and SHALL reflect each device's final Command_Lifecycle state in its per-device entry.
6. WHEN `devices.actionAll()` is called without Confirmation_Options, THE Action_Executor SHALL still assign each matched device command a valid Command_Lifecycle state.
7. IF the bulk action filter predicate matches zero devices, THEN THE Action_Executor SHALL return a Bulk_Action_Result with `total`, `succeeded`, and `failed` all equal to zero.

### Requirement 8: Observability of lifecycle and execution states

**User Story:** As an operator diagnosing physical control problems, I want lifecycle transitions and confirmation failures to be observable, so that I can tell whether a command was sent, acknowledged, or physically confirmed.

#### Acceptance Criteria

1. WHEN a command reaches a terminal Command_Lifecycle state, THE Action_Executor SHALL log the command target, the final state, and any error message.
2. WHEN a command reaches the `TIMED_OUT` or `STATE_MISMATCH` state, THE Action_Executor SHALL log the Observed_Device identifier and the confirmation timeout that applied.
3. WHEN a Script_Rule execution fails, THE Automation_Engine SHALL log the rule identifier, the Failure_Reason, and the error message.
4. WHEN THE Action_Executor records a command outcome in the Execution_Log, THE Action_Executor SHALL include the final Command_Lifecycle state in the recorded entry.

### Requirement 9: Capability-gated lifecycle and graceful degradation

**User Story:** As an integrator connecting devices with widely varying feedback abilities, I want the lifecycle to adapt to each device's declared capabilities, so that a command's reported outcome is always the most truthful tier that device can actually support.

#### Acceptance Criteria

1. THE Connector interface SHALL provide a lightweight surface by which a connector declares, per device, whether that device supports an Acknowledgement_Capability, analogous to the existing capability declaration pattern.
2. WHERE a connector does not declare an Acknowledgement_Capability for a device, THE Action_Executor SHALL treat that device as reaching at most the Dispatch Confirmation_Tier unless Confirmation_Options are supplied.
3. WHEN a command targets a device whose connector declares neither an Acknowledgement_Capability nor is given Confirmation_Options, THE Action_Executor SHALL use `DISPATCHED` as that command's truthful terminal success state.
4. WHERE a command targets an MQTT device, THE Action_Executor SHALL derive both Device_Acknowledgement and observation from messages the device publishes over the existing MqttService client and ingestion pipeline, reusing that same MQTT connection rather than a non-MQTT or out-of-band acknowledgement transport; a dedicated Response_Topic space that MqttService subscribes to (for example `aeolus/acks/#`) is permitted and is the expected pattern.
5. WHERE a device supports neither an Acknowledgement_Capability nor Confirmation_Options, THE Action_Executor SHALL report `success` equal to `true` at the `DISPATCHED` state without representing that the physical effect was confirmed.
6. THE Action_Executor SHALL select the highest Confirmation_Tier available for a command in the order Observed, then Acknowledged, then Dispatch, based on the supplied Confirmation_Options and the target device's declared capabilities.

### Requirement 10: Command-correlation acknowledgement and observation over MQTT

**User Story:** As an integrator whose MQTT devices report back after acting, I want each dispatched command tagged with a correlation identifier and a response topic, and I want the replies matched back to the originating command, so that acknowledgement and observation reflect the specific command that was sent rather than ambient device state.

#### Acceptance Criteria

1. WHEN dispatching a command to an MQTT device that participates in acknowledgement or observation, THE Action_Executor SHALL emit a Command_Envelope that includes a Correlation_Id and a Response_Topic, supplied via the MQTT 5 Correlation Data and Response Topic message properties AND mirrored in the published payload, so that firmware reading either mechanism can respond.
2. WHEN THE Action_Executor dispatches a command, THE Action_Executor SHALL assign that command a Correlation_Id that is unique across outstanding commands, so that each Ack_Message is matched to exactly one command.
3. WHERE a bulk action dispatches commands to multiple devices, THE Action_Executor SHALL assign each per-device command its own unique Correlation_Id.
4. WHEN a command is dispatched with a Command_Envelope, THE Action_Executor SHALL record a Pending_Command keyed by its Correlation_Id with an associated timeout.
5. WHEN a message arrives on a Response_Topic, THE Action_Executor SHALL read its Correlation_Id from the MQTT 5 Correlation Data property when present and otherwise from the payload correlationId field, and SHALL route the message to the matching Pending_Command rather than treating it as ordinary device state.
6. WHERE both an MQTT 5 Correlation Data property and a payload correlationId field are present on an incoming message, THE Action_Executor SHALL use the MQTT 5 Correlation Data value.
7. WHERE only one of the MQTT 5 Correlation Data property or the payload correlationId field is present on an incoming message, THE Action_Executor SHALL use the value that is present.
8. IF an incoming message on a Response_Topic carries no resolvable Correlation_Id, THEN THE Action_Executor SHALL NOT match it to any Pending_Command.
9. WHEN a Pending_Command receives a correlated Ack_Message whose Acknowledgement_Indicator confirms receipt or execution, THE Action_Executor SHALL advance that command to the `ACKNOWLEDGED` state.
10. WHEN a Pending_Command receives a correlated Ack_Message or subsequent device state whose Observation_Indicator satisfies the Confirmation_Options predicate, THE Action_Executor SHALL advance that command to the `OBSERVED` state.
11. WHERE a single correlated Ack_Message satisfies both the Acknowledgement_Indicator and the Confirmation_Options predicate, THE Action_Executor SHALL apply both the `ACKNOWLEDGED` and `OBSERVED` transitions for that command.
12. IF no correlated Ack_Message satisfying the required Confirmation_Tier arrives before a Pending_Command's timeout elapses, THEN THE Action_Executor SHALL transition that command to the `TIMED_OUT` state.
13. IF a correlated Ack_Message arrives after its command has reached a terminal Command_Lifecycle state, THEN THE Action_Executor SHALL ignore the message for state-transition purposes and MAY log the late arrival.
14. WHEN more than one correlated Ack_Message satisfying the same tier arrives for one Correlation_Id, THE Action_Executor SHALL apply the corresponding lifecycle transition at most once.
