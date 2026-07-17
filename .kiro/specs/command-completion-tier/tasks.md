# Implementation Plan: Command Completion Tier

## Overview

This plan makes the **completion tier** — which lifecycle step counts as SUCCESS for an automation — an author-configurable choice, end to end. It does exactly one new thing conceptually: it **supplies a value** to the `requiredTier?: ConfirmationTier` input that `CommandService.execute()` already exposes. It does not build that input, define the lifecycle, or implement tier clamping — those are inherited.

Implementation language is **TypeScript** (the design is expressed in concrete TypeScript, not pseudocode, matching the existing codebase). Tests use `vitest` + `fast-check` following repo conventions: co-located `*.property.test.ts`, `{ numRuns: 100 }` minimum, each property tagged `// Feature: command-completion-tier, Property N: <text>`. Each of the design's **6 correctness properties** maps to exactly one property-based test.

Tasks build incrementally with no orphaned code: (1) the pure helpers module `completion-tier.ts`; (2) migration `004` + registry wiring + `StoredRule`/`Rule` type additions and (de)serialization; (3) `ConnectorManager.getCompletionTierCapability` + the `GET /api/devices/:id/completion-tiers` endpoint; (4) authoring validation on `POST`/`PUT /api/automations` + the zod schema field; (5) form-rule dispatch wiring; (6) script-rule dispatch wiring (sandbox `__actionRef` tier arg + `BOOTSTRAP_SCRIPT` options bag + rule-level default + `sandbox-types.d.ts`); (7) the frontend capability-aware tier selector; (8) a final build + full test run.

> **Prerequisite — unified-command-boundary must be implemented first.** This feature supplies a value to the `requiredTier` input that **unified-command-boundary** introduces on the physical-command boundary. That spec renames `ActionExecutor` → `CommandService` (file `src/automations/command-service.ts`) and widens `execute(action, ruleId, confirm?)` to `execute(action, ruleId, confirm?, requiredTier?)`, and owns the capability clamping and the never-report-an-unreached-tier guarantee. This plan is written against that post-unified-command-boundary contract. **unified-command-boundary's own tasks are not included here.** Where a symbol name matters, both names are noted (`CommandService` / the renamed `ActionExecutor`).

> **Truthfulness is inherited, not re-implemented.** Requirement 6 (truthful outcome relative to the chosen tier) is satisfied by the inherited lifecycle/clamping mechanism reached through `CommandService`; this feature's only contribution is to never *supply* an over-ceiling tier (it omits `requiredTier` instead). Requirement 6 is therefore covered by inherited-mechanism integration tests, not by new correctness properties here.

## Tasks

- [ ] 1. Pure completion-tier helpers module
  - [ ] 1.1 Implement `completion-tier.ts`
    - Create `src/automations/completion-tier.ts` importing `ConfirmationTier` from `./command-lifecycle.js`
    - Implement `isConfirmationTier(value): value is ConfirmationTier` (exactly `"dispatch" | "acknowledged" | "observed"`)
    - Implement `tierRank(tier)` using the ordinal map `dispatch:0 < acknowledged:1 < observed:2`
    - Implement `computeCapabilityCeiling({ dispatchable, ackSupported, observationAvailable })` returning `{ tiers, ceiling }`: empty `tiers`/`null` ceiling when not dispatchable; else `["dispatch"]` plus `acknowledged` iff `ackSupported`, plus `observed` iff `observationAvailable`; ceiling is the highest-rank member
    - Implement `validateAgainstCeiling(submitted, ceiling): TierValidation` — `{ ok:true, tier:null }` for `null`/`undefined`; `{ ok:false, code:"invalid" }` for non-tier values; `{ ok:false, code:"ceiling_unresolvable" }` when ceiling is `null`; `{ ok:false, code:"over_ceiling" }` when `rank(submitted) > rank(ceiling)`; else `{ ok:true, tier:submitted }`
    - Implement `resolveEffectiveTier(stored, actionSpecified, ceiling): ConfirmationTier | undefined` — action-specified overrides stored; return `undefined` on absent/invalid/over-ceiling (omit-on-doubt), else the chosen tier verbatim
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.2, 3.3, 3.4, 3.5, 3.6, 4.5, 4.6, 5.3, 5.4, 7.4_
  - [ ]* 1.2 Write property test for capability-ceiling computation
    - New `src/automations/completion-tier.property.test.ts`; arbitrary `fc.record` of booleans for `{ dispatchable, ackSupported, observationAvailable }`
    - **Property 1: Capability ceiling reflects exactly the provable tiers**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
  - [ ]* 1.3 Write property test for authoring validation
    - Extend `src/automations/completion-tier.property.test.ts`; arbitraries mixing tier strings, non-tier strings, `null`/`undefined`, and ceilings including `null`
    - **Property 2: Authoring validation classifies every submission against the ceiling**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 7.4**
  - [ ]* 1.4 Write property test for effective-tier pass-through and precedence
    - Extend `src/automations/completion-tier.property.test.ts`
    - **Property 3: Effective-tier resolution honors precedence and passes through in-ceiling tiers**
    - **Validates: Requirements 1.8, 4.1, 4.3, 5.1, 5.2, 6.7**
  - [ ]* 1.5 Write property test for effective-tier omit-on-doubt
    - Extend `src/automations/completion-tier.property.test.ts`
    - **Property 4: Effective-tier resolution omits on absence, invalidity, or over-ceiling, and never returns an out-of-vocabulary value**
    - **Validates: Requirements 4.2, 4.5, 4.6, 5.3, 5.4, 7.1, 7.5**

- [ ] 2. Persistence — migration, types, and (de)serialization
  - [ ] 2.1 Add migration `004` and register it
    - Create `src/db/migrations/004-automation-rules-completion-tier.ts` following the guarded `PRAGMA table_info` pattern of `002-automation-rules-columns.ts`; `up()` checks for the `completion_tier` column and, if absent, runs `ALTER TABLE automation_rules ADD COLUMN completion_tier TEXT DEFAULT NULL;` (no `NOT NULL`/`CHECK`, so legacy rows read as `null` without rewrite)
    - Register it as migration id `4` in `src/db/migrations/index.ts` after `devicesRemoveCheck`
    - _Requirements: 1.1, 1.5_
  - [ ] 2.2 Thread `completion_tier` through `StoredRule`, `Rule`, and (de)serialization
    - In `src/api/routes/automation.routes.ts` add `completion_tier: string | null` to the `StoredRule` row shape; add `completion_tier` to the create `INSERT` (form and script) binding the validated value or `null`, add `completion_tier = ?` to the `UPDATE` (value fully replaces prior), and read `row.completion_tier` where rules are loaded
    - In `src/core/types.ts` add optional `completionTier?: ConfirmationTier` to `Rule` (import `ConfirmationTier` from `../automations/command-lifecycle.js`)
    - In the list/read handlers add an **additive** `completionTier` field (normalized `ConfirmationTier | null`) without changing any existing field (Req 7.6)
    - In `registerUiRule()` read `stored.completion_tier`, normalize via `isConfirmationTier`, attach `completionTier` to the runtime `Rule` (form path) / treat as rule-level default (script path); if reading/normalizing throws, log and do **not** register the rule (leave it disabled) rather than dispatching with an unresolved tier
    - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 7.6_
  - [ ]* 2.3 Write property test for completion-tier persistence round-trip
    - New `src/api/routes/automation.routes.property.test.ts` (or focused persistence test) using an in-memory `better-sqlite3` DB with migration `004` applied; generate sequences of `dispatch`/`acknowledged`/`observed`/`null` via create-then-update
    - **Property 6: Completion tier persists as a last-write round-trip**
    - **Validates: Requirements 1.1, 1.2, 1.4**
  - [ ]* 2.4 Write unit tests for migration `004`
    - Applies on a fresh DB; guarded no-op when the column already exists; a legacy row created before the column reads `completion_tier` as `null` without rewrite
    - _Requirements: 1.5, 7.5_

- [ ] 3. Checkpoint - helpers and persistence
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Capability query and REST endpoint
  - [ ] 4.1 Add `ConnectorManager.getCompletionTierCapability`
    - In `src/connectors/connector-manager.ts` add a read-only `getCompletionTierCapability(deviceId, observationAvailable = false)` returning `{ resolved, tiers, ceiling }`: `{ resolved:false, tiers:[], ceiling:null }` when the device is not in the registry; otherwise compose `getAcknowledgementCapability(deviceId)?.supported === true` and `observationAvailable` through `computeCapabilityCeiling({ dispatchable:true, ackSupported, observationAvailable })`
    - Performs no dispatch; pure composition of existing capability reads
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - [ ] 4.2 Add `GET /api/devices/:id/completion-tiers` endpoint
    - In `src/api/routes/device.routes.ts` add the route calling `getCompletionTierCapability(id)`; on unresolved device return `404` with `{ deviceId, resolved:false, availableTiers:[], ceiling:null, error }`; otherwise `200` with `{ deviceId, resolved:true, availableTiers, ceiling }` (tiers ordered low→high, using the `dispatch`/`acknowledged`/`observed` vocabulary)
    - Additive endpoint only; the existing `GET /api/devices/:id/actions` is untouched
    - _Requirements: 2.6, 2.8, 7.6_
  - [ ]* 4.3 Write unit tests for the capability endpoint
    - A dispatchable+ack device reports `["dispatch","acknowledged"]` with ceiling `acknowledged`; a missing device returns `404` with `resolved:false`
    - _Requirements: 2.2, 2.3, 2.8_

- [ ] 5. Authoring validation wiring
  - [ ] 5.1 Add the optional `completionTier` schema field
    - In `src/api/schemas/automation.schemas.ts` add `completionTier: z.enum(["dispatch","acknowledged","observed"]).optional().nullable()` to the create and update schemas (additive, optional)
    - _Requirements: 7.3, 7.4_
  - [ ] 5.2 Validate `completionTier` against the ceiling before persisting
    - In the `POST` and `PUT` form branches of `src/api/routes/automation.routes.ts`, before any `INSERT`/`UPDATE` and before `registerUiRule`, resolve the target device ceiling via `connectorManager.getCompletionTierCapability(target).ceiling` (or `null` when the device is unresolvable) and call `validateAgainstCeiling(req.body.completionTier, ceiling)`
    - On `!ok` throw `BadRequestError` with the code-specific message (`invalid` lists accepted values; `over_ceiling` names requested tier and ceiling; `ceiling_unresolvable` indicates the ceiling cannot be determined); on failure nothing is written and the rule is not (re-)registered; on success bind `v.tier` (`ConfirmationTier | null`) into the persistence path from task 2.2
    - Inject the `ConnectorManager` (or a narrow capability-query dependency) from the composition root in `src/index.ts` (both already constructed there)
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7_
  - [ ]* 5.3 Write unit tests for authoring validation
    - Omitted `completionTier` persists `null` and returns success; over-ceiling `PUT` leaves the stored tier and registration unchanged; unresolvable-device create is rejected with the ceiling-undeterminable error
    - _Requirements: 3.1, 3.6, 3.7, 7.3, 7.4_

- [ ] 6. Form-rule dispatch wiring
  - [ ] 6.1 Supply the resolved tier from the form-rule closure
    - In the form branch of `registerUiRule()` (`src/api/routes/automation.routes.ts`), normalize the stored tier via `isConfirmationTier`, compute the dispatch-time ceiling via `connectorManager.getCompletionTierCapability(stored.action_target).ceiling` (form rules supply no `ConfirmOptions`, so the ceiling max is `acknowledged`), compute `effective = resolveEffectiveTier(storedTier, undefined, ceiling)`, and call `commandService.execute(descriptor, stored.id, undefined, effective)`
    - `effective === undefined` ⇒ omit `requiredTier` (behaviorally identical to today's highest-available); a re-registered rule with a changed stored tier supplies the new value on subsequent dispatches
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 7.1, 7.5_
  - [ ]* 6.2 Write unit tests for form-rule tier delivery
    - Stored in-ceiling tier is supplied verbatim; absent/invalid/over-ceiling tier omits `requiredTier`; a re-registered rule with a changed tier supplies the new value
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6_

- [ ] 7. Script-rule dispatch wiring
  - [ ] 7.1 Thread rule-level default and per-call tier through the sandbox
    - In `src/automations/sandbox.ts` add a per-call `perCallTier` argument to the `__actionRef` host callback and construct the closure with the rule-level default (`ruleTierDefault`) in scope (passed alongside `ruleId` via the existing per-rule ref setup); the script branch of `registerUiRule` supplies the rule's normalized `completion_tier` as that default
    - **Fail-on-invalid before dispatch (Req 5.5, 5.6):** if `perCallTier` is defined and not a valid tier, or (when no per-call tier) `ruleTierDefault` is defined and not a valid tier, return `{ success:false, error:<names the invalid tier>, lifecycleState:"FAILED" }` without calling `execute`
    - Otherwise compute `chosen = resolveEffectiveTier(ruleTierDefault, perCallTier, null)` (per-call overrides default; ceiling `null` because the inherited boundary clamps against live capability) and call `execute(descriptor, ruleId, confirm?, chosen)`
    - Extend the `BOOTSTRAP_SCRIPT` `devices.action(deviceId, actionType, params, opts)` wrapper to read an optional `opts.tier` and forward it as the new trailing argument, preserving the existing 3-arg / confirm-object call shapes byte-for-byte
    - In `src/automations/sandbox-types.d.ts` add an optional `tier` field to the `devices.action()` options/confirm surface
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [ ]* 7.2 Write property test for the invalid-script-tier failure gate
    - New `src/automations/sandbox.property.test.ts` (addition) with a spy `CommandService.execute`; generate non-tier values across per-call and rule-level-default source combinations
    - **Property 5: An invalid script tier fails validation without dispatching**
    - **Validates: Requirements 5.5, 5.6**

- [ ] 8. Checkpoint - capability query, authoring, and dispatch wiring
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Frontend capability-aware tier selector
  - [ ] 9.1 Add the completion-tier selector to the form-rule editor
    - In `frontend/src/components/AutomationsPage.tsx` add a `completionTier` field to form state and a selector next to the action target; when the target device changes, fetch `GET /api/devices/:id/completion-tiers` and render one option per `availableTiers` entry plus a default "Highest available (auto)" option that omits `completionTier`
    - Block/disable tiers above `ceiling` (over-ceiling not selectable) and surface a short warning when a previously-stored tier is now over-ceiling; include `completionTier` in the create/update body only when the author picks an explicit tier (otherwise omit it)
    - _Requirements: 2.6, 3.4_

- [ ] 10. Final verification
  - [ ] 10.1 Run the full build/typecheck and test suite and fix any failures
    - Run the project build/typecheck and the full `vitest` suite single-run (not watch); resolve any type or test failures introduced by the feature
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 7.6_

## Notes

- **Prerequisite:** unified-command-boundary must land first — it provides the `CommandService` boundary and the `requiredTier` input this feature supplies a value to. Its tasks are intentionally excluded from this plan.
- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but the design treats testing as first-class; each of Properties 1–6 maps to exactly one property-based test.
- Property tests use `fast-check` at `{ numRuns: 100 }` minimum, tagged `// Feature: command-completion-tier, Property N: <text>`, co-located as `*.property.test.ts`.
- Property → test-file mapping (from the design's Testing Strategy): P1–P4 in `completion-tier.property.test.ts`; P5 in `sandbox.property.test.ts`; P6 in `automation.routes.property.test.ts`.
- Requirement 6 (truthful outcome) is enforced by the inherited `CommandService`/lifecycle mechanism; this feature's only contribution is never *supplying* an over-ceiling tier (Property 4). It is validated by inherited-mechanism integration tests owned upstream, not by new properties here.
- The `automation.routes.ts` file is edited across separate tasks (2.2 persistence, 5.2 validation, 6.1 form dispatch, 7.1 script branch); the dependency graph places these in different waves to avoid write conflicts.
- Checkpoints (tasks 3 and 8) and the final build (10.1) ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.2", "4.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "4.2", "5.2"] },
    { "id": 3, "tasks": ["4.3", "5.3", "6.1"] },
    { "id": 4, "tasks": ["6.2", "7.1"] },
    { "id": 5, "tasks": ["7.2", "9.1"] },
    { "id": 6, "tasks": ["10.1"] }
  ]
}
```
