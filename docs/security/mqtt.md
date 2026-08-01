# MQTT security

Open broker access is the current default. Dashboard-managed Shared Password and Per-Device provisioning are under
development and disabled by default because a deployment must prove that Mosquitto has applied every credential
change before Aeolus can safely report it as active. The dashboard labels both options accordingly, and their APIs
return `503` unless `MQTT_MANAGED_PROVISIONING_ENABLED=true` is set deliberately for development work.

For authenticated production deployments today, manage Mosquitto credentials and reloads through the host deployment.

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

The following endpoints are experimental and require `MQTT_MANAGED_PROVISIONING_ENABLED=true`:

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

Aeolus hashes device passwords into Mosquitto's native sha512-pbkdf2 (`$7$`) format using Node's built-in `crypto.pbkdf2` — no external binary or Docker socket required. A generated device password is returned once; the `$7$` hash is stored in the database and written verbatim to the shared password file.

### Shared-volume wiring

The implementation bind-mounts `./mosquitto` into both the backend and the broker at `/mosquitto/config`, then uses a
sidecar to signal Mosquitto after a change. The sidecar watches the config **directory** (not a single file path) for
move/create events, so the backend's atomic temp-file-plus-rename password-file writes are reliably observed and the
broker is sent `SIGHUP` for each one.

### Change verification

Writing files and triggering a reload does not by itself prove the broker applied the change — under the default
`none` reload strategy the reload is delegated to the sidecar and is asynchronous. After each managed change the
backend therefore probes the broker with short-lived throwaway connections and only reports success once the new
policy is demonstrably enforced:

- switching to Open confirms anonymous access is accepted;
- switching to Shared Password / Per-Device confirms anonymous access is rejected and the backend credential is accepted;
- regenerating the shared password confirms the new credential is accepted;
- creating a device credential confirms it is accepted; revoking one confirms it is rejected while the backend still connects.

The probes poll within a bounded budget to tolerate the asynchronous reload. If the broker does not converge within the
budget, the API returns `503` — the change is still saved and will apply on the broker's next reload or restart; only the
live confirmation did not land in time. Verification runs only while `MQTT_MANAGED_PROVISIONING_ENABLED=true`.

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
| `MQTT_PASSWORD_FILE` | `<project>/mosquitto/password_file` | Path to the shared password file |
| `MQTT_CONFIG_FILE` | `<project>/mosquitto/mosquitto.conf` | Path to the Mosquitto config file |
| `MQTT_RELOAD_STRATEGY` | `none` | Reload mechanism (see above) |
| `MQTT_RELOAD_CONTAINER` | `aeolus-mosquitto` | Container name for the `docker` strategy |
| `MQTT_RELOAD_PID` | — | Explicit PID for the `signal` strategy |
| `MQTT_RELOAD_PID_FILE` | — | PID file for the `signal` strategy |
| `MQTT_RELOAD_COMMAND` | — | Shell command for the `command` strategy |
| `MQTT_PBKDF2_ITERATIONS` | `100000` | PBKDF2 iteration count (embedded in each hash) |
| `MQTT_MANAGED_PROVISIONING_ENABLED` | `false` | Enables experimental dashboard-managed Shared / Per-Device provisioning |
| `MQTT_PROVISIONING_VERIFY_BUDGET_MS` | `12000` | Total budget to confirm a change against the broker |
| `MQTT_PROVISIONING_VERIFY_POLL_MS` | `500` | Gap between verification poll attempts |
| `MQTT_PROVISIONING_VERIFY_TIMEOUT_MS` | `3000` | Per-attempt connection timeout for a verification probe |

## Device guidance

- Use TLS or a private network when MQTT crosses an untrusted link.
- Keep command topics narrow and predictable.
- Prefer QoS 1 for important commands.
- Do not embed one production credential into a fleet of devices when Per-Device mode is available.
- Revoke lost or retired devices promptly.

See [Microcontrollers](../MICROCONTROLLERS.md) and [Add an MQTT device](../how-to/add-mqtt-device.md).
