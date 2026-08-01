# Requirements Document

## Introduction

The fail-closed WebSocket visibility work scoped device, automation, and MQTT live events to the tabs that surface each resource, but left Data Store events (`data-store-write`, `data-store-collection-deleted`) hard-coded admin-only, because no collection→tab authorization model existed. As a result, a non-admin viewing a collection on one of their tabs never receives its live updates.

This feature gives collections a collection→tab scope so their live events reach non-admins on the tabs that surface them — matching how automations derive tab ownership from a pane's `config.ruleId`. It introduces the missing surface: a **data-collection pane** whose `config.collection` names the collection it displays, a persisted collection→tab assignment derived from those panes, and a visibility resolver that scopes the Data Store events to the assigned tabs.

## Glossary

- **Collection**: A Data Store record collection, identified by its unique `name`.
- **Data_Collection_Pane**: A dashboard pane (`paneType: "data-collection"`) that displays one collection's recent records; its `config.collection` names that collection.
- **Collection_Tab_Assignment**: A persisted `{ collection_name → tab_id }` record stating that a tab surfaces a collection, derived from the Data_Collection_Panes on that tab.
- **Collection_Ownership_Store**: The backend store that persists and queries Collection_Tab_Assignments (mirror of the automation Resource_Ownership_Store).
- **Data_Store_Event**: A `data-store-write` or `data-store-collection-deleted` WebSocket event; its payload carries the `collection` name.
- **Exposing_Tabs**: The set of tab ids that surface a given collection.
- **Broadcast_Envelope**: The server-derived visibility (`public` / `admin` / `tabs`) the WsServer uses to decide recipients.

## Requirements

### Requirement 1: A pane that surfaces a collection

**User Story:** As a user, I want a pane that displays a Data Store collection, so that a collection can appear on a tab and its live updates have a home.

#### Acceptance Criteria

1. THERE SHALL be a `data-collection` pane type whose `config.collection` names the Collection it displays.
2. THE Data_Collection_Pane SHALL display the collection's recent records and update live as new records are written to that collection.
3. WHEN `config.collection` is empty or names no existing collection, THE pane SHALL render an unobtrusive empty/prompt state rather than an error.
4. THE pane's collection SHALL be editable through the existing pane configuration panel.

### Requirement 2: Collection→tab assignments derived from panes

**User Story:** As the platform, I want to know which tabs surface which collections, so that I can authorize collection events by tab.

#### Acceptance Criteria

1. THE system SHALL derive Collection_Tab_Assignments from the Data_Collection_Panes in the saved layout: a pane contributes `{ config.collection → its tabId }` only when `config.collection` is a non-empty string.
2. WHEN the layout is saved, THE system SHALL reconcile the stored Collection_Tab_Assignments to exactly match the assignments derived from the new layout, in the same transaction as the layout write.
3. THE Collection_Ownership_Store SHALL return the Exposing_Tabs for a collection, and an empty set for a collection that no pane surfaces.
4. Non-`data-collection` panes SHALL contribute no Collection_Tab_Assignment.

### Requirement 3: Scope Data Store events to exposing tabs

**User Story:** As a non-admin, I want live updates for a collection shown on a tab I can access, so that the pane stays current without admin rights.

#### Acceptance Criteria

1. WHEN a Data_Store_Event is broadcast, THE system SHALL derive its Broadcast_Envelope as `tabs` scoped to the collection's Exposing_Tabs.
2. WHEN a collection has no Exposing_Tabs, THE Data_Store_Event SHALL reach admins only (fail-closed), preserving current behaviour for unsurfaced collections.
3. WHEN a non-admin client can access at least one of a collection's Exposing_Tabs, THE client SHALL receive that collection's Data_Store_Events.
4. THE collection name used for scoping SHALL be taken from the server-side event payload, never from client input.
5. Admins SHALL continue to receive all Data_Store_Events.

### Requirement 4: No regression to existing behaviour

**User Story:** As a maintainer, I want the change to be additive, so that existing deployments are unaffected until they add a Data_Collection_Pane.

#### Acceptance Criteria

1. WHILE no Data_Collection_Pane references a collection, that collection's Data_Store_Events SHALL remain admin-only, exactly as today.
2. THE change SHALL NOT alter the Data Store REST endpoints or their existing authorization.
3. Removing or re-pointing a Data_Collection_Pane and saving the layout SHALL update the collection's Exposing_Tabs accordingly on the next event.

### Requirement 5: Tested

#### Acceptance Criteria

1. THERE SHALL be unit tests for the Collection_Ownership_Store (assignment round-trip, reconciliation, empty result) and the collection-assignment extractor (only `data-collection` panes with a non-empty `config.collection` contribute).
2. THERE SHALL be a test proving a Data_Store_Event resolves to a `tabs` envelope for a surfaced collection and to admin-only for an unsurfaced collection.
