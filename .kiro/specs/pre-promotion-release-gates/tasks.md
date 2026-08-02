# Implementation Plan: Pre-Promotion Release Gates

## Overview

This plan closes the five 2 Aug 2026 fresh-review release gates and adds the production-composition verification that would have caught them. Each gate is independently shippable; tasks are ordered smallest-blast-radius-first, with the architectural Gate 1 (command source) and the production-composition suite as the larger anchors.

Implementation language is **TypeScript** (matching the codebase). Tests use `vitest` + `fast-check` (backend/pure logic and routes via supertest) and Testing Library (frontend), following repo conventions. The design's **4 correctness properties** each map to one property-based test tagged `// Feature: pre-promotion-release-gates, Property {n}: {text}` at `{ numRuns: 200 }`.

> **Reused, not redefined:** `CommandService`, `execute()`, built-in handlers, single-boundary wiring (**unified-command-boundary**); `AutomationScopeResolver` fail-closed semantics (**scoped-automation-authoring**); `completion_tier`, `normalizeTier`, `isConfirmationTier`, tier validation (**command-completion-tier**). These specs are already implemented.

> **One open decision (Gate 4 / brightness):** tasks assume the canonical contract is `brightness` integer `0–100` percent (connectors translate to native scale). If the team prefers the minimal-churn alternative (`brightness` `0–254` native), only task 4.x changes — flip the descriptor range and drop the Hue translation.

## Tasks

- [x] 1. Gate 5 — partial-update PATCH semantics (smallest, isolated)
  - [x] 1.1 Preserve omitted fields on automation update
    - In `src/api/routes/automation.routes.ts` add a `preserve(incoming, current)` helper (`undefined` → current, else incoming) and apply it to `completion_tier`, `condition_type`, `condition_value` in **both** the script and form update branches
    - Completion tier: omitted ⇒ `normalizeTier(existing.completion_tier)`; explicit `null` ⇒ `null`; valid ⇒ the value; invalid non-null ⇒ existing `BadRequestError`
    - Replace the current `conditionType ?? existing.condition_type` / `conditionValue ?? existing.condition_value` with the preserve helper so an explicit `null` can clear while omission preserves
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [ ]* 1.2 Property test for the PATCH merge
    - New `src/api/routes/automation-update.property.test.ts` over the pure merge (`undefined`/`null`/valid), asserting preserve/clear/replace and invalid-tier rejection, identical across fields
    - **Property 4: Partial update preserves, clears, or replaces correctly** — **Validates: 8.1–8.6**
  - [ ]* 1.3 Regression examples for tier preservation
    - Name-only update preserves tier; `uiSource`-only update preserves tier; explicit `null` clears; valid tier replaces
    - _Requirements: 9.9_

- [x] 2. Gate 3 — wire MQTT into the connector manager at composition
  - [x] 2.1 Call `connectorManager.setMqttService(mqttService)` in `src/index.ts`
    - Add the call immediately after `connectorManager` is constructed and `mqttService` is available (before commands can flow), so `ActionRouter` can publish MQTT device commands
    - _Requirements: 3.1, 3.2, 3.3_
  - [ ]* 2.2 Example test for MQTT wiring
    - Assert `setMqttService` is invoked at composition and that a generic MQTT device dispatch publishes (via a stub `MqttService`) rather than returning "broker not connected" while connected
    - _Requirements: 3.2_

- [x] 3. Gate 5-adjacent / Gate 2 — sandbox `actionAll` scoped inventory
  - [x] 3.1 Filter the scoped inventory in `__actionAllRef`
    - In `src/automations/sandbox.ts` `setDevicesRefs()`, capture the already-computed scope-filtered `allDevices` as the inventory the `__actionAllRef` callback uses, and replace `const all = deviceRegistry.getAll()` inside the callback with a filter over that captured inventory; remove the `deviceRegistry` capture used only by `actionAll`
    - Ensure dispatch targets, `BulkActionResult` device ids, and `total`/`succeeded`/`failed` all derive from the scoped matches; unrestricted scope keeps full-inventory behavior
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [ ]* 3.2 Property test for scoped `actionAll`
    - New `src/automations/sandbox-actionall.property.test.ts` (registry containing in- and out-of-scope devices; spy `CommandService`)
    - **Property 3: `actionAll` never escapes the scoped inventory** — **Validates: 5.1–5.6**
  - [ ]* 3.3 Regression example for hidden-device exclusion
    - Prove the predicate is never invoked with a hidden device and hidden ids never appear in the result
    - _Requirements: 9.8_

- [x] 4. Gate 4 — one canonical brightness contract
  - [x] 4.1 Align the generic descriptor and connectors on `brightness` 0–100
    - In `src/connectors/capability-action-map.ts` rename the brightness param `level` → `brightness`, keep range `0–100`, update label/description
    - In `src/connectors/hue/hue-connector.ts` map the incoming `0–100` percentage to Hue native `0–254` (`bri = round(pct/100*254)`, clamped); verify Kasa brightness aligns to `0–100`
    - In `frontend/src/components/panes/HueControlPane.tsx` send `brightness` in `0–100`
    - Update any brightness examples/snippets and connector docs to `0–100`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [ ]* 4.2 Example test for brightness alignment
    - Descriptor validation accepts a canonical dashboard brightness; the Hue connector maps it to native scale
    - _Requirements: 4.2, 4.4_

- [x] 5. Gate 1 — explicit command source, scoped only for automations
  - [x] 5.1 Add the `Command_Source` model and source-gated scope
    - In `src/automations/command-service.ts` add the `CommandSource` union and `automationSource()`/`restSource()`/`systemSource()` helpers
    - Change `execute(action, source: CommandSource | string, confirm?, requiredTier?)`: coerce a bare string to `automationSource(...)` (Req 1.7); derive a `logId` for handlers/logging; pass the source to `checkScope`
    - `checkScope(action, source)`: return `null` for any non-automation source; otherwise resolve by `source.ruleId` with the existing unrestricted/publish/webhook/device-scope logic unchanged
    - Keep `executeSequence(actions, ruleId)` string-based (coerced)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  - [x] 5.2 Normalize REST device actions and pass a rest source
    - In `src/api/routes/device.routes.ts` `POST /:id/action`, call `commandService.execute({ type: "device_action", target: id, params: { actionType: req.body.type, ...(req.body.params ?? {}) } }, restSource())`, keeping the existing `withTimeout` and HTTP-status mapping
    - _Requirements: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5_
  - [ ]* 5.3 Property tests for source-gated scoping
    - Extend `src/automations/command-service.property.test.ts` with a spy resolver
    - **Property 1: Scope is applied only to automation sources** — **Validates: 1.2, 1.3, 1.4, 1.5, 1.7**
    - **Property 2: Automation scoping is unchanged for automation sources** — **Validates: 1.6**

- [x] 6. Checkpoint — backend gates
  - Run the backend build/typecheck and the affected `vitest` suites single-run; confirm no automation call site regressed via the bare-string coercion. Ask the user if questions arise.

- [x] 7. Gate 6 — decouple pane removal from automation deletion
  - [x] 7.1 Remove the automation delete from pane removal
    - In `frontend/src/components/TabLayout.tsx` `handleRemovePane()`, drop the `authFetch(DELETE /api/automations/:id)` call; call only `removePane(paneId)`
    - In `frontend/src/store/dashboard-store.ts` `removePane()`, drop the `deleteAutomation(...)` call; remove only the pane and persist
    - _Requirements: 6.1, 6.4, 6.5_
  - [x] 7.2 Add an explicit, confirmed automation delete
    - On the automation editing/management surface (`AutomationsPage` / `AutomationPane`), add an explicit "delete automation" action that calls `DELETE /api/automations/:id` only after a confirmation dialog
    - _Requirements: 6.2, 6.3, 6.6_
  - [ ]* 7.3 Frontend tests for pane/delete decoupling
    - Removing an automation pane issues no automation DELETE (neither call site) and the rule persists; the explicit delete requires confirmation before sending
    - _Requirements: 6.1, 6.3, 6.4_

- [x] 8. Gate 4 (permissions) / Gate 7 — truthful non-admin layout editing
  - [x] 8.1 Gate layout-mutation controls to admins
    - In `frontend/src/components/TabLayout.tsx` derive `canEditLayout` from the admin role (not tab `write`) and use it for add-pane/browse-panes, per-pane settings and remove controls, and `dragConfig`/`resizeConfig` `enabled`; keep `canInteract` and automation authoring on tab `write`
    - _Requirements: 7.1, 7.2, 7.3, 7.6_
  - [x] 8.2 Correct the permission wording
    - In `docs/security/permissions.md` reword `write` so pane/layout composition is described as admin-only for now, while `write` covers scoped automation authoring/editing and interacting with panes (leave the tab-scoped endpoint as a documented future alternative, Req 7.5)
    - _Requirements: 7.4, 7.5_
  - [ ]* 8.3 Frontend test for layout gating
    - A non-admin `write` user is not shown add/remove/drag/resize/settings controls; an admin is; automation authoring remains available to `write`
    - _Requirements: 7.1, 7.2, 7.6_

- [ ] 9. Gate 9 — production-composition verification
  - [ ] 9.1 Production-composition integration suite
    - New `src/__integration__/command-path-composition.integration.test.ts` wiring dependencies like `src/index.ts` (real `AutomationScopeResolver`; `connectorManager.setMqttService(stubMqtt)`; registered handlers; a stub/spy connector)
    - Cover: authorized REST `toggle` reaches the connector for admin and permitted non-admin; brightness reaches the connector with the canonical param/range; explicit `off` reaches the connector; a generic MQTT command publishes through the stub `MqttService`; an in-scope REST action is not rejected as an unknown automation while an unauthorized one is denied at the route; a scoped automation cannot act on a fabricated/out-of-scope device id
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 10. Final verification
  - [x] 10.1 Full build + test run
    - Run the backend and frontend build/typecheck and the full `vitest` suites single-run (not watch); resolve failures introduced by the feature; confirm the production-composition suite passes
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_

## Notes

- Tasks marked `*` are optional test sub-tasks; the design treats testing as first-class and each of Properties 1–4 maps to one property test.
- Gate ordering minimizes risk: the isolated backend fixes (5, 3, 2, 4-descriptor) land before the architectural source change (1), then the frontend gates (6, 7) and the composition suite (9).
- The bare-string → automation-source coercion (task 5.1) is what lets Gate 1 land without editing every automation call site; the composition suite (9.1) guards against a regression there.
- The brightness canonical decision (task 4.1) is the one item worth confirming with the team before implementation; everything else follows the design directly.
- These items are tracked in `docs/BACKLOG.md` under "Critical / High — fresh review release gates (2 Aug 2026)".

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.2", "3.3", "4.2", "5.2"] },
    { "id": 2, "tasks": ["5.3", "6"] },
    { "id": 3, "tasks": ["7.1", "7.2", "8.1", "8.2"] },
    { "id": 4, "tasks": ["7.3", "8.3", "9.1"] },
    { "id": 5, "tasks": ["10.1"] }
  ]
}
```
