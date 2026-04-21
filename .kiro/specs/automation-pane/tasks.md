# Implementation Plan: Automation Pane

## Overview

Replace the multi-component automation workflow with a single self-contained Automation Pane (one pane = one automation). Implementation follows backend-first order: DB migration, structured metadata extractor, `automation()` sandbox global, API changes — then frontend: AutomationPane component, FlowDiagram, ActivityFeed, pane registry changes, TabLayout extension — then cleanup: deprecate legacy panes, update documentation.

## Tasks

- [x] 1. Database migration — add structured_metadata and ui_source columns
  - [x] 1.1 Add ALTER TABLE migration for `structured_metadata` and `ui_source` columns
    - In `src/db/database.ts`, add two `addColumn` calls in the migration section of `initSchema`:
      - `addColumn("structured_metadata", "TEXT DEFAULT NULL")`
      - `addColumn("ui_source", "TEXT DEFAULT NULL")`
    - Update the `StoredRule` interface in `src/api/routes/automation.routes.ts` to include `structured_metadata: string | null` and `ui_source: string | null`
    - _Requirements: 11.3, 14.1_

- [x] 2. Backend — StructuredMetadataExtractor and automation() sandbox global
  - [x] 2.1 Create `src/automations/structured-metadata-extractor.ts`
    - Define `StructuredMetadata` interface: `{ trigger: string; conditionText: string | null; actionsText: string }`
    - Implement `extractStructuredMetadata(compiledJs: string): StructuredMetadata | null` using best-effort regex parsing of transpiled JS to find `automation(` call patterns
    - Extract condition function body and actions function body as source text strings
    - Return `null` if the pattern doesn't match (free-form code)
    - _Requirements: 11.3, 11.5_

  - [ ]* 2.2 Write property test: structured metadata extraction round-trip
    - **Property 3: Structured metadata extraction round-trip**
    - Generate random single-expression condition bodies and action bodies, wrap in `automation()` template, transpile, extract metadata, assert conditionText and actionsText contain the original fragments
    - **Validates: Requirements 11.3**

  - [ ]* 2.3 Write property test: free-form scripts produce null structured metadata
    - **Property 4: Free-form scripts produce null structured metadata**
    - Generate random valid free-form scripts (e.g. `log.info("...")`, `devices.get("...")`, variable assignments), assert `extractStructuredMetadata()` returns null
    - **Validates: Requirements 11.5**

  - [x] 2.4 Add `automation()` global to sandbox bootstrap and type definitions
    - In `src/automations/sandbox-types.d.ts`, add the `automation()` function declaration:
      ```typescript
      declare function automation(config: {
        condition?: (ctx: typeof context) => boolean;
        actions: (ctx: typeof context) => void | Promise<void>;
      }): void;
      ```
    - In `src/automations/sandbox.ts`, extend the `BOOTSTRAP_SCRIPT` to wire up `globalThis.automation` as a function that registers condition/actions with the execution context
    - _Requirements: 11.1, 11.5_

- [x] 3. Checkpoint — Ensure all backend utility tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Backend — API changes for structured metadata and history filtering
  - [x] 4.1 Wire structured metadata extraction into POST and PUT automation routes
    - In `src/api/routes/automation.routes.ts`, after successful transpilation in POST and PUT handlers:
      - Call `extractStructuredMetadata(result.js)` on the compiled JS
      - Store the result as JSON in the `structured_metadata` column
    - Update the INSERT and UPDATE SQL statements to include `structured_metadata`
    - _Requirements: 11.3, 11.4_

  - [x] 4.2 Add `ruleId` query parameter filtering to GET /api/automations/history
    - In the `/history` route handler, check for `req.query.ruleId`
    - If present, call `executionLog.getByRuleId(ruleId)` instead of `executionLog.list(limit)` and apply the limit after filtering
    - _Requirements: 13.2_

  - [x] 4.3 Include `structured` field in GET /api/automations response
    - For script rules in the GET `/` handler, parse `structured_metadata` from the DB row
    - Include it as a `structured` field in the response object (or `null` if not present)
    - _Requirements: 11.4_

  - [ ]* 4.4 Write unit tests for API changes
    - Test POST creates rule with structured_metadata stored
    - Test PUT re-extracts structured_metadata on update
    - Test GET /history with ruleId filter returns only matching entries
    - Test GET /automations includes structured field for script rules
    - _Requirements: 11.3, 11.4, 13.2_

- [x] 5. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend — AutomationPane component with Setup Mode
  - [x] 6.1 Create `frontend/src/components/panes/AutomationPane.tsx`
    - Implement the `AutomationPane` component accepting `{ config: PaneConfig; paneId?: string }`
    - Implement internal state machine with modes: `setup`, `status`, `editing`
    - When `config.ruleId` is empty or missing → render Setup Mode
    - Setup Mode renders: name input (placeholder "Automation name"), trigger topic input (placeholder "e.g. sensor/+/temperature" in monospace), ScriptEditor filling remaining space, Save button disabled when name or topic is empty
    - On Save: POST to `/api/automations` with `{ name, triggerTopic, ruleType: "script", scriptSource }`, store returned `id` as `ruleId` via `updatePaneConfig(paneId, { ruleId: id })`, transition to Status Mode
    - On 400 error: pass `details` array to ScriptEditor `errors` prop, display error summary panel below editor
    - Wire Ctrl+S / Cmd+S in ScriptEditor to trigger save
    - Follow `docs/BRANDING.md` for all colours, spacing, and typography
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 8.1, 8.3, 10.1, 10.2, 10.3_

  - [ ]* 6.2 Write property test: Save button reflects validation state
    - **Property 1: Save button reflects validation state**
    - Generate random `{ name: string, topic: string }` pairs including empty/whitespace-only strings, assert `isDisabled === (name.trim() === '' || topic.trim() === '')`
    - **Validates: Requirements 2.5**

  - [ ]* 6.3 Write property test: Error panel displays all transpilation errors
    - **Property 2: Error panel displays all transpilation errors**
    - Generate random arrays of `{ line: number, column: number, message: string }`, render error panel, assert every error's line, column, and message text appears in output
    - **Validates: Requirements 8.3**

- [x] 7. Frontend — Status Mode, editing, and real-time updates
  - [x] 7.1 Implement Status Mode in AutomationPane
    - When `config.ruleId` is non-empty → fetch rule data from GET /api/automations, find matching rule, render Status Mode
    - Display: automation name as heading, trigger topic as monospace badge, enabled/disabled toggle (PATCH `/api/automations/:id/toggle`), last fired timestamp, Edit button
    - If rule has `structured` field → render FlowDiagram (task 8.1)
    - If rule has no `structured` field → render ActivityFeed (task 9.1)
    - If rule not found → display "Rule not found" with reset button to clear ruleId
    - Listen for `automation-fired` WebSocket events matching ruleId to update last fired timestamp
    - On initial load, fetch most recent execution from GET /api/automations/history?ruleId=X&limit=1 for initial last fired timestamp
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 9.1, 9.2, 9.3_

  - [x] 7.2 Implement editing view in AutomationPane
    - On Edit click → transition to `editing` mode, pre-fill name, trigger topic, and ScriptEditor with current values
    - Save sends PUT to `/api/automations/:id`, on success transition back to Status Mode
    - On 400 error: display errors inline, remain in editing view
    - Cancel button discards changes and returns to Status Mode
    - Wire Ctrl+S / Cmd+S to trigger save in editing mode
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 8. Frontend — FlowDiagram component
  - [x] 8.1 Create `frontend/src/components/FlowDiagram.tsx`
    - Pure presentational SVG component accepting `{ trigger: string; conditionText?: string; actionsText: string }`
    - Render trigger node as rounded rectangle with Aeolus Blue (`#3BA4FF`) border, topic in monospace
    - If conditionText present, render diamond-shaped condition node with Wind Cyan (`#5CE1E6`) border, "Yes"/"No" branches
    - Render action node(s) as rectangles with `#2A3441` border, Primary Text (`#E6EDF3`)
    - Connect nodes with SVG `<line>` or `<path>` elements using `#6B7785` stroke and arrowhead markers
    - All on Graphite (`#121821`) background — no external diagramming library
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 8.2 Write property test: Flow diagram renders all structured components
    - **Property 5: Flow diagram renders all structured components**
    - Generate random StructuredMetadata objects with varying trigger topics, optional conditionText, and actionsText, render FlowDiagram, assert SVG contains trigger text, actions text, and conditional condition text
    - **Validates: Requirements 12.2, 12.4**

- [x] 9. Frontend — ActivityFeed component
  - [x] 9.1 Create `frontend/src/components/ActivityFeed.tsx`
    - Component accepting `{ ruleId: string; wsEvents: AutomationFiredEvent[] }`
    - Fetch initial data from `GET /api/automations/history?ruleId={id}&limit=5`
    - Display each entry: timestamp, actions (type + target), success/failure indicator
    - Prepend new entries from WebSocket `automation-fired` events matching ruleId
    - Show "No activity yet" placeholder when no entries exist
    - Follow `docs/BRANDING.md` for colours and typography
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 9.2 Write property test: Activity feed entry completeness
    - **Property 6: Activity feed entry completeness**
    - Generate random ExecutionLogEntry objects, render ActivityFeed entry, assert timestamp, action type/target, and success/failure indicator are present
    - **Validates: Requirements 13.3**

- [x] 10. Checkpoint — Ensure all frontend component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Frontend — Pane registry changes and TabLayout extension
  - [ ] 11.1 Update pane registry: add `automation`, remove `automations-editor` and `automation-card`
    - In `frontend/src/lib/pane-registry.ts`:
      - Add import for `AutomationPane`
      - Add `"automation"` entry with `displayName: "Automation"`, `defaultIcon: "code"`, `defaultConfig: { ruleId: "" }`, `defaultSize: { w: 6, h: 5 }`, `category: "automations"`
      - Remove the `"automations-editor"` entry and its import (`AutomationsEditorPane`)
      - Remove the `"automation-card"` entry and its import (`AutomationCardPane`)
      - Keep the `"automation-rules"` entry unchanged
    - _Requirements: 1.1, 1.2, 1.3, 7.1, 7.2, 7.3_

  - [ ] 11.2 Extend TabLayout to pass `paneId` to pane components
    - In `frontend/src/components/TabLayout.tsx`, update the pane rendering to pass `paneId={pane.id}` to the pane component: `<entry.component config={pane.config} paneId={pane.id} />`
    - Update the `PaneRegistryEntry` component type to accept optional `paneId`: `ComponentType<{ config: PaneConfig; paneId?: string }>`
    - _Requirements: 3.2, 6.1_

  - [ ] 11.3 Add pane removal cleanup hook for automation rule deletion
    - In `TabLayout.tsx`, before calling `removePane(paneId)`, check if the pane type is `"automation"` and has a non-empty `ruleId` in config
    - If so, send DELETE to `/api/automations/:ruleId` (fire-and-forget — do not block removal on failure)
    - Then proceed with `removePane(paneId)`
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 11.4 Write unit tests for pane registry changes
    - Verify `automation` entry exists with correct fields
    - Verify `automations-editor` and `automation-card` are removed
    - Verify `automation-rules` is retained
    - _Requirements: 1.1, 7.1, 7.2, 7.3_

- [ ] 12. Frontend — Update ScriptEditor default template
  - Update the `DEFAULT_TEMPLATE` in `frontend/src/components/ScriptEditor.tsx` to use the `automation()` helper pattern:
    ```typescript
    automation({
      condition: (ctx) => {
        return ctx.state.value !== undefined;
      },
      actions: (ctx) => {
        log.info(`Triggered on ${ctx.topic}`);
      },
    });
    ```
  - _Requirements: 11.2_

- [ ] 13. Frontend — Custom UI placeholder tab (future)
  - In the AutomationPane editing view, add a "UI" tab alongside the "Logic" tab
  - The "UI" tab displays a placeholder message: "Custom UI — coming soon" with an "Experimental" badge
  - No functional implementation — just the tab and placeholder
  - _Requirements: 14.2, 14.4_

- [ ] 14. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Documentation and cleanup
  - [ ] 15.1 Update `docs/COMPREHENSIVE_DOCUMENTATION.md`
    - Document the new Automation Pane: registration, setup mode, status mode, editing, deletion cleanup
    - Document the `automation()` sandbox global and structured metadata extraction
    - Document the FlowDiagram and ActivityFeed status mode tiers
    - Document the API changes: history ruleId filter, structured field in response, new DB columns
    - Document the deprecated pane types (`automations-editor`, `automation-card`)
    - Follow steering rules in `.kiro/steering/documentation-updates.md`

  - [ ] 15.2 Final cleanup commit
    - Verify no unused imports from removed pane components
    - Ensure all files follow project code standards from `.kiro/steering/development-workflow.md`

- [ ] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The `automation()` sandbox global is wired in the bootstrap script — no new isolated-vm API needed
- FlowDiagram is pure inline SVG — no external diagramming library
- Custom UI (Requirement 14) is future — only the DB column and a placeholder tab are implemented
- Follow conventional commits with scoped types, commit after every sub-task
