# Requirements Document

## Introduction

This feature uplifts the Philips Hue connector to properly detect and handle different light types (color, color temperature, dimmable, on/off), adds missing action types for color and color temperature control, enables adding new lights via Zigbee search directly from Aeolus, and updates the frontend pane to show capability-appropriate controls. The uplift preserves full backward compatibility with existing automations and the pairing wizard.

## Glossary

- **Hue_Connector**: The Aeolus connector module responsible for communicating with the Philips Hue bridge via its local HTTP API
- **Hue_Bridge**: The physical Philips Hue bridge device that controls Zigbee-connected lights on the local network
- **Light_Type**: The classification string returned by the Hue bridge API identifying a light's capabilities (e.g., "Extended color light", "Color temperature light", "Dimmable light", "On/Off plug-in unit", "On/Off light")
- **Capability_Set**: The set of control features available for a given light, derived from its Light_Type
- **Mirek**: The color temperature unit used by the Hue bridge API, ranging from 153 (6500K cold) to 500 (2000K warm)
- **Color_Mode**: The active color mode of a light as reported by the bridge: "hs" (hue/saturation), "ct" (color temperature), or "xy" (CIE color space)
- **Gamut_Type**: The color gamut classification (A, B, or C) defining the range of colors a light can reproduce
- **Zigbee_Search**: The process of instructing the Hue bridge to scan for new Zigbee devices on its network
- **Device_State**: The state record stored for each device in the Aeolus device registry
- **HueControlPane**: The frontend React component that renders Hue light controls on the dashboard
- **Archetype**: The Hue bridge's classification of a light's physical form factor (e.g., "sultanbulb", "floodlight", "spot")

## Requirements

### Requirement 1: Light Type Detection

**User Story:** As a user, I want Aeolus to detect what type each Hue light is, so that I only see controls relevant to that light's actual capabilities.

#### Acceptance Criteria

1. WHEN the Hue_Connector discovers lights from the Hue_Bridge, THE Hue_Connector SHALL read the `type` field from each light and map it to a Capability_Set
2. WHEN a light has type "Extended color light", THE Hue_Connector SHALL assign the Capability_Set: on/off, brightness, color, color-temperature
3. WHEN a light has type "Color temperature light", THE Hue_Connector SHALL assign the Capability_Set: on/off, brightness, color-temperature
4. WHEN a light has type "Dimmable light", THE Hue_Connector SHALL assign the Capability_Set: on/off, brightness
5. WHEN a light has type "On/Off plug-in unit" or "On/Off light", THE Hue_Connector SHALL assign the Capability_Set: on/off
6. WHEN a light has an unrecognized type, THE Hue_Connector SHALL assign the Capability_Set: on/off, brightness (safe default)

### Requirement 2: Enhanced Device State

**User Story:** As a user, I want to see detailed state information for each Hue light, so that the UI and automations can make informed decisions based on current light status.

#### Acceptance Criteria

1. WHEN the Hue_Connector discovers or polls a light, THE Hue_Connector SHALL include in the Device_State: `on`, `brightness`, `reachable`, `type`, `modelId`, `manufacturer`, and `archetype`
2. WHEN a light supports color (Capability_Set includes "color"), THE Hue_Connector SHALL include in the Device_State: `hue`, `saturation`, `colorMode`, and `gamutType`
3. WHEN a light supports color-temperature (Capability_Set includes "color-temperature"), THE Hue_Connector SHALL include in the Device_State: `ct`, `ctMin`, and `ctMax`
4. WHEN a light does not support color, THE Hue_Connector SHALL omit `hue`, `saturation`, `colorMode`, and `gamutType` from the Device_State
5. WHEN a light does not support color-temperature, THE Hue_Connector SHALL omit `ct`, `ctMin`, and `ctMax` from the Device_State

### Requirement 3: Color Control Action

**User Story:** As a user, I want to set my color-capable Hue lights to specific colors, so that I can create the ambiance I want.

#### Acceptance Criteria

1. WHEN a "color" action is received for a light with "color" in its Capability_Set, THE Hue_Connector SHALL send `{ hue, sat }` values to the Hue_Bridge light state endpoint
2. WHEN a "color" action is received for a light without "color" in its Capability_Set, THE Hue_Connector SHALL reject the action with a descriptive error indicating the light does not support color
3. THE Hue_Connector SHALL accept hue values in the range 0–65535 and saturation values in the range 0–254
4. IF a "color" action contains hue or saturation values outside the valid range, THEN THE Hue_Connector SHALL clamp the values to the valid range before sending to the Hue_Bridge

### Requirement 4: Color Temperature Control Action

**User Story:** As a user, I want to adjust the color temperature of my lights from warm to cool, so that I can match the lighting to the time of day or activity.

#### Acceptance Criteria

1. WHEN a "color-temp" action is received for a light with "color-temperature" in its Capability_Set, THE Hue_Connector SHALL send `{ ct }` (Mirek value) to the Hue_Bridge light state endpoint
2. WHEN a "color-temp" action is received for a light without "color-temperature" in its Capability_Set, THE Hue_Connector SHALL reject the action with a descriptive error indicating the light does not support color temperature
3. THE Hue_Connector SHALL accept ct values within the light's reported ctMin–ctMax range
4. IF a "color-temp" action contains a ct value outside the light's ctMin–ctMax range, THEN THE Hue_Connector SHALL clamp the value to the light's supported range before sending to the Hue_Bridge

### Requirement 5: Zigbee Light Search

**User Story:** As a user, I want to search for and add new Hue lights directly from Aeolus, so that I do not need to open the Hue app every time I add a new bulb.

#### Acceptance Criteria

1. WHEN a Zigbee_Search is initiated, THE Hue_Connector SHALL send a POST request to `/api/{key}/lights` on the Hue_Bridge to start the pairing scan
2. WHILE a Zigbee_Search is in progress, THE Hue_Connector SHALL poll `GET /api/{key}/lights/new` on the Hue_Bridge at regular intervals to check for newly discovered lights
3. WHEN the Zigbee_Search completes (approximately 40 seconds), THE Hue_Connector SHALL trigger a full device discovery to incorporate any newly found lights into the Aeolus device registry
4. WHEN the Hue_Bridge returns newly discovered lights from the search, THE Hue_Connector SHALL include the count and names of new lights in the search result
5. IF the Zigbee_Search POST request fails, THEN THE Hue_Connector SHALL return a descriptive error indicating the search could not be started

### Requirement 6: Frontend Capability-Based Controls

**User Story:** As a user, I want the Hue control pane to show only the controls my lights actually support, so that the interface is clean and not confusing.

#### Acceptance Criteria

1. WHEN a light has only "on/off" in its Capability_Set, THE HueControlPane SHALL display only a toggle button for that light
2. WHEN a light has "brightness" in its Capability_Set, THE HueControlPane SHALL display a toggle button and a brightness slider for that light
3. WHEN a light has "color-temperature" in its Capability_Set, THE HueControlPane SHALL display a color temperature slider (warm to cool) in addition to toggle and brightness controls
4. WHEN a light has "color" in its Capability_Set, THE HueControlPane SHALL display a color picker in addition to toggle, brightness, and color temperature controls
5. WHEN a light's `reachable` state is false, THE HueControlPane SHALL visually indicate the light is unreachable (greyed out appearance)
6. THE HueControlPane SHALL display the light type and model information in each light card

### Requirement 7: Search for New Lights UI

**User Story:** As a user, I want a button in the Hue pane to search for new lights, so that I can easily add new bulbs without leaving Aeolus.

#### Acceptance Criteria

1. THE HueControlPane SHALL display a "Search for new lights" button accessible from the Hue pane
2. WHEN the user initiates a light search, THE HueControlPane SHALL display a progress indicator showing the approximate remaining time (countdown from ~40 seconds)
3. WHEN the search completes and new lights are found, THE HueControlPane SHALL display the names of newly discovered lights
4. WHEN the search completes and no new lights are found, THE HueControlPane SHALL display a message indicating no new lights were discovered
5. WHILE a Zigbee_Search is in progress, THE HueControlPane SHALL disable the search button to prevent duplicate searches

### Requirement 8: Backward Compatibility

**User Story:** As a user with existing automations, I want the connector upgrade to preserve all existing behavior, so that my setup continues to work without changes.

#### Acceptance Criteria

1. THE Hue_Connector SHALL continue to support the "toggle" action type with identical behavior to the current implementation
2. THE Hue_Connector SHALL continue to support the "brightness" action type with identical behavior to the current implementation
3. THE Hue_Connector SHALL continue to support the existing bridge discovery and button-press pairing setup steps without modification
4. WHEN the Hue_Connector upgrades and re-discovers existing lights, THE Hue_Connector SHALL preserve the same device ID format (`hue-light-{index}`) for previously discovered lights
5. THE Hue_Connector SHALL continue to expose the same connector metadata, config schema, and snippet interfaces without breaking changes

### Requirement 9: Light Groups (Optional)

**User Story:** As a user, I want to see and control my Hue light groups/rooms, so that I can manage multiple lights together as the Hue app organizes them.

#### Acceptance Criteria

1. WHERE the groups feature is enabled, THE Hue_Connector SHALL fetch group information from `GET /api/{key}/groups` on the Hue_Bridge
2. WHERE the groups feature is enabled, THE Hue_Connector SHALL expose group membership as metadata on each light's Device_State
3. WHERE the groups feature is enabled, THE Hue_Connector SHALL support a "group-action" action type that applies toggle, brightness, color, or color-temp actions to all lights in a specified group

### Requirement 10: Scenes (Optional)

**User Story:** As a user, I want to activate predefined Hue scenes from Aeolus, so that I can quickly set up lighting moods without configuring each light individually.

#### Acceptance Criteria

1. WHERE the scenes feature is enabled, THE Hue_Connector SHALL fetch available scenes from `GET /api/{key}/scenes` on the Hue_Bridge
2. WHERE the scenes feature is enabled, THE Hue_Connector SHALL provide a list of available scenes with their names and associated group
3. WHERE the scenes feature is enabled, WHEN a "scene" action is received, THE Hue_Connector SHALL activate the specified scene on the Hue_Bridge by sending a PUT request to the appropriate group endpoint

### Requirement 11: Prerequisites and Scope Documentation

**User Story:** As a new user setting up Hue lights with Aeolus, I want clear guidance on what I need to do before Aeolus can control my lights, so that I don't waste time troubleshooting things that are outside Aeolus's control.

#### Acceptance Criteria

1. THE Hue_Connector setup wizard (bridge discovery step) SHALL display a brief prerequisites section explaining what the user needs before proceeding:
   - A Philips Hue bridge powered on and connected to the same LAN
   - New lights powered on and within Zigbee range of the bridge (Aeolus can pair them)
   - The bridge must be reachable from the device running Aeolus (same subnet or routable)
2. THE Hue_Connector setup wizard SHALL clearly state what Aeolus handles:
   - Discovers the bridge automatically on the local network
   - Pairs with the bridge via the link button (no Hue app needed)
   - Searches for and pairs new unpaired lights via Zigbee scan (no Hue app needed)
   - Controls all lights on the bridge (toggle, brightness, color, color temperature)
   - Polls for state changes every 60 seconds
3. THE Hue_Connector setup wizard SHALL clearly state what Aeolus does NOT handle:
   - Factory-resetting a light that is already paired to a different bridge (requires the Hue app or a Zigbee touchlink reset device)
   - Firmware updates to lights or the bridge (use the Hue app)
   - Creating or editing Hue Entertainment zones (use the Hue app)
4. THE comprehensive documentation (`docs/COMPREHENSIVE_DOCUMENTATION.md`) SHALL include a "Hue Connector Prerequisites" subsection in the Hue Connector section documenting the full scope of what Aeolus does and does not handle
5. THE connector module's description field in its metadata SHALL be updated to mention that lights must be on the bridge before Aeolus can control them, or use the built-in search feature to add new ones

### Requirement 12: Firmware Update Awareness

**User Story:** As a user, I want Aeolus to tell me when firmware updates are available for my Hue system, so that I can keep things up to date without manually checking the Hue app.

#### Acceptance Criteria

1. WHEN the Hue_Connector connects to or polls the Hue_Bridge, THE Hue_Connector SHALL read the `swupdate2` object from `GET /api/{key}/config` to determine if updates are available
2. WHEN the bridge reports updates are available (state is "anyreadytoinstall" or "allreadytoinstall"), THE Hue_Connector SHALL include an `updatesAvailable: true` flag and an `updateType` field ("bridge", "lights", or "both") in its connector health status, derived from the `swupdate2.bridge.state` and `swupdate2.state` fields
3. WHEN updates are available, THE HueControlPane SHALL display a non-intrusive banner indicating what needs updating (e.g. "Bridge firmware update available" or "Light updates available") with a note to open the Hue app to install
4. THE firmware update banner SHALL NOT block normal operation — it is informational only
5. WHEN no updates are available, THE Hue_Connector SHALL NOT display any update-related UI
