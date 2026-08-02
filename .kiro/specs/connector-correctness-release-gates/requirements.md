# Requirements Document

## Introduction

The core Aeolus platform reached a strong pre-promotion state: resource
authorization, scoped automation authority, event admission, command-source
typing, MQTT command wiring, pane-deletion semantics, layout permissions and
partial automation updates are all in place. A fresh review (2 Aug 2026,
`docs/aeolus-v11-fresh-review-2026-08-02.md`) found that the remaining public
release risk has moved outward into the **bundled Hue and Kasa connectors**:
several controls are advertised by device capabilities or the UI but are
rejected or executed incorrectly by the connector, plus a long-running Kasa
listener leak and device identifiers that do not satisfy the documented
multi-instance guarantee.

These are high-embarrassment-risk bugs because a reviewer encounters them by
clicking ordinary controls. This feature brings the older Hue and Kasa adapters
into conformance with the newer, stricter Action Catalog and multi-instance
contracts, and adds the production-composition integration coverage that would
have caught them. It is scoped to connector correctness and identity; it does
not change the core command boundary, authorization model or sandbox.

## Glossary

- **Connector**: An Aeolus module that discovers and controls a class of local
  devices (Hue, Kasa) and conforms to `src/connectors/connector.interface.ts`.
- **Action_Catalog**: The set of `CapabilityDescriptor` objects that describe
  which actions a device accepts and their parameter schemas. Resolved by
  `ActionRouter` from, in order: the owning connector instance's
  `getActionCatalog()`, the connector module's `getActionCatalog()`, then the
  `CAPABILITY_ACTION_MAP` fallback.
- **Capability_Action_Map**: The fallback map in
  `src/connectors/capability-action-map.ts` from capability strings to
  descriptors, used only when a connector provides no explicit catalog.
- **Kasa_Power_State**: The boolean on/off state of a Kasa device, held under
  `sysInfo.relay_state` for plugs/switches and `sysInfo.light_state.on_off`
  for bulbs.
- **Hue_Native_Brightness**: The Hue bridge brightness scale, an integer
  `bri` in the range 0–254.
- **Canonical_Brightness**: The Aeolus platform brightness representation, an
  integer percentage in the range 0–100, used by the command contract.
- **Device_Identity**: The `Device.id` string used as the key in the global
  `DeviceRegistry`. Must be globally unique and stable across polls and across
  multiple connector instances.
- **Connector_Instance**: One configured, enabled instance of a connector
  (e.g. one Hue bridge, one Kasa network), identified by
  `connectorInstanceId`.
- **DeviceDetail**: The generic frontend device pane
  (`frontend/src/components/DeviceDetail.tsx`) that renders capability-driven
  controls for any device.
- **Production_Composition**: The dependency graph wired in `src/index.ts`, as
  opposed to the hand-wired graphs used in unit tests.

## Requirements

### Requirement 1: Correct Kasa power-state extraction

**User Story:** As a user with a Kasa plug or bulb, I want Aeolus to show the
correct on/off state, so that a physically-on device is never shown as off and I
never accidentally switch it off by pressing a toggle that thought it was off.

#### Acceptance Criteria

1. THE KasaConnector SHALL resolve Kasa_Power_State through a single canonical
   helper used by both discovery and action execution.
2. WHEN a Kasa device reports `light_state` (a bulb), THE KasaConnector SHALL
   derive on/off from `light_state.on_off === 1`.
3. WHEN a Kasa device reports no `light_state` but reports `relay_state` (a
   plug/switch), THE KasaConnector SHALL derive on/off from `relay_state === 1`.
4. WHEN a plug reports `relay_state: 1` and no `light_state`, THE KasaConnector
   SHALL report `on: true`.
5. WHEN a bulb reports `light_state.on_off: 1`, THE KasaConnector SHALL report
   `on: true` regardless of `relay_state`.
6. WHEN a `toggle` action is executed against any Kasa device, THE
   KasaConnector SHALL compute the next power state from the same canonical
   Kasa_Power_State helper rather than from `relay_state` alone.
7. IF neither `relay_state` nor `light_state.on_off` is present, THEN THE
   KasaConnector SHALL report `on: false`.

### Requirement 2: Truthful Kasa Action_Catalog

**User Story:** As a user, I want the Kasa controls I see to be the ones the
connector can actually perform, so that pressing a brightness slider or reading
energy does not silently fail or mislead me.

#### Acceptance Criteria

1. THE KasaConnector SHALL provide an explicit `getActionCatalog(deviceId)` that
   returns only descriptors for actions the connector implements for that
   device.
2. THE Kasa Action_Catalog SHALL include `toggle`, `on` and `off` for every
   Kasa device.
3. WHERE the KasaConnector does not implement brightness control, THE Kasa
   Action_Catalog SHALL NOT advertise a `brightness` action, and the connector
   SHALL NOT register the `brightness` capability that causes the
   Capability_Action_Map to advertise it.
4. WHERE the KasaConnector does not implement energy reading, THE Kasa
   Action_Catalog SHALL NOT advertise a `read-energy` action, and the connector
   SHALL NOT register the `energy-monitoring` capability that causes the
   Capability_Action_Map to advertise it.
5. WHEN `DeviceDetail` renders a Kasa device, THE frontend SHALL only display a
   control when the device's Action_Catalog contains the corresponding action.
6. IF a future Kasa capability (brightness, energy) is implemented, THEN it
   SHALL be added to both the connector's `execute()` and its
   `getActionCatalog()` in the same change so advertisement and behaviour stay
   in step.

### Requirement 3: Bounded Kasa discovery listeners

**User Story:** As an operator running Aeolus for a long time, I want Kasa
discovery to not leak event listeners, so that the process does not emit max-
listener warnings, duplicate device processing, or grow memory over days of
polling.

#### Acceptance Criteria

1. THE KasaConnector SHALL NOT accumulate `device-new` or `device-online`
   listeners across repeated `discoverDevices()` calls.
2. WHEN a discovery scan completes (success, timeout or error), THE
   KasaConnector SHALL remove any scan-local listeners it registered for that
   scan.
3. WHEN `discoverDevices()` is called repeatedly (e.g. once per 60-second poll
   cycle), THE number of registered `device-new` and `device-online` listeners
   on the underlying client SHALL remain constant.
4. THE KasaConnector SHALL preserve current discovery behaviour: devices found
   on a scan are still mapped, de-duplicated within the scan, and returned.

### Requirement 4: Explicit truthful Hue Action_Catalog

**User Story:** As a user, I want every Hue control the UI shows me — color
temperature, rename, delete, on and off — to actually work, so that ordinary
clicks are not rejected before the connector runs.

#### Acceptance Criteria

1. THE HueConnector SHALL provide an explicit `getActionCatalog(deviceId)`
   generated from the device's `CapabilitySet` plus the bridge-management
   actions the connector implements.
2. WHEN a Hue light has the `color-temperature` capability, THE Hue
   Action_Catalog SHALL advertise a `color-temp` action whose parameter schema
   matches what `HueConnector.execute()` accepts, so the action reaches the
   connector.
3. THE Hue Action_Catalog SHALL advertise `rename` and `delete` actions for Hue
   lights, because `HueConnector.execute()` implements them and
   `HueControlPane` exposes them.
4. THE Hue Action_Catalog SHALL advertise `on` and `off` actions, AND
   `HueConnector.execute()` SHALL implement explicit `on` and `off` cases (not
   only `toggle`).
5. WHEN an action is present in the Hue Action_Catalog, THE ActionRouter SHALL
   NOT reject it as unsupported before `HueConnector.execute()` is invoked.
6. THE Hue Action_Catalog SHALL NOT advertise an action the connector does not
   implement.

### Requirement 5: Consistent Hue brightness units end-to-end

**User Story:** As a user adjusting a Hue light's brightness from the generic
device pane, I want the slider value to be applied correctly, so that setting
50% actually produces 50% and the control is never rejected by validation.

#### Acceptance Criteria

1. THE Aeolus platform SHALL use Canonical_Brightness (0–100) as the single
   brightness representation for both the command contract and normalized
   device state.
2. WHEN the HueConnector extracts device state, THE stored `brightness` field
   SHALL be Canonical_Brightness (0–100), converted from Hue_Native_Brightness
   at the connector boundary.
3. WHEN the HueConnector executes a `brightness` action, THE connector SHALL
   accept Canonical_Brightness (0–100) and translate it to Hue_Native_Brightness
   (0–254) only at the Hue API call.
4. WHEN `DeviceDetail` renders a brightness slider, THE slider range SHALL be
   0–100 and the value sent SHALL be Canonical_Brightness.
5. THE Hue connector snippets and examples SHALL describe and send
   Canonical_Brightness (0–100), not 0–254.
6. WHEN `ActionRouter` applies an optimistic state update for a `brightness`
   action, THE resulting `brightness` value SHALL remain in the
   Canonical_Brightness representation the pane interprets, so state does not
   visibly jump.

### Requirement 6: Globally unique, stable connector Device_Identity

**User Story:** As an operator running two Hue bridges or two Kasa networks, I
want each device to keep a stable, unique identity, so that devices from
different instances never collide in the registry and commands are never routed
to the wrong instance.

#### Acceptance Criteria

1. THE HueConnector SHALL derive Device_Identity from an immutable native
   identity (the Hue light's `uniqueid`, or the bridge id combined with the
   native light id) rather than the bridge-local light index alone.
2. THE KasaConnector SHALL derive Device_Identity from an immutable native
   identity (the device id / MAC) rather than the user-editable alias.
3. WHEN a Kasa device is renamed, THE Device_Identity SHALL NOT change.
4. WHEN two Connector_Instances each expose a device, THE two devices SHALL
   have distinct Device_Identity values and SHALL NOT overwrite each other in
   the `DeviceRegistry`.
5. THE Device display name SHALL be kept separate from Device_Identity.
6. **No migration is required.** Aeolus has no production users yet, so the
   change to the identity scheme MAY change existing device IDs without
   preserving them. Existing panes, automations, `automation_tab_assignments`
   and stored device state that reference the old IDs are acceptable collateral:
   they are re-created by re-discovery / re-authoring and do not need a migration
   path. Do not add migration machinery for this change.
7. Because the identity change is applied directly, the multi-instance
   independence claim in `docs/reference/connectors.md` SHALL be kept accurate
   for the new scheme (it holds once IDs derive from immutable native identity);
   no known-limitation downgrade is needed.

### Requirement 7: Production-composition command-path integration coverage

**User Story:** As a maintainer, I want an integration test that wires the real
production dependency graph, so that connector/command mismatches like these are
caught by CI instead of by a reviewer clicking a control.

#### Acceptance Criteria

1. THE test suite SHALL include an integration suite that composes dependencies
   the same way `src/index.ts` does (Production_Composition), not a hand-wired
   per-test graph.
2. THE suite SHALL prove that an authorized REST `toggle` reaches the connector
   for both an admin and a permitted non-admin user.
3. THE suite SHALL prove that a Hue/native `brightness` action reaches the
   connector with Canonical_Brightness parameters and passes descriptor
   validation.
4. THE suite SHALL prove that an explicit Kasa `off` reaches the connector.
5. THE suite SHALL prove that an MQTT device action publishes through the
   `MqttService` injected at composition.
6. THE suite SHALL prove that an out-of-scope REST action is rejected before
   dispatch.
7. THE suite SHALL prove that a scoped automation cannot escape its device set
   (e.g. by fabricating another device id).
8. THE suite SHALL prove that a Hue `color-temp` and a Hue `rename` action are
   accepted by Action_Catalog validation and reach the connector (regression
   for Requirement 4).

### Requirement 8: No regression to the core boundary

**User Story:** As a maintainer, I want these connector fixes to leave the
established security and command boundaries unchanged, so that closing connector
gaps does not reopen authorization or truthfulness gaps.

#### Acceptance Criteria

1. THE change SHALL NOT alter the resource-level authorization, scoped-authoring
   or event-admission behaviour verified by existing integration suites.
2. THE change SHALL NOT convert a failed physical connector operation into a
   reported success.
3. WHEN an action is genuinely unsupported by a device, THE ActionRouter SHALL
   continue to reject it with a truthful `unsupported` failure.
4. THE existing Hue and Kasa unit and property tests SHALL continue to pass, or
   be updated in the same change when a contract they assert (e.g. brightness
   units, device id format) is deliberately changed.
