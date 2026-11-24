# Changelog

Aeolus follows semantic versioning for published releases. Until the first stable release, interfaces may still change as the platform is hardened.

## Unreleased

### Resilient authoring and account sessions

* A temporary Pi/network outage now preserves the active dashboard authentication state and retries, instead of treating a fetch failure or 5xx as credential revocation. `401/403` still ends the session.
* Standard automation editors keep browser-local IndexedDB recovery snapshots of multi-file projects and form fields, with explicit restoration and a pre-save changed-project check.
* Admin user provisioning can choose per-user 1/7/30-day refresh sessions and optional idle logout; access JWTs remain 15 minutes.
* Six retrospective architectural decisions now document resource authority, authored HTTP egress, MQTT topic/identity contracts, connector ownership, public-demo isolation and golden reset. ADR-0025 records this change and is Accepted: crash recovery, concurrent-editor refusal and outage reconnect are verified in a real browser by `e2e/session-drafts.spec.ts`.
* Shared dashboard layout and Automation Project authoring now use server-owned revisions and atomic `If-Match` preconditions. Stale writes return `409` instead of silently replacing another operator's committed change; WebSocket invalidations keep passive clients current while active authors retain their local draft. Recorded in [ADR-0026](docs/adr/0026-multi-user-mutation-consistency.md), verified by a two-browser end-to-end test.

### Project APIs

* Automation Projects can publish read-only HTTP endpoints for other programs, including another Aeolus installation: `api/routes.json` declares GET routes and `api/handlers.ts` implements them. Handlers run in their own sandbox with read-only access to their automation's state. An admin publishes an immutable snapshot under a permanent slug, creates API clients and keys (shown once, SHA-256 hashed), and grants them individual routes. Callers use `Authorization: Bearer` at `/api/exposed/v1/<slug>/...`. Unpublishing, or demoting the admin who published, revokes every grant. All changes are recorded in an append-only audit log. LAN and VPN are the supported networks; `EXPOSED_API_REQUIRE_HTTPS` enforces HTTPS behind a trusted proxy. Management is API-only until the Endpoints editor section ships. See [Project APIs](docs/reference/project-apis.md) and [ADR-0027](docs/adr/0027-project-apis.md).
* The Automation Project editor has an **Endpoints** view, beside Logic and UI, for admins. It shows the declared routes and compile errors, the saved source against the immutable published snapshot, and why an API is or is not being served. Admins create the API's slug, publish after a confirmation of the exact revision, manage API clients, issue keys with an explicit expiry (shown once, with a copy button), rotate and revoke them, grant routes, test a route through the real request pipeline, and download an OpenAPI 3.1 document of the snapshot. Unpublishing, revoking and disabling ask for confirmation that says what is lost. Management responses are never cached, and a public-demo server refuses all of it. See [Project APIs](docs/reference/project-apis.md#publishing-and-access-in-the-editor).
* A client granted some routes of an API gets `404`, never `503`, on its other routes, whatever the API's state. Only a granted route reports that its API is unavailable.
* Rotating an API key now requires the new key's expiry (`expiresAt`, or `null`). It is no longer copied from the old key; `overlapSeconds` separately sets how long the old key keeps working.
* A caller that disconnects has its handler's isolate disposed at once instead of at the 5 s deadline, a string far over the response limit is refused inside the isolate before being copied out (the 64 KiB limit itself is counted exactly in UTF-8 bytes on the host), and neither a state reader failing before the isolate starts nor an isolate that cannot be constructed leaks a concurrency slot. `make bench-project-api` measures latency, CPU and memory on the host it runs on.

### Security and reliability

* Request logs no longer record query strings. They used to log the full URL, so a token a caller put in a query string reached stdout, container logs and the admin log viewer even when the request was rejected. Requests carrying a credential in the query string are now refused with 400, and an API key or JWT pasted into a path is masked in logs and metrics. See [tokens and API](docs/security/tokens-and-api.md#credentials-in-urls).
* Saving the dashboard layout no longer strips tab-scoped automations of their owning tab. Every save used to delete and reinsert all tabs, which cleared `owner_tab_id` through its `ON DELETE SET NULL` constraint, so a reorder or rename left those automations with no devices or collections in scope. Deleting the owning tab still clears ownership, and re-adding a tab with the same id does not restore it.
* WebSocket access tokens are sent only in the first authenticated message and are no longer accepted from query strings.
* Refresh cookie security can be selected explicitly or left in automatic mode for local HTTP versus public HTTPS deployments.
* High rate device state now uses keep latest execution coalescing while discrete Automation Events remain separate and are never coalesced.
* Device Registry state persistence is batched and flushed transactionally, including during graceful shutdown.
* The dashboard host CSP no longer requires inline script execution.
* Version information is local only until an administrator explicitly asks Aeolus to check GitHub releases.
* The Mosquitto reload watcher is built with its dependencies instead of installing packages when the stack starts.
* Open, Shared Password and Per-Device MQTT security are now first-class capabilities of the standard Compose stack with no provisioning feature flags. Mode changes, restart persistence and Per-Device revocation were field-verified on a Raspberry Pi deployment.
* The Mosquitto reload sidecar arms its directory watch immediately and performs a startup reconciliation reload, eliminating the first Open-to-authenticated transition race.
* Dashboard copy controls now fall back to the browser selection/`execCommand` path when the modern Clipboard API is unavailable or denied, including local-LAN HTTP access to a Pi.
* The standard Compose path now explicitly propagates documented security/runtime settings from `.env` while keeping public-demo mode overlay-only.
* Reverse-proxy trust is explicit and hop-bounded so HTTPS scheme detection and per-client rate limiting work behind a known Caddy/nginx hop.
* Ordinary `interact` users can fire only named UI events or the constrained atomic state-set primitive; arbitrary fire-context injection is admin-only.
* The atomic state-set primitive clears the same key, value and allowlist bounds as a direct state write, in public-demo sessions as well, so firing is never a looser route into automation state. `saveAndFire()` now works inside the public demo.
* Philips Hue local traffic uses HTTPS with bridge-certificate identity checks and treats Hue application-level error objects inside HTTP 2xx responses as failures.
* Hue bridge exchanges are time-bounded, so a peer that accepts a connection and stalls the TLS handshake can no longer hold a command open indefinitely.
* Authored `http.get/post` accept an optional `timeoutMs` for slow public services. The default stays 10 seconds and requests are clamped to 1–25 seconds so they finish inside a run's 30-second completion budget ([ADR-0020](docs/adr/0020-authored-http-egress-boundary.md)). A timed-out request now reports `Outbound request timed out after N ms` instead of a bare abort message.

### Automation state and showcase

* Existing Data Store buckets are now first-class Shared Automation State: durable current values shared between unrestricted automations, always available independently of historical Collections.
* Shared State changes can trigger automations internally with keep-latest coalescing and never publish to MQTT.
* Identical private Automation State and Shared State writes are no-ops, avoiding unnecessary SQLite writes and broadcasts.
* Bunker, mine and vessel overview composition now uses Shared State instead of snapshot-like Automation Events.
* Off-grid bunker water consumption follows wall time independently of the accelerated power simulation clock.
* A Northern Rivers showcase tab (the Regional Conditions automation) maps measured regional data on a hand-drawn SVG map: WaterNSW river heights and rainfall gauges with quality flags and retained history, plus NSW RFS fire danger and incidents. Every reading shows its freshness, and a failing source keeps its last data marked stale.
* Media capture mode (`?capture=1`) for hand-recorded showcase video hides dashboard editing chrome and demo-scenario controls. It exists only in showcase builds.
* Seeding the showcase now refuses an install that has its own automations or tabs and has never held the showcase; `FORCE=1` overrides. `make deploy` stops a leftover simulator.
* Execution history retention is an admin setting on the System page: 7 days by default, 1 to 3650 days, or kept forever. It now runs at startup, every six hours and when the setting is saved; execution history used to be pruned first 24 hours after boot, so a backend restarted daily never pruned it. Command evidence is never pruned automatically. See [history retention](docs/reference/data-and-storage.md#history-retention).
* The Northern Rivers tab draws the gauged rivers (Geoscience Australia, CC BY 4.0) with the main ones named, labels each river gauge with its height in metres, can overlay animated RainViewer radar, keeps hourly rainfall quality flags, and replaces a WaterNSW reading that is revised later. Radar comes from an optional collector (`scripts/radar/`) that publishes a sampled colour grid over MQTT; the dashboard draws it itself and loads no external images. `make showcase` runs the collector; the hosted demo needs the `radar` Compose profile. See [scripts/radar/README.md](scripts/radar/README.md).

### Operations

* Raspberry Pi installs can pin `AEOLUS_REF` to a release tag or commit.
* A repeatable MQTT load generator is available under `scripts/bench/` for Pi testing.
* Release and multi architecture CI validation has been expanded.
* Release-tag validation now repeats lint, coverage, broker-backed integration and Chromium sandbox-boundary gates before multi-architecture image validation.
* Deployment pulls are fast-forward-only and the hosted Cloudflare Tunnel image is pinned instead of following `latest`.
