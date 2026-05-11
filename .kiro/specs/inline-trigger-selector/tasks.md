# Implementation Plan: Inline Trigger Selector

## Overview

This plan implements the Inline Trigger Selector feature in incremental steps, starting with shared utilities and data layer changes, then backend engine integration, API updates, and finally the frontend component. Each step builds on the previous one so there is no orphaned code.

## Tasks

- [x] 1. Create shared cron utilities
  - [x] 1.1 Create backend cron-utils module (`src/automations/cron-utils.ts`)
    - Export `CRON_PRESETS` array with all 8 preset objects (label + expression)
    - Implement `isValidCron(expression: string): boolean` using `node-cron`'s `validate()` function
    - Implement `describeCron(expression: string): string` with pattern matching for common expressions and a "Runs on custom schedule" fallback
    - _Requirements: 2.1, 2.2, 3.1, 3.4_

  - [ ]* 1.2 Write property tests for cron validation (Property 2)
    - **Property 2: Cron validation correctness**
    - Generate random strings with fast-check, verify `isValidCron()` matches `node-cron.validate()`
    - **Validates: Requirements 3.1, 5.5**

  - [ ]* 1.3 Write property tests for describeCron (Property 3)
    - **Property 3: Human-readable cron description is non-empty for valid expressions**
    - Generate valid cron expressions, verify `describeCron()` returns a non-empty string starting with "Runs"
    - **Validates: Requirements 3.4**

  - [x] 1.4 Create frontend cron-utils module (`frontend/src/lib/cron-utils.ts`)
    - Mirror the backend `CRON_PRESETS`, `isValidCron`, and `describeCron` logic for client-side use
    - Use the same validation approach (can use a lightweight regex-based validator or import `cron-validate` if available, matching backend behavior)
    - _Requirements: 2.1, 3.1, 3.4_

- [x] 2. Extend database schema and core types
  - [x] 2.1 Add `trigger_type` and `cron_expression` columns to `automation_rules` table
    - In `src/db/database.ts`, add two `addColumn` calls in `initSchema`: `trigger_type TEXT DEFAULT 'mqtt'` and `cron_expression TEXT DEFAULT NULL`
    - Ensure migration is non-destructive (existing rows get `trigger_type = 'mqtt'`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.3_

  - [x] 2.2 Extend the `Rule` interface in `src/core/types.ts`
    - Add optional `triggerType?: "mqtt" | "cron" | "none"` field
    - Add optional `cronExpression?: string` field
    - _Requirements: 4.1, 4.2_

- [x] 3. Implement CronTimerManager
  - [x] 3.1 Create `src/automations/cron-timer-manager.ts`
    - Implement `CronTimerManager` class with `start()`, `stop()`, `has()`, `stopAll()`, and `size` getter
    - `start()` validates expression via `node-cron.validate()`, creates a `ScheduledTask`, stores in internal Map, returns boolean success
    - `stop()` calls `.stop()` on the task and removes from Map; no-op if not found
    - `stopAll()` iterates all entries and stops each
    - _Requirements: 6.1, 6.3, 6.5_

  - [ ]* 3.2 Write property tests for CronTimerManager (Property 7)
    - **Property 7: Registering a cron rule creates a timer**
    - Generate valid cron expressions, call `start()`, verify `has(ruleId)` returns true
    - **Validates: Requirements 6.1, 7.3**

  - [ ]* 3.3 Write property tests for CronTimerManager (Property 8)
    - **Property 8: Unregistering a cron rule stops its timer**
    - Register rules, call `stop()`, verify `has(ruleId)` returns false
    - **Validates: Requirements 6.3, 7.2**

- [x] 4. Integrate CronTimerManager into AutomationEngine
  - [x] 4.1 Modify `src/automations/automation-engine.ts`
    - Instantiate `CronTimerManager` in the constructor
    - In `register()`: if rule has `triggerType === "cron"` and a valid `cronExpression`, start a cron timer; on fire, construct synthetic `NormalizedEvent` and invoke the rule's action directly
    - In `unregister()`: call `cronTimerManager.stop(ruleId)` to clean up any active timer
    - Add `dispose()` method that calls `cronTimerManager.stopAll()`
    - On engine startup/initialization, create timers for all existing cron rules loaded from DB
    - Log warning and skip rule if cron expression is invalid at startup
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.2, 7.3_

  - [ ]* 4.2 Write property test for cron fire event shape (Property 9)
    - **Property 9: Cron fire event contains required context fields**
    - Register a cron rule, capture the synthetic event when timer fires, verify it contains `ruleId`, `cronExpression`, and a valid `firedAt` timestamp
    - **Validates: Requirements 6.2**

  - [x] 4.3 Add engine `dispose()` call on process shutdown in `src/index.ts`
    - Call `engine.dispose()` in the existing graceful shutdown handler
    - _Requirements: 6.3_

- [x] 5. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update API routes
  - [x] 6.1 Modify `src/api/routes/automation.routes.ts` — POST and PUT handlers
    - Accept `triggerType` and `cronExpression` from request body
    - Validate: if `triggerType === "cron"`, require `cronExpression` and validate with `isValidCron()`; return 400 if invalid
    - Set `trigger_topic` to `""` when type is "cron" or "none"; set `cron_expression` to NULL when type is not "cron"
    - Pass `triggerType` and `cronExpression` through to DB insert/update and engine register/unregister
    - Default `triggerType` to `"mqtt"` if not provided (backward compat)
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 8.1_

  - [x] 6.2 Modify `src/api/routes/automation.routes.ts` — GET handler
    - Include `triggerType` and `cronExpression` in response objects
    - Default `triggerType` to `"mqtt"` for rows where column is NULL
    - _Requirements: 5.3, 8.1_

  - [ ]* 6.3 Write property test for API rejection of invalid cron (Property 5)
    - **Property 5: API rejects invalid cron expressions**
    - Generate strings that are NOT valid cron expressions, send POST with `triggerType: "cron"`, verify 400 response
    - **Validates: Requirements 5.2**

  - [ ]* 6.4 Write property test for API round-trip (Property 4)
    - **Property 4: API trigger configuration round-trip**
    - Generate valid trigger configurations, POST then GET, verify `triggerType` and `cronExpression` match
    - **Validates: Requirements 5.1, 5.3**

  - [ ]* 6.5 Write property test for API update persistence (Property 6)
    - **Property 6: API update persists trigger configuration**
    - Create a rule, PUT with new valid trigger config, GET and verify updated values
    - **Validates: Requirements 5.4**

- [x] 7. Checkpoint - Ensure all backend and API tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement TriggerSelector frontend component
  - [x] 8.1 Create `frontend/src/components/TriggerSelector.tsx`
    - Implement `TriggerSelectorProps` interface as defined in design
    - Render segmented control with three options: "MQTT Topic", "Schedule", "None"
    - When "MQTT Topic" selected: show text input for topic pattern
    - When "Schedule" selected: show preset dropdown, cron expression preview (read-only for presets), custom input field, and human-readable description via `describeCron()`
    - When "None" selected: hide all configuration inputs
    - Default to "MQTT Topic" for new automations
    - Call `onValidityChange(false)` when cron expression is invalid; show inline error message
    - Call `onValidityChange(true)` when configuration is valid
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_

  - [ ]* 8.2 Write property test for preset mapping (Property 1)
    - **Property 1: Preset mapping populates correct cron expression**
    - For each preset in CRON_PRESETS, verify selecting it results in the correct expression value
    - **Validates: Requirements 2.2**

- [x] 9. Integrate TriggerSelector into AutomationPane
  - [x] 9.1 Modify `frontend/src/components/panes/AutomationPane.tsx`
    - Replace the existing trigger topic text input with the `TriggerSelector` component
    - Wire `triggerType`, `mqttTopic`, `cronExpression` state to the component props
    - Use `onValidityChange` to control save button enabled/disabled state
    - Send `triggerType` and `cronExpression` fields in API create/update calls
    - In edit mode, populate `TriggerSelector` with existing rule's `triggerType`, `trigger_topic`, and `cronExpression`
    - _Requirements: 1.1, 1.5, 7.1, 7.4_

- [ ] 10. Backward compatibility verification
  - [x] 10.1 Ensure existing rules without `trigger_type` are treated as "mqtt"
    - Verify the GET endpoint defaults NULL `trigger_type` to "mqtt"
    - Verify the engine continues to match MQTT rules via `topicMatches()` without changes
    - Verify rules with empty `trigger_topic` and no `trigger_type` behave as "none" (manual-only)
    - _Requirements: 8.1, 8.2, 8.4_

  - [ ]* 10.2 Write property test for backward compatibility (Property 10)
    - **Property 10: Backward compatibility — null trigger_type treated as mqtt**
    - Generate rules with NULL trigger_type, verify system treats them as "mqtt"
    - **Validates: Requirements 8.1, 8.4**

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The backend cron-utils and CronTimerManager are built first so the API and engine can use them immediately
- Frontend cron-utils mirrors backend logic to provide consistent validation on both sides
