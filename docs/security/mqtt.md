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
