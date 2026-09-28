# MQTT security

Aeolus supports three broker security modes out of the box in the standard Docker Compose deployment: **Open**, **Shared Password**, and **Per-Device**. Changing mode from **Security → MQTT Security** rewrites the live Mosquitto configuration, reloads the broker through the scoped sidecar, reconnects the Aeolus backend as needed, and verifies the resulting broker behaviour before reporting success.

Open remains the first-run default for compatibility and low-friction hardware onboarding. It is intended for trusted or isolated local networks. Use Shared Password or Per-Device whenever other clients on the broker network should not have anonymous access.

The rationale for keeping all three modes is recorded in [ADR-0017](../adr/0017-mqtt-security-modes.md).

## Security levels

### Open

Anonymous broker access is allowed.

Use Open for development, bring-up, or an isolated/trusted broker network. Do not expose an Open broker to an untrusted LAN or the public internet.

### Shared Password

Aeolus generates one broker username/password shared by external MQTT devices. The Aeolus backend uses a separate internal broker credential.

Shared Password is the simplest authenticated mode. It is a good fit when the site network is not fully trusted but per-device identity and individual revocation are unnecessary. Regenerating the shared password invalidates the previous shared credential.

### Per-Device

Each device receives its own generated username/password. Credentials can be created and revoked independently, while the Aeolus backend continues to use its own internal broker credential.

Use Per-Device when devices need distinct identities or when one lost/retired device must be revoked without rotating every other device. A device password is shown once at creation; Aeolus stores the Mosquitto-compatible password hash rather than the plaintext device password.

A credential identifies a broker login, not immutable hardware. Copying the same username/password to another MQTT client would allow that client to authenticate as the same logical device. Use unique MQTT client IDs and protect credentials accordingly.

## Provisioning API

All three modes are supported by the standard deployment. There are no feature flags for MQTT security modes.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/mqtt/provisioning/status` | Authenticated | Current security mode/status |
| `PUT` | `/api/mqtt/provisioning/level` | Admin | Switch Open / Shared Password / Per-Device |
| `POST` | `/api/mqtt/provisioning/shared/regenerate` | Admin | Rotate the shared credential |
| `GET`, `POST` | `/api/mqtt/provisioning/credentials` | Admin | List/create Per-Device credentials |
| `DELETE` | `/api/mqtt/provisioning/credentials/:id` | Admin | Revoke a Per-Device credential |

The standard Docker Compose runtime exposes the live broker config/password paths to the backend. A custom raw source-run that is not connected to writable/reloadable broker files can still inspect status but cannot apply broker changes until equivalent plumbing is provided.

Legacy credential endpoints also exist under `/api/auth/mqtt-credentials`.

## Raw publish confinement

`POST /api/mqtt/publish` publishes a caller-supplied topic and payload to the broker. It is confined by a server-side policy so user-originated traffic is bounded and the acknowledgement control plane cannot be forged.

| Topic class | Non-admin | Admin |
|---|---|---|
| User namespace (`aeolus/pub/…`) | allowed | allowed |
| Reserved system (`aeolus/acks/…`) | 403 | 403 |
| Anything else | 403 | allowed |

- **User namespace.** Non-admins may publish only under `aeolus/pub/` (configurable via `MQTT_PUBLISH_USER_NAMESPACE`). Matching is on MQTT topic-level boundaries.
- **Reserved system namespace.** Publishing to the acknowledgement namespace is refused for every role, including admins. The reserved prefix is derived from the same ack filter the ingestion path consumes.
- **Admin latitude.** Admins may publish outside the user namespace for diagnostics, but never into the reserved system namespace.
- **Guardrails.** The `retain` flag is rejected for non-admins; admins may set it. `MQTT_PUBLISH_MAX_BYTES` (default 256 KiB) limits payload size.
- **Validation.** Missing/empty topics and topics containing MQTT wildcards (`+`/`#`) are rejected.

Confinement is enforced only at this HTTP endpoint; internal publishers are unaffected.

## Credential handling

Aeolus hashes device passwords into Mosquitto's native sha512-pbkdf2 (`$7$`) format using Node's built-in `crypto.pbkdf2`. No external binary or Docker socket is required. A generated Per-Device password is returned once; its `$7$` hash is stored in SQLite and written to the broker password file.

The Shared Password is intentionally recoverable in the admin dashboard so an operator can provision additional devices. It is stored in Aeolus settings and should be treated as a site secret.

### Shared-volume wiring

The default Compose deployment keeps live broker configuration in the Docker-managed `mosquitto_config` volume, mounted into both the backend and broker at `/mosquitto/config`. A one-shot init service copies the committed `mosquitto/mosquitto.conf` into that volume only when the live config does not yet exist. The tracked `mosquitto/` directory remains source-only.

The reload sidecar mounts the same runtime volume read-only and watches the config **directory** for move/create/write events. It arms that watch immediately, then sends one startup reconciliation `SIGHUP`. This prevents the first Open → authenticated transition from landing before the watcher is ready. Later atomic temp-file-plus-rename writes trigger another `SIGHUP`.

### Change verification

After a managed security change, Aeolus probes the broker with short-lived MQTT connections and waits for the expected policy to become observable:

- Open: anonymous connection accepted;
- Shared Password: anonymous rejected and Aeolus' backend credential accepted;
- Per-Device: anonymous rejected and Aeolus' backend credential accepted;
- shared password regeneration: new shared credential accepted;
- device credential creation: new credential accepted;
- device credential revocation: the password file is regenerated/reloaded and the backend credential remains accepted.

The probes use a bounded retry budget to tolerate asynchronous `SIGHUP` handling. If the broker does not converge within the budget, the API returns `503` rather than claiming success without broker evidence.

Per-Device create/connect/restart/revoke behaviour, including actual rejection of a revoked field credential, has also been field-tested on the Raspberry Pi deployment used to validate the feature.

### Reload strategies

The backend supports pluggable reload strategies via `MQTT_RELOAD_STRATEGY`:

| Strategy | Mechanism | When to use |
|---|---|---|
| `none` (default) | No-op — an external watcher handles it | Docker Compose with the sidecar |
| `signal` | `process.kill(pid, 'SIGHUP')` | Shared PID namespace or same host |
| `docker` | `docker kill --signal=SIGHUP <container>` + restart fallback | Legacy; needs Docker socket |
| `command` | Runs `MQTT_RELOAD_COMMAND` | Custom orchestration |

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MQTT_PASSWORD_FILE` | `<project>/mosquitto/password_file` | Path to the password file in custom deployments |
| `MQTT_CONFIG_FILE` | `<project>/mosquitto/mosquitto.conf` | Path to the Mosquitto config file in custom deployments |
| `MQTT_RELOAD_STRATEGY` | `none` | Reload mechanism |
| `MQTT_RELOAD_CONTAINER` | `aeolus-mosquitto` | Container name for the legacy `docker` strategy |
| `MQTT_RELOAD_PID` | — | Explicit PID for `signal` |
| `MQTT_RELOAD_PID_FILE` | — | PID file for `signal` |
| `MQTT_RELOAD_COMMAND` | — | Shell command for `command` |
| `MQTT_PBKDF2_ITERATIONS` | `100000` | PBKDF2 iteration count embedded in each hash |
| `MQTT_PROVISIONING_VERIFY_BUDGET_MS` | `12000` | Total broker-verification budget |
| `MQTT_PROVISIONING_VERIFY_POLL_MS` | `500` | Gap between verification attempts |
| `MQTT_PROVISIONING_VERIFY_TIMEOUT_MS` | `3000` | Per-attempt connection timeout |

## Device guidance

- Use TLS or a private network when MQTT crosses an untrusted link.
- Keep command topics narrow and predictable.
- Prefer QoS 1 for important commands.
- Prefer Per-Device over a fleet-wide credential when independent revocation matters.
- Use a unique MQTT client ID for each physical/logical client.
- Revoke lost or retired device credentials promptly.

See [Microcontrollers](../MICROCONTROLLERS.md) and [Add an MQTT device](../how-to/add-mqtt-device.md).
