# Implementation Plan

- [x] 1. Add `connectorInstanceId` to the domain model
  - Add optional `connectorInstanceId` to `Device` and `NormalizedEvent` in `src/core/types.ts`.
  - _Requirements: 1.1, 1.5_

- [x] 2. Persist device ownership
  - Add migration `009-connector-instance-ownership.ts` (nullable `connector_instance_id` column) and register it.
  - Extend `initSchema` (fresh-schema column + CHECK-removal rebuild copy list) in `src/db/database.ts`.
  - Map `connectorInstanceId` ⇄ `connector_instance_id` in `serializeDevice`/`deserializeDevice` and the UPDATE/INSERT statements; copy it in `upsert`.
  - _Requirements: 1.3, 1.4_

- [x] 3. Tag discovered devices with their owning instance
  - Make `ConnectorManager.emitDeviceEvent(device, instanceId?)` set `connectorInstanceId` (explicit id, else the device's existing id).
  - Pass `instanceId` from every discovery loop (enable, restoreFromStore, retry, poll).
  - _Requirements: 1.2_

- [x] 4. Resolve the owning instance at execution time
  - Add `resolveOwningInstance(device)` to `ActionRouter`: exact `connectorInstanceId` lookup; no fall-through to a sibling when the named owner is disabled; type-scan fallback only when the field is absent.
  - Use it in `executeAction`, `resolveActionCatalog`, and `getAcknowledgementCapability`; return a naming failure when the owner is disabled.
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 5. Reference-count contribution lifecycle by type
  - Replace per-instance `contributedHandlers`/`contributedConditions` with `activeInstanceCountByType`; add `registerContributions`/`unregisterContributions`.
  - Register on the first instance of a type, unregister on the last; wire into `enable`, `restoreFromStore`, `disable`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Scope device removal on disable to the instance
  - Replace the type-wide removal loop in `disable` with ownership-scoped removal (`connectorInstanceId === instanceId`, plus the instance's device set for legacy/in-flight devices).
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 7. Unit tests
  - DeviceRegistry: ownership round-trip + persistence + upsert copy + MQTT stays unowned.
  - ActionRouter: instance resolution, disabled-owner failure, type fallback, ack parity.
  - (ConnectorManager ref-count + scoped removal covered by the integration test in task 8.)
  - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 3.x, 4.x_

- [x] 8. Two-instance lifecycle integration test
  - Enable two instances of one mock type, discover disjoint devices, operate each; disable one; assert the other still works and keeps its devices, the disabled instance's devices are gone, and shared contributions remain until the last instance is disabled.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 9. Docs
  - Document instance ownership in `docs/reference/connectors.md` and remove the resolved item from `docs/BACKLOG.md`.
  - _Requirements: 1.1_
