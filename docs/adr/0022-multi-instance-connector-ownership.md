# ADR-0022: Persist connector-instance ownership rather than route by connector type

- **Status:** Accepted (retrospective)
- **Date:** 2026-09-30

## Context

A site can have two bridges or accounts for the same connector type. If every discovered device is routed to any active instance of the correct type, actions may reach the wrong bridge; disabling one instance can remove the other's devices. Connector *type* registration and connector *instance* lifecycle are different concerns.

## Decision

Maintain a registry of connector **modules/types** and a manager of configured **instances**, each identified by its own persisted UUID and configuration. Record the owning connector-instance ID on discovered devices and use it in instance-specific action routing and lifecycle cleanup. On disable, clean up devices actually owned by that instance; use the instance's discovered-device set as a limited compatibility fallback for legacy or in-flight entries without persisted ownership. Keep type-level registration distinct from instance enable, disable, retry and polling.

The manager must not infer that all devices of a given connector type belong to the instance being disabled. Ownership may be unknown for legacy data, but ambiguity must be visible and handled intentionally rather than silently selecting an arbitrary live instance.

## Alternatives considered

- **One instance per connector type:** simpler, but excludes real multi-bridge sites.
- **Use connector type as device ownership:** insufficient when two instances share a type.
- **Choose any currently active instance at action time:** makes commands depend on startup and polling order.
- **Delete every matching connector-type device on disable:** causes unrelated instance data loss.

## Consequences

Device provenance is part of durable platform state, not merely a runtime implementation detail. Reconnection and polling must preserve instance identity; migration of legacy records must avoid guessing. Shared type-level contribution registration should not be torn down while another instance still depends on it.

## Revisit when

If Aeolus supports distributed connector workers, instance migration between hubs, or cross-site device federation, instance identity and ownership will need network-wide semantics.

## Implementation anchors

- `src/connectors/connector-registry.ts`
- `src/connectors/connector-manager.ts`
- `src/db/migrations/009-connector-instance-ownership.ts`
- `src/connectors/connector-manager.property.test.ts`
