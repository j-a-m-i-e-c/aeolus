# Project APIs security and release hardening

Status: **H0 review complete; H1 design awaiting approval.** Baseline `ad5155e` (Project APIs
Phases 0–5). Branch `security/project-apis-hardening`.

The goal is to take Project APIs and the Aeolus Remote connector from implementation-complete
to a defensible developer preview. Out of scope: portability, federation, new API methods and
unrelated platform features.

Severity combines impact with realistic exploitability for the supported deployment: one
backend, one SQLite database, on a LAN or VPN, with an admin and possibly non-admin dashboard
users.

## H0 findings

| ID | Severity | Finding | Who can exploit it | Phase |
|---|---|---|---|---|
| F1 | **High** | Usable secrets are stored in the database. A copy of `aeolus.db` or a backup reveals the JWT signing secret, connector password fields and the backend's MQTT password | Anyone who obtains the database file or a backup | H2 |
| F2 | **High** | Restoring an older database restores machine access revoked since, and rolls back the audit trail | An operator restoring a backup, or someone who can replace the database file | H3 |
| F3 | **High** on multi-user installs, Medium otherwise | Authored HTTP checks DNS, then `fetch()` resolves again on connect. A rebinding DNS answer reaches loopback, LAN or metadata addresses, and the response body goes back to the author. Non-admin tab writers can use `http.*` | Any user who can write an automation, plus a DNS name they control | H1 |
| F4 | **Medium** | A malformed JSON body is logged verbatim. Express's parse error carries `body`, the error handler logs `err` at error level, and the line lands in stdout and in the admin-visible log buffer. That includes passwords sent to `/api/auth/login`, connector keys and `/try` keys (reproduced) | Anyone who can read logs (admins via `/api/system/logs`, operators via `docker logs`). Needs a malformed request, which a buggy or hostile client can send | H1b |
| F5 | **Medium**, depends on configuration | Proxy trust is set by hop count while the backend listens on every interface (host networking in the default Compose). With `TRUST_PROXY_HOPS≥1`, a client reaching port 3001 directly can forge `X-Forwarded-For` (bypassing the per-IP login limiter) and `X-Forwarded-Proto` (HTTPS detection and the secure cookie) | Any LAN host, when a reverse proxy is configured | H4 |
| F6 | **Medium** | The Remote connector can verify only public-CA certificates. A LAN peer with a private CA or a self-signed certificate cannot use HTTPS, which pushes operators towards plain HTTP | Passive LAN observers, once plain HTTP is chosen | H4 (decision) |
| F7 | **Medium** | Backup documentation: Option A copies only `aeolus.db`; restoring does not say to remove stale `-wal`/`-shm` files; nothing says which secrets a backup holds | Operators following the guide | H2/H3 |
| F8 | Low | `POST /api/project-apis/:id/try` URL-encodes path parameters, but `.` and `..` survive encoding, so the loopback request can leave `/api/exposed/...` | Admin only, using credentials they supply; no escalation | H4 |
| F9 | Low | `/metrics` is unauthenticated unless `METRICS_TOKEN` is set, and the token comparison is not constant-time | LAN hosts (operational metrics only) | H4 |
| F10 | Low | A failed authored HTTP request logs the full URL, so an author's query-string token reaches the logs | Log readers | H1b |
| F11 | Low | `GET /api/connectors` and its status route are open to every signed-in user, exposing non-secret config: Remote base URL and endpoint, Hue bridge IP | Non-admin users | H2 |
| F12 | Low | On failure, the daily E2E workflow prints backend logs to the CI log without the credential scan | Readers of the CI logs (combined with F4) | H1b |
| F13 | Info | `isPublicIpv4` omits 192.88.99.0/24 (the deprecated 6to4 relay). Node's opt-in `NODE_USE_ENV_PROXY` would route `fetch` through an environment proxy | — | H1 |
| F14 | Decision | Scoped (non-admin) automations are refused the `webhook` action but may call `http.get`/`http.post`, which reach the same public internet | — | H1 (decision) |

### Existing controls (verified in code)

- **Authentication:**
  - Keys are `aeo_<keyId>_<secret>` with a 256-bit secret, stored as SHA-256.
  - The comparison is constant-time, and an unknown key id still costs one comparison.
  - Revocation, expiry and client status are read on every request.
  - Keys are accepted only in `Authorization` on `/api/exposed`, which is mounted before dashboard authentication and is terminal.
- **Publication and grants:**
  - Requests are served from immutable snapshots.
  - Grants are per route, with a route fingerprint, and are checked before the API's health is revealed.
  - Unpublishing, or demoting the admin who published, revokes grants permanently.
  - Changes are written to an append-only audit table.
- **Limits:**
  - In-memory per-key and per-client rate windows (bounded maps).
  - Two concurrent requests per client, four isolates server-wide, 32 MB per isolate.
  - A 5 s deadline, a 64 KiB response limit, disposal on disconnect, and release of the slot on every path (Phase 3 tests).
- **Authored HTTP:**
  - Public addresses only, with every answer checked at preflight.
  - No redirects, size caps both ways, a timeout clamped to 1–25 s.
  - The webhook action is refused for scoped automations.
- **Remote connector:**
  - Its own transport; the policy runs in the connection's `lookup` hook, with every answer checked.
  - No redirects, TLS verification always on, per-request dual-stack attempts, separate deadlines, size caps.
  - Refusals fail closed; secrets are masked with the hardened mask semantics.
- **Proxy:** `trust proxy` stays off unless `TRUST_PROXY_HOPS` is set, and `requireHttps` uses `req.secure`.
- **Artifacts:** E2E masking, the artifact scan and the disposable stack (fixes A and B).

### Test gaps

- No test resolves DNS twice with different answers, for authored HTTP or the connector.
- No test of log redaction: secrets in malformed bodies, error objects or URLs.
- No test of a restored database. There is no detection mechanism to test yet.
- No test of a direct-to-backend client forging forwarded headers while a proxy hop is trusted.
- No test of `/try` with `.`/`..` parameters.
- No test that the connector's LAN policy is unreachable from authored code. True today, but untested.

### Compatibility concerns for the fixes

- **H1:** authored HTTP moves off `fetch`. `PublicHttpRequestOptions.fetchImpl` is only used by tests and is dropped. Two behaviours change on the wire:
  - Response decompression must be reimplemented, under the size cap.
  - Header filtering becomes explicit.
- **H2:** an encryption key outside the database is new operational state, and existing installations need migration. That is why its design needs approval first.
- **H3:** a new external state file alongside the H2 key, and a new "machine access suspended" state.
- **H4:** a bind-address setting and proxy trust by address could change how existing reverse-proxy deployments behave, so both need explicit defaults.

## H1 design: connection-time enforcement for authored HTTP

**Threat (F3).** `validatePublicHttpUrl` resolves the name and checks every answer, then `fetch()` resolves again when it connects. A rebinding name with a short TTL can return a public address to the check and a private one to the connection. Because `http.get` returns the body to the author, this is a read SSRF, available to any user who can write an automation:
- loopback (the unauthenticated `/metrics` and `/api/health`, other local services);
- LAN devices and router UIs;
- `169.254.169.254` on a cloud host.

**Selected design: one guarded transport, two policies.**
1. Move the connection code out of `src/connectors/aeolus-remote/transport.ts` into a shared `src/security/guarded-request.ts`.
   - It uses `node:http`/`node:https` with a `lookup` hook. `net.connect` dials exactly the addresses the hook returns, so the check and the connection use the same answers. There is no second resolution.
   - It takes an explicit, required **address policy** argument.
2. Two policies, each a constant in its own module:
   - `PUBLIC_ONLY` (authored HTTP, webhooks): the existing `isPublicIpAddress`, plus 192.88.99.0/24. Every answer must pass, and IP literals are checked before connecting.
   - `CONFIGURED_PEER` (Aeolus Remote, unchanged): private allowed, loopback only as a literal.

   The sandbox imports only the public-only entry point (`requestPublicHttp`). The peer policy is never reachable from authored code, and a static test asserts that.
3. **Defence in depth.** On the socket's `connect` event, check `socket.remoteAddress` against the same policy and destroy the socket if it fails. This catches any future code path that skips `lookup`. The `lookup` hook stays the primary control: it refuses before connecting. A test will establish whether the post-connect check runs before Node writes the first request byte; until it does, the check is not counted as preventing that byte.
4. **TLS:** Node's default verification; `servername` is the URL host name. There is no option to disable it.
5. **No redirects:** `node:http` never follows them; a 3xx is returned to the author as a status, and `Location` is never followed.
6. **Per request, nothing process-wide:**
   - `autoSelectFamily: true` with a 2.5 s attempt per address;
   - a connection deadline of min(5 s, request timeout), covering DNS, the attempts and TLS;
   - the existing request timeout (default 10 s, clamped to 1–25 s);
   - `agent: false`, so there is no pooled socket and environment proxies are ignored.
7. **Size limits:**
   - The request body cap stays at 256 KiB.
   - The response cap (1 MiB) applies to `Content-Length`, to the received bytes and to the decoded bytes.
   - Responses are requested with `Accept-Encoding: identity`. If a server compresses anyway, gzip, deflate or br is decoded as a stream under the same cap, so a compression bomb cannot exceed it.
8. **Headers:**
   - Author headers are passed through, except `Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Upgrade`, `Proxy-*` and `Accept-Encoding`, which the transport owns.
   - The response is returned as a `Headers` object, so `PublicHttpResponse` keeps its shape.
9. **Cancellation:** a timeout or abort destroys the socket and reports `Outbound request timed out after N ms`, the same message authors see today.
10. **Errors stay `OutboundHttpPolicyError`**, with the same messages for policy refusals. A refusal found at connection time reads: "Outbound hostname resolves to a private, local, link-local, or reserved address".

**Rejected alternatives**
- *An undici `Agent` with `connect.lookup` as the `fetch` dispatcher:* the clean option, but Node does not export its bundled undici, so it needs the `undici` package. That is a new runtime dependency.
- *Resolve once and connect to the IP with a `Host` header:* loses Node's Happy Eyeballs across answers, and every caller must set the TLS `servername` correctly. The `lookup` hook gives the same pinning with less code.
- *Re-validating after `fetch` connects:* `fetch` does not expose the socket before it sends the request.
- *A process-wide `net.setDefaultAutoSelectFamilyAttemptTimeout` or `dns.setDefaultResultOrder`:* forbidden by the requirements; it would also change MQTT and connectors.

**Code changes**

| Change | Files |
|---|---|
| New guarded request core | `src/security/guarded-request.ts` |
| `requestPublicHttp` rebuilt on the core; `validatePublicHttpUrl` kept for preflight error messages; `fetchImpl` removed; 192.88.99.0/24 added | `src/security/outbound-http.ts` |
| Remote transport uses the core with its own policy (behaviour unchanged, its tests kept) | `src/connectors/aeolus-remote/transport.ts` |

There are no database changes. The sandbox and webhook callers are unchanged.

**Tests** (controlled local servers; a resolver and policy injected only by tests):
- **Rebinding:**
  - A resolver that answers public at preflight and loopback at connection: refused before any byte reaches the loopback server.
  - Mixed public and private answers: refused.
  - A private IP literal: refused without DNS.
- **Defence in depth:** a `lookup` that lies (claims public, dials loopback) is caught by the post-connect check.
- **Dual-stack:**
  - A first answer that never connects plus a working second one: connects within the attempt budget.
  - Every answer failing: a bounded failure.
  - The process default is unchanged.
- **Redirects:** 301/302/307 returned, never followed, and the target server receives nothing.
- **TLS:** self-signed and wrong host name refused, with no option to skip verification.
- **Deadlines:** a slow header, a slow body, and a server that never answers; the socket is destroyed and the error message is unchanged.
- **Limits:** declared, streamed and decompressed response caps; the request body cap; header filtering.
- **Isolation:** a static test that `sandbox.ts` and `command-service.ts` import only the public-only entry point. A test that a private target is refused for authored HTTP while the Remote connector reaches the same private test server.
- **Existing tests:** the existing `outbound-http` and sandbox HTTP tests are kept and adapted. The remote transport tests are kept unchanged.

**Decision needed (F14).** Should scoped (non-admin) automations keep `http.get`/`http.post`? Today they may call them while the `webhook` action is refused for them. Options:
- (a) Keep them, since after H1 they reach only public addresses.
- (b) Refuse authored HTTP for scoped automations, like webhooks. That breaks any non-admin project that calls an external API.

Recommendation: (a) for this programme, with the inconsistency documented.

## H1b: secrets in logs (proposed as a small phase straight after H1)

F4, F10 and F12. Planned changes:
- Pino `redact` paths: `err.body`, `req.headers.authorization`, `*.password`, `*.apiKey`, `*.key`.
- A JSON-parse error handler that logs only the type, length and path, never the body.
- Authored URLs logged as origin and path, without the query string.
- The CI log step piped through the credential scanner.
- Regression tests that send a malformed body containing a fake key and password and assert that the logs and the log buffer do not contain it.

## Phases and checkpoints

| Phase | Content | Checkpoint |
|---|---|---|
| H0 + H1 design | This document | **Now** |
| H1 | Guarded transport, authored HTTP on it | Review after implementation |
| H1b | Log redaction (F4, F10, F12) | Folded into the H1 review |
| H2 design | Key management, migration, backup and restore for all stored secrets (F1, F7, F11) | **Approval before implementation** |
| H2 | Implementation | Review |
| H3 design | Restore detection and machine-access recovery (F2, F7) | **Approval before implementation** |
| H3 | Implementation, with the copied-database regression scenario | Review |
| H4 | HTTPS, proxy and transport matrix; bind address and proxy trust by address (F5); peer CA (F6); `/try` (F8, and the HTTPS-only test route); metrics auth (F9) | Decision points on the peer CA and the HTTPS test route |
| H5 | Extended adverse-condition runs on disposable stacks | Review |
| H6 | Raspberry Pi validation package (scripts and instructions; results unverified until run) | Review |

### Questions to settle at the H2 and H3 checkpoints (no design proposed yet)

- **H2 scope:**
  - Should the JWT signing secret and the backend MQTT password, which are also in the database, be protected alongside connector secrets?
  - Where does the key live: a separate volume or Docker secret, a file under `/run/secrets`, or an environment variable?
  - What happens when the key is absent: connectors with secrets do not start, other features carry on?
- **H3 approach:**
  - The likely approach is an external, monotonic "access epoch" kept with the H2 key. It is raised and fsynced after every committed change to machine access.
  - A database whose epoch is behind the external one is treated as restored, and machine access is suspended until an admin explicitly re-authorises it.
  - To settle: how this behaves on power loss, with a stale WAL, and when the external state is missing; and what a whole-machine rollback leaves unprotected.
