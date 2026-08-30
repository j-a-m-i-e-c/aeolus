# ADR-0002: MQTT for custom hardware, connectors for external ecosystems

- **Status:** Accepted
- **Date:** 2026-08-28

## Context

Aeolus must integrate both custom devices, where the protocol is under the developer's control, and commercial products that already expose their own LAN/API protocols.

Using a bespoke transport for every microcontroller would create unnecessary device-side complexity. Conversely, forcing every commercial integration through an MQTT bridge would introduce translation services and lose useful native capabilities.

## Decision

Use **MQTT as the primary transport for custom hardware** and a **connector interface for products/services with another native protocol**. Both paths normalise into the same internal device, event and command model.

Eclipse Mosquitto is the default local broker. MQTT devices may declare command/acknowledgement behaviour through a persisted MQTT command profile. Connectors own discovery and action execution for their devices.

## Why this fits Aeolus

MQTT is small, well supported on embedded hardware, tolerant of intermittent links and naturally suited to telemetry plus command topics. Connectors avoid forcing existing ecosystems into an artificial MQTT-only shape.

The normalisation boundary means automations care about Aeolus devices and capabilities rather than whether a Hue light arrived over HTTP and a pump controller arrived over MQTT.

## Alternatives considered

### MQTT for everything

This would make the backend transport model simpler, but every vendor integration would need a separate bridge and Aeolus would lose direct knowledge of native discovery, actions and failure semantics.

### Direct REST/WebSocket from custom hardware

HTTP is easy to demonstrate but heavier for small embedded clients and less natural for pub/sub telemetry, retained state and wildcard observation.

### Depend on an existing home-automation platform as the integration layer

This would provide a large integration catalog quickly, but would make another platform part of Aeolus' core runtime and blur the product boundary. External bridges can still be added as connectors later.

## Consequences

### Positive

- A simple path exists for ESP32/Arduino-class devices.
- Vendor integrations keep their native capabilities.
- MQTT and connector-backed devices share automation and UI concepts.
- The broker can operate entirely on the local network.

### Negative / accepted trade-offs

- Aeolus owns MQTT topic identity, broker security and command-correlation design.
- Connectors must truthfully advertise capabilities and reconcile device lifecycle.
- Two integration mechanisms exist and both require good test coverage.

## Revisit when

Reconsider if industrial field protocols such as Modbus, CAN or OPC UA become first-class transports rather than connector-level integrations, or if a different embedded transport becomes a dominant requirement.

## Implementation anchors

- `src/mqtt/`
- `src/connectors/`
- `src/core/device-registry.ts`
- `src/api/routes/mqtt-command-profile.ts`
- `docs/reference/architecture.md`
- `docs/reference/connectors.md`
