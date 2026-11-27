# Project APIs security and release hardening

Status: **H0a, H1 and F5 implemented and provisionally accepted; H2 (revision 2) and H3 (revision 2) designs awaiting approval.** Baseline `ad5155e`
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

## H2 design (revision 2): secrets at rest

Status: the direction is approved (AES-256-GCM, record binding, a versioned envelope, an external keyring). This revision answers the eight review points and is **awaiting approval before implementation**.

**Objective:** a copy of `aeolus.db`, its WAL, or a normal database backup yields no usable application credential and no signing authority.

### What is protected

| Secret | Stored now | Needed as | H2 |
|---|---|---|---|
| Connector `password` fields: Hue `apiKey`, Aeolus Remote `apiKey`, any future one (Kasa has none) | `connectors.config` JSON, plaintext | plaintext | encrypt |
| JWT signing secret, when `JWT_SECRET` is unset (the default) | `system_settings.jwt_secret` | plaintext (HMAC) | encrypt |
| Backend MQTT password | `system_settings.mqtt_backend_password` | plaintext, to connect | encrypt |
| Shared MQTT password | `system_settings.mqtt_shared_password` | plaintext, shown to admins | encrypt |
| User passwords (bcrypt); refresh tokens and API keys (SHA-256); MQTT device credentials (PBKDF2 in the database and in the broker `password_file`) | — | verification only | unchanged |

### 1. Keyring: provisioning, permissions, recovery, independent backups

- **Location:** `AEOLUS_KEYRING_FILE`, default `<AEOLUS_SECRETS_DIR>/keyring.json`. `AEOLUS_SECRETS_DIR` is `/app/secrets` in containers, on a **separate named volume** `aeolus_secrets`, never inside `backend_data`. A Docker secret works through the same variable. Key material is never accepted directly in an environment variable.
- **Format:**

  ```text
  { version: 1, installationId, keys: [{ id, key (base64, 256-bit), status: "active" | "pending" | "retired", createdAt, activatedAt, retiredAt }] }
  ```

  Exactly one key is `active`. A `pending` key may decrypt but is never used to encrypt.
- **Permissions:**
  - The directory is created 0700 and the file 0600, owned by the backend user.
  - On POSIX hosts startup **refuses** a keyring that is group- or world-readable, or not owned by the process user (as OpenSSH does for private keys), naming the problem.
  - On Windows (development only) the check logs a warning instead.
- **Every write** is atomic: write a temporary file in the same directory, fsync it, rename it over the old one, fsync the directory, keeping `keyring.prev.json`.
- **Independent backup:**
  - `aeolus-secrets backup --out <file>` writes the keyring encrypted under a passphrase (scrypt N=2^17, r=8, p=1 → AES-256-GCM), for offline storage: a password manager, a USB key, a separate machine.
  - `aeolus-secrets restore --in <file>` refuses to overwrite an existing keyring.
  - `aeolus-secrets verify --db <path> [--keyring <path>]` opens a database **read-only** and confirms every envelope decrypts. Nothing is printed except counts and key ids. It is the recommended check for every backup set.
  - A keyring backup is needed once at setup and after every rotation; the CLI and the dashboard warn until one is recorded since the last rotation.

### 2. Fresh installation vs existing installation whose keyring is missing

The database records the binding in `system_settings.secrets_binding` = `{ installationId, keyIds, fingerprint }`, where `fingerprint` is HMAC-SHA256 of a fixed label under each key, not the key.

| Database | Keyring | Meaning | Action |
|---|---|---|---|
| no binding, no envelopes | absent | fresh install, or pre-H2 install | create the keyring (exclusive create, never overwrite), bind, migrate |
| no binding, no envelopes | present | pre-H2 database (for example restored) with an existing keyring | bind to that keyring, migrate |
| binding present | present, matching ids and fingerprints | normal | start |
| binding present | **absent** | an existing installation lost its keyring | **refuse to start**; never generate a replacement |
| binding present | present but a needed key id is missing or the fingerprint differs | wrong or older keyring | **refuse to start**, listing the missing key ids |
| envelopes present, binding absent | any | inconsistent (tampered or partial) | **refuse to start** |

The keyring is created with an exclusive create (`O_EXCL`), so a race or a bug can never replace an existing file.

### 3. Key retention and retirement

- **Rotation** marks the old key `retired` (with `retiredAt`) and never deletes it.
- **Retention:** `AEOLUS_KEY_RETENTION_DAYS`, default **400**. Pruning is an explicit command, `aeolus-secrets prune`. It refuses to remove a key that is:
  - younger than the retention period since retirement (unless `--force`);
  - used by any envelope in the live database.
- **The documented rule:** a database backup can be restored if a keyring backup contains its key ids. Keep keyring backups at least as long as database backups, and never prune keys younger than your oldest database backup you intend to restore. The default of 400 days covers a 14-day nightly rotation, monthly archives and a yearly backup, with margin.

### 4. Staged migration that cannot lose a working credential

Encrypted values finally sit in place (the connector JSON field or the setting value) as `aeolus-enc:v1:<keyId>:<nonce>:<ciphertext+tag>`, with AAD `connector:<instanceId>:<fieldId>` or `setting:<key>` under an HKDF-SHA256 subkey per purpose. Migration reaches that state in stages. A stage marker (`system_settings.secrets_migration`) makes each stage resumable.

| Stage | Action | If interrupted |
|---|---|---|
| 0. Preflight | Keyring ready and bound (point 2). An online `.backup` checkpoint of the database to `<data>/checkpoints/pre-secrets-<time>.db`. It contains plaintext; see point 6. | Nothing changed |
| 1. Shadow | In one transaction, write an envelope for every secret into a side table, `secret_migration(context, envelope)`. Plaintext is untouched and still used. | The transaction is atomic; plaintext still works; rerun |
| 2. Verify | Decrypt every envelope and compare it with its plaintext (constant-time); any mismatch stops the migration and keeps plaintext | Nothing switched; rerun |
| 3. Switch | In **one** transaction, replace each plaintext value with its envelope, delete the side rows and set the marker to `encrypted-v1`. Reads use envelopes from then on. | Atomic: either all plaintext (stage 2 state) or all envelopes |
| 4. Clean | `wal_checkpoint(TRUNCATE)`, `VACUUM`; delete the stage-0 checkpoint after `verify` passes; log a reminder about older backups | Repeatable; already secure in content terms |

The same stored values are kept through every stage:
- the JWT secret, so dashboard sessions survive;
- the MQTT passwords, so the broker `password_file` hashes stay valid and devices keep connecting;
- the Hue and Remote keys, so the connectors keep working.

Kasa has no secrets and is untouched. A stored literal `********` (from the pre-Phase-5 bug) is not migrated as a value: that connector is marked "credential required".

**Testing order:**
1. Synthetic databases first: Hue, Kasa and two Remote instances; MQTT open, shared-password and per-device modes; with and without `JWT_SECRET`. Each stage is interrupted by fault injection.
2. Then the approved real copy (see "Real database copy" below).

### 5. Externally supplied `JWT_SECRET`

- Behaviour is unchanged: when `JWT_SECRET` is set, it signs and verifies, and the database value is ignored.
- Migration still encrypts any `jwt_secret` row present, so a later removal of `JWT_SECRET` keeps the same sessions.
- `JWT_SECRET` is already outside the database; the docs recommend supplying it as a file (Docker secret) rather than in `.env`.
- Rotating the keyring never changes the JWT secret unless `--regenerate-derived` is used.

### 6. Plaintext that can remain after migration

After stage 4, the live database contains no plaintext secret in its pages or WAL as SQLite sees them. That is **not** secure erasure. The bytes can remain in:
- freed filesystem blocks, the filesystem journal and SSD or SD-card wear-levelled blocks (`VACUUM` rewrites the file but does not overwrite the device);
- the old WAL's disk blocks after truncation;
- SQLite temporary files and the OS page cache or swap;
- the stage-0 checkpoint until it is deleted (deletion is not erasure either);
- **every pre-H2 backup and any copy of them.**

Stage 3 also sets `PRAGMA secure_delete=ON` for its transaction, which reduces what remains in the database file itself, nothing more.

The documented response is **credential rotation**. After upgrading, `aeolus-secrets rotate-credentials` regenerates the MQTT backend and shared passwords (rewriting the broker file) and, if chosen, the JWT secret (everyone signs in again). It prints what must be rotated elsewhere: rotate each Aeolus Remote key on its publishing installation; re-pair Hue. Old backups should be treated as containing those credentials until they expire.

### 7. Rollback and recovery procedures

- **Failed migration:**
  - Before stage 3, `aeolus-secrets migrate --abort` drops the side table; plaintext was never touched.
  - After stage 3, the database is consistent and encrypted.
  - Running an older Aeolus release needs `aeolus-secrets downgrade --confirm`, which decrypts back to plaintext under an explicit warning, or restoring the stage-0 checkpoint while it exists.
  - The startup error names both options.
- **Interrupted key rotation** (`aeolus-secrets rotate`), staged the same way:

  | Stage | Action | If interrupted |
  |---|---|---|
  | R1 | Add the new key to the keyring as `pending` (atomic replace) | The old key is still active; the pending key is unused |
  | R2 | Re-encrypt every envelope under the new key in one database transaction | Atomic: all old-key or all new-key envelopes; both keys are in the keyring, so either state starts |
  | R3 | Mark the new key `active` and the old `retired` (atomic replace) | On restart, envelopes under a pending key mean R2 finished, so R3 is completed automatically |

  A key is never removed in the same operation that stops using it.
- **Lost keyring** (point 2 refuses to start): `aeolus-secrets recover --discard-undecryptable`.
  - It creates a new keyring and binding, generates a new JWT secret, and regenerates the MQTT passwords, rewriting the broker file.
  - It marks connectors with lost secrets disabled and "credential required".
  - It writes an audit entry. It never invents or reuses a credential.

### 8. Limits of a keyring on the same host

The keyring is outside the database and its backup, not outside the machine. H2 protects against:
- a stolen database file, WAL or database backup;
- a database copied off for support;
- a backup service that captures `backend_data` only.

It does **not** protect against:
- root or the backend user on the host, a container escape, or a process-memory dump;
- a stolen SD card or disk holding both volumes;
- a full-disk image or VM snapshot;
- a backup tool configured to capture all Docker volumes.

Operators wanting more can keep the keyring on a separate device and mount it at start (documented), or use a Docker secret from an external store. A TPM or HSM is out of scope.

### Real database copy (approved, after synthetic tests pass)

- **Made with** SQLite's online backup: `.backup` through `better-sqlite3`'s `db.backup()` on a **read-only** connection to the live file. The live database, its volume and the stack are not stopped, migrated or changed.
- **Destination:** `%LOCALAPPDATA%\aeolus-h2-verify\` (outside the repository and OneDrive), restricted with `icacls` to the current user only.
- **Running it:** migration and `verify` run through the CLI only. No backend, MQTT client, connector or outbound network is started against the copy.
- **Output:** counts, key ids and pass or fail, never values.
- **Cleanup:** when done, the directory is deleted and the deletion recorded here. No existing backup is touched.

### Phases

| Phase | Scope |
|---|---|
| H2a | Keyring, envelope crypto, binding table and CLI `init`/`verify`/`backup`/`restore` |
| H2b | Staged migration and the read and write paths |
| H2c | Rotation, prune, recover, downgrade and `rotate-credentials`; docs |

Each phase is gated separately.

## H3 design (revision 2): crash-consistent revocation journal

Status: **awaiting approval before implementation.** It depends on H2: the keyring's `installationId` and an HKDF subkey for the journal MAC.

### The failure to model (from the review)

The proposed design was:
1. Both counters at N.
2. A revocation commits in SQLite (N+1).
3. Power fails before the external counter is written.
4. The database is restored to a backup at N.
5. The external file also says N.

Startup would then see "equal" and serve the revoked key. **That design is withdrawn.**

### Protocol: write-ahead journal on the secrets volume

`access-journal.jsonl` in `AEOLUS_SECRETS_DIR` is append-only. Each record is one JSON line:

```text
{ seq, kind: "intent" | "commit" | "abort", op, targets, at, prev, mac }
```

- `prev` is the previous record's hash, forming a chain.
- `mac` is HMAC-SHA256 under the H2 subkey `aeolus/access-journal/v1`.
- Records contain only public ids, never a secret.

The database holds `machine_access_state(installation_id, epoch, suspended, suspended_reason)` (a numbered migration).

Every change that **reduces** machine access runs this sequence under one in-process mutex. One backend and one database is the supported topology.

1. **Intent:** append the intent record `seq = epoch + 1`, then `fsync` the file. If the file was created, also `fsync` the directory.
2. **Commit:** one SQLite transaction applies the change and sets `epoch = seq`. WAL with `synchronous=FULL` (verified as the effective setting) makes it durable at commit.
3. **Mark:** append `commit(seq)`, then `fsync`.
4. **Respond.**

- **If step 2 fails:** append `abort(seq)`, fsync, and report the error.
- **If step 1 cannot be made durable** (the volume is full, read-only or missing): the operation is refused, **and machine access is suspended** (503, below) until the journal is writable. A credential the admin is trying to revoke must never keep working because the journal could not record it.

**Changes that only add access are not journaled:** a key issued, a client enabled, a grant given or a publish. Rolling them back only removes access. Replay never re-adds anything.

### Journaled operations and their replay

Replay applies an intent to the database idempotently. It is safe on any database state, including one where the targets no longer exist, which is a no-op.

| Operation | Intent targets | Replay |
|---|---|---|
| Revoke a key | credentialId, keyId | `revoked_at = coalesce(revoked_at, at)` |
| Rotate a key (the old key's overlap) | credentialId, newExpiry | `expires_at = min(expires_at, newExpiry)`. If the paired new key was lost (an interrupted rotation), the old one still ends; the admin re-issues. |
| Revoke a grant (direct, or by a republish with a changed contract) | grantId, clientId, apiId, routeId | revoke that grant |
| Disable a client | clientId | `status = disabled` |
| Unpublish | apiId | unpublish; revoke every grant to apiId |
| Delete an automation with an API | apiId, automationId | as unpublish, and mark the API retired |
| Demote or delete the publishing admin | userId | the existing withdrawal: unpublish that user's APIs and revoke their grants |
| Recovery (below) | recoveryId, epoch range | revoke every credential and grant created before the recovery |

### Startup decision

E is the database epoch. J is the highest intent seq in the journal; its status is commit, abort or none.

| State | Meaning | Action | Result |
|---|---|---|---|
| E = J, J committed or aborted | normal | — | normal |
| E = J, J unmarked | crash after the commit, before the mark | append `commit(J)` | normal |
| E = J − 1, J aborted | the operation failed | — | normal |
| E = J − 1, J unmarked | crash before or during the commit, **or** a restore to exactly the state before the last operation (identical states) | replay J in one transaction, `epoch = J`, append `commit(J)` | normal (safe replay: the withdrawal the admin asked for is applied) |
| E < J and any intent in (E, J] is committed, or E < J − 1 | **the database is older than revocations that were committed** | replay every intent in (E, J] in one transaction; set `suspended` | **fail-closed suspension** |
| E > J | the journal is older than the database (the secrets volume was restored or replaced) | — | **suspension** |
| journal missing or unreadable, E > 0 | external state lost | — | **suspension** |
| journal missing, E = 0, binding new (first H3 start) | upgrade to H3 | create the journal at seq 0 | normal (restores of backups taken before H3 are not detectable; documented) |
| a broken chain or MAC failure before the last line | tampering or corruption | — | **suspension** |
| only the last line torn (short or unparseable) | crash during an append | discard that line, then decide as above | per row above |
| `installationId` differs from the keyring and database | a database from another installation, or a clone | — | **suspension** |
| keyring missing | H2 | refuse to start (H2) | — |

**The review's scenario:**
- Under this protocol, step 3's power failure happens after the intent N+1 is durable.
- After the database restore to N, startup sees E = N and J = N+1, unmarked, and replays N+1.
- The credential is revoked again before any request is served. The old access never becomes valid.

**If the backup is older than N:** the intents between it and N are committed, so the restore is **detected**. Every later withdrawal is replayed **and** machine access is suspended pending recovery.

**Why replay is complete for withdrawals:** every reduction since any epoch is in the journal, in order. Replaying (E, J] on a database at E reproduces every revocation made after that database was saved. Additions made after the backup are absent from it, so the result never grants more than the live system last did.

### Crash-state matrix (one operation)

| Interruption | Durable state afterwards | Next start |
|---|---|---|
| Before step 1 completes (a torn last line) | journal ends at J−1 (the torn line is discarded); database at J−1 | normal; the operation did not happen and the admin saw no success |
| After step 1, before or during step 2 | intent J durable, unmarked; database at J−1 (the transaction rolled back) | safe replay applies J |
| After step 2, before step 3 | intent J; database at J | mark committed; normal |
| After step 3, before the response | complete | normal (the admin may retry; revoking again is a no-op) |
| Step 2 fails, `abort(J)` durable | aborted | normal; the operation did not happen |
| Step 2 fails, crash before `abort(J)` is durable | intent J unmarked; database at J−1 | safe replay **applies** J. A revocation the admin saw fail may still take effect, never the reverse. |
| Step 1 refused (journal unwritable) | no intent; database unchanged | suspended until the journal is writable |
| Crash during replay | the replay transaction rolls back; the journal is unchanged | replay again (idempotent) |
| Crash during recovery (below) | recovery intent durable, unmarked or uncommitted | the recovery replays to completion; a second attempt finds nothing left; the same `recoveryId` is never applied twice with different effects |

### Restores of SQLite and WAL files

| Restored | Effect | Outcome |
|---|---|---|
| An older `aeolus.db` and its `-wal` (a consistent older state) | E smaller | detected (suspension) or safe replay (one step) |
| `aeolus.db` without its `-wal` | an older consistent state | same |
| An older `aeolus.db` with the current `-wal` left behind | SQLite ignores a WAL whose salt does not match | same as the older database |
| A database from another installation | `installationId` mismatch | suspension |
| A database from before H3 | no epoch table; the migration creates E = 0 while the journal has J > 0 | E < J with committed intents: suspension |

### Suspension (as decided)

- A missing or invalid key is still 401, and an unknown or ungranted route still 404.
- A route that is otherwise authorised gets a **fixed 503** (`Retry-After`, "Machine access is suspended pending administrator review"). **No published handler runs.**
- No response mentions the epoch, the journal or recovery.
- The dashboard shows a persistent recovery-required warning to admins, and the Endpoints view shows the recovery page.
- **The Aeolus Remote connector** classifies 503 as `remote-unavailable`: the reading stays as last-known but is **stale**, never fresh. An integration test will drive a real suspended exposed router with a real connector and check `stale: true` and `staleReason: "remote-unavailable"`.

### Recovery: restored credentials are invalidated, not reinstated

Clearing a flag never restores access. Recovery is one journaled operation (intent, then commit), shown to the admin with counts of what it will invalidate.

1. Revoke **every** machine credential and **every** grant present in the restored database. This includes those not revoked after the backup, because the database's history can no longer be trusted.
2. Record audit entries: `access.restore-detected` (with no epoch values exposed outside the admin audit), then `access.recovery` with counts.
3. Clear `suspended`.

Clients and published APIs are kept so the admin need not rebuild them, but every client has **no working key and no grant**. The admin must issue new keys and grant routes explicitly, and update each remote installation with its new key.

The recovery page lists what was revoked after the backup (from the journal) so the admin understands what happened. Nothing is preselected for re-issue.

### Dashboard sessions and authority (also exposed by a restore)

A restore also brings back:
- refresh tokens revoked after the backup (logout, sessions ended by an admin);
- users deleted or demoted after it;
- **old passwords** changed after it, which matters if the change was made because a password leaked;
- MQTT device credentials removed after it (the broker `password_file` is regenerated from the database).

Proposed as **H3b**, with the same journal:
- **Journal these too:** user disabled, deleted or demoted; password changed (the intent carries the new bcrypt hash, a one-way hash, not the password); sessions revoked; MQTT credential removed.
- **Replay them on any start.**
- **On a detected restore, also:** revoke every refresh token (everyone signs in again), rotate the JWT signing secret through H2 when it is not externally supplied, and rewrite the broker `password_file` after replay.

Your call: H3b inside H3, or as a following phase. I recommend inside, because the same restore that resurrects a key resurrects a leaked password.

### Filesystem ordering

- **Appends:** `open(O_APPEND)`, write the whole line, `fsync(fd)`. A new file also gets `fsync` on its directory.
- **Lines are self-delimiting and MACed**, so a torn tail is detectable and discarded. Only the last line may be torn; anything else is corruption.
- **Journal segments rotate at 1 MiB.** A new segment starts with a `base` record carrying the previous chain hash, created by write-temp, fsync, rename and directory fsync.
- **Retention:** segments are kept for `AEOLUS_KEY_RETENTION_DAYS` (shared with H2), so any restorable backup can be replayed. A database older than the oldest segment is treated as detected and suspended.
- **Windows:** directory fsync is not available (development only; documented). Linux is the supported target.

### What cannot be protected

- A rollback of the **whole machine**, or of both volumes together: an SD-card or disk image, a VM snapshot, or restoring the database and the secrets volume from the same backup set. The journal goes back with the database, and no on-host mechanism can tell.
- Detecting that needs a witness off the host that cannot be rolled back (another installation, a remote service, a TPM monotonic counter), which is out of scope.
- An attacker with write access to the secrets volume **and** the keyring can forge the journal. (H2's same-host limits apply.)
- Two clones running at once with copies of the same state.
- These are documented, with the operational advice: back up the secrets volume separately from the database, and never restore both from the same snapshot unless you intend a full rollback. In that case, run recovery manually: `aeolus-secrets access-recovery --force` performs the same invalidation.

### Tests (to be written with the implementation)

- The required scenario against real copied databases (SQLite backup API), plus the review's power-failure scenario using a fault-injection hook between steps.
- Every row of the startup table and the crash-state matrix, each operation type in the replay table, and journal faults (torn tail, broken chain, MAC failure, missing file, wrong installation).
- Duplicate and interrupted recovery; normal restarts in a loop; a migration run.
- The suspended 503 contract (401 and 404 unchanged, no handler executed), and the Remote connector staying stale.
## Phases and approvals after this checkpoint

| Next | Needs |
|---|---|
| H2a–H2c | Approval of H2 revision 2 (the real-copy test is approved, after synthetic tests) |
| H3 (and H3b) | Approval of H3 revision 2, and whether H3b is included (503 while suspended is decided) |
| H4 | Peer CA option for Aeolus Remote (F6), the HTTPS-only test route, `/try` path parameters (F8), metrics auth (F9) |
| H5, H6 | As planned |
