# Connector architecture

Connectors adapt local products and APIs to the Aeolus device model. Hue and Kasa are bundled examples.

For implementation steps, use the [connector developer guide](../../src/connectors/README.md).

## Module contract

A connector module exports:

- `metadata`
- `configSchema`
- `createConnector(config)`

It may also export:

- editor snippets;
- automation action handlers;
- condition factories;
- an action catalog.

Bundled production connectors are imported and registered in `src/index.ts`. `ConnectorRegistry.discoverFromDirectory()` is available for development and testing, but adding a folder alone does not place a connector in the production bundle.

## Runtime lifecycle

```text
register module
      ↓
enable instance
      ↓
validate configuration
      ↓
createConnector()
      ↓
connect()
      ↓
discoverDevices()
      ↓
register devices and contributed automation types
      ↓
poll and execute actions
      ↓
disconnect and dispose
```

`ConnectorManager` restores enabled connector records from SQLite during startup.

## Device ownership

Connector devices set their `integration` field to the connector ID (the type). They also record a `connectorInstanceId` identifying the specific enabled instance that discovered them, so multiple instances of one type — two Hue bridges, two Kasa networks — stay independent:

- Action routing dispatches to the exact owning instance. If that instance is disabled, the command fails cleanly rather than being handed to a same-type sibling.
- Disabling an instance removes only that instance's devices; a sibling keeps its own.
- Type-generic contributions (action handlers, condition factories) are registered once for a type and torn down only when its last instance is disabled, so a sibling never loses functionality.

Ownership is persisted, so it survives a restart; a device discovered before ownership existed reacquires it on the next poll, falling back to type-based routing until then. Discovered devices should have stable IDs across restarts. They are normal Aeolus devices once registered, so they appear in the dashboard, emit internal state events and can trigger automations.

Device IDs must be unique across instances of the same type (namespace them by bridge/account), since the device registry is keyed by ID. The bundled connectors use immutable native IDs where available, avoiding normal cross-instance collisions, and renaming a device does not change its identity:

- Hue uses the light's `uniqueid` (its Zigbee address), e.g. `hue-00-11-22-33-44-55-66-77-0b`.
- Kasa uses the device's native id/MAC, e.g. `kasa-8006abcd1234`.

When a native identifier is missing, the connector falls back to a less stable identity (Hue to the bridge-local light index, Kasa to the host address) and logs it. These fallback IDs are not guaranteed unique across instances.

## Action catalogs

A connector can describe supported actions and parameter schemas. The manager checks the catalog before execution.

The fallback capability map provides common actions for standard capabilities. Connector-specific catalogs should be used where the external system supports richer operations. The bundled Hue and Kasa connectors provide explicit catalogs so they advertise exactly the actions they implement — Hue exposes on/off, brightness, colour, colour-temperature and bridge rename/delete per light capability; Kasa exposes on/off only. Brightness is a canonical percentage (0–100) across the command contract and normalised device state; a connector translates to its device-native scale (Hue 0–254) only at the API boundary.

## Setup flows

Connectors that require pairing can expose setup steps. Hue uses this for bridge discovery and link-button pairing.

The dashboard asks the connector for step descriptors, submits each step through the connector API and closes the flow when the connector reports completion.

## Frontend panes

A connector can provide a normal generic device experience without frontend code.

A specialised pane is useful when the integration needs controls such as:

- colour and colour-temperature pickers;
- power and energy information;
- scene selection;
- connector-specific health or pairing state.

Frontend panes are registered separately in `frontend/src/lib/pane-registry.ts`.

## Contributed automation features

While an instance is enabled, a connector module may add:

- Logic and UI snippets to the Automation Project editor;
- named condition factories to `ConditionRegistry` for retained form rules;
- advanced connector-specific command handlers to `CommandService`.

Normal code automations should use `devices.action()` against connector-owned devices. A contributed command handler is for genuinely connector-specific command types, and every contribution explicitly declares `physical: true|false` so physical-command IDs/history are not created for reporting-only helpers. The manager removes contributions when the connector is disabled.

## Main source files

```text
src/connectors/connector.interface.ts
src/connectors/connector-registry.ts
src/connectors/connector-manager.ts
src/connectors/connector-store.ts
src/connectors/action-router.ts
src/connectors/capability-action-map.ts
src/connectors/hue/
src/connectors/kasa/
```
