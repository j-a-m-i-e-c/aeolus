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

Connector devices set their `integration` field to the connector ID. Action routing uses this value to find the responsible connector instance.

Discovered devices should have stable IDs across restarts. They are normal Aeolus devices once registered, so they appear in the dashboard, emit internal state events and can trigger automations.

## Action catalogs

A connector can describe supported actions and parameter schemas. The manager checks the catalog before execution.

The fallback capability map provides common actions for standard capabilities. Connector-specific catalogs should be used where the external system supports richer operations.

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

- named action handlers to `ActionExecutor`;
- named condition factories to `ConditionRegistry`;
- Logic and UI snippets to the editor.

The manager removes those contributions when the connector is disabled.

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
