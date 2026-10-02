# ADR-0021: MQTT device identity, reserved topics and correlated command replies

- **Status:** Accepted (retrospective)
- **Date:** 2026-09-30

## Context

Aeolus ingests telemetry from hobbyist and industrial MQTT hardware, but MQTT topics are not, by themselves, trustworthy or permanent database IDs. It also publishes commands that may need acknowledgements, and receives explicit Automation Events. Letting arbitrary telemetry populate the acknowledgement or automation-event paths would create false device discovery and misleading command evidence. Firmware must be able to interoperate whether it reads MQTT 5 response properties or a JSON payload.

## Decision

Use one MQTT ingestion boundary to parse topics, derive and resolve device identity through the device registry, and distinguish ordinary device data from **reserved** acknowledgement and Automation Event topic spaces. Raw topics may remain observable while discovery ignores configured suffixes and special protocol topics. Do not route reserved acknowledgement messages through normal device discovery or state updates.

For correlated commands, generate a correlation ID and response topic and mirror them in MQTT 5 Correlation Data/Response Topic and the JSON command payload. On acknowledgement ingestion, MQTT 5 Correlation Data takes precedence; otherwise use the payload correlation ID. Replies with neither ID cannot complete an unrelated outstanding command. The pending-command tracker owns correlation and the command service owns truthful completion (ADR-0006).

An MQTT **authentication username** is an independent broker credential, not proof of a physical board's identity. Per-Device broker accounts grant independent revocation but copied credentials remain usable elsewhere (ADR-0017). Topic routing, broker authentication, observed device identity and command correlation must not be conflated.

## Alternatives considered

- **Treat every topic as telemetry:** makes reserved reply/event spaces indistinguishable from sensor values.
- **Infer successful commands from publish:** proves broker acceptance at most, not physical completion.
- **Require MQTT 5 properties only:** breaks simpler firmware that can echo JSON fields but not MQTT 5 response properties.
- **Trust client-supplied device IDs without registry collision handling:** makes identity collisions and routing ambiguities more dangerous.

## Consequences

Firmware integrations must respect the reserved topic and correlation contracts. Broker ACLs, username-to-client-ID binding or certificates, if added later, would strengthen authentication but not replace the application-level command evidence rules. An MQTT payload may be spoofed by any publisher authorized to reach the topic; this ADR does **not** assert hardware attestation.

## Revisit when

Aeolus introduces per-topic broker ACLs, MQTT 5-only firmware requirements, physical-device certificates, or incompatible external topic conventions requiring explicit profiles.

## Implementation anchors

- `src/mqtt/mqtt-service.ts`
- `src/mqtt/topic-parser.ts`
- `src/mqtt/command-envelope.ts`
- `src/mqtt/private-topic-store.ts`
- `src/automations/pending-command-tracker.ts`
- `docs/how-to/add-mqtt-device.md`
- [ADR-0002](0002-mqtt-and-connectors.md), [ADR-0006](0006-truthful-command-lifecycle.md), [ADR-0017](0017-mqtt-security-modes.md)
