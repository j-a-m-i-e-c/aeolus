# Requirements Document

## Introduction

The 2 August 2026 fresh pre-public review (`docs/aeolus-fresh-review-2026-08-02.md`) confirmed that the earlier security release gates are closed, but found a concentrated set of new pre-promotion gates. They are composition and lifecycle bugs on the *ordinary* control and authoring path — the first things a reviewer or early adopter is likely to touch — rather than future enhancements. This spec collects them into one release-gate feature so they can be closed and verified together before promoting the interactive application or inviting early adopters to trust it with authored work.

The gates are grounded in the current code:

1. **The unified command boundary is mis-composed for REST / dashboard / custom-UI device actions.** The `unified-command-boundary` spec correctly routed every source through `CommandService.execute()`, tagging REST commands with the source string `` `rest:${id}` `` (`src/api/routes/device.routes.ts`). A later spec (`scoped-automation-authoring`) added `CommandService.checkScope()`, which calls `scopeResolver.resolve(ruleId)` for **every** source (`src/automations/command-service.ts`). `AutomationScopeResolver.resolve()` fail-closes an unknown rule id to an empty scoped authority (`src/automations/automation-scope-resolver.ts`), so `` `rest:${id}` `` is treated as an unknown automation with no devices and a normal `toggle`/`brightness`/`color` is refused — for admins too, because route-level admin authorization does not reach the service. The same path has three further problems: REST-native action types (`brightness`, `color`, `color-temp`, `on`, `off`) have no registered handler and return `unsupported` before the device's action catalog is consulted; `ConnectorManager.setMqttService()` is never called in production wiring, so generic MQTT device dispatch reports "broker not connected" while the app-level `MqttService` is connected; and the generic fallback brightness descriptor declares `{ level: 0..100 }` (`src/connectors/capability-action-map.ts`) while the Hue connector and dashboard use `{ brightness: 0..254 }`, so descriptor validation can reject a valid dashboard brightness action.

2. **`devices.actionAll()` bypasses the sandbox's scoped device inventory.** `Sandbox.setDevicesRefs()` computes a scoped `allDevices` list and injects only it into `devices.list()/get()/filter()`, but the `__actionAllRef` host callback calls `deviceRegistry.getAll()` again and filters the full inventory (`src/automations/sandbox.ts`). The command boundary still blocks the out-of-scope command, but the user predicate is evaluated against hidden devices and the returned `BulkActionResult` can disclose hidden device ids, counts, and state-derived side channels — contradicting `docs/security/permissions.md`.

3. **Removing an automation pane permanently deletes the underlying automation.** `TabLayout.handleRemovePane()` fires `DELETE /api/automations/:id`, then calls `removePane()`, which fires a *second* delete via `deleteAutomation()` (`frontend/src/components/TabLayout.tsx`, `frontend/src/store/dashboard-store.ts`). The backend delete is a hard delete that also wipes stored state (`src/api/routes/automation.routes.ts`). Because `automation_tab_assignments` is many-to-many, an automation can be exposed by multiple panes/tabs, so removing one view can destroy hand-written Logic/UI used elsewhere — with no confirmation.

4. **Non-admin `write` users are offered layout editing the backend refuses to persist.** `docs/security/permissions.md` grants `write` users pane editing, and the frontend enables add/remove/drag/resize/config for any `canWrite` user (`frontend/src/components/TabLayout.tsx`). But `PUT /api/layout` is `requireAdmin` (`src/api/routes/layout.routes.ts`), so a non-admin's layout mutation fails after the UI already accepted it; the failure is only logged to the browser console and local state stays changed until reload.

5. **Partial automation updates silently clear the chosen completion tier.** `PUT /api/automations/:id` (`src/api/routes/automation.routes.ts`) does not preserve the omitted-vs-explicit-clear distinction: on the script path `completionTierValue = normalizeTier(completionTier)` and `normalizeTier(undefined)` returns `null`; on the form path `completionTierValue` defaults to `null` when the field is omitted. Both paths always write that value, so an unrelated edit (name, trigger, Logic, paired UI) erases a persisted `dispatch`/`acknowledged`/`observed` choice. The same nullish handling also prevents an explicit `null` from clearing `condition_type`/`condition_value` (`?? existing.*`), which is less consequential.

A cross-cutting testing gap enabled these to reach CI green: unit and route tests validate the pieces (a route mock asserting the `` `rest:${id}` `` tag, a `CommandService` property test constructed without the production scope resolver, `ActionRouter` tests that hand-call `setMqttService()`), but nothing exercises the real production dependency graph. A production-composition integration suite is therefore part of this feature.

### Scope

**In scope:**

- An explicit command-source model so `CommandService` applies the automation scope resolver only to automation-originated commands; REST/dashboard/custom-UI/system commands are not treated as automations.
- Normalizing REST-native device control actions through the generic device-action handler so they reach the device's action catalog.
- Wiring `ConnectorManager`'s MQTT service at composition so generic MQTT device dispatch works in production.
- Choosing one canonical brightness contract and aligning the generic descriptor, the Hue connector, the dashboard UI, and examples.
- Scoping `devices.actionAll()` to the sandbox's already-computed in-scope device inventory.
- Decoupling pane removal from automation deletion, removing the duplicate delete, and requiring explicit confirmation before destroying an automation.
- Making layout-editing truthful for non-admin `write` users (frontend gating + permission-doc wording), with a tab-scoped write endpoint as the documented alternative.
- Preserving completion tiers (and other omitted fields) across partial automation updates using PATCH semantics.
- A production-composition integration test suite plus the targeted regression tests for `actionAll` scoping and completion-tier preservation.

**Out of scope (owned elsewhere or deferred):**

- The command lifecycle states, `PendingCommandTracker`, MQTT correlation, and confirmation tiers themselves (**verified-command-execution**, **command-completion-tier**) — referenced, not redefined.
- The unified boundary's result-propagation and event semantics (**unified-command-boundary**) — this feature corrects the *source-scoping composition*, not those contracts.
- `ActionResult`/`BulkActionResult`/`executeAction()` semantics and the device action catalog (**device-action-system-uplift**) — referenced, not redefined.
- Full soft-delete/archive and export/import of automations (**docs/BACKLOG.md** Planned) — this feature only stops accidental destruction and adds confirmation; recoverability remains roadmap.
- The custom-UI capability manifest / confused-deputy hardening (**docs/BACKLOG.md** Planned).
- Device `rename`/`delete` management operations, which use their own routes and are not device-control actions.

### Cross-spec dependencies

- **`unified-command-boundary` is implemented and is the substrate this feature corrects.** `CommandService`, its `execute()` signature, the built-in handlers (`handleToggle`, `handleDeviceAction`, `handlePublish`), and the single-boundary-by-construction wiring are reused. This feature changes how the *source* is expressed and how scope is applied, and completes the MQTT wiring that boundary work assumed.
- **`scoped-automation-authoring` owns `AutomationScopeResolver` and `checkScope`.** This feature narrows *when* `checkScope` runs (automation sources only); the resolver's fail-closed semantics are unchanged.
- **`command-completion-tier` owns the `completion_tier` column, `normalizeTier`/`isConfirmationTier`, and authoring validation.** This feature only fixes the update route's omitted-field handling; tier validation semantics are unchanged.

## Glossary

- **Command_Source**: The explicit origin of a physical device command handed to `CommandService.execute()`. One of `Automation_Source` (carries the authoring rule id), `Rest_Source` (a REST device-action request, already resource-authorized at the route), or `System_Source` (an internal/system-originated command). Replaces the current free-form source string.
- **Automation_Source**: A `Command_Source` denoting an automation rule, carrying `ruleId`. The only source kind to which the `AutomationScopeResolver` is applied.
- **Rest_Source**: A `Command_Source` denoting a REST device-action request (dashboard controls and custom-UI `aeolus.control()` reach devices through this route). Resource authorization has already occurred at the route boundary; no automation scope applies.
- **CommandService**: The single physical-command boundary (`src/automations/command-service.ts`), owned by **unified-command-boundary**. Referenced, not redefined.
- **AutomationScopeResolver**: Resolves an automation rule id to an `AuthorizationScope` (`src/automations/automation-scope-resolver.ts`), owned by **scoped-automation-authoring**. Referenced, not redefined.
- **Generic_Device_Handler**: The `handleDeviceAction` built-in handler that maps `{ type: "device_action", target, params: { actionType, ... } }` to `ConnectorManager.executeAction(target, { type: actionType, ... })`.
- **Native_Device_Action**: A device control action type sent by the dashboard/custom-UI/REST such as `toggle`, `on`, `off`, `brightness`, `color`, `color-temp`.
- **Action_Catalog**: The set of actions a device supports, resolved by `ConnectorManager`/`ActionRouter` from connector-provided descriptors or the fallback capability map. Referenced, not redefined.
- **Scoped_Inventory**: The in-scope device list `allDevices` computed by `Sandbox.setDevicesRefs()` for a scoped automation (or the full inventory for an unrestricted one).
- **Automation_Pane**: A dashboard pane of `paneType === "automation"` whose `config.ruleId` references an automation rule.
- **Layout_Mutation**: A change to tabs/panes persisted via `PUT /api/layout`.
- **Completion_Tier**: The per-rule `dispatch | acknowledged | observed` value stored in `automation_rules.completion_tier`. Owned by **command-completion-tier**. Referenced, not redefined.
- **Production_Composition_Test**: An integration test that wires dependencies the same way `src/index.ts` does and exercises a command from a real source through the production dependency graph.

## Requirements

### Requirement 1: Explicit command source, scoped only for automations

**User Story:** As an operator, I want dashboard, custom-UI, and REST device actions to work without being mistaken for an unknown automation, so that toggling or adjusting a device from the ordinary UI succeeds.

#### Acceptance Criteria

1. THE `CommandService` SHALL accept an explicit `Command_Source` for each command that distinguishes at least an `Automation_Source` (carrying a rule id), a `Rest_Source`, and a `System_Source`.
2. WHEN a command's `Command_Source` is an `Automation_Source`, THE `CommandService` SHALL apply the `AutomationScopeResolver` to that source's rule id exactly as it does today.
3. WHEN a command's `Command_Source` is not an `Automation_Source`, THE `CommandService` SHALL NOT apply the `AutomationScopeResolver` and SHALL NOT reject the command on the basis of an automation scope.
4. WHEN a `Rest_Source` command targets a device the requester was authorized for at the route boundary, THE `CommandService` SHALL NOT refuse it for being "outside an automation's authorization scope".
5. THE `CommandService` SHALL determine whether to apply the automation scope resolver solely from the `Command_Source` kind, and SHALL NOT infer the source kind by pattern-matching a source string such as a `rest:` prefix.
6. WHEN an `Automation_Source` command is out of its resolved scope, THE `CommandService` SHALL continue to refuse it with the existing fail-closed behavior, unchanged by this feature.
7. WHERE existing automation call sites pass a rule id, THE `CommandService` SHALL treat that as an `Automation_Source` so that automation scoping behavior is preserved after the source model becomes explicit.

### Requirement 2: Native device actions reach the device action catalog

**User Story:** As a dashboard user, I want brightness, color, on, off, and toggle actions to reach the device, so that device controls actually change the device.

#### Acceptance Criteria

1. WHEN a REST device-action request specifies a `Native_Device_Action`, THE REST device-action route SHALL route it through the `Generic_Device_Handler` so the action reaches the device's `Action_Catalog`.
2. WHEN a `Native_Device_Action` is routed through the `Generic_Device_Handler`, THE `CommandService` SHALL NOT return `unsupported` for an action type the target device's `Action_Catalog` supports.
3. WHEN a REST device-action request supplies action parameters, THE route SHALL preserve those parameters when normalizing the action so the device receives the intended values.
4. IF the target device's `Action_Catalog` does not support the requested action type, THEN THE `CommandService` SHALL return a truthful failure identifying the unsupported action, leaving device state unchanged.
5. THE normalization SHALL apply to device control actions and SHALL NOT alter device management operations (such as rename/delete) that use their own routes.

### Requirement 3: MQTT device dispatch works in production composition

**User Story:** As an installer of generic MQTT devices, I want device commands to publish to the broker in the running application, so that a connected broker is not reported as disconnected.

#### Acceptance Criteria

1. WHEN the application composes its services at startup, THE composition root SHALL provide the `ConnectorManager` with the live `MqttService` used by the rest of the application.
2. WHEN a generic MQTT device command is dispatched through the `CommandService` and the application-level `MqttService` is connected, THE dispatch SHALL NOT fail with a "broker not connected" error attributable to a missing MQTT service reference.
3. WHILE the application-level `MqttService` is genuinely disconnected, THE MQTT device dispatch MAY report a broker-not-connected failure, and that failure SHALL reflect the real broker connection state rather than an unwired dependency.

### Requirement 4: One canonical brightness contract

**User Story:** As a dashboard user and a connector author, I want brightness to use one agreed parameter and range everywhere, so that a valid brightness action is not rejected by descriptor validation.

#### Acceptance Criteria

1. THE system SHALL define exactly one canonical brightness parameter name and value range used by the generic capability descriptor, the connectors that support brightness, the dashboard brightness control, and the documented examples.
2. WHEN the dashboard issues a brightness action within the canonical range, THE descriptor validation performed before the connector SHALL accept it rather than rejecting it for a parameter-name or range mismatch.
3. WHERE a connector's device-native brightness scale differs from the canonical contract, THE connector SHALL translate between the canonical value and its device-native value so the external contract stays consistent.
4. THE generic fallback brightness descriptor and the actual brightness action accepted by the connectors SHALL agree on parameter name and range after this feature.

### Requirement 5: `devices.actionAll()` respects the scoped inventory

**User Story:** As an operator relying on the advertised group model, I want a scoped automation's bulk action to only see and act on its in-scope devices, so that hidden devices are never disclosed through predicates, counts, or results.

#### Acceptance Criteria

1. WHEN a scoped automation invokes `devices.actionAll()`, THE bulk-action host callback SHALL evaluate the user-supplied predicate only against the automation's `Scoped_Inventory`, never the full device registry.
2. WHEN a scoped automation invokes `devices.actionAll()`, THE returned `BulkActionResult` SHALL contain only device ids that are within the automation's `Scoped_Inventory`.
3. WHEN a scoped automation invokes `devices.actionAll()`, THE counts (`total`, `succeeded`, `failed`) SHALL be derived only from devices within the automation's `Scoped_Inventory`.
4. WHEN a scoped automation invokes `devices.actionAll()`, THE only devices for which a command is dispatched to the `CommandService` SHALL be devices within the automation's `Scoped_Inventory`.
5. WHEN an unrestricted (or admin-authored) automation invokes `devices.actionAll()`, THE callback SHALL retain full-inventory behavior over all devices.
6. THE `Scoped_Inventory` used by `devices.actionAll()` SHALL be the same in-scope device set injected into `devices.list()`, `devices.get()`, and `devices.filter()` for that execution.

### Requirement 6: Pane removal does not delete the automation

**User Story:** As a dashboard author, I want removing a pane to remove only that view, so that I do not accidentally destroy hand-written Logic and UI that other tabs may also use.

#### Acceptance Criteria

1. WHEN a user removes an `Automation_Pane`, THE frontend SHALL remove only that pane and SHALL NOT issue a request that deletes the underlying automation.
2. THE frontend SHALL issue at most one deletion request for an automation only through an explicit "delete automation" operation, never as a side effect of removing a pane.
3. WHEN a user explicitly chooses to delete an automation, THE frontend SHALL require an explicit confirmation before the deletion is sent.
4. THE pane-removal path SHALL NOT contain a duplicate deletion request for the same automation.
5. WHEN a pane referencing an automation is removed while other panes/tabs still reference the same automation, THE underlying automation SHALL remain intact and continue to function for those other references.
6. THE explicit "delete automation" operation SHALL be reachable from an automation editing/management surface rather than only from a pane's remove control.

### Requirement 7: Truthful layout editing for non-admin write users

**User Story:** As a non-admin write user, I want the dashboard to only offer me layout edits it will actually persist, so that my changes do not silently disappear on reload.

#### Acceptance Criteria

1. THE set of `Layout_Mutation` controls the frontend offers to a user SHALL match what the backend will persist for that user's role.
2. IF layout persistence is restricted to admins, THEN THE frontend SHALL NOT present `Layout_Mutation` controls (add, remove, drag, resize, pane settings) to a non-admin user as if their changes will be saved.
3. WHEN a non-admin `write` user is denied a `Layout_Mutation`, THE system SHALL NOT leave the frontend in a state where accepted local changes are silently discarded only on reload.
4. THE permission documentation (`docs/security/permissions.md`) SHALL describe `write` in a way that matches the actual layout-editing capability delivered to non-admin users.
5. WHERE non-admin dashboard composition is desired, THE system MAY instead expose a tab-scoped layout endpoint guarded by tab `write` permission that mutates only panes belonging to that tab, and SHALL NOT accept a full-layout replacement from a non-admin.
6. THE non-admin `write` capability for authoring and editing scoped automations SHALL be unchanged by this requirement.

### Requirement 8: Partial automation updates preserve omitted fields

**User Story:** As an automation author, I want editing one field of an automation to leave my other settings intact, so that changing the name never erases my chosen completion tier.

#### Acceptance Criteria

1. WHEN an automation update omits `completionTier`, THE update SHALL preserve the rule's existing stored completion tier.
2. WHEN an automation update supplies an explicit `null` for `completionTier`, THE update SHALL clear the stored completion tier.
3. WHEN an automation update supplies a valid `completionTier`, THE update SHALL replace the stored completion tier with that value.
4. THE completion-tier preservation behavior SHALL apply identically to script-rule updates and form-rule updates.
5. WHEN an automation update omits a field that maps to `condition_type` or `condition_value`, THE update SHALL preserve the existing stored value, AND WHEN it supplies an explicit `null` for that field THE update SHALL clear the stored value.
6. THE completion-tier validation semantics owned by **command-completion-tier** (rejecting an invalid tier value) SHALL be unchanged; only the omitted-versus-cleared distinction is corrected.

### Requirement 9: Production-composition verification

**User Story:** As a maintainer, I want an integration test that exercises the real dependency graph, so that a source/scope/handler/MQTT composition bug cannot pass CI again.

#### Acceptance Criteria

1. THE test suite SHALL include a `Production_Composition_Test` that wires dependencies equivalently to `src/index.ts` (including the automation scope resolver and the MQTT service on the connector manager).
2. THE `Production_Composition_Test` SHALL verify that an authorized REST `toggle` reaches the connector for both an admin and a permitted non-admin user.
3. THE `Production_Composition_Test` SHALL verify that a brightness action reaches the connector with the canonical parameter and range.
4. THE `Production_Composition_Test` SHALL verify that an explicit `off` action reaches the connector.
5. THE `Production_Composition_Test` SHALL verify that a generic MQTT device command publishes through the live or stubbed `MqttService` injected at composition.
6. THE `Production_Composition_Test` SHALL verify that an out-of-scope REST action is rejected before dispatch only where resource authorization denies it, and that an in-scope one is not rejected as an unknown automation.
7. THE `Production_Composition_Test` SHALL verify that a scoped automation cannot escape its device set, including when it fabricates a device id.
8. THE test suite SHALL include a regression test proving `devices.actionAll()` does not evaluate the predicate against, dispatch to, or return, any device outside the scoped inventory.
9. THE test suite SHALL include regression tests proving that updating an automation's name (or `uiSource`) alone preserves the stored completion tier, that an explicit `null` clears it, and that a valid tier replaces it.
