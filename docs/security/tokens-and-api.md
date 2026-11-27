# Tokens and API access

## Access tokens

Access tokens are JWTs signed with HS256.

They contain:

- user ID;
- username;
- role;
- group ID.

The lifetime is 15 minutes. The frontend keeps the access token in memory rather than localStorage.

Dashboard clients send:

```http
Authorization: Bearer <access-token>
```

## Refresh tokens

Refresh tokens are random opaque values with an administrator-managed per-user lifetime of **1, 7 (default) or 30 days**. Optional inactivity policy is disabled by default, or 30 minutes, 2 hours or 8 hours.

The browser stores the raw value in a cookie with:

- `HttpOnly`;
- `SameSite=Strict`;
- `Path=/api/auth`;
- a maximum age matching the user's chosen session lifetime;
- `Secure` on HTTPS connections (or as set by `AUTH_COOKIE_SECURE`).

SQLite stores only the SHA-256 hash.

`POST /api/auth/refresh` exchanges a valid refresh cookie for a new access token. The dashboard may include `{ "active": true }` when deliberate user activity occurred in its current refresh interval. The backend records activity *only after validating the refresh credential* and checks the per-user absolute/idle policy before issuing the new JWT. The activity field is a convenience signal, not cryptographic proof of presence. Requests with no activity field do not keep an idle session alive.

The frontend renews access tokens roughly every 13 minutes. Network failures and temporary server errors are retried without treating the cookie as invalid; a definitive `401/403` clears the browser session. Bearer tokens are still enforced by the server during outages. See [ADR-0025](../adr/0025-resilient-sessions-and-local-automation-drafts.md).

## JWT signing secret

Resolution order:

1. `JWT_SECRET` environment variable;
2. persisted `jwt_secret` in `system_settings`;
3. generate and persist a new 256-bit secret.

Changing the secret invalidates existing access tokens. Refresh tokens remain in the database, but refresh requires the current user and then produces tokens signed by the current secret.

## Public HTTP routes

The authentication middleware allows these routes without a dashboard access token:

| Method | Path |
|---|---|
| `GET`, `HEAD` | `/api/health` |
| `GET` | `/api/auth/status` |
| `POST` | `/api/auth/setup` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/refresh` |
| `GET` | `/metrics` |

`/metrics` has its own optional bearer-token guard through `METRICS_TOKEN`.

## WebSocket authentication

The frontend connects to the WebSocket endpoint without including the token in the URL. Instead, the client sends the access token as its first message using the format:

```json
{ "type": "auth", "token": "<access-token>" }
```

The server holds the connection in a pending-auth state for up to five seconds. If no valid auth message arrives within that window, the connection is closed with code 4001. Once authenticated, the server verifies the token and its expiry, then closes the connection when the token expires so the client can refresh and reconnect.

First-message auth is the only accepted path. A `?token=` query parameter is ignored, so a client that sends one and nothing else is closed at the end of the pending-auth window like any other unauthenticated connection. Access tokens are kept out of the URL because reverse proxies and access logs routinely record request targets.

## Project API keys

Machine clients of published Project APIs use API keys, not JWTs
([ADR-0027](../adr/0027-project-apis.md), [reference](../reference/project-apis.md)).

- **Format.** `aeo_<keyId>_<secret>`: a public 16-hex-character key id and a 256-bit random
  secret.
- **Storage.** Only SHA-256(secret) is stored, and the comparison is constant-time. An
  unknown key id costs the same comparison, so timing does not reveal which ids exist.
- **Issue and rotation.** A key is shown once when it is issued or rotated. Keys can expire
  and be revoked. A rotation sets the replacement's expiry explicitly, never copying the old
  key's, and separately how long the old key overlaps (revoked at once by default).
- **Where they are accepted.** Only in `Authorization: Bearer` on `/api/exposed/...`. A
  machine key is refused (`401`) by dashboard authentication on every other route, and
  dashboard JWTs, refresh cookies and demo sessions are refused on `/api/exposed`.
- **Not users.** API clients are not dashboard users. They have no role, session or refresh
  token, and never appear as `req.user`.
- **Liveness.** Revocation, expiry, client status and grants are read on every request.
- **Never cached, never kept by the dashboard.** Every `/api/project-apis` response carries
  `Cache-Control: no-store`. The Endpoints view holds a new key in component state only,
  shows it once, and drops it when the dialog closes. It is not written to IndexedDB drafts,
  browser storage, the URL or the console. A key pasted into the test-request form is sent
  once in a request body to `POST .../try`, which uses it for that one loopback request and
  does not store, log, audit or return it.
- **Public demo.** A public-demo server answers `403` to every management route, for every
  session including a real admin's, and `404` to everything under `/api/exposed`.
- **Held by another installation.** The Aeolus Remote connector on installation B stores the
  full key it was given in its connector configuration, in B's SQLite database, so B's
  database and its backups must be protected like the key itself. It is shown as `********`
  in every API response and the dashboard; posting the mask back keeps it, and it never
  appears in device state, health, logs or exports. B sends it only in the `Authorization`
  header to the configured origin, follows no redirect, and with plain HTTP only after an
  explicit trusted-LAN opt-in. Use expiring keys, and revoke on A if B's data may be exposed.

## Credentials in URLs

Credentials go in the `Authorization` header, or, for the refresh token, its httpOnly cookie. They never go in a URL. A URL ends up in browser history, proxy and server logs, and `Referer` headers whether the request succeeds or not.

- A request whose query string has a credential-shaped parameter (`token`, `access_token`, `api_key`, `password`, `secret` and similar, compared case-insensitively) is refused with `400` before authentication. A value that looks like an Aeolus API key (`aeo_...`) or a JWT is refused under any parameter name. The list is in `src/api/middleware/url-credential-guard.ts`.
- Request logs record the path only, never the query string. An API key or JWT pasted into the path itself is masked in request logs and in Prometheus metrics labels. Headers, cookies and request bodies are never logged.
## CORS and rate limits

CORS accepts configured origins and local development/LAN origins according to `src/api/middleware/cors-config.ts`.

The global API limiter defaults to 1000 requests per minute per IP. Login has its own stricter limiter.
