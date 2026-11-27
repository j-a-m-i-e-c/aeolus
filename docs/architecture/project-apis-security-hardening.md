# Project APIs security and release hardening

Status: **H0a, H1 and F5 implemented; H2 and H3 designs awaiting approval.** Baseline `ad5155e`
(Project APIs Phases 0–5). Branch `security/project-apis-hardening`.

| Commit | Phase | Finding |
|---|---|---|
| `141c209` | H0a: credentials out of logs and error responses | F4 (raised to High), F10, F12 |
| `cc06e76` | H1: connection-time destination enforcement | F3, F13 |
| `601bc7b` | Proxy trust by address, optional bind address | F5 |

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
| F4 | **High** (raised at review; fixed in H0a) | A malformed JSON body is logged verbatim. Express's parse error carries `body`, the error handler logs `err` at error level, and the line lands in stdout and in the admin-visible log buffer. That includes passwords sent to `/api/auth/login`, connector keys and `/try` keys (reproduced) | Anyone who can read logs (admins via `/api/system/logs`, operators via `docker logs`). Needs a malformed request, which a buggy or hostile client can send | H1b |
| F5 | **Medium**, depends on configuration | Proxy trust is set by hop count while the backend listens on every interface (host networking in the default Compose). With `TRUST_PROXY_HOPS≥1`, a client reaching port 3001 directly can forge `X-Forwarded-For` (bypassing the per-IP login limiter) and `X-Forwarded-Proto` (HTTPS detection and the secure cookie) | Any LAN host, when a reverse proxy is configured | H4 |
| F6 | **Medium** | The Remote connector can verify only public-CA certificates. A LAN peer with a private CA or a self-signed certificate cannot use HTTPS, which pushes operators towards plain HTTP | Passive LAN observers, once plain HTTP is chosen | H4 (decision) |
| F7 | **Medium** | Backup documentation: Option A copies only `aeolus.db`; restoring does not say to remove stale `-wal`/`-shm` files; nothing says which secrets a backup holds | Operators following the guide | H2/H3 |
| F8 | Low | `POST /api/project-apis/:id/try` URL-encodes path parameters, but `.` and `..` survive encoding, so the loopback request can leave `/api/exposed/...` | Admin only, using credentials they supply; no escalation | H4 |
| F9 | Low | `/metrics` is unauthenticated unless `METRICS_TOKEN` is set, and the token comparison is not constant-time | LAN hosts (operational metrics only) | H4 |
| F10 | Low | A failed authored HTTP request logs the full URL, so an author's query-string token reaches the logs | Log readers | H1b |
| F11 | Low | `GET /api/connectors` and its status route are open to every signed-in user, exposing non-secret config: Remote base URL and endpoint, Hue bridge IP | Non-admin users | H2 |
| F12 | Low | On failure, the daily E2E workflow prints backend logs to the CI log without the credential scan | Readers of the CI logs (combined with F4) | H1b |
| F13 | Info | `isPublicIpv4` omits 192.88.99.0/24 (the deprecated 6to4 relay). Node's opt-in `NODE_USE_ENV_PROXY` would route `fetch` through an environment proxy | — | H1 |
| F14 | Decided: keep | Scoped (non-admin) automations are refused the `webhook` action but may call `http.get`/`http.post`, which reach the same public internet | — | H1 (decision) |

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

## Checkpoint review: H0a, H1 and F5

**H0a (F4, F10, F12).**
- A body the parser refuses is logged as category, method, path and request id, and answered with a fixed message carrying the same request id.
- Errors are logged from an allowlist of fields; secret-named fields are censored; URLs and webhook targets are logged without query strings.
- A last pass masks API keys, JWTs and bearer tokens before stdout and the log buffer.
- `log-safety.integration.test.ts` runs the real middleware and logger in a child process with random sentinels, and scans its real stdout and stderr, the log buffer and every response. It fails against the previous code.
- CI prints backend logs only after the credential scan.
- *Residual:* a free-form secret (a password) placed by a caller in a field that is not secret-named, and then logged by new code, would not be caught by the shape-based last pass. Bodies are never logged, which is the control.

**H1 (F3, F13).**
- One shared transport, `guarded-request.ts`, with a required policy: authored HTTP and webhooks use `PUBLIC_ONLY_POLICY`, and the Remote connector uses `CONFIGURED_PEER_POLICY`.
- The name is resolved once, in the connection's `lookup` hook; every answer is checked and only checked answers are dialled; literals are checked first; the connected address is checked again.
- The old code was shown to return a loopback server's response through the gap.
- Tests use real local servers and controlled DNS, and count connections to prove refused destinations are never connected to. A static test keeps the LAN policy out of authored code.
- The contract is preserved: status, statusText, `Headers`, text body, size limits and the timeout message.
- *Changes to note:*
  - Responses are requested uncompressed, and a compressed one is decoded under the 1 MiB cap.
  - Transport headers (`Host` and similar) are owned by Aeolus.
  - A connection-phase timeout reads `… while connecting`.
  - Non-timeout transport errors are fixed messages, no longer the transport's own text.
- *Residual:* the post-connect check runs after the TCP handshake. For plain HTTP, Node may already have queued the request bytes, so that check is defence in depth, not the guarantee. The guarantee is the `lookup` check before connecting. A test with a deliberately lying `lookup` shows the post-connect check refuses and nothing is served.

**F5.**
- A hop is trusted only if it is within `TRUST_PROXY_HOPS` and its socket address is in `TRUSTED_PROXY_ADDRESSES` (default `loopback`). An unreadable list stops startup. Ignored forwarded headers are logged once per peer.
- `BIND_ADDRESS` lets a proxied backend listen on `127.0.0.1` only.
- The tests run real Express, the exposed router and a login-style limiter over real sockets from a trusted (127.0.0.1) and a direct (127.0.0.2) source address. They cover:
  - forwarded address and scheme through the proxy;
  - forged `X-Forwarded-For` and `X-Forwarded-Proto` from the direct client;
  - HTTPS enforcement both ways;
  - login rate-limit attribution, including rotating forged addresses;
  - no proxy configured.
- *Compatibility:* a deployment with `TRUST_PROXY_HOPS=1` whose proxy is **not** on the same host, or runs in another container, now ignores that proxy's headers until `TRUSTED_PROXY_ADDRESSES` names it. The symptoms are all users sharing the proxy's login-limit bucket, the refresh cookie not marked Secure, and HTTPS-only Project APIs answering 403. The backend logs a warning naming the peer. The hosted demo is unaffected: it uses `loopback,uniquelocal` for its tunnel on the private bridge network.

**Gates at `601bc7b`:** backend 4,090 tests, 90.8% branches; frontend 1,344 tests, 90.76%; type checks, lint, radar and E2E safety all green.

## H2 design: secrets at rest (awaiting approval)

**Objective:** a copy of `aeolus.db`, its WAL, or a normal database backup yields no usable application credential and no signing authority.

### What is stored, and what changes

| Secret | Where now | Needed as | H2 |
|---|---|---|---|
| Connector `password` fields: Hue `apiKey`, Aeolus Remote `apiKey`, and any future one | `connectors.config` JSON, plaintext | plaintext, to call the device or peer | **Encrypt** |
| JWT signing secret (when `JWT_SECRET` is unset, the default) | `system_settings.jwt_secret`, plaintext | plaintext (HMAC) | **Encrypt** |
| Backend MQTT password | `system_settings.mqtt_backend_password`, plaintext | plaintext, to connect | **Encrypt** |
| Shared MQTT password | `system_settings.mqtt_shared_password`, plaintext | plaintext, shown to admins | **Encrypt** |
| User passwords | `users`, bcrypt | verification only | unchanged |
| Refresh tokens, Project API keys | SHA-256 | verification only | unchanged |
| MQTT device credentials | `mqtt_credentials` and the broker `password_file`, PBKDF2 (`$7$`) | verification only | unchanged; the broker file holds hashes only |

### Root key

- A **keyring file** outside the database and its volume:
  - `AEOLUS_KEYRING_FILE` (default `<AEOLUS_SECRETS_DIR>/keyring.json`, where `AEOLUS_SECRETS_DIR` defaults to `/app/secrets` in containers and `./secrets` from source).
  - Compose mounts a **separate named volume**, `aeolus_secrets`, so the documented database backup (`aeolus.db` from `backend_data`) never includes it.
  - A Docker secret (`/run/secrets/...`) works through the same variable.
  - The file is created with mode 0600 in a 0700 directory.
- **Format:** `{ "version": 1, "installationId": "<uuid>", "keys": [{ "id": "k1", "key": "<base64 256-bit>", "createdAt": …, "status": "active" | "retired" }] }`. Exactly one key is active.
- **Not supported:** key material directly in an environment variable, because it is visible in `docker inspect` and process listings. Only a file path is accepted.

### Encryption

- **AES-256-GCM** from `node:crypto`, with a random 96-bit nonce per value. The data key is derived from the root key with HKDF-SHA256 per purpose (`info`: `aeolus/connector-secret/v1`, `aeolus/setting-secret/v1`).
- **AAD** binds each ciphertext to its place: `connector:<instanceId>:<fieldId>` or `setting:<key>`. A ciphertext copied to another record or field does not decrypt.
- **Versioned text envelope** stored in place of the value: `aeolus-enc:v1:<keyId>:<nonce>:<ciphertext+tag>` (base64url). The prefix lets every read tell an envelope from legacy plaintext.
- **Where it happens:** `ConnectorStore` encrypts on save and decrypts on load, using the module's schema to find `password` fields. A small `secret-settings` accessor does the same for the three settings keys.
  - The manager, the `********` mask semantics (`connector-config.ts`) and redaction are unchanged: they see plaintext in memory, as today.
  - Nothing else reads those columns (audited in H0).

### Provisioning, restart and failure

- **First start with no keyring and no envelopes in the database:** generate the keyring, encrypt (migration below), and log the keyring *path* and a reminder to back it up separately. Never the key.
- **Restart:** load the keyring; every envelope's key id must be present.
- **Keyring missing or unreadable, or a key id absent, while the database holds envelopes:** **the backend refuses to start.** The error names the keyring path and the recovery command. Nothing falls back to plaintext. A partly working start is not offered, because without the JWT secret no session can be verified and without the MQTT password the backend cannot reach an authenticated broker.
- **Explicit recovery when the key is lost:** `aeolus-secrets recover --discard-undecryptable`, run with `docker compose run --rm backend node dist/cli/aeolus-secrets.js …`. It:
  - creates a new keyring;
  - generates a new JWT secret (every user signs in again);
  - regenerates the backend and shared MQTT passwords and rewrites the broker password file (devices using the shared password must be updated);
  - marks connectors with lost secrets "credential required", disabled, for an admin to re-enter.

  It writes an audit entry and never invents a credential.

### Rotation and compromise

- **`aeolus-secrets rotate`:** adds a new active key, re-encrypts every envelope in one database transaction, and marks the old key `retired`.
  - Retired keys stay in the keyring so older database backups can still be restored.
  - `aeolus-secrets prune --key k1` removes one explicitly, and refuses while any envelope still uses it.
- **Suspected keyring compromise:** `rotate --regenerate-derived` also replaces the JWT secret and the MQTT passwords. Connector credentials must be rotated where they were issued (re-pair Hue; rotate the key on the remote Aeolus). The docs and the command output say so.

### Migration of existing installations

- **When it runs:** a startup step after the SQL migrations and after the keyring loads. It is idempotent, and is not a numbered SQL migration, because it needs the key.
- **Order:**
  1. Take the existing pre-migration database checkpoint.
  2. Encrypt every plaintext secret in one transaction.
  3. Run `wal_checkpoint(TRUNCATE)` and `VACUUM`, so no plaintext is left in free pages or the WAL.
- **Value mapping:** an empty value stays empty, and a value already in envelope form is left alone. A stored `********` (possible only from the pre-Phase-5 bug) is not encrypted. That connector is marked "credential required" rather than keeping the placeholder.
- **Old backups still contain plaintext.** The release notes and the command output recommend rotating the Remote key and the MQTT passwords after upgrading (a single command), and re-pairing Hue if old backups may have been exposed.
- **Verification before release:**
  - Run against a **copy** of a real database containing Hue and Aeolus Remote credentials and MQTT shared-password mode.
  - Check that every secret decrypts to its original, connectors reconnect, sessions survive (the JWT secret is preserved), and the broker accepts the backend.
  - Check that the copy and its WAL contain no plaintext (byte scan for each secret).
  - **Your call:** I would make that copy from your everyday installation with SQLite's online `.backup`, read-only, into a disposable directory. Do you approve, or should I build a representative database on the disposable stack instead?

### Backup and restore

- A database backup **and** a keyring containing every key id it references are both needed.
- Back up the keyring **separately and rarely**: offline, a password manager, a USB stick. It changes only on rotation.
- The docs will state plainly that whoever holds both can decrypt.
- Restoring a backup older than a rotation needs the retired key, which is why retired keys are kept until pruned.

### Not protected by H2

- An attacker with the running process, root on the host, or both volumes.
- Plaintext that is already in pre-H2 backups.

## H3 design: restore detection and machine-access recovery (awaiting approval)

**Objective:** a restored or rolled-back database never makes revoked machine access usable again without an explicit admin decision.

### Mechanism: an access epoch outside the database's rollback domain

- **In the database:** a numbered migration adds `machine_access_state(id = 1, installation_id, epoch, updated_at)`.
- **Outside it:** `access-state.json` in `AEOLUS_SECRETS_DIR` holds `{ installationId, epoch, updatedAt, mac }`. The MAC is HMAC-SHA256 with an HKDF subkey of the H2 root key (`aeolus/access-state/v1`), which detects corruption and editing. It lives on the separate secrets volume, so a database restore does not roll it back.
- **Every change that reduces machine access raises the epoch in the same database transaction:** revoking a key, a rotation ending its overlap, revoking a grant, disabling a client, unpublishing, deleting an API, demoting the publishing admin. After the commit, and **before the API responds**, the file is replaced atomically: write a temporary file, fsync, rename, fsync the directory, keeping the previous file as `access-state.prev.json`.
  - Changes that only add access do not raise it; rolling them back only removes access, which is the safe direction.
- **A small append-only `access-journal.jsonl`** next to it records each reduction: `{ epoch, at, action, clientId, credential keyId (the public id), apiId, routeId }`. It holds no secrets, and it is evidence a restore cannot erase.

### Startup decision

| Database epoch vs file | Meaning | Result |
|---|---|---|
| equal | normal restart | serve |
| database ahead | power loss after commit, before the file write | update the file to match; serve |
| **database behind** | the database is older than the last revocation: restored or rolled back | **machine access suspended** |
| file missing or unreadable (and `.prev` too), database epoch > 0 | external state lost | **suspended** |
| `installationId` differs | a database from another installation or a clone | **suspended** |
| file missing, database epoch 0 | first run of H3 on an existing install | create the file; serve (restores older than this cannot be detected; documented) |

**While suspended:**
- Every `/api/exposed` request gets one uniform answer, revealing nothing per key. I propose **503** with `Retry-After` and the body "Machine access is suspended pending administrator review". The alternative is **401**, which looks like a revoked key to a remote installation.
- The rest of Aeolus runs normally: dashboard, MQTT, automations, outbound connectors.
- The Endpoints view shows the suspension and the recovery page.

### Explicit recovery (an admin, in the dashboard)

1. Aeolus lists every client, key and grant that is active in the restored database. Using the journal, it marks each one **revoked after this backup** (with date and action) or not.
2. For each item the admin chooses **Keep** (reauthorise) or **Revoke**. Items revoked after the backup default to Revoke and cannot be kept without a second confirmation. **Revoke all and start again** is available.
3. On confirm, in one transaction:
   - the chosen revocations are applied;
   - kept items are recorded;
   - the epoch becomes the file's epoch + 1;
   - audit entries are written (`access.restore-detected` with both epochs, then one entry per kept or revoked item);
   - then the file is updated. Suspension ends.

Nothing is regranted silently. A restored grant that the journal shows revoked stays revoked unless the admin confirms keeping it.

### Interrupted writes, WAL and power loss

- `synchronous` is SQLite's default for WAL (FULL), so a committed revocation is durable before the file write.
- A crash between the database commit and the file write leaves the database ahead, which is safe.
- A torn file write cannot happen (rename is atomic); if it did, `.prev` is used.
- Restoring `aeolus.db` without its `-wal` produces an older database, which is detected. A stale `-wal` from another lineage is ignored by SQLite (salt mismatch), with the same outcome.
- The restore docs will still say to remove `-wal`/`-shm` before restoring.
- Migrations do not change the epoch.
- Key unavailable: H2 refuses to start; the file's MAC cannot be checked without the key.

### Limits, documented

- A rollback of **both** volumes (a VM or SD-card image, or a full-disk backup restored together) is not detectable. Nothing on the machine can outlive it.
- The only stronger option is an external monotonic witness (another host, a TPM counter), which is out of scope.
- Two clones running at once with the same state are not distinguished.

### Tests (with real database copies, using SQLite's backup API)

- The required scenario end to end against a real copied database:
  1. Create a client, a key and a grant.
  2. Back up.
  3. Revoke the key and the grant.
  4. Restore the backup.
  5. The old key gets the suspension response, never the endpoint.
  6. Run the recovery procedure.
  7. Only what was deliberately reauthorised works.
- The same with active, revoked, expired and rotated (overlap) credentials mixed.
- Normal restart; repeated restarts; a crash injected between commit and file write; a restore without the WAL and with a stale WAL; a missing, corrupt or edited file; a missing key; an `installationId` mismatch; and a migration run.

## Phases and approvals after this checkpoint

| Next | Needs |
|---|---|
| H2 implementation | Approval of the H2 design, and your answer on making a read-only `.backup` copy of the everyday database for migration verification |
| H3 implementation | Approval of the H3 design, and the choice between 503 and 401 while suspended |
| H4 | Peer CA option for Aeolus Remote (F6), the HTTPS-only test route, `/try` path parameters (F8), metrics auth (F9) |
| H5, H6 | As planned |
