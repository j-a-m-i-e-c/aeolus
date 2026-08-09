# Phase 2 Handoff

Phase 1 (runtime foundations) is complete. The backend primitives the Phase 2
demo mock-device system will build on are now in place and verified end to end.

## What Phase 2 can assume

- **Generic MQTT devices are first-class ack-capable devices.** A device with an
  MQTT command profile (`acknowledgement.supported: true`) resolves the
  `acknowledged` completion tier through the same `CommandService` /
  `PendingCommandTracker` path as connector devices. See
  `docs/MICROCONTROLLERS.md` for the profile config and ACK protocol.
- **Every verified physical command has a durable `commandId`** and a queryable
  `REQUESTED → DISPATCHED → ACKNOWLEDGED → OBSERVED` (or failure) timeline via
  `GET /api/commands`.
- **Restart never replays a physical command.** In-flight records are reconciled
  to terminal `FAILED` / `interrupted`.
- **Automations can emit domain events** over the reserved `aeolus/events/...`
  namespace with causal metadata, without arbitrary MQTT publish authority.

## Rules for Phase 2 mock actuators

A mock actuator MUST behave exactly like a real MQTT client:

- publish sensor/actuator state on ordinary state topics;
- receive a correlated command (read `correlationId` + `responseTopic` from the
  command envelope);
- publish an ACK (`{ correlationId, success }`) on the response topic;
- publish resulting state.

A mock actuator MUST NOT:

- call `CommandService`, `PendingCommandTracker`, `CommandHistoryStore`, or any
  command internals directly;
- introduce a mock-specific shortcut around the verified-command boundary;
- fabricate command records, lifecycle transitions, or provenance metadata.

If a mock needs the acknowledged tier, configure it through the normal MQTT
command profile — the same path a real device uses. This keeps the demo honest:
what the dashboard shows is what actually flowed through the real runtime.

## Out of scope reminder

Phase 1 added backend/API/WebSocket support only. The command timeline UI,
automation flow/topology visualisation, seeded scenario rewrites, and mock
actuator implementations belong to later phases.
