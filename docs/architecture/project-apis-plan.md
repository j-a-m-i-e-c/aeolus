# Project APIs: implementation plan

**Status:** Phases 0 to 2 complete on `main`, awaiting review before Phase 3.
**Decision record:** [ADR-0027](../adr/0027-project-apis.md). This plan is the
implementation detail behind it, and replaces the original "Aeolus Project APIs —
Implementation Specification" (reviewed against `f0cf75d`).

## Ground rules

- Each phase is committed to `main` once it passes every gate, then stops for review before
  the next phase starts. Unfinished work stays local. (Phases 0 and 1 were developed on
  `feat/project-apis` and fast-forwarded into `main` at `414c1e8`; the branch is deleted.)
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

## Phase 1: compilation, snapshots, storage and audit (complete)

**Delivered**
- **Compilation.** `compileAutomationProject()` compiles the API whenever `api/routes.json`
  exists and returns it as `api`. Every save therefore reports manifest and import errors in
  the editor's existing `details` shape. Projects without a manifest compile exactly as
  before, including ones with other files under `api/`.
  - The compile error class moved to `src/automations/project-compile-error.ts`, and is
    re-exported from its old module, to avoid an import cycle.
- **The API compile records its whole transitive import graph**:
  - `sources`: the manifest plus every file esbuild loaded;
  - `contentHash`: over those sources, so an esbuild upgrade does not count as a code
    change;
  - `bundleHash`.
- **Migration 021:**
  - `project_apis`, `project_api_snapshots`, `project_api_retired_slugs` and
    `project_api_audit`;
  - triggers that make snapshots immutable, make the audit append-only, retire a slug on
    rename or delete (including the foreign-key cascade), and refuse a retired slug unless
    it is reclaimed.
- **`src/project-api/publication-store.ts`:**
  - `setSlug`, with explicit, audited `reclaim`;
  - `publish`, bound to the reviewed content hash and automation revision;
  - `unpublish` and `deleteForAutomation`;
  - `resolve`, which checks every live fact on every call;
  - `listAudit`, keyset-paged, and `storageStats`.

  Each mutation writes its audit record in the same transaction.
- **`/api/project-apis` management routes:**
  - GET status, PUT slug, POST publish and POST unpublish;
  - GET audit, with `limit`/`before`/`apiId` and storage use.

  A real admin is required, which refuses public-demo sessions even on GET. Nothing under
  `/api/project-apis` or `/api/exposed` is on the demo allowlist, which is asserted by a test.
- **Automation delete** removes the API (snapshots cascade, slug retired), audited with the
  deleting user, in the same transaction as the rule delete.
- **Docs:** this plan, ADR-0027, `reference/api.md` and `architecture/AUTOMATION_PROJECTS.md`
  (`api/`, `lib/` and `shared/`, and how they differ from Shared Automation State).

**On `main`, separately:** `a083caa`. Request logs record the path only. Credentials in
query strings are refused with 400. API keys and JWTs pasted into a path are masked in logs
and metrics labels.

**Departures from the plan as previously written** (none changes an approved decision)
1. **Publication management routes moved from Phase 2 to Phase 1.** Publishing, slugs and
   the admin audit read interface need them. Clients, keys, grants and the `/api/exposed`
   router stay in Phase 2.
2. **No `current_content_hash` column.** Whether the source has changed since publication
   is worked out on demand by compiling the current source in the admin status route. The
   project save path is unchanged apart from validating `api/routes.json`.
3. **`api/handlers.ts` without a manifest is not an error.** Only the manifest declares an
   API, so a project saved before this feature cannot start failing.
4. **The publisher must still be an admin.** This is how the decision "do not snapshot an
   administrator's permissions" is implemented: a demoted or deleted publisher stops the API
   until another admin republishes it.
5. **Retired slugs can be reclaimed explicitly** (`reclaim: true`, audited), so a showcase
   reseed or a deliberate migration can point a known URL at a new API.

**Requested Phase 1 tests**

| Requested | Where | Status |
|---|---|---|
| Editing published code while requests are active | `project-api-publication.integration.test.ts` | Done: an in-flight request and later requests run the snapshot; the new code runs only after a republish |
| Restarting Aeolus with an existing snapshot | same file (SQLite file reopened) | Done: same snapshot served; unpublished state also survives restart |
| Disabling and revoking access while an old snapshot exists | store tests and integration | Disable, unpublish, lost authority, demoted or deleted publisher, contract mismatch and bundle tampering all fail closed. **Key revocation needs Phase 2 keys** |
| Accessing an ungranted endpoint | — | **Phase 2** (needs keys, grants and the router) |
| Forged HTTPS forwarding headers | — | **Phase 2** (`EXPOSED_API_REQUIRE_HTTPS` is part of the router) |
| Credentials in query strings | `request-logger.test.ts` on `main` | Done for logging and global refusal. The exposed-router case is **Phase 2** |
| Invalid transitive imports | compiler tests; management route test | Done: `lib/` importing `logic/` is refused with file and line, and cannot be published |
| Failed transaction involving audit records | store tests | Done for create slug, rename, publish, unpublish and automation delete: no change when the audit insert fails |
| Reverting source without reactivating historical grants | store tests | Done for publications: identical reverted content stays unpublished, and republishing creates a new snapshot. **Grant behaviour is Phase 2**, where grants will be revoked on unpublish so none can be reactivated |

## Phase 2: clients, keys, grants and the request pipeline (complete)

**Delivered**
- **Durable publisher withdrawal.** Demoting or deleting the admin who published
  unpublishes their APIs and revokes those grants in the same transaction as the user
  change, audited against the acting admin. Promoting them back restores nothing. Triggers
  on `users` (migration 022) cover every other path. The live publisher check in `resolve()`
  stays as defence in depth.
- **Migration 022:** `api_clients`, `api_credentials` and `api_grants`. Grant rows are
  kept after revocation, with who, when and why.
- **Stores:**
  - `access-store.ts`: clients, keys (issue, rotate with overlap, revoke) and grants, each
    audited in its transaction.
  - `api-keys.ts`: key format, SHA-256 and constant-time comparison.
  - `audit.ts`: the shared audit writer and route fingerprints.
- **Grant lifecycle:**
  - unpublish revokes all of an API's grants;
  - republish revokes grants whose route fingerprint changed;
  - automation delete revokes before the cascade;
  - disable and runtime-contract mismatch revoke nothing.
- **`/api/exposed` router** (`exposed-router.ts`), mounted before `authenticate`:
  - terminal, with CORS skipped for its prefix;
  - a uniform 405, 401 and 404, each with one fixed body;
  - `EXPOSED_API_REQUIRE_HTTPS` through `req.secure`;
  - in-memory per-key and per-client rate and concurrency limits;
  - the snapshot executed in the API sandbox, with the 200 body checked against its schema;
  - a fixed 404 for everything in public-demo mode.
- **Metrics** label all exposed traffic `/api/exposed/:slug/:route`, from the full original
  path.
- **Management routes** for clients, keys and grants. `unpublish` returns `revokedGrants`,
  and a reclaimed slug reports `reclaimedFrom`. The status route caches compiles by
  revision and source hash.
- **Configuration:** `EXPOSED_API_REQUIRE_HTTPS`, `EXPOSED_API_REQUESTS_PER_MINUTE` and
  `EXPOSED_API_CONCURRENT_PER_CLIENT` in `config.ts`, `docker-compose.yml`, `.env.example`
  and `reference/operations.md`.
- **Docs:** the new `reference/project-apis.md`; `reference/api.md`;
  `security/tokens-and-api.md`, which separates dashboard clients from API keys; and
  ADR-0027.

**Departures**
1. **Handler execution, response validation and limits landed in Phase 2**, because your
   Phase 2 requirements include "every request executes the immutable approved snapshot"
   and an in-flight revocation test. Phase 3 shrinks to what is listed there.
2. **A withdrawn approval also revokes that API's grants.** It is treated as an unpublish,
   so the rule "no publication, no grants" has no exception, and a republish by another
   admin needs regranting.
3. **A granted caller sees `503` for an unavailable API. A caller with no grant to it sees
   `404`**, so an API's state is visible only to its grantees.

**Requested tests**

| Requested | Where |
|---|---|
| Demote then promote with no request in between | `user-service.project-api.test.ts`, `publication-store.test.ts` |
| Uniform 401 (12 kinds of bad credential) | `project-api-exposed.integration.test.ts` |
| Indistinguishable 404, including other projects' APIs | same |
| No enumeration through OPTIONS or method errors | same: one 405 body for all methods and paths, with no CORS approval |
| Revocation during an in-flight request | same: the running request finishes, the next is refused |
| Key, grant, client and unpublish revocation on the next request | same |
| Unpublish revokes grants for good, keys keep working elsewhere | same |
| Forged `X-Forwarded-Proto` | same: refused without a trusted proxy, accepted only from a trusted hop |
| Keys in URLs, logs or metrics | same, plus `request-logger.test.ts` |
| Public-demo mode | same, plus `demo-policy.test.ts` |
| Machine key on a management route | `project-api.access.routes.test.ts` (real `authenticate`) |
| Reclaimed slug inherits nothing | integration and route tests |
| Transactional audit | store tests: every mutation rolls back when its audit insert fails |

### Phase 2 design notes kept from the plan


**Migration 022**
- `api_clients`: `id`, `name`, `status` (`active` | `disabled`), `created_by`, timestamps.
- `api_credentials`
  - `id`, `client_id`, `key_id` UNIQUE, `secret_hash` (SHA-256)
  - `last4`, `expires_at`, `revoked_at`
  - `last_used_at`, updated at most once a minute
- `api_grants`
  - `client_id`, `api_id`, `route_id`
  - a `route_fingerprint` (path, handler and response schema hash)
  - `access` (`read`), `granted_by`, `granted_at`
  - Unique on (`client_id`, `api_id`, `route_id`).
- Client, credential and grant changes are audited in `project_api_audit` (from
  migration 021), in the same transaction. No secret material is ever written there.

**Management API** (added to `/api/project-apis`, same real-admin guard)
- Create and disable clients.
- Issue, rotate (with an explicit overlap) and revoke keys.
- Grant and revoke routes.
- Read recent activity.
- A key is returned once, from issue or rotate. Machine keys are refused on every
  management route.

**`/api/exposed/v1/:slug/*` router**, mounted before `authenticate` in `src/index.ts`
- Terminal: it never falls through to dashboard routes.
- CORS off and cookies ignored. Query strings are rejected.
- A uniform `405` for any non-GET/HEAD method (OPTIONS included), before any lookup.
- Request URL and header bounds.
- Not mounted in public-demo mode.
- Pipeline order and uniform error bodies as in ADR-0027.
- `EXPOSED_API_REQUIRE_HTTPS`: when on, a request is served only if `req.secure` is true,
  meaning direct TLS or `X-Forwarded-Proto` from a hop trusted through `TRUST_PROXY_HOPS`.
- Responses carry `X-Request-Id`, `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.
- Metrics label the route as `/api/exposed/:slug/:route`.

**Grant rules**
- Credentials, revocation, client status and grants are always read live, never from a
  snapshot.
- On republish, a grant survives only for routes whose fingerprint is unchanged.
- On unpublish, all grants for the API are revoked, so a later publish (including one of
  reverted source) never reactivates old access.

**Negative security tests** (all required)
- No key, a malformed key, an unknown key id or a wrong secret gets the same `401` and
  body. So do an expired key, a revoked key and a disabled client. None of them reaches
  the sandbox.
- Revoking a key, disabling a client or revoking a grant takes effect on the next request
  while the old snapshot is still published.
- A key in the query string, a dashboard JWT, a refresh cookie and a demo session are all
  refused.
- A valid key reaching an ungranted route, an unknown slug, a retired slug, a removed route
  or **another project's API** gets the same `404` and body as a route that doesn't exist.
- A new route on a republished snapshot is not callable under the old grant. Unpublishing,
  reverting the source and republishing restores no grant.
- An API key on any `/api/...` management or dashboard route gets `401`. A request with a
  valid JWT to `/api/exposed/*` doesn't fall through.
- POST, PUT, DELETE, PATCH and OPTIONS get the same `405` for existing and non-existent
  paths, and OPTIONS gets no CORS approval.
- With `EXPOSED_API_REQUIRE_HTTPS` on, a forged `X-Forwarded-Proto: https` is refused when
  no proxy is trusted, and when it arrives from an untrusted hop.
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

## Review points for the end of Phase 2

1. **Withdrawn approval revokes grants** (departure 2 in the Phase 2 section).
2. **503 only for grantees** (departure 3).
3. **Phase 3 is now small:** measuring on a Pi, the bridge-spy test proving a GET never writes state, publishes MQTT, sends a command or makes an outbound request, and caching compiled scripts per snapshot if the Pi measurements need it.
