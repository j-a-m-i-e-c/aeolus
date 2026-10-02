# Tokens and API access

## Access tokens

Access tokens are JWTs signed with HS256.

They contain:

- user ID;
- username;
- role;
- group ID.

The lifetime is 15 minutes. The frontend keeps the access token in memory rather than localStorage.

API clients send:

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

## CORS and rate limits

CORS accepts configured origins and local development/LAN origins according to `src/api/middleware/cors-config.ts`.

The global API limiter defaults to 1000 requests per minute per IP. Login has its own stricter limiter.
