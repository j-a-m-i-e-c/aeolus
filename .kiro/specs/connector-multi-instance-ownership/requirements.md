# Requirements Document

## Introduction

Aeolus supports enabling multiple instances of the same connector type — two Hue bridges, two Kasa networks — each with its own configuration and lifecycle. But the framework identifies a device's owner only by connector *type* (`Device.integration`), never by instance. As a result, two instances of one type interfere with each other in three ways:

- **Execution misrouting**: the action router resolves the owning connector by taking the *first* enabled instance whose type matches the device's `integration`. With two instances of a type, the wrong instance can execute a command for a device it does not own.
- **Shared-handler teardown**: contributed action/condition handlers are registered in global type-keyed registries. Disabling one instance unregisters handlers a sibling instance of the same type still needs.
- **Cross-instance device deletion**: disabling one instance removes *every* device whose `integration` equals the connector type — including devices discovered by the sibling instance.

This feature makes connector instances first-class owners of their devices. Devices gain an owning `connectorInstanceId`; execution routing, contribution teardown, and device removal all become instance-scoped, so two instances of the same type operate independently.

## Glossary

- **Connector_Type**: A connector module identified by `metadata.id` (e.g. `hue`, `kasa`). Registered once in the ConnectorRegistry.
- **Connector_Instance**: A configured, enabled deployment of a Connector_Type, identified by a UUID `instanceId`. Multiple instances of one type may coexist.
- **Owning_Instance**: The Connector_Instance that discovered and manages a given device.
- **Contribution**: An action handler or condition factory a connector module contributes, keyed by action/condition type, registered into the global CommandService / ConditionRegistry.
- **Device_Registry**: The in-memory + SQLite store of all known devices.
- **Managed_Instance**: The runtime record for a Connector_Instance, tracking its connector object, persisted record, polling timer, and the set of device IDs it has discovered.

## Requirements

### Requirement 1: Instance-scoped device ownership

**User Story:** As an operator running two instances of the same connector type, I want each device to record which instance owns it, so that the platform can act on the right instance.

#### Acceptance Criteria

1. THE Device model SHALL carry an optional `connectorInstanceId` identifying its Owning_Instance.
2. WHEN a Connector_Instance discovers a device, THE system SHALL tag the resulting device with that instance's `instanceId`.
3. THE `connectorInstanceId` SHALL be persisted with the device so ownership survives a restart.
4. WHILE a device has no `connectorInstanceId` (e.g. an MQTT device, or a device discovered before this feature), THE system SHALL continue to function using the existing type-based behaviour as a fallback.
5. THE ownership tag SHALL NOT change the device's `integration` field, which continues to identify the Connector_Type.

### Requirement 2: Instance-scoped action execution

**User Story:** As an operator, I want a device command to be executed by the instance that owns the device, so that commands reach the correct bridge/network.

#### Acceptance Criteria

1. WHEN executing an action on a device that has a `connectorInstanceId`, THE action router SHALL dispatch to that exact Owning_Instance.
2. IF the Owning_Instance is not currently enabled, THEN THE action router SHALL return a failure result identifying the missing instance, rather than dispatching to a different instance of the same type.
3. WHEN a device has no `connectorInstanceId`, THE action router SHALL fall back to the first enabled instance whose type matches the device's `integration` (preserving current behaviour).
4. THE action catalog resolution and acknowledgement-capability resolution SHALL use the same Owning_Instance resolution as action execution.

### Requirement 3: Instance-scoped contribution lifecycle

**User Story:** As an operator, I want disabling one instance to leave a sibling instance of the same type fully functional, so that its action and condition handlers keep working.

#### Acceptance Criteria

1. WHEN the first instance of a Connector_Type is enabled, THE system SHALL register that type's contributed action handlers and condition factories.
2. WHILE two or more instances of a Connector_Type are enabled, THE system SHALL keep that type's Contributions registered.
3. WHEN an instance of a Connector_Type is disabled AND another instance of the same type remains enabled, THE system SHALL keep that type's Contributions registered.
4. WHEN the last enabled instance of a Connector_Type is disabled, THE system SHALL unregister that type's Contributions.
5. Contribution registration and teardown SHALL behave identically whether an instance was started via runtime enable or restored from the store on startup.

### Requirement 4: Instance-scoped device removal

**User Story:** As an operator, I want disabling one instance to remove only that instance's devices, so that a sibling instance keeps its devices.

#### Acceptance Criteria

1. WHEN a Connector_Instance is disabled, THE system SHALL remove from the Device_Registry only the devices owned by that instance.
2. WHEN a Connector_Instance is disabled AND a sibling instance of the same type remains enabled, THE sibling's devices SHALL remain in the Device_Registry.
3. THE set of devices removed on disable SHALL be determined by instance ownership, not by Connector_Type match.

### Requirement 5: Lifecycle correctness under two instances

**User Story:** As a maintainer, I want an automated test proving two instances coexist correctly, so that this regression cannot silently return.

#### Acceptance Criteria

1. THERE SHALL be an integration test that enables two instances of the same Connector_Type, discovers devices on both, and operates a device on each.
2. THE test SHALL disable one instance and assert the other still executes actions and retains its devices.
3. THE test SHALL assert that the disabled instance's devices were removed while the remaining instance's devices were not.
