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

Refresh tokens are random opaque values with a seven-day lifetime.

The browser stores the raw value in a cookie with:

- `HttpOnly`;
- `SameSite=Strict`;
- `Path=/api/auth`;
- seven-day maximum age.

SQLite stores only the SHA-256 hash.

`POST /api/auth/refresh` exchanges a valid refresh cookie for a new access token.

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
| `GET` | `/api/system/version` |
| `GET` | `/api/auth/status` |
| `POST` | `/api/auth/setup` |
| `POST` | `/api/auth/login` |
| `POST` | `/api/auth/refresh` |
| `GET` | `/metrics` |

`/metrics` has its own optional bearer-token guard through `METRICS_TOKEN`.

## WebSocket authentication

The frontend connects with a current access token. The server verifies the token and its expiry, then closes the connection when the token expires so the client can refresh and reconnect.

Because the current connection flow carries the token in the WebSocket URL, reverse proxies should avoid logging query strings.

## CORS and rate limits

CORS accepts configured origins and local development/LAN origins according to `src/api/middleware/cors-config.ts`.

The global API limiter defaults to 1000 requests per minute per IP. Login has its own stricter limiter.
