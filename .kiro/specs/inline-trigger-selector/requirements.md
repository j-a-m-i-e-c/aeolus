# Requirements Document

## Introduction

The Inline Trigger Selector replaces the current plain-text trigger topic input in the Automation Pane with a structured trigger type selector. Users can choose between an MQTT topic subscription, a cron schedule (with presets), or no trigger (manual-only). Cron expressions are stored directly on the automation rule and managed by the AutomationEngine via per-rule timers, avoiding coupling to the standalone Cron Service.

## Glossary

- **Trigger_Selector**: The UI component that allows users to choose a trigger type and configure its parameters within the Automation Pane setup section.
- **AutomationEngine**: The backend rule evaluation engine that listens for events, matches rules by topic pattern, and executes rule actions.
- **Automation_Rule**: A persisted record in the `automation_rules` database table representing a user-created automation.
- **Cron_Timer**: A per-rule timer managed by the AutomationEngine that fires synthetic events based on a cron expression stored on the Automation_Rule.
- **Trigger_Type**: An enumerated value indicating how an automation is triggered — one of `mqtt`, `cron`, or `none`.
- **Cron_Expression**: A standard five-field cron string (minute, hour, day-of-month, month, day-of-week) defining a recurring schedule.
- **Preset**: A predefined cron expression with a human-readable label offered as a quick-select option in the Trigger_Selector.
- **MQTT_Topic**: A slash-delimited topic string supporting `+` (single-level) and `#` (multi-level) wildcards for event subscription.

## Requirements

### Requirement 1: Trigger Type Selection UI

**User Story:** As a user creating an automation, I want to choose between MQTT topic, Cron schedule, or No trigger, so that I can configure the appropriate trigger mechanism without manually typing service topic paths.

#### Acceptance Criteria

1. THE Trigger_Selector SHALL display three mutually exclusive options: "MQTT Topic", "Schedule", and "None".
2. WHEN the user selects "MQTT Topic", THE Trigger_Selector SHALL display a text input for entering an MQTT_Topic pattern.
3. WHEN the user selects "Schedule", THE Trigger_Selector SHALL display a cron configuration interface with Preset options and a custom Cron_Expression input.
4. WHEN the user selects "None", THE Trigger_Selector SHALL hide all trigger configuration inputs.
5. THE Trigger_Selector SHALL default to "MQTT Topic" for new automations to preserve backward compatibility with the current workflow.

### Requirement 2: Cron Preset Selection

**User Story:** As a user, I want to pick from common schedule presets so that I can quickly configure time-based triggers without memorizing cron syntax.

#### Acceptance Criteria

1. WHEN the user selects "Schedule" trigger type, THE Trigger_Selector SHALL display the following Preset options: "Every 1 minute", "Every 5 minutes", "Every 15 minutes", "Every 30 minutes", "Every hour", "Every 6 hours", "Every 12 hours", "Daily at midnight", and "Custom".
2. WHEN the user selects a Preset other than "Custom", THE Trigger_Selector SHALL populate the Cron_Expression field with the corresponding cron string.
3. WHEN the user selects "Custom", THE Trigger_Selector SHALL allow free-text entry of a Cron_Expression.
4. THE Trigger_Selector SHALL display the resolved Cron_Expression in a read-only preview when a Preset is selected.

### Requirement 3: Cron Expression Validation

**User Story:** As a user, I want immediate feedback on invalid cron expressions so that I can correct mistakes before saving.

#### Acceptance Criteria

1. WHEN the user enters or selects a Cron_Expression, THE Trigger_Selector SHALL validate the expression against standard five-field cron syntax.
2. IF the Cron_Expression is invalid, THEN THE Trigger_Selector SHALL display an inline error message describing the issue.
3. IF the Cron_Expression is invalid, THEN THE Trigger_Selector SHALL disable the save action for the automation.
4. WHEN the Cron_Expression is valid, THE Trigger_Selector SHALL display a human-readable description of the schedule (e.g., "Runs every 5 minutes").

### Requirement 4: Database Schema Extension

**User Story:** As a developer, I want the automation rule schema to store trigger type and cron expression so that the system can persist and restore trigger configurations.

#### Acceptance Criteria

1. THE Automation_Rule table SHALL include a `trigger_type` column of type TEXT with allowed values "mqtt", "cron", or "none", defaulting to "mqtt".
2. THE Automation_Rule table SHALL include a `cron_expression` column of type TEXT, nullable, storing the five-field cron string when Trigger_Type is "cron".
3. WHEN Trigger_Type is "mqtt", THE Automation_Rule SHALL store the MQTT_Topic in the existing `trigger_topic` column.
4. WHEN Trigger_Type is "none", THE Automation_Rule SHALL store an empty string in `trigger_topic` and NULL in `cron_expression`.
5. THE database migration SHALL preserve existing rows by defaulting `trigger_type` to "mqtt" for all pre-existing Automation_Rules.

### Requirement 5: API Contract Extension

**User Story:** As a frontend developer, I want the automation API to accept and return trigger type and cron expression fields so that the UI can persist user selections.

#### Acceptance Criteria

1. WHEN creating an automation via POST /api/automations, THE API SHALL accept `triggerType` (string: "mqtt" | "cron" | "none") and `cronExpression` (string, optional) in the request body.
2. WHEN `triggerType` is "cron" and `cronExpression` is missing or invalid, THE API SHALL return HTTP 400 with a descriptive error message.
3. WHEN listing automations via GET /api/automations, THE API SHALL include `triggerType` and `cronExpression` fields in each rule response object.
4. WHEN updating an automation via PUT /api/automations/:id, THE API SHALL accept updated `triggerType` and `cronExpression` values.
5. THE API SHALL validate that `cronExpression` conforms to five-field cron syntax before persisting.

### Requirement 6: Engine-Managed Cron Timers

**User Story:** As a user, I want my cron-triggered automations to fire automatically at the scheduled times without configuring the separate Cron Service.

#### Acceptance Criteria

1. WHEN an Automation_Rule with Trigger_Type "cron" is registered, THE AutomationEngine SHALL create a Cron_Timer using the stored Cron_Expression.
2. WHEN a Cron_Timer fires, THE AutomationEngine SHALL execute the associated rule's action with a synthetic event context containing the rule ID, cron expression, and fire timestamp.
3. WHEN an Automation_Rule with Trigger_Type "cron" is unregistered or disabled, THE AutomationEngine SHALL stop and dispose of the associated Cron_Timer.
4. WHEN the AutomationEngine starts, THE AutomationEngine SHALL create Cron_Timers for all enabled Automation_Rules with Trigger_Type "cron".
5. WHEN a Cron_Timer fails to initialize due to an invalid expression, THE AutomationEngine SHALL log a warning and skip the rule without affecting other rules.

### Requirement 7: Trigger Type Editing

**User Story:** As a user, I want to change the trigger type of an existing automation so that I can switch between MQTT, schedule, and manual triggers after creation.

#### Acceptance Criteria

1. WHEN the user enters editing mode for an existing automation, THE Trigger_Selector SHALL display the current Trigger_Type and its configuration.
2. WHEN the user changes the Trigger_Type from "cron" to another type, THE AutomationEngine SHALL stop the existing Cron_Timer for that rule upon save.
3. WHEN the user changes the Trigger_Type to "cron" from another type, THE AutomationEngine SHALL create a new Cron_Timer for that rule upon save.
4. THE Trigger_Selector SHALL allow changing Trigger_Type in editing mode using the same interface as creation mode.

### Requirement 8: Backward Compatibility

**User Story:** As an existing user, I want my current automations to continue working without modification after this feature is deployed.

#### Acceptance Criteria

1. THE system SHALL treat all pre-existing Automation_Rules (those without an explicit `trigger_type` value) as Trigger_Type "mqtt".
2. THE AutomationEngine SHALL continue to match MQTT-triggered rules using the existing `topicMatches()` logic without modification.
3. THE Automation_Rule table migration SHALL be non-destructive, adding new columns with defaults that preserve current behavior.
4. WHEN an automation has an empty `trigger_topic` and no `trigger_type` column value, THE system SHALL treat the automation as Trigger_Type "none" (manual-only), matching current behavior.
