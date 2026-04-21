# Design Document: Automation Pane

## Overview

The Automation Pane replaces the existing multi-component automation workflow (AutomationsEditorPane wrapping the full AutomationsPage, plus the standalone AutomationCardPane) with a single self-contained pane type. One pane = one automation. The pane owns the full lifecycle: create, edit, monitor, and delete — all within a single dashboard tile.

The pane has two primary modes:

- **Setup Mode** — shown when no `ruleId` exists in the pane config. Displays name, trigger topic, and the Monaco ScriptEditor for authoring. Save creates the backend rule and transitions to Status Mode.
- **Status Mode** — shown when a `ruleId` is linked. Displays the automation's visual summary, enabled/disabled toggle, last-fired timestamp, and an Edit button. The visual summary has three tiers:
  1. **Structured automations** — scripts using the `automation()` helper get an auto-generated SVG flow diagram (trigger → condition → actions).
  2. **Free-form code** — scripts without the helper get a live activity feed of recent executions.
  3. **Custom UI (future)** — user-authored React component rendered in a sandboxed iframe.

Editing transitions back to the ScriptEditor with pre-filled fields. Deleting the pane sends a DELETE to the backend to clean up the rule.

The legacy `automations-editor` and `automation-card` pane types are removed from the registry. The `automation-rules` list pane remains as a read-only overview.

## Architecture

```mermaid
graph TD
    subgraph Frontend
        PP[PanePicker] -->|adds pane type 'automation'| DS[Dashboard Store]
        DS -->|renders| AP[AutomationPane]
        AP -->|Setup Mode| SE[ScriptEditor - Monaco]
        AP -->|Status Mode - structured| FD[FlowDiagram - inline SVG]
        AP -->|Status Mode - free-form| AF[ActivityFeed]
        AP -->|Status Mode - custom UI future| CU[CustomUI - sandboxed iframe]
        AP -->|listens| WS[WebSocket Client]
    end

    subgraph Backend
        API[/api/automations] -->|CRUD| DB[(SQLite - automation_rules)]
        API -->|register/unregister| AE[AutomationEngine]
        API -->|transpile| TR[Transpiler]
        TR -->|extract structured metadata| SM[StructuredMetadataExtractor]
        AE -->|execute| SB[Sandbox - isolated-vm]
        AE -->|log| EL[ExecutionLog]
        AE -->|emit| EB[EventBus - AUTOMATION_FIRED]
        EB -->|broadcast| WSS[WebSocket Server]
    end

    AP -->|POST/PUT/DELETE/PATCH| API
    AP -->|GET /history| EL
    WS -->|automation-fired| AP
```

The architecture extends the existing system with minimal new modules:

1. **AutomationPane** — new React component registered in the pane registry as `automation`.
2. **FlowDiagram** — pure SVG component that renders structured metadata as connected nodes.
3. **ActivityFeed** — component that fetches and displays ExecutionLog entries filtered by ruleId.
4. **StructuredMetadataExtractor** — backend utility that parses transpiled JS to extract `automation()` call metadata (best-effort regex/AST parse).
5. **`automation()` sandbox global** — new helper function declared in sandbox type definitions and wired in the sandbox bootstrap.

No new database tables are needed. The existing `automation_rules` table gets two new columns: `structured_metadata` (JSON text) and `ui_source` (TEXT, future).

## Components and Interfaces

### AutomationPane (React Component)

The main pane component. Receives `config: PaneConfig` (with `ruleId?: string`) and `paneId: string`.

```typescript
interface AutomationPaneProps {
  config: PaneConfig;
  paneId: string;
}

// Internal state machine
type PaneMode = 'setup' | 'status' | 'editing';
```

State transitions:
- `setup` → (save success) → `status`
- `status` → (click Edit) → `editing`
- `editing` → (save success) → `status`
- `editing` → (click Cancel) → `status`
- `status` → (rule not found) → `setup` (after user confirms reset)

The component needs `paneId` to call `updatePaneConfig` and to intercept pane removal for cleanup. The `paneId` will be passed down from `TabLayout` by extending the pane component interface.

### FlowDiagram (SVG Component)

Pure presentational component. Renders structured metadata as inline SVG.

```typescript
interface FlowDiagramProps {
  trigger: string;         // MQTT topic
  conditionText?: string;  // Source text of condition function
  actionsText: string;     // Source text of actions function
}
```

Node types:
- **Trigger node** — rounded rectangle, Aeolus Blue (`#3BA4FF`) border, topic text in monospace.
- **Condition node** — diamond shape, Wind Cyan (`#5CE1E6`) border, condition text. "Yes" arrow to actions, "No" arrow to end.
- **Action node(s)** — rectangle, `#2A3441` border, Primary Text (`#E6EDF3`). One node per extracted action call.
- **Connecting arrows** — simple SVG `<line>` or `<path>` elements with arrowhead markers, `#6B7785` stroke.

All on Graphite (`#121821`) background. No external diagramming library — just `<svg>`, `<rect>`, `<polygon>`, `<text>`, `<line>`, and `<marker>` elements.

### ActivityFeed (Component)

Displays recent execution entries for a specific rule.

```typescript
interface ActivityFeedProps {
  ruleId: string;
  wsEvents: AutomationFiredEvent[];  // real-time events from WebSocket
}

interface ActivityFeedEntry {
  id: string;
  timestamp: number;
  actions: Array<{ type: string; target: string; success: boolean; error?: string }>;
  duration: number;
}
```

Fetches initial data from `GET /api/automations/history?ruleId={id}&limit=5`. Prepends new entries from WebSocket `automation-fired` events matching the ruleId.

### StructuredMetadataExtractor (Backend Utility)

Best-effort extraction of `automation()` call metadata from transpiled JavaScript.

```typescript
interface StructuredMetadata {
  trigger: string;
  conditionText: string | null;
  actionsText: string;
}

function extractStructuredMetadata(compiledJs: string): StructuredMetadata | null;
```

Strategy: After transpilation, scan the compiled JS for an `automation(` call pattern. Use a simple regex or lightweight AST walk to extract the object literal argument. Extract the `condition` and `actions` function bodies as source text strings. If the pattern doesn't match (free-form code), return `null`.

This is intentionally best-effort. If the user writes complex code that happens to call `automation()` in a non-standard way, we fall back to the activity feed.

### automation() Sandbox Global

New sandbox global function that the user calls to declare a structured automation.

```typescript
// In sandbox-types.d.ts
declare function automation(config: {
  condition?: (ctx: typeof context) => boolean;
  actions: (ctx: typeof context) => void | Promise<void>;
}): void;
```

The `automation()` function is wired in the sandbox bootstrap script. At runtime, it registers the condition and actions with the sandbox execution context. The trigger topic is configured separately in the pane UI (not in the code) — the `automation()` call only declares the condition/actions logic.

The default code template in the ScriptEditor will use this pattern:

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

### Pane Registry Changes

```typescript
// Remove these entries:
// - "automations-editor"
// - "automation-card"

// Add new entry:
"automation": {
  component: AutomationPane,
  displayName: "Automation",
  defaultIcon: "code",
  defaultConfig: { ruleId: "" },
  defaultSize: { w: 6, h: 5 },
  category: "automations",
}
```

### TabLayout Extension

The `TabLayout` component currently passes only `config` to pane components. The AutomationPane needs `paneId` for two reasons:
1. Calling `updatePaneConfig(paneId, ...)` to store the `ruleId` after creation.
2. Intercepting pane removal to send the DELETE request before the pane is removed.

The pane component interface will be extended to optionally receive `paneId`:

```typescript
// Updated PaneRegistryEntry component type
component: ComponentType<{ config: PaneConfig; paneId?: string }>;
```

For the delete cleanup, the `removePane` action in the dashboard store will be extended with an optional `onBeforeRemove` callback, or the AutomationPane will register a cleanup handler. The simplest approach: override the remove button behavior in TabLayout to call a pane-specific cleanup function before removal.

### API Changes

#### GET /api/automations/history

Add `ruleId` query parameter support to filter execution log entries by rule:

```
GET /api/automations/history?ruleId=abc-123&limit=5
```

The ExecutionLog already has `getByRuleId(ruleId)` — just wire it to the query parameter.

#### GET /api/automations (response extension)

For script rules that have structured metadata, include a `structured` field in the response:

```json
{
  "id": "abc-123",
  "name": "Temperature Alert",
  "topic": "sensor/+/temperature",
  "ruleType": "script",
  "scriptSource": "...",
  "structured": {
    "trigger": "sensor/+/temperature",
    "conditionText": "ctx.state.value > 30",
    "actionsText": "log.info(`Hot!`); devices.action(ctx.deviceId, 'alert');"
  }
}
```

If the script doesn't use the `automation()` helper, `structured` is `null`.

#### Database Schema Migration

Two new columns on `automation_rules`:

```sql
ALTER TABLE automation_rules ADD COLUMN structured_metadata TEXT DEFAULT NULL;
ALTER TABLE automation_rules ADD COLUMN ui_source TEXT DEFAULT NULL;
```

`structured_metadata` stores the JSON-serialized `StructuredMetadata` object. `ui_source` is for the future Custom UI feature (Requirement 14).

## Data Models

### AutomationRule (Extended)

```typescript
interface StoredRule {
  id: string;
  name: string;
  trigger_topic: string;
  condition_type: string | null;
  condition_value: string | null;
  action_type: string;
  action_target: string;
  action_params: string;           // JSON
  rule_type: "form" | "script";
  script_source: string | null;
  compiled_js: string | null;
  structured_metadata: string | null;  // NEW — JSON of StructuredMetadata
  ui_source: string | null;            // NEW — future Custom UI source
  enabled: number;                     // 0 or 1
  created_at: number;                  // Unix timestamp ms
}
```

### StructuredMetadata

```typescript
interface StructuredMetadata {
  trigger: string;                // The trigger topic (copied from rule for convenience)
  conditionText: string | null;   // Source text of the condition function body
  actionsText: string;            // Source text of the actions function body
}
```

### AutomationPaneConfig

```typescript
interface AutomationPaneConfig extends PaneConfig {
  ruleId: string;  // Empty string = setup mode, UUID = linked to rule
}
```

### AutomationFiredEvent (WebSocket)

Already exists in the system:

```typescript
interface AutomationFiredEvent {
  type: "automation-fired";
  data: {
    ruleId: string;
    ruleName: string;
    topic: string;
    deviceId: string;
    timestamp: number;
  };
}
```

### ExecutionLogEntry (Existing)

```typescript
interface ExecutionLogEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: "file" | "form" | "script";
  triggerTopic: string;
  actions: Array<{ type: string; target: string; success: boolean; error?: string }>;
  duration: number;
  timestamp: number;
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Save button reflects validation state

*For any* combination of automation name string and trigger topic string, the Save button SHALL be disabled if and only if either `name.trim() === ''` or `triggerTopic.trim() === ''`.

**Validates: Requirements 2.5**

### Property 2: Error panel displays all transpilation errors

*For any* array of `TranspileError` objects (each with line, column, and message), the error summary panel SHALL render every error's line number, column, and message text in the output.

**Validates: Requirements 8.3**

### Property 3: Structured metadata extraction round-trip

*For any* valid condition function body and actions function body, wrapping them in the `automation({ condition: (ctx) => { <conditionBody> }, actions: (ctx) => { <actionsBody> } })` pattern, transpiling, and extracting structured metadata SHALL produce a `StructuredMetadata` object where `conditionText` contains the condition body and `actionsText` contains the actions body.

**Validates: Requirements 11.3**

### Property 4: Free-form scripts produce null structured metadata

*For any* valid TypeScript automation script that does not contain an `automation()` call, the structured metadata extractor SHALL return `null`.

**Validates: Requirements 11.5**

### Property 5: Flow diagram renders all structured components

*For any* valid `StructuredMetadata` (with trigger topic, optional conditionText, and actionsText), the FlowDiagram SVG output SHALL contain a node displaying the trigger topic text and at least one node displaying the actions text. If conditionText is present, a condition node SHALL also be rendered.

**Validates: Requirements 12.2, 12.4**

### Property 6: Activity feed entry completeness

*For any* `ExecutionLogEntry` object, the rendered ActivityFeed entry SHALL display the entry's timestamp, each action's type and target, and a success or failure indicator matching the entry's action success status.

**Validates: Requirements 13.3**

## Error Handling

| Scenario | Handling |
|---|---|
| POST /api/automations returns 400 (transpilation error) | Display errors inline below ScriptEditor via `errors` prop. Show error summary panel. Remain in Setup Mode. |
| POST /api/automations returns 5xx or network error | Show toast notification with "Failed to save automation". Remain in Setup Mode. |
| PUT /api/automations/:id returns 400 (transpilation error) | Display errors inline below ScriptEditor. Show error summary panel. Remain in editing view. |
| PUT /api/automations/:id returns 5xx or network error | Show toast notification with "Failed to update automation". Remain in editing view. |
| GET /api/automations returns rule not found | Display "Rule not found" message with a "Reset" button to clear ruleId and return to Setup Mode. |
| GET /api/automations returns 5xx or network error | Display "Failed to load automation" with a "Retry" button. |
| DELETE /api/automations/:id fails on pane removal | Log warning to console. Allow pane removal to proceed — do not block the user. |
| PATCH /api/automations/:id/toggle fails | Revert toggle UI state. Show toast notification with "Failed to toggle automation". |
| WebSocket disconnects while in Status Mode | Gracefully degrade — last-fired timestamp stops updating but remains visible. Reconnect handled by existing WS client logic. |
| Structured metadata extraction fails (non-standard automation() usage) | Return null — fall back to Activity Feed in Status Mode. No error shown to user. |
| GET /api/automations/history fails | Show "Unable to load activity" in the Activity Feed area. Last-fired timestamp shows "—". |

## Testing Strategy

### Unit Tests

- **Pane registry**: Verify `automation` entry exists with correct fields, `automations-editor` and `automation-card` removed, `automation-rules` retained.
- **AutomationPane mode selection**: Render with empty ruleId → setup mode. Render with ruleId → status mode (mock API).
- **Save button validation**: Verify disabled state based on name/topic emptiness.
- **FlowDiagram rendering**: Verify SVG output contains correct node types and colors for given StructuredMetadata.
- **ActivityFeed rendering**: Verify entries display timestamp, actions, success/failure.
- **Error panel rendering**: Verify all errors listed with line/column/message.
- **StructuredMetadataExtractor**: Verify extraction from various automation() patterns and null return for free-form code.

### Property-Based Tests

Property-based testing applies to this feature for the pure logic and rendering components. Use `fast-check` as the PBT library (already available in the project's Vitest setup).

Each property test runs a minimum of 100 iterations and is tagged with the design property reference.

- **Property 1**: Generate random `{ name: string, topic: string }` pairs including empty strings, whitespace-only strings, and valid strings. Assert `isDisabled === (name.trim() === '' || topic.trim() === '')`.
  - Tag: `Feature: automation-pane, Property 1: Save button reflects validation state`

- **Property 2**: Generate random arrays of `{ line: number, column: number, message: string }` objects. Render the error panel. Assert every error's line, column, and message text appears in the rendered output.
  - Tag: `Feature: automation-pane, Property 2: Error panel displays all transpilation errors`

- **Property 3**: Generate random single-expression condition bodies and action bodies (valid JS expressions). Wrap in `automation()` template, transpile, extract metadata. Assert conditionText and actionsText contain the original fragments.
  - Tag: `Feature: automation-pane, Property 3: Structured metadata extraction round-trip`

- **Property 4**: Generate random valid free-form scripts (e.g., `log.info("...")`, `devices.get("...")`, variable assignments). Assert `extractStructuredMetadata()` returns null.
  - Tag: `Feature: automation-pane, Property 4: Free-form scripts produce null structured metadata`

- **Property 5**: Generate random StructuredMetadata objects with varying trigger topics, optional conditionText, and actionsText. Render FlowDiagram. Assert SVG contains trigger text, actions text, and conditional condition text.
  - Tag: `Feature: automation-pane, Property 5: Flow diagram renders all structured components`

- **Property 6**: Generate random ExecutionLogEntry objects. Render ActivityFeed entry. Assert timestamp, action type/target, and success/failure indicator are present.
  - Tag: `Feature: automation-pane, Property 6: Activity feed entry completeness`

### Integration Tests

- **Create automation flow**: POST to `/api/automations` with script source, verify rule created in DB, structured metadata extracted and stored.
- **Update automation flow**: PUT to `/api/automations/:id`, verify rule updated, re-transpiled, metadata re-extracted.
- **Delete automation flow**: DELETE to `/api/automations/:id`, verify rule removed from DB and engine.
- **Toggle automation**: PATCH to `/api/automations/:id/toggle`, verify enabled state toggled in DB and engine registration updated.
- **History endpoint filtering**: GET `/api/automations/history?ruleId=X&limit=5`, verify filtered results.
- **WebSocket automation-fired**: Verify `automation-fired` events broadcast with correct ruleId and timestamp.
