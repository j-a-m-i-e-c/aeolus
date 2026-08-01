# Design Document

## Overview

The fix threads a `connectorInstanceId` through device discovery, persistence, and execution, and makes contribution teardown reference-counted by type. Connector *modules* remain correctly type-keyed (a Hue action handler is the same code for every bridge); what becomes instance-aware is **device ownership** and the **lifecycle bookkeeping** around it.

Three independent defects, three targeted changes plus one shared data change:

| Defect | Root cause | Fix |
|---|---|---|
| Execution misrouting | Router matches first instance by type | Resolve by `device.connectorInstanceId`, fall back to type |
| Shared-handler teardown | Contributions unregistered per-instance | Reference-count contributions by type; unregister on last instance |
| Cross-instance device deletion | Disable removes all devices of the type | Remove only devices owned by the instance |

Shared data change: `Device.connectorInstanceId` (+ `NormalizedEvent`, persistence, migration).

## Data model changes

### `Device` and `NormalizedEvent` (`src/core/types.ts`)

```ts
export interface Device {
  // ...existing...
  integration: string;             // unchanged — the Connector_Type
  connectorInstanceId?: string;    // NEW — the Owning_Instance (absent for MQTT / legacy)
}

export interface NormalizedEvent {
  // ...existing...
  integration?: string;
  connectorInstanceId?: string;    // NEW — carried from discovery to the registry
}
```

`integration` is deliberately unchanged (Req 1.5): it still identifies the type, keeps the synthetic topic `connector/{integration}/{id}` stable, and preserves all type-based fallbacks.

### Persistence (`src/db/database.ts` + migration 009)

Mirror the migration-008 pattern (nullable column, additive, back-compat):

- `src/db/migrations/009-connector-instance-ownership.ts`: `ALTER TABLE devices ADD COLUMN connector_instance_id TEXT DEFAULT NULL;`
- `initSchema` gains the same nullable column for fresh databases and the CHECK-removal rebuild copy list.
- `serializeDevice` / `deserializeDevice` (`src/core/device-registry.ts`) map `connectorInstanceId` ⇄ `connector_instance_id`, and the UPDATE/INSERT statements gain the column.

Persisting ownership closes the restart window (Req 1.3): after a restart, devices already carry their owner before the first poll re-tags them.

## Discovery: tagging devices with their owner

`ConnectorManager.emitDeviceEvent` becomes owner-aware:

```ts
private emitDeviceEvent(device: Device, instanceId?: string): void {
  const connectorInstanceId = instanceId ?? device.connectorInstanceId;
  const event: NormalizedEvent = {
    // ...existing...
    integration: device.integration,
    ...(connectorInstanceId ? { connectorInstanceId } : {}),
    capabilities: device.capabilities,
  };
  this.eventBus.emit(DEVICE_STATE_CHANGE, event);
}
```

Every discovery loop (enable, restoreFromStore, retry, poll) passes its `instanceId`. The ActionRouter's optimistic-update callback keeps calling `emitDeviceEvent(device)` with no id — the device it re-emits already carries `connectorInstanceId`, so ownership is preserved.

`DeviceRegistry.upsert` copies `connectorInstanceId` from the event onto the stored Device (both the new-device and merge branches), alongside the existing integration handling.

## Execution: resolve the Owning_Instance

`ActionRouter` gains a single resolution helper used by `executeAction`, `resolveActionCatalog`, and `getAcknowledgementCapability`:

```ts
/** Resolve the instance that owns this device: exact instance id first, else first type match. */
private resolveOwningInstance(device: Device): ManagedInstance | undefined {
  if (device.connectorInstanceId) {
    const owner = this.instances.get(device.connectorInstanceId);
    if (owner) return owner;
    return undefined; // owner known but not enabled — do NOT fall through to a sibling
  }
  for (const instance of this.instances.values()) {
    if (instance.record.connectorType === device.integration) return instance;
  }
  return undefined;
}
```

Key rule (Req 2.2): when a device names an owner that is not enabled, resolution returns `undefined` — `executeAction` then returns a failure that names the missing instance, rather than silently dispatching to a same-type sibling. The type-scan fallback applies only when `connectorInstanceId` is absent (Req 2.3).

`this.instances` is a `Map<instanceId, ManagedInstance>`, so `instances.get(id)` is the direct lookup.

## Contribution lifecycle: reference-count by type

Contributions (action handlers, condition factories) are type-generic. The manager keeps a per-type active-instance count and registers/unregisters at the transitions:

```ts
private activeInstanceCountByType = new Map<string, number>();

private registerContributions(connectorType: string, mod: ConnectorModule): void {
  const count = this.activeInstanceCountByType.get(connectorType) ?? 0;
  if (count === 0) {
    // first instance of this type — register the type's contributions
    if (mod.actionHandlers && this.actionExecutor) {
      for (const [type, handler] of Object.entries(mod.actionHandlers)) {
        this.actionExecutor.registerHandler(type, handler);
      }
    }
    if (mod.conditions && this.conditionRegistry) {
      for (const [type, factory] of Object.entries(mod.conditions)) {
        this.conditionRegistry.registerCondition(type, factory);
      }
    }
  }
  this.activeInstanceCountByType.set(connectorType, count + 1);
}

private unregisterContributions(connectorType: string, mod: ConnectorModule): void {
  const count = (this.activeInstanceCountByType.get(connectorType) ?? 1) - 1;
  if (count <= 0) {
    // last instance of this type — tear down the type's contributions
    ...unregister handlers + conditions...
    this.activeInstanceCountByType.delete(connectorType);
  } else {
    this.activeInstanceCountByType.set(connectorType, count);
  }
}
```

`enable` and `restoreFromStore` call `registerContributions`; `disable` calls `unregisterContributions`. This replaces the per-instance `contributedHandlers`/`contributedConditions` maps. The behaviour is identical for runtime-enabled and store-restored instances (Req 3.5).

## Device removal on disable: scope to the instance

`disable` replaces the type-wide loop with instance-scoped removal driven by ownership:

```ts
// Remove only the devices this instance owns.
for (const device of this.deviceRegistry.getAll()) {
  const ownedById = device.connectorInstanceId === instanceId;
  const ownedBySet = instance.devices.has(device.id);
  if (ownedById || (device.connectorInstanceId === undefined && ownedBySet)) {
    this.deviceRegistry.remove(device.id);
  }
}
```

Primary signal is `connectorInstanceId === instanceId`. The `instance.devices` set covers legacy/in-flight devices that have no persisted owner yet but were discovered by this instance. A sibling instance's devices carry a different `connectorInstanceId` and are not in this instance's set, so they survive (Req 4.2).

## Boundary: device-id collisions across instances

If a connector generates device IDs that are not unique across instances (e.g. two Hue bridges both yielding `hue-light-1`), the registry — keyed by device id — would still collide regardless of ownership. That is a connector-implementation concern (ID namespacing in the Hue/Kasa modules) and is out of scope here; this spec makes *ownership* unambiguous. It is noted so a follow-up can require connectors to namespace device IDs by instance.

## Testing strategy

- **Unit — DeviceRegistry**: `connectorInstanceId` round-trips through serialize/deserialize and persists across a reload; upsert copies it from the event.
- **Unit — migration 009**: the new column is added; seeded device rows survive the adoption/rebuild path (extend the existing migration-runner property test coverage).
- **Unit — ActionRouter**: resolves by `connectorInstanceId`; returns a naming failure when the owner is disabled; falls back to type when the field is absent; catalog + ack resolution use the same path. Extends `action-router.test.ts` (its `instances` map + mock instances make two-instance cases straightforward).
- **Unit — ConnectorManager**: reference-counted contributions (register on first, retain across sibling disable, unregister on last); instance-scoped device removal.
- **Integration — two-instance lifecycle** (Req 5): enable two instances of one mock type, discover disjoint devices on each, execute an action on each (asserting the correct connector object received it), disable one, then assert (a) the remaining instance still executes and keeps its devices, (b) the disabled instance's devices were removed, (c) the shared handlers/conditions remain registered.

## Rollout

Purely additive and backward-compatible: the new column is nullable, absent ownership falls back to today's type behaviour, and `integration` is unchanged. No config flags. Existing single-instance deployments behave exactly as before; devices acquire ownership on their next discovery poll.
