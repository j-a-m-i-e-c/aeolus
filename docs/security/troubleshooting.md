# Security troubleshooting

## First-run page does not appear

Check:

```text
GET /api/auth/status
```

If `needsSetup` is false, an admin already exists.

## Login is rate limited

Five failed or repeated login requests within one minute can return HTTP 429. Wait for the `Retry-After` interval before trying again.

## Access token expired

The frontend should call `/api/auth/refresh` using the refresh cookie. When refresh also fails, sign in again.

## Admin password is lost

Use the supported recovery procedure in [Reset admin password](../how-to/reset-admin-password.md). Avoid directly editing database tables unless the documented recovery path cannot run and a backup exists.

## User signs in but sees no tabs

Check that:

- the user has a group;
- the group still exists;
- the group contains assignments for current tab IDs.

## WebSocket closes with an authentication error

Confirm that the frontend can refresh its access token and reconnect. Check proxy configuration if the HTTP API works but WebSocket upgrade requests do not.

## MQTT device cannot connect

First confirm whether the deployment uses dashboard provisioning or operator-managed Mosquitto configuration. The default Compose stack includes the required file mounts and reload sidecar, but dashboard-managed provisioning is disabled unless `MQTT_MANAGED_PROVISIONING_ENABLED=true` is set deliberately.

Then check:

1. current security level;
2. username and password;
3. whether the credential was revoked;
4. Mosquitto logs;
5. password-file mount and permissions;
6. whether Mosquitto reloaded after a provisioning change.

## Token or credential changes after restore

A complete restore must preserve:

- the SQLite database;
- Mosquitto configuration and password files;
- environment secrets when explicitly supplied.

If the JWT signing secret changes, current access tokens become invalid and users must sign in again.
