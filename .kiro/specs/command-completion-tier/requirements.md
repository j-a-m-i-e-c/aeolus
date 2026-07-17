# Requirements Document

## Introduction

Aeolus commands pass through a lifecycle — `REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED`, plus the terminal failure states `FAILED`, `TIMED_OUT`, and `STATE_MISMATCH` — defined by the **verified-command-execution** spec. The **unified-command-boundary** spec (complete) routes every command source through a single `CommandService` and already exposes an **optional** `requiredTier?: ConfirmationTier` input on `CommandService.execute()`, where `ConfirmationTier` is `"dispatch" | "acknowledged" | "observed"` (from `src/automations/command-lifecycle.ts`). Today, the required tier is auto-selected by `selectRequiredTier(hasConfirm, hasAckCapability)` as the **highest available** tier for the target device; nothing lets an automation author choose a tier per automation.

This feature makes the **completion tier** — which lifecycle step counts as SUCCESS for a given automation — an author-configurable choice, end to end. It builds **on top of** the `requiredTier` plumbing that already exists. It does not redefine the lifecycle states, the tier-selection/clamping mechanism, or the `CommandService` boundary; it supplies a value to the `requiredTier` input those specs already provide.

Grounded in the current code, the situation is:

- `selectRequiredTier()` (`src/automations/command-lifecycle.ts`) always returns the highest tier a device can prove: `observed` when Confirmation_Options are supplied, else `acknowledged` when the connector declares an Acknowledgement_Capability, else `dispatch`. There is no author input.
- The form-rule closure built in `registerUiRule()` (`src/api/routes/automation.routes.ts`) calls `actionExecutor.execute(descriptor, stored.id)` with no tier argument, and the stored `automation_rules` row (`StoredRule`, migration `002-automation-rules-columns.ts`) has no column for a chosen completion tier.
- The script path host callback `__actionRef` (`src/automations/sandbox.ts`) calls `actionExecutor.execute(...)` with only `confirm`; scripts cannot request a tier.
- Device capability is discoverable: `ConnectorManager.getAcknowledgementCapability(deviceId)` (`src/connectors/connector-manager.ts` → `action-router.ts`) reports the ack capability, and `ConnectorManager.getActionCatalog(deviceId)` reports supported actions. Observation capability is expressed by whether Confirmation_Options can be supplied for the target/observed device.

Two concepts must be captured distinctly:

1. **Device capability ceiling** — the highest tier a device can actually prove. `Observed` requires an observation source (Confirmation_Options identifying an Observed_Device); `Acknowledged` requires a declared Acknowledgement_Capability on the device's connector; `Dispatch` is universal.
2. **Author-chosen required tier** — within that ceiling, which tier the author decides means "done/success" for this automation. An author may legitimately choose a **lower** tier than available (a "set and forget" action where `DISPATCHED` is success even when observation is possible) or require a **higher** tier for critical actions.

A hard invariant is inherited from verified-command-execution and must be respected: the system must **never report or claim a tier that was not actually reached**. An author's requested tier that exceeds the device's capability ceiling must be handled explicitly — rejected at authoring time or clearly downgraded with a visible warning — never silently pretended.

### Scope

**In scope:**

- **Persistence** — storing an author-chosen Completion_Tier per automation rule (with consideration for per-action where relevant), in the `automation_rules` table, for form rules and as a rule-level default for script rules. Absence of a stored tier means today's behavior.
- **Authoring / UI validation** — accepting and validating a Completion_Tier when an automation is created or updated, surfacing which tiers the target device can actually prove (capability-aware options), and preventing or clearly warning on an over-ceiling choice.
- **Wiring** — passing the stored Completion_Tier into `CommandService.execute()` as `requiredTier` from both the form-rule path (`registerUiRule()` closure) and the script path (`devices.action()` host callback in the sandbox), including whether the script tier is a per-call argument, a rule-level default, or both.
- **Defaults & backward compatibility** — existing automations with no configured tier keep behaving exactly as today (auto-highest-available).
- **Validation of tier vs capability ceiling** — at authoring time and/or execution time, with an explicit reject-vs-downgrade behavior, and never reporting an unreached tier.

**Out of scope (owned by other specs / efforts; referenced, not redefined):**

- The Command_Lifecycle states and transitions, `PendingCommandTracker`, MQTT correlation, `ConfirmOptions`, `DEFAULT_CONFIRM_TIMEOUT_MS`, and the `selectRequiredTier()` / tier-clamping mechanism — owned by **verified-command-execution**.
- The `CommandService` boundary, `AutomationExecutionResult`, event semantics, and the `requiredTier` **input** itself — owned by **unified-command-boundary**. This feature supplies a value to that input; it does not build the input.
- `ActionResult` / `BulkActionResult` and `ConnectorManager.executeAction()` semantics — owned by **device-action-system-uplift**.

### Cross-Spec Dependencies

- **The `requiredTier` input and its clamping are consumed, not built.** `CommandService.execute()` already accepts an optional `requiredTier`, and the verified-command-execution mechanism validates/clamps a requested tier against device capability and guarantees the returned `lifecycleState` was actually reached. This feature is responsible for capturing an author's choice and delivering it to that input; the never-claim-an-unreached-tier guarantee is inherited from those specs.
- **Capability discovery reuses existing surfaces.** Acknowledgement capability comes from `ConnectorManager.getAcknowledgementCapability(deviceId)`; action support comes from `ConnectorManager.getActionCatalog(deviceId)`; observation capability is expressed through Confirmation_Options. This feature reads these; it does not add a new capability channel.

## Glossary

- **Completion_Tier**: The author-chosen Confirmation_Tier that counts as SUCCESS for a given automation rule (and optionally a given action within it). One of `dispatch`, `acknowledged`, or `observed`. When absent, the system falls back to the highest-available tier selected by `selectRequiredTier()`.
- **Confirmation_Tier**: The `ConfirmationTier` type (`"dispatch" | "acknowledged" | "observed"`) defined in `src/automations/command-lifecycle.ts`. Referenced here, not redefined.
- **Capability_Ceiling**: The highest Confirmation_Tier a target device can actually prove for a command: `observed` when an observation source (Confirmation_Options identifying a present Observed_Device) is available; otherwise `acknowledged` when the device's connector declares an Acknowledgement_Capability; otherwise `dispatch`.
- **Command_Service**: The single physical-command boundary (`src/automations/command-service.ts`, the renamed `ActionExecutor`) whose `execute()` accepts an optional `requiredTier`. Defined by **unified-command-boundary**; referenced here, not redefined.
- **Required_Tier_Input**: The optional `requiredTier?: ConfirmationTier` parameter on `CommandService.execute()`. Defined by **unified-command-boundary**; this feature supplies its value.
- **Command_Lifecycle_State**: One of `REQUESTED`, `DISPATCHED`, `ACKNOWLEDGED`, `OBSERVED`, `FAILED`, `TIMED_OUT`, `STATE_MISMATCH`, defined by **verified-command-execution**. Referenced here, not redefined.
- **Acknowledgement_Capability**: The per-device capability declared through `ConnectorManager.getAcknowledgementCapability(deviceId)` indicating the device can confirm receipt/execution. Defined by **verified-command-execution**; referenced here.
- **Confirmation_Options**: The optional `confirm` object on a device action (`ConfirmOptions` in `src/core/types.ts`) that identifies an Observed_Device, a condition predicate, and a timeout. Defined by **verified-command-execution**; referenced here as the observation source that makes `observed` reachable.
- **Observed_Device**: The device whose state confirms a command's physical effect, identified by Confirmation_Options. Defined by **verified-command-execution**; referenced here.
- **Automation_Rule**: A stored automation persisted in the `automation_rules` table and represented at runtime by `Rule` (`src/core/types.ts`). A Form_Rule has no `compiled_js`; a Script_Rule has `compiled_js` present.
- **Form_Rule**: An Automation_Rule without `compiled_js`, whose single action is dispatched through the Command_Service by the closure built in `registerUiRule()`.
- **Script_Rule**: An Automation_Rule with `compiled_js` present, executed through the Sandbox, which may issue zero or more device commands via `devices.action()` / `devices.actionAll()`.
- **Rule_Store**: The `automation_rules` SQLite table and its `StoredRule` row shape (`src/api/routes/automation.routes.ts`, schema in `src/db/migrations`).
- **Authoring_Endpoint**: The `POST /api/automations` and `PUT /api/automations/:id` routes that create and update Automation_Rules.
- **Capability_Query**: The read operation that reports, for a target device, which Confirmation_Tiers are within its Capability_Ceiling, derived from `getAcknowledgementCapability()` and the availability of an observation source.
- **Completion_Tier_Selection**: The runtime decision that yields the effective Required_Tier_Input value for a command — the author-chosen Completion_Tier when present and permitted, otherwise the highest-available tier from `selectRequiredTier()`.

## Requirements

### Requirement 1: Persisting an author-chosen completion tier

**User Story:** As an automation author, I want my chosen completion tier saved with the automation, so that the automation consistently uses the tier I selected across restarts and re-registration.

#### Acceptance Criteria

1. THE Rule_Store SHALL provide a column that stores the Completion_Tier for an Automation_Rule, holding exactly one of the values `dispatch`, `acknowledged`, or `observed`, or a null value indicating no author-chosen tier.
2. WHEN an Automation_Rule is created with a Completion_Tier equal to one of `dispatch`, `acknowledged`, or `observed`, THE Authoring_Endpoint SHALL persist that Completion_Tier in the Rule_Store such that a subsequent load of the same Automation_Rule returns the persisted value.
3. WHEN an Automation_Rule is created without a Completion_Tier, THE Authoring_Endpoint SHALL persist a null Completion_Tier for that Automation_Rule.
4. WHEN an existing Automation_Rule's Completion_Tier is updated to a value that is one of `dispatch`, `acknowledged`, `observed`, or null, THE Authoring_Endpoint SHALL persist the updated Completion_Tier in the Rule_Store, replacing the previously stored value such that a subsequent load returns only the updated value.
5. WHERE an Automation_Rule row predates the Completion_Tier column, THE Rule_Store SHALL represent that row's Completion_Tier as null without requiring the row to be rewritten.
6. WHEN an Automation_Rule with a stored Completion_Tier is loaded from the Rule_Store, THE system SHALL make that Completion_Tier available to the rule's command dispatch path.
7. IF the system encounters an internal error that prevents resolving a stored Completion_Tier when an Automation_Rule is loaded, THEN THE system SHALL disable that Automation_Rule and SHALL NOT dispatch its commands with an unresolved Completion_Tier.
8. WHERE a Script_Rule stores a Completion_Tier, THE Rule_Store SHALL treat that Completion_Tier as a rule-level default applied to commands the script issues that do not specify their own tier.

### Requirement 2: Reporting the device capability ceiling

**User Story:** As an automation author, I want to see which completion tiers the target device can actually prove, so that I can make an informed choice and avoid requesting a tier the device cannot deliver.

#### Acceptance Criteria

1. WHEN a Capability_Query is made for a target device that can perform command dispatch, THE Capability_Query SHALL report `dispatch` as within that device's Capability_Ceiling.
2. WHEN a Capability_Query is made for a target device whose connector declares an Acknowledgement_Capability with `supported` equal to `true`, THE Capability_Query SHALL report `acknowledged` as within that device's Capability_Ceiling.
3. IF a Capability_Query is made for a target device whose connector does not declare an Acknowledgement_Capability with `supported` equal to `true`, THEN THE Capability_Query SHALL NOT report `acknowledged` as within that device's Capability_Ceiling.
4. WHERE an observation source is available for a command through Confirmation_Options identifying an Observed_Device present in the device registry, THE Capability_Query SHALL report `observed` as within the Capability_Ceiling for that command.
5. IF no observation source is available for a command, because no Confirmation_Options are supplied or the Confirmation_Options identify an Observed_Device that is absent from the device registry, THEN THE Capability_Query SHALL NOT report `observed` as within the Capability_Ceiling for that command.
6. WHEN a Capability_Query reports the Capability_Ceiling for a target device, THE Capability_Query SHALL report each tier value using the Confirmation_Tier vocabulary `dispatch`, `acknowledged`, and `observed`.
7. IF a target device cannot perform command dispatch, THEN THE Capability_Query SHALL NOT report `dispatch` as within that device's Capability_Ceiling.
8. IF a Capability_Query is made for a target device that cannot be resolved in the device registry, THEN THE Capability_Query SHALL report no tiers within the Capability_Ceiling and SHALL return an indication that the target device could not be resolved.

### Requirement 3: Validating an author-chosen tier against the capability ceiling

**User Story:** As an automation author, I want a completion tier higher than the device can prove to be caught explicitly, so that I never end up with an automation that silently claims success it cannot verify.

#### Acceptance Criteria

1. WHEN an Automation_Rule is created or updated with a Completion_Tier, THE Authoring_Endpoint SHALL validate that Completion_Tier against the target device's Capability_Ceiling before persisting any change.
2. WHEN a submitted Completion_Tier is equal to the target device's Capability_Ceiling, THE Authoring_Endpoint SHALL accept the Completion_Tier and persist it.
3. WHEN a submitted Completion_Tier is a tier lower than the target device's Capability_Ceiling, THE Authoring_Endpoint SHALL accept the Completion_Tier and persist it.
4. IF a submitted Completion_Tier is a tier higher than the target device's Capability_Ceiling, THEN THE Authoring_Endpoint SHALL reject the request with an error identifying the requested tier and the highest tier the device can prove, and SHALL leave the stored Completion_Tier unchanged.
5. IF a submitted Completion_Tier is not exactly one of the values `dispatch`, `acknowledged`, or `observed`, THEN THE Authoring_Endpoint SHALL reject the request with a validation error indicating the accepted tier values, and SHALL leave the stored Completion_Tier unchanged.
6. IF the target device's Capability_Ceiling cannot be determined because the target device does not exist or has no established Capability_Ceiling, THEN THE Authoring_Endpoint SHALL reject the request with an error indicating the Capability_Ceiling cannot be determined, and SHALL leave the stored Completion_Tier unchanged.
7. WHEN the Authoring_Endpoint rejects a request because the Completion_Tier is a tier higher than the Capability_Ceiling, THE Authoring_Endpoint SHALL leave device state unchanged and SHALL NOT register or re-register the Automation_Rule with the rejected tier.

### Requirement 4: Delivering the chosen tier from the form-rule path

**User Story:** As an automation author using a form rule, I want my chosen completion tier applied when the rule fires, so that the rule reports success only at the tier I selected.

#### Acceptance Criteria

1. WHEN a Form_Rule with a stored Completion_Tier dispatches its command, THE Form_Rule dispatch path SHALL supply that Completion_Tier as the Required_Tier_Input to `CommandService.execute()`.
2. WHEN a Form_Rule without a stored Completion_Tier dispatches its command, THE Form_Rule dispatch path SHALL omit the Required_Tier_Input so that the highest-available tier is selected, preserving current behavior.
3. WHEN a Form_Rule supplies a Completion_Tier as the Required_Tier_Input, THE Form_Rule dispatch path SHALL supply the tier currently stored for that Automation_Rule.
4. WHEN a Form_Rule's stored Completion_Tier is changed and the rule is re-registered, THE Form_Rule dispatch path SHALL supply the changed Completion_Tier on all subsequent dispatches.
5. IF a Form_Rule's stored Completion_Tier is not one of the recognized Completion_Tier values, THEN THE Form_Rule dispatch path SHALL omit the Required_Tier_Input so that the highest-available tier is selected.
6. IF a Form_Rule's stored Completion_Tier is a tier higher than the target device's Capability_Ceiling at dispatch time, THEN THE Form_Rule dispatch path SHALL omit the Required_Tier_Input so that the highest-available tier is selected.

### Requirement 5: Delivering the chosen tier from the script-rule path

**User Story:** As an automation author writing a script rule, I want a completion tier applied to the device actions my script issues, so that scripted commands report success at the tier appropriate for each action.

#### Acceptance Criteria

1. WHERE a Script_Rule has a rule-level Completion_Tier default and a device action issued by the script specifies no tier of its own, THE Script_Rule dispatch path SHALL supply the rule-level Completion_Tier as the Required_Tier_Input for that command.
2. WHERE a device action issued by a Script_Rule specifies its own tier, THE Script_Rule dispatch path SHALL supply that action-specified tier as the Required_Tier_Input for that command, overriding any rule-level Completion_Tier default.
3. WHERE a Script_Rule has neither a rule-level Completion_Tier default nor an action-specified tier for a command, THE Script_Rule dispatch path SHALL omit the Required_Tier_Input so that the highest-available tier is selected, preserving current behavior.
4. WHEN a Script_Rule supplies a tier as the Required_Tier_Input, THE Script_Rule dispatch path SHALL supply a value that is exactly one of `dispatch`, `acknowledged`, or `observed`.
5. IF a device action issued by a Script_Rule specifies a tier value that is not exactly one of `dispatch`, `acknowledged`, or `observed`, THEN THE Script_Rule dispatch path SHALL treat the command as failing validation, SHALL NOT dispatch the command to the device, and SHALL return a Command_Result with `success` equal to `false` and an error indication identifying the invalid tier value.
6. IF a Script_Rule's rule-level Completion_Tier default is selected as the Required_Tier_Input for a command and its value is not exactly one of `dispatch`, `acknowledged`, or `observed`, THEN THE Script_Rule dispatch path SHALL treat the command as failing validation, SHALL NOT dispatch the command to the device, and SHALL return a Command_Result with `success` equal to `false` and an error indication identifying the invalid tier value.

### Requirement 6: Truthful outcome relative to the chosen tier

**User Story:** As an operator, I want a command's reported success to reflect whether the chosen completion tier was actually reached, so that a lower-tier "set and forget" choice is honored and a claimed tier is never fabricated.

#### Acceptance Criteria

1. WHEN a command is dispatched with a Completion_Tier of `dispatch`, THE system SHALL report `success` equal to `true` upon reaching the `DISPATCHED` Command_Lifecycle_State, reporting `DISPATCHED` as the final Command_Lifecycle_State, without requiring acknowledgement or observation.
2. WHEN a command is dispatched with a Completion_Tier of `acknowledged`, THE system SHALL report `success` equal to `false` while the command has not reached the `ACKNOWLEDGED` Command_Lifecycle_State, and SHALL report `success` equal to `true` only after the command reaches at least the `ACKNOWLEDGED` Command_Lifecycle_State.
3. WHEN a command is dispatched with a Completion_Tier of `observed`, THE system SHALL report `success` equal to `false` while the command has not reached the `OBSERVED` Command_Lifecycle_State, and SHALL report `success` equal to `true` only after the command reaches the `OBSERVED` Command_Lifecycle_State.
4. THE system SHALL report a final Command_Lifecycle_State that was actually reached by the command.
5. THE system SHALL NOT report a Command_Lifecycle_State corresponding to a tier that was not reached.
6. IF a command does not reach its required Command_Lifecycle_State before its confirmation timeout elapses, THEN THE system SHALL report `success` equal to `false` with the terminal failure Command_Lifecycle_State determined by the verified-command-execution mechanism.
7. WHERE an author-chosen Completion_Tier is lower than the target device's Capability_Ceiling, THE system SHALL treat the chosen lower tier as the success threshold and SHALL report `success` equal to `true` upon reaching that lower tier without requiring a higher tier.

### Requirement 7: Backward compatibility and defaults

**User Story:** As an owner of existing automations, I want my current automations to keep working unchanged when the completion-tier feature is added, so that adding tier selection does not alter deployed behavior.

#### Acceptance Criteria

1. WHEN an Automation_Rule that has no stored Completion_Tier is dispatched, THE system SHALL select the Required_Tier_Input using the existing `selectRequiredTier()` mechanism and dispatch its commands using the highest-available tier, identical to the tier selection performed before this feature.
2. WHEN a device action is issued and neither the Automation_Rule nor the action supplies a Completion_Tier, THE system SHALL produce a Command_Lifecycle outcome whose command state transitions and terminal state are identical to the outcome produced for that command before this feature.
3. THE Completion_Tier SHALL be an optional field on the Authoring_Endpoint.
4. WHEN the Authoring_Endpoint receives a create or update request in which the Completion_Tier is omitted, THE Authoring_Endpoint SHALL create or update the Automation_Rule with no stored Completion_Tier and SHALL return a success response.
5. WHEN an Automation_Rule created before this feature is loaded and dispatched, THE system SHALL dispatch its commands with no Required_Tier_Input, preserving the highest-available-tier behavior.
6. WHEN the list or read endpoints return an Automation_Rule, THE system SHALL include every field that was returned for an Automation_Rule before the Completion_Tier was added, so that clients unaware of the Completion_Tier continue to function.
