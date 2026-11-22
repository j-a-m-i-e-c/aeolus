# Project APIs: implementation plan

**Status:** Phase 0 complete on `feat/project-apis`, awaiting review before Phase 1.
**Decision record:** [ADR-0027](../adr/0027-project-apis.md). This plan is the
implementation detail behind it, and replaces the original "Aeolus Project APIs —
Implementation Specification" (reviewed against `f0cf75d`).

## Ground rules

- Development happens on `feat/project-apis`. Each phase gets separate commits and its
  own tests, and merges to `main` only after review. Phase 0 stops for architecture and
  security review.
- The existing gates all pass: `tsc` (root, e2e, frontend), ESLint, backend and frontend
  coverage suites, project compiler and migration tests, and the real-isolate sandbox
  tests. **A skipped isolate test is not a passing security check.**
- No new runtime dependencies. Validation uses Zod 4 (already installed, including
  `fromJSONSchema`/`toJSONSchema`). Compilation uses esbuild. The sandbox uses isolated-vm.
- Types follow the data: `unknown` at untrusted inputs, Zod-inferred types after
  validation, and no `any` or cast that pretends to validate.
- The rules below do not change: existing projects behave exactly as before, the dashboard
  is unchanged, command evidence is retained indefinitely, the authored outbound HTTP
  policy (ADR-0020) is untouched, and the public-demo boundary (ADR-0023) still fails
  closed.

## Corrections to the original specification

| Original assumption | Actual code | Consequence |
|---|---|---|
| Handlers can come from the project's compiled Logic | The Logic entry always calls `automation()`, and esbuild removes unimported named exports | Separate API bundle with a generated entry (done in Phase 0) |
| Restrict capabilities by passing fewer references to the sandbox | The Logic bootstrap reads device, MQTT, HTTP and state references without checking they exist | Dedicated API setup script (done in Phase 0) |
| The sandbox's 5 s timeout bounds handlers | It bounds synchronous code only | Host wall-clock deadline plus `dispose()` (done in Phase 0) |
| A request can use `fire()` | One run record per request, duplicate suppression, shared execution slots | `invokeApiHandler()`, outside the engine |
| "Persisted with project revisions" | One counter on `automation_rules`, no history; toggling doesn't bump it | Immutable publication snapshots carry their own revision |
| `apiEntry` can be added to the project payload | Zod strips unknown keys, so the field would be silently dropped | Schema change in Phase 1. The API is found by convention (`api/routes.json`), so no new entry field is needed |
| The public-demo guard covers new routes | It only inspects demo sessions | Explicit `config.publicDemo.enabled` check: the router is not mounted |
| Reuse audit logging and log redaction | Neither exists. The request logger records query strings | New audit table; the router rejects query strings and logs the path only |
| Automation ids work as API identity | Random UUIDs, recreated on every reseed | Permanent API id plus an admin-chosen slug |
| Only admins edit projects | Tab writers can edit any automation exposed on their tab | Snapshots: edits never change what is served |
| Ownership survives layout saves | Every layout save nulled `owner_tab_id` | Fixed on `main` in `1430c87`, with regression tests |
| An automation's `http.get` can reach another Aeolus | The outbound policy blocks RFC 1918, 100.64/10 (Tailscale) and ULA addresses | Phase 5 uses a dedicated connector |
| Connector secrets are protected | Plain JSON in SQLite, masked only in API responses | Secrets stay out of logs, exports and responses; encryption at rest is a separate ADR |
| The editor has room for an "API" section | "API" is already the API-reference panel | The new section is called **Endpoints** |

## Phase 0: design validation and sandbox proof (complete)

**Delivered**
- `src/project-api/manifest.ts`:
  - Manifest schema: version 1, at most 16 routes, GET only, strict keys.
  - Route ids and handler names, with reserved names (`default`, `__proto__`, `then`…) refused.
  - Path grammar and overlap detection.
  - The response-schema subset, with size and depth caps.
  - Request-path matching: literals compared raw, parameters decoded once, with encoded `/` or `\`, dot segments, control characters and values over 128 bytes refused.
  - A response validator built with `z.fromJSONSchema`.
- `src/project-api/api-compiler.ts`:
  - Builds the API bundle from a generated entry that names each handler.
  - Restricts imports to `api/` and `lib/` across the whole graph, and to `.ts`/`.js`/`.json`.
  - No packages, URLs or dynamic package imports.
  - Strict mode, and a content hash of the manifest plus bundle.
- `src/project-api/api-sandbox.ts`, `invokeApiHandler()`:
  - A fresh isolate with a read-only state view and the frozen `state` and `api` globals.
  - Values cross the boundary as copies only.
  - Statuses 200/400/404; a missing handler, an invalid body, a body over 64 KiB, a thrown error and memory exhaustion are each classified.
  - A host deadline that disposes the isolate, and a cap on concurrent isolates.
- Tests:
  - 51 manifest and 18 compiler unit tests.
  - 26 real-isolate tests, all of which ran here on Windows; none were skipped.
- This plan and ADR-0027.

**What the proof established** (all by tests in
`src/__integration__/project-api-sandbox.integration.test.ts` and `src/project-api/*.test.ts`)
1. Compilation runs no author code: a top-level `throw` in a handler compiles. Imports
   outside `api/` and `lib/` are refused with file and line, including one made by a `lib/`
   file on behalf of `api/`.
2. A response-bearing handler returns plain JSON to the host, synchronously or async, with
   `api.response(404)` for "not found".
3. The isolate has no automation, device, network, storage or host capability, and no raw
   bridge reference. State is read-only, frozen and copied, so mutating a returned value
   does not touch the host. The request is frozen. Author code cannot replace `state` or
   the invoker.
4. Errors propagate as classified results. A `__proto__` key returns as plain data and
   never pollutes host prototypes. Unserializable, cyclic and `undefined` bodies are
   refused.
5. The host ends, within deadline + 300 ms, a synchronous top-level loop, a synchronous
   handler loop, **a CPU loop after an `await`** (while the host event loop keeps running)
   and a promise that never settles. Memory exhaustion is classified `memory`. The
   concurrency cap returns `busy` and frees its slot. Each request starts from a fresh
   isolate, so nothing leaks between requests.
6. An end-to-end local GET built from these pieces returns 200 with a schema-valid body,
   404 from the handler for an unknown id, and 404 for an encoded slash or unknown path.
   The project's Logic is not in the API bundle, so requests cannot run it.

**Measured:** median 1.8 ms and p90 2.2 ms per request on the development PC (Windows,
Node 24.14), including isolate creation, script compilation and invocation. This still needs
measuring on a Pi 4/5 in Phase 3; caching compiled code per snapshot is available if
needed.

**Phase 0 is not:** wired into project compilation, routing, storage or the UI. Nothing in
it is reachable at runtime.

## Phase 1: declarative compilation, snapshots and storage

**Compilation**
- `compileAutomationProject()` calls `compileProjectApi()` when `api/routes.json` or
  `api/handlers.ts` exists. API errors use the existing `details` shape, so the editor
  shows them with file and line.
- Projects without an API compile exactly as today.
- `automationProjectSchema` needs no new field: the API is found by its fixed paths, which
  avoids a second source of truth.

**Migration 021** (registered in `src/db/migrations/index.ts`, with a colocated test, and
`src/db/database.ts` legacy path reviewed)
- `project_apis`
  - `id` (random, permanent)
  - `automation_id` UNIQUE, `REFERENCES automation_rules ON DELETE CASCADE`
  - `slug` UNIQUE
  - `enabled` default 0
  - `current_content_hash`
  - `created_at`, `updated_at`
- `project_api_retired_slugs`: `slug` PK, `api_id`, `retired_at`. Never deleted.
- `project_api_snapshots` (immutable)
  - `id`, `api_id`
  - `manifest`, `bundle`, `content_hash`
  - `automation_revision`, `runtime_contract`
  - `published_by`, `published_at`
- `project_apis.published_snapshot_id` points to the snapshot being served, or is null when
  nothing is published.

**Save flow** (unchanged contract: compile outside the transaction, then one transaction
guarded by `revision = ?`, with the invalidation emitted only after commit)
- The same transaction updates `current_content_hash`.
- It never creates, alters or enables a snapshot.

**Acceptance**
- A valid manifest compiles, and an invalid, overlapping or reserved one fails with a
  location.
- A failed save leaves the previous Logic, UI, API source and snapshot intact.
- `If-Match` conflicts still return 409.
- Deleting the automation removes its API, snapshots and grants, and the slug moves to
  retired.
- Every existing seed project compiles unchanged, and the showcase compile test covers
  `api/` when present.

## Phase 2: clients, keys, grants and the request pipeline

**Migration 022**
- `api_clients`: `id`, `name`, `status` (`active` | `disabled`), `created_by`, timestamps.
- `api_credentials`
  - `id`, `client_id`, `key_id` UNIQUE, `secret_hash` (SHA-256)
  - `last4`, `expires_at`, `revoked_at`
  - `last_used_at`, updated at most once a minute
- `api_grants`
  - `client_id`, `api_id`, `route_id`
  - `access` (`read`), `granted_by`, `granted_at`
  - Unique on (`client_id`, `api_id`, `route_id`).
- `api_audit_events` (append-only)
  - `at`, `actor_user_id`, `action`, `client_id`, `api_id`, `route_id`, `detail`
  - No secrets.

**Management API** (`/api/project-apis/…`, under the normal JWT stack)
- A **real-admin** guard: `requireAdmin` lets a demo session through on GET, so it is not
  used here.
- Operations:
  - publish and unpublish, which snapshot the current compile
  - set and rename the slug
  - create and disable clients
  - issue, rotate (with explicit overlap) and revoke keys
  - grant and revoke routes
  - read recent activity
- A key is returned once from issue and rotate. Machine keys are refused on every
  management route.

**`/api/exposed/v1/:slug/*` router**, mounted before `authenticate` in `src/index.ts`
- Terminal: it never falls through to dashboard routes.
- CORS off, cookies ignored, GET/HEAD only, query strings rejected.
- Request URL and header bounds.
- Not mounted in public-demo mode.
- Pipeline order and status codes as in ADR-0027.
- Responses carry `X-Request-Id`, `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.
- Metrics label the route as `/api/exposed/:slug/:route`.

**Republish grant rule:** a grant survives only for routes whose path, handler name and
response schema are unchanged.

**Negative security tests** (all required)
- No key, a malformed key, an unknown key id, a wrong secret (same 401 for each), an
  expired key, a revoked key and a disabled client never reach the sandbox.
- A key in the query string, a dashboard JWT, a refresh cookie and a demo session are all
  refused.
- A valid key reaching an ungranted route, an unknown slug, a retired slug or a removed
  route gets 404, indistinguishable from a nonexistent one.
- A new route on a republished snapshot is not callable under the old grant.
- An API key on any `/api/...` management or dashboard route gets 401, and a request with a
  valid JWT to `/api/exposed/*` doesn't fall through.
- POST, PUT, DELETE and PATCH get 405, and OPTIONS gets no CORS approval.
- `{ "role": "admin" }` or `__proto__` in headers or the path changes nothing.
- An oversized URL or headers are refused.
- No key material appears in logs, the admin log buffer, metrics, audit rows or error
  bodies (asserted by capturing log output).

## Phase 3: runtime, limits and snapshot enforcement

- The router executes the published snapshot through `invokeApiHandler()` with a state
  reader bound to the API's automation id.
- Mapping: 200 with a schema-validated body; the handler's 400 or 404; 500 for an invalid
  body or a thrown error; 504 for the deadline; 503 for a disabled automation, a lost
  authority, a runtime-contract mismatch, an unpublished API or a busy sandbox.
- In-memory limits per credential and per client (default 60/min, 2 concurrent), plus the
  server-wide isolate cap. Limits are configurable within ceilings, and responses carry 429
  and `Retry-After`.
- **Acceptance**
  - Status mapping holds for each case above.
  - Concurrent calls never exceed the configured limits.
  - Hung handlers never exhaust the process.
  - A GET never writes state, publishes MQTT, sends a command or makes an outbound request
    (asserted with spies on every bridge).
  - Editing the project after publishing serves the old snapshot, and the Endpoints section
    reports unpublished changes.
  - A restart resets limits, which is documented.
  - Measured on a Pi.

## Phase 4: OpenAPI, Endpoints UI and documentation

- An OpenAPI 3.1 document is generated from the **published snapshot** (paths, parameters,
  response schemas via `z.toJSONSchema`, bearer auth, the error responses, and
  `operationId` taken from the route id). It is admin-only to download and validated in
  tests with a standard OpenAPI parser, added as a dev dependency only.
- **Endpoints** section in the Automation Project editor: a new component covered by the
  frontend gate. It keeps separate panels for:
  - declared routes and compile errors
  - publication status, slug, effective URL, and the published-versus-current difference
    with a Publish button
  - API clients and their grants
  - credentials (key id, last four characters, expiry, last used), issued with a one-time
    reveal and copy
  - recent activity

  Non-admins see it read-only; the server enforces this regardless. Read-only in public
  demo. A curl example uses a placeholder key.
- **Documentation**
  - `docs/reference/api.md`
  - a new `docs/reference/project-apis.md` covering the author guide, statuses and limits
  - `docs/security/tokens-and-api.md`, which currently defines API clients as JWT holders
    and has a stale public-route table
  - the threat model
  - operations: LAN/VPN, a reverse-proxy example, backups, and key rotation and revocation
  - the CHANGELOG
- **Acceptance**
  - The OpenAPI document validates.
  - The documentation matches the published snapshot.
  - The demo build cannot publish or create clients.
  - Disabling publication takes effect on the next request.

## Phase 5: Aeolus-to-Aeolus connector

- A bundled connector, `src/connectors/aeolus-remote/`, registered in `src/index.ts`. Each
  instance has:
  - a base URL
  - an API key (a `password` field)
  - the endpoint path
  - a poll interval within bounds
  - a maximum response size
  - an explicit **Allow plaintext HTTP on a trusted LAN** flag
- **Transport** (its own; ADR-0020's authored-HTTP policy is untouched)
  - Only the configured host, so private and VPN addresses are allowed for that host alone.
  - HTTPS by default. HTTP only with the flag, which shows a warning in the UI and in the
    log once per connection.
  - An HTTPS URL is never downgraded, and there are no cross-origin redirects (at most two
    same-origin ones).
  - Response size cap, total timeout, and an explicit per-request connection-attempt
    timeout.
- **Device:** one read-only device per instance whose state is `{ data, sourceTime,
  fetchedAt, stale, httpStatus, error }`. It is always returned, so a failed poll marks
  the data stale instead of leaving it looking current. Health follows the last fetch.
- **The dual-stack connection issue is investigated on its own:** reproduce Node's 250 ms
  per-address attempt limit against long-round-trip dual-stack hosts in the backend's
  `fetch` and `https.request` paths. Fix it with a per-request option rather than a
  process-wide default, and decide separately whether `requestPublicHttp` needs the same
  fix.
- **Secrets:** check that the connector key never appears in logs, exports or responses,
  including a fix for the generic edit form posting the `********` mask back over a stored
  secret. Encryption at rest is a separate ADR.
- **Demonstration** on a Pi and a PC on the same LAN, designed so two Pis also work:
  1. A publishes a `GET /conditions/summary` endpoint from Northern Rivers.
  2. B stores a key granted to that route only.
  3. B renders the remote data with its source time.
  4. Disconnect them: both keep working locally, and B's reading turns visibly stale.
  5. Revoke the key: B fails closed.
  6. Rotate the key: it survives a connector restart.

## Phase 6 (separate approval)

POST and device-command endpoints, with request schemas, `command` grants, idempotency
keys, replay protection, tighter per-route limits, audit attribution and `CommandService`
evidence semantics. Also out of scope until then: webhooks, WebSocket subscriptions,
discovery or federation, anonymous public APIs, OAuth/OIDC, delegated client management,
billing and Kong integration.

## Threat model coverage

| Threat | Covered by |
|---|---|
| Author code at compile time | Phase 0 (compiler tests) |
| Logic or UI code reached from an API, including via `lib/` | Phase 0 |
| Sandbox escape to `process`, `require`, MQTT, devices, HTTP, Shared State or the Data Store | Phase 0 (capability test) |
| State mutation through a GET | Phase 0 (no set/delete, copies); Phase 3 (bridge spies) |
| Long-running promises, async CPU loops, memory exhaustion | Phase 0 |
| `__proto__` keys, cyclic and oversized bodies | Phase 0 |
| Encoded-path traversal and ambiguous routes | Phase 0 |
| Credentials copied from a browser session; dashboard JWTs or demo sessions used as keys | Phase 2 |
| Keys in URLs or logs | Phase 2 |
| Revoked, expired or ungranted keys, unknown slugs, removed routes | Phase 2 |
| A changed handler or new route under an old grant | Phase 1 snapshots, Phase 2 republish rule |
| CORS, OPTIONS, method confusion, fall-through to dashboard routes | Phase 2 |
| Proxy trust spoofing | Phase 2 (existing `TRUST_PROXY_HOPS`; limits keyed by credential, not IP) |
| Concurrent quota admission | Phase 3 |
| Source deleted or edited during a request | Phase 3 (the snapshot is read once per request) |
| SSRF through the outbound connector | Phase 5 (configured host only, redirect rules) |

## Review points for the end of Phase 0

1. **Snapshots instead of auto-disable.** Edits never change what is served, and the
   Endpoints section reports unpublished changes. Auto-disable is reserved for a lost
   authority, a disabled automation and a runtime-contract mismatch.
2. **Ungranted routes return 404 rather than 403,** so a key holder cannot probe for APIs
   it was not given.
3. **The server cannot tell LAN from VPN, or know whether a client used TLS through a
   proxy.** The HTTPS requirement is enforced on the calling side, in the Phase 5
   connector. An optional server setting could refuse requests not marked secure by a
   trusted proxy (`req.secure`); proposed as off by default for LAN use.
4. **Query strings are rejected in the MVP** rather than passed to handlers.
5. **The shared-code directory is `lib/`.**
6. **A new append-only audit table** for publication, client, credential and grant changes.
