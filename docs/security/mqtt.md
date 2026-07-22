# MQTT security

Aeolus supports Open, Shared and Per-Device Mosquitto security modes, with dashboard controls and provisioning APIs.

## Security levels

### Open

Anonymous broker access is allowed.

This is convenient for a trusted development network but should not be exposed outside that network.

### Shared

Devices use one generated shared username and password.

This is simpler than per-device provisioning but cannot identify or revoke one individual device.

### Per-Device

Each device receives its own username and password. Credentials can be created and revoked independently.

## Provisioning API

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/mqtt/provisioning/status` | Authenticated |
| `PUT` | `/api/mqtt/provisioning/level` | Admin |
| `POST` | `/api/mqtt/provisioning/shared/regenerate` | Admin |
| `GET`, `POST` | `/api/mqtt/provisioning/credentials` | Admin |
| `DELETE` | `/api/mqtt/provisioning/credentials/:id` | Admin |

Legacy credential endpoints also exist under `/api/auth/mqtt-credentials`.

## Raw publish confinement

`POST /api/mqtt/publish` publishes a caller-supplied topic and payload to the
broker. It is confined by a server-side policy so user-originated traffic is
bounded and the acknowledgement control plane cannot be forged.

| Topic class | Non-admin | Admin |
|---|---|---|
| User namespace (`aeolus/pub/…`) | allowed | allowed |
| Reserved system (`aeolus/acks/…`) | 403 | 403 |
| Anything else | 403 | allowed |

- **User namespace.** Non-admins may publish only under `aeolus/pub/`
  (configurable via `MQTT_PUBLISH_USER_NAMESPACE`). This keeps raw publish useful
  for driving automations that subscribe there, and makes user traffic easy to
  target with broker ACLs later. Matching is on MQTT topic-level boundaries, so
  `aeolus/public/…` does not count as `aeolus/pub`.
- **Reserved system namespace.** Publishing to the acknowledgement namespace is
  refused for every role, including admins — this closes the forged-acknowledgement
  path (a publish to `aeolus/acks/#` can no longer make an unconfirmed command
  look confirmed). The reserved prefix is derived from the same ack filter the
  ingestion path consumes, so the two cannot drift apart.
- **Admin latitude.** Admins may publish outside the user namespace for
  diagnostics, but never into the reserved system namespace.
- **Guardrails.** The `retain` flag is rejected for non-admins (prevents planting
  a persistent fake state); admins may set it. A payload-size cap
  (`MQTT_PUBLISH_MAX_BYTES`, default 256 KiB) applies to all publishes.
- **Validation.** The request body is schema-validated; a missing/empty topic or
  a topic containing an MQTT wildcard (`+`/`#`) is rejected. Errors are
  distinguishable: `400` validation, `403` authorization/retain, `413` payload
  too large.

Confinement is enforced only at this HTTP endpoint; internal publishers (the
command dispatch path, acknowledgement responders, and connectors) are
unaffected.

## Credential handling

A generated device password is returned once. Aeolus stores a bcrypt hash and writes the Mosquitto password file.

The provisioning service is designed to update Mosquitto configuration and trigger a broker reload when the security level or credentials change. For that to work, the backend deployment must have writable access to the broker configuration and password file, plus a narrowly scoped way to reload Mosquitto.

The committed Docker Compose deployment does not grant those privileges. Its dashboard can expose the provisioning controls, but broker changes must be applied manually unless you add deployment-specific provisioning wiring. Avoid mounting the unrestricted Docker socket into the backend.

In a provisioning-enabled deployment, the backend also maintains its own broker credential for secured modes.

## Device guidance

- Use TLS or a private network when MQTT crosses an untrusted link.
- Keep command topics narrow and predictable.
- Prefer QoS 1 for important commands.
- Do not embed one production credential into a fleet of devices when Per-Device mode is available.
- Revoke lost or retired devices promptly.

See [Microcontrollers](../MICROCONTROLLERS.md) and [Add an MQTT device](../how-to/add-mqtt-device.md).
