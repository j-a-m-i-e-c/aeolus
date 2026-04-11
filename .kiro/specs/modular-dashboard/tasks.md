# Implementation Plan: Modular Dashboard

## Overview

Replace Aeolus's hardcoded four-page navigation with a user-defined tab system. Each tab contains configurable Panes rendered via react-grid-layout. Backend persists layout to SQLite; frontend manages state in a separate Zustand Dashboard_Store. Implementation proceeds bottom-up: types → backend → store → registry → UI components → wiring.

## Tasks

- [x] 1. Define shared types and data models
  - [x] 1.1 Create shared Tab, Pane, PaneConfig, and LayoutPayload TypeScript interfaces
    - Create `frontend/src/types/dashboard.ts` with Tab, Pane, PaneConfig, LayoutPayload interfaces
    - Include Default_Layout seed data constants (DEFAULT_TABS, DEFAULT_PANES)
    - _Requirements: 1.2, 2.2, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.6, 8.1_

- [x] 2. Backend: SQLite schema and layout API
  - [x] 2.1 Add tabs and panes tables to SQLite schema
    - Add `tabs` and `panes` CREATE TABLE statements to `initSchema()` in `src/db/database.ts`
    - tabs: id, name, icon, "order", pinned, created_at
    - panes: id, tab_id (FK → tabs.id ON DELETE CASCADE), pane_type, config (JSON), x, y, w, h, created_at
    - _Requirements: 6.6, 8.1_

  - [x] 2.2 Implement layout routes (GET and PUT /api/layout)
    - Create `src/api/routes/layout.routes.ts` with `createLayoutRoutes(db)`
    - GET /api/layout: SELECT tabs + panes, deserialize JSON config, return `{ tabs, panes }`
    - PUT /api/layout: validate payload has tabs/panes arrays, DELETE all + INSERT all in transaction, return `{ success: true }`
    - Handle errors: 400 for invalid payload, 500 for DB failure, empty result on read failure
    - _Requirements: 6.1, 6.2, 6.6, 8.1, 8.2, 8.4_

  - [x] 2.3 Register layout routes in the Express app
    - Import and mount `createLayoutRoutes` in `src/index.ts` at `/api/layout`
    - _Requirements: 6.1, 6.2_

  - [ ]* 2.4 Write property test: Layout Serialization Round-Trip (Property 12)
    - **Property 12: Layout Serialization Round-Trip**
    - Use fast-check to generate random valid LayoutPayload objects (tabs + panes)
    - PUT then GET and verify equivalence of all fields
    - **Validates: Requirements 6.2, 8.1, 8.2, 8.3**

- [x] 3. Checkpoint — Backend layout API
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Frontend: Pane Registry
  - [x] 4.1 Create Pane_Registry module
    - Create `frontend/src/lib/pane-registry.ts`
    - Define PaneRegistryEntry interface (component, displayName, defaultIcon, defaultConfig, defaultSize)
    - Register all 8 Pane_Types: device-grid, sensor-panel, mqtt-inspector, hue-lights, automation-rules, system-stats, topic-tree, event-log
    - Each entry maps to a thin wrapper component that accepts `{ config: PaneConfig }` and renders the existing component
    - _Requirements: 4.1, 4.2, 4.3, 3.4_

  - [x] 4.2 Create Pane wrapper components
    - Create `frontend/src/components/panes/` directory with wrapper components for each Pane_Type
    - Each wrapper accepts `{ config: PaneConfig }` and passes relevant filters to the existing component
    - DeviceGridPane, SensorPanelPane, MqttInspectorPane, HueLightsPane, AutomationRulesPane, SystemStatsPane, TopicTreePane, EventLogPane
    - _Requirements: 3.2, 3.3, 3.5, 4.1, 4.2_

  - [ ]* 4.3 Write property test: Pane Registry Completeness (Property 10)
    - **Property 10: Pane Registry Completeness**
    - For every entry in PANE_REGISTRY, verify non-null component, non-empty displayName, non-empty defaultIcon, defined defaultConfig, positive defaultSize w and h
    - **Validates: Requirements 3.4, 4.1**

  - [ ]* 4.4 Write property test: Unknown Pane Type Produces Error Placeholder (Property 13)
    - **Property 13: Unknown Pane Type Produces Error Placeholder**
    - For any string not in PANE_REGISTRY keys, lookup returns undefined
    - **Validates: Requirements 4.4**

- [x] 5. Frontend: Dashboard Store
  - [x] 5.1 Create Dashboard_Store with tab and pane CRUD actions
    - Create `frontend/src/store/dashboard-store.ts` as a separate Zustand store
    - Implement state: tabs, panes, activeTabId, initialized
    - Implement tab actions: addTab, renameTab, reorderTabs, deleteTab, setActiveTab
    - Implement pane actions: addPane, updatePanePosition, updatePaneSize, updatePaneConfig, removePane
    - addTab rejects empty/whitespace-only names
    - deleteTab and reorderTabs skip pinned tabs
    - deleteTab cascades to remove associated panes
    - addPane uses Pane_Registry defaults for size and config
    - Every mutation triggers debounced persistLayout (2s)
    - _Requirements: 1.2, 1.4, 1.5, 1.7, 1.9, 2.2, 2.3, 2.4, 2.5, 3.3, 6.3_

  - [x] 5.2 Implement initialize() and persistLayout() for API integration
    - initialize(): GET /api/layout, if empty → load Default_Layout + PUT, else populate state
    - persistLayout(): debounced 2s, PUT /api/layout with full layout
    - Handle network failures gracefully (log warning, retry on next mutation)
    - _Requirements: 5.1, 5.6, 6.3, 6.4, 6.5_

  - [ ]* 5.3 Write property tests for tab operations (Properties 1-6)
    - **Property 1: Tab Creation Invariant** — addTab produces unique id, correct name/icon/order, count +1
    - **Validates: Requirements 1.2**
    - **Property 2: Tab Rename Preserves Identity** — renameTab changes only name, other fields unchanged
    - **Validates: Requirements 1.4**
    - **Property 3: Tab Reorder Produces Correct Sequence** — reorderTabs sets order = index in permutation
    - **Validates: Requirements 1.5, 1.8**
    - **Property 4: Tab Deletion Cascades to Panes** — deleteTab removes tab + associated panes, others unaffected
    - **Validates: Requirements 1.7, 6.6**
    - **Property 5: Empty Tab Names Are Rejected** — addTab with whitespace-only name does not create tab
    - **Validates: Requirements 1.9**
    - **Property 6: Pinned Tabs Cannot Be Deleted or Reordered** — deleteTab no-op on pinned, reorderTabs preserves pinned order
    - **Validates: Requirements 1.6, 1.7, 7.1**

  - [ ]* 5.4 Write property tests for pane operations (Properties 7-9)
    - **Property 7: Pane Addition With Registry Defaults** — addPane creates pane with registry defaults, count +1
    - **Validates: Requirements 2.2, 3.4**
    - **Property 8: Pane Field Updates Preserve Other Fields** — position/size/config updates only change targeted fields
    - **Validates: Requirements 2.3, 2.4, 3.3**
    - **Property 9: Pane Removal Decreases Count** — removePane reduces count by 1, others unaffected
    - **Validates: Requirements 2.5**

  - [ ]* 5.5 Write property test: Active Tab Selection (Property 11)
    - **Property 11: Active Tab Selection** — setActiveTab sets activeTabId, tabs/panes unchanged
    - **Validates: Requirements 7.3**

- [x] 6. Checkpoint — Store and registry
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Frontend: UI components
  - [-] 7.1 Update Sidebar to render dynamic tabs from Dashboard_Store
    - Render 3 pinned system tabs (Dashboard, Automations, System) at top in a fixed section
    - Render a visual separator line below pinned tabs
    - Render custom (non-pinned) tabs below the separator
    - Add "Add Tab" button at the bottom of the custom tab list
    - Support double-click to rename custom tabs (inline text input)
    - Support drag to reorder custom tabs
    - Support delete icon on custom tabs with confirmation prompt
    - Display each tab's icon next to its name
    - Highlight active tab with bg-elevated
    - Keep simulator toggle, MQTT status, WebSocket status at the bottom
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.8, 1.9, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [~] 7.2 Create TabLayout component with react-grid-layout
    - Create `frontend/src/components/TabLayout.tsx`
    - Read panes for active tabId from Dashboard_Store
    - Map each pane through Pane_Registry to resolve component
    - Render ResponsiveGridLayout from react-grid-layout
    - Handle drag/resize callbacks → updatePanePosition/updatePaneSize
    - Render error boundary placeholder for unknown pane types ("Unknown pane type: {type}")
    - Responsive grid adapts to viewport width
    - _Requirements: 2.3, 2.4, 2.6, 2.7, 4.3, 4.4_

  - [~] 7.3 Create PanePicker component
    - Create `frontend/src/components/PanePicker.tsx`
    - List all PANE_REGISTRY entries with displayName + icon
    - On select: call Dashboard_Store.addPane(tabId, paneType)
    - Add "Add Pane" button to TabLayout toolbar
    - _Requirements: 2.1, 2.2_

  - [~] 7.4 Create PaneConfigPanel component
    - Create `frontend/src/components/PaneConfigPanel.tsx`
    - Render form fields based on paneType (room filter for device-grid, topic pattern for mqtt-inspector, show/hide sections for system-stats)
    - Settings gear icon on each pane opens the config panel
    - On save: call Dashboard_Store.updatePaneConfig
    - Clearing all filters shows unfiltered data
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [~] 7.5 Add remove action to panes
    - Add close/remove icon to each pane header
    - On click: call Dashboard_Store.removePane(paneId)
    - _Requirements: 2.5_

- [ ] 8. Frontend: Wire everything together in App.tsx
  - [~] 8.1 Update App.tsx to use Dashboard_Store and TabLayout
    - Call Dashboard_Store.initialize() on mount
    - Replace currentPage routing with TabLayout rendering for the active tab
    - Keep global overlays: ToastContainer, CommandPalette, DeviceDetail modal
    - _Requirements: 6.4, 7.3_

  - [~] 8.2 Remove currentPage from device-store
    - Remove `currentPage` field and `setCurrentPage` action from `device-store.ts`
    - Remove all imports/references to currentPage/setCurrentPage from components
    - Navigation now driven entirely by Dashboard_Store.activeTabId
    - _Requirements: 7.1, 7.3_

  - [~] 8.3 Install react-grid-layout dependency
    - Add react-grid-layout and @types/react-grid-layout to frontend dependencies
    - Import required CSS for react-grid-layout
    - _Requirements: 2.6_

- [ ] 9. Final checkpoint — Full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (13 properties total)
- All code uses TypeScript — backend (Node.js/Express) and frontend (React/Vite)
- The project already uses fast-check for property-based testing (see `src/core/device-registry.property.test.ts`)
