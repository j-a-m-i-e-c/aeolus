# Operations reference

## Services and ports

| Service | Default port | Responsibility |
|---|---:|---|
| Mosquitto | `1883` | MQTT broker |
| Backend | `3001` | API, WebSocket, automations, connectors and storage |
| Frontend | `3000` | nginx serving the React application |

The backend uses host networking in Docker so it can reach LAN products and perform UDP discovery for Kasa devices.

## Backend configuration

| Variable | Default | Purpose |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | Broker URL |
| `MQTT_TOPICS` | `#` | Comma-separated subscription filters |
| `PORT` | `3001` | Backend port |
| `DB_PATH` | `./data/aeolus.db` | SQLite path |
| `LOG_LEVEL` | `info` (`.env.example` and Compose) | pino level; source development may set `debug` |
| `NODE_ENV` | `production` (`.env.example` and Compose) | Runtime environment; source development may set `development` |
| `STATE_HISTORY_MAX` | `100` | History entries per device |
| `HISTORY_RECORD_INTERVAL` | `5000` | Minimum stored-history interval |
| `RATE_LIMIT_RPM` | `1000` | Global requests per minute per IP |
| `CORS_ORIGINS` | empty | Additional allowed origins |
| `TRUST_PROXY_HOPS` | `0` | Trusted reverse-proxy hops; `1` behind exactly one local HTTPS proxy |
| `TRUSTED_PROXY_ADDRESSES` | `loopback` | Addresses a trusted hop must come from (addresses, CIDR ranges, `loopback`, `linklocal`, `uniquelocal`). A peer outside the list cannot set `X-Forwarded-For`/`-Proto`, whatever the hop count. Invalid values stop startup |
| `BIND_ADDRESS` | unset | Interface the backend listens on; `127.0.0.1` behind a same-host proxy |
| `AEOLUS_SECRETS_DIR` | `secrets` beside the database directory (`/app/secrets` in containers) | Where the keyring lives. Must not be inside the database directory; startup refuses that |
| `AEOLUS_KEYRING_FILE` | `<AEOLUS_SECRETS_DIR>/keyring.json` | The keyring file. It must be writable by the backend; see [Secrets at rest](#secrets-at-rest) |
| `EXPOSED_API_REQUIRE_HTTPS` | `false` | Serve published Project APIs only when Express establishes HTTPS: direct TLS, or `X-Forwarded-Proto` from a hop trusted by `TRUST_PROXY_HOPS` |
| `EXPOSED_API_REQUESTS_PER_MINUTE` | `60` | Project API requests per key and per client per minute (1–600). In memory: resets on restart |
| `EXPOSED_API_CONCURRENT_PER_CLIENT` | `2` | Project API requests one client may have running at once (1–8) |
| `AUTH_COOKIE_SECURE` | `auto` | Refresh-cookie `Secure` policy (`auto`, `true`, `false`) |
| `JWT_SECRET` | generated and stored | Optional explicit JWT signing key |
| `METRICS_TOKEN` | unset | Optional bearer token for `/metrics` |
| `AEOLUS_PROJECT_DIR` | process working directory | Mosquitto config root used to locate broker files in a custom runtime |
| `MQTT_PASSWORD_FILE` | `<project>/mosquitto/password_file` | Live broker password-file path; the standard Compose stack sets this itself |
| `AEOLUS_E2E` | unset | `true` only on the disposable E2E stack (`e2e/docker-compose.e2e.yml`). Adds `"e2e": true` to `/api/health` so the destructive Playwright suite will run; changes no behaviour. Never set it on a real installation |

Docker Compose also accepts deployment variables such as `API_PORT`, `FRONTEND_PORT`, `MQTT_PORT`, `BUILD_COMMIT` and `BUILD_DATE`. The browser endpoints `VITE_API_URL` and `VITE_WS_URL` are Vite build-time variables, not backend runtime variables.

`docker-compose.yml` passes an explicit allowlist of backend settings from the project `.env` rather than forwarding the ambient environment. `AEOLUS_PUBLIC_DEMO` is deliberately excluded from that list — only the dedicated public-demo overlays under `demo/compose/` can enable public-demo mode. Reverse-proxy guidance for `TRUST_PROXY_HOPS` lives in [production deployment](../production-deployment.md#7-environment-variables).

Use `.env.example` and `docker-compose.yml` as deployment starting points. `src/config.ts` defines backend runtime defaults, while `frontend/.env.example` documents build-time browser endpoints.

## Container startup and the data volume

The backend image ships an entrypoint (`scripts/docker-entrypoint.sh`) that repairs the
data directory before the application starts. The container begins as root, so
the entrypoint can `chown` the data directory (`DB_PATH`'s parent, default
`/app/data`) to the unprivileged `aeolus` user, then drops privileges with
`gosu` and execs Node. The Node process itself never runs as root.

The backend must be launched with `--no-node-snapshot`, which `isolated-vm`
requires on Node 20 and later. The image `CMD` already carries it, so normal
Compose deployments need no action — but if you override the backend command or
run `node dist/index.js` by hand, carry the flag across. Omitting it does not
reliably fail: the backend usually starts and serves normally while the
automation sandbox runs an unsupported V8 configuration. See
[ADR-0010](../adr/0010-node-24-runtime.md).

This exists because the SQLite database runs in WAL mode and must create
`-wal`/`-shm` sidecar files *in the data directory*. A named volume that was
first created root-owned by an earlier image or run stays root-owned — Docker
does not re-apply image ownership to an existing volume — which previously left
the unprivileged backend unable to write and crash-looping on
`SQLITE_READONLY_DIRECTORY`. The entrypoint self-heals that ownership on every
boot; the chown is skipped when ownership is already correct.

If the container is instead started as an explicit non-root user
(`docker run --user …`), the entrypoint assumes the operator has arranged
writable storage and execs directly. In that case `getDatabase()` still runs a
writability preflight and, if the directory is not writable, fails fast with an
actionable error naming the directory and process uid rather than an opaque
driver error.

## MQTT provisioning deployment boundary

The provisioning service needs writable access to the live Mosquitto configuration and password file, plus a way to reload the broker. The default `docker-compose.yml` provides that plumbing without a Docker socket: a Docker-managed `mosquitto_config` volume is shared with the backend and broker, and the `mosquitto-reloader` sidecar watches that volume and sends Mosquitto `SIGHUP` after atomic config changes. A one-shot init service seeds the volume from the committed `mosquitto/mosquitto.conf` on first creation. The tracked `mosquitto/` directory is never used as mutable runtime storage. Open, Shared Password and Per-Device provisioning are supported by this default Compose plumbing with no feature flags. The backend detects the live broker paths supplied by Compose and initializes managed broker security automatically. See [MQTT security](../security/mqtt.md).

## Demo simulator (Phase 2)

The demo simulator is a **separate process** that emulates MQTT hardware for the public demo and for integration tests. It speaks only MQTT to the broker: it holds no Aeolus credentials, opens no ports, and never touches the Aeolus database or command internals. It is **off by default** — a normal install never runs it.

Run it locally against a broker:

```bash
make sim            # AEOLUS_SIMULATOR_ENABLED=true npm run sim
```

| Variable | Default | Purpose |
|---|---|---|
| `AEOLUS_SIMULATOR_ENABLED` | `false` | Master switch; the process exits unless set to `true` |
| `AEOLUS_SIMULATOR_SCENARIOS` | empty | Comma-separated scenario keys to load (e.g. `reference-water`) |
| `AEOLUS_SIMULATOR_LOG_LEVEL` | `LOG_LEVEL` or `info` | pino level for the simulator |
| `AEOLUS_SIMULATOR_MAX_DELAY_MS` | `15000` | Ceiling for any modelled ACK/state delay |
| `AEOLUS_SIMULATOR_MAX_PENDING_TIMERS` | `200` | Global cap on outstanding delayed operations |
| `AEOLUS_SIMULATOR_MAX_COMMAND_QUEUE` | `100` | Per-device command-queue depth before fail-fast |
| `AEOLUS_SIMULATOR_RANDOM_SEED` | unset | Seed for deterministic telemetry |

Simulated actuators are ordinary generic MQTT devices. Their acknowledgement capability is configured through the normal `PUT /api/devices/:id/mqtt-command-profile` path by a seed-time bootstrap (`demo/seed/simulator-bootstrap.mjs`), not by the simulator itself.

In the showcase overlay the simulator runs as a `simulator` service (no published ports, internal broker only). This is the full unrestricted application with simulated hardware — it does not enable public-demo restrictions:

```bash
make showcase                        # real Aeolus + simulated hardware
make showcase-seed PASS=<password>   # seed the showcase content
make showcase-reset                  # restart the simulator; it republishes initial state on reconnect
```

Add visitor restrictions only when those are what you are testing, with `make public-demo-local`. See [demo/README.md](../../demo/README.md).

`showcase-seed` is a reconcile and is safe to rerun. It reclaims the resources a previous run created: automations by id from the `_showcase:seed-ledger` Shared State bucket, tabs and panes by declared tab id, Collections by declared name, and the explicitly showcase-owned Shared State buckets declared by the seed. Resources outside those showcase-owned namespaces are left alone. Wiping the database is not part of reseeding; `make reset` remains the separate full reset.

The reference `reference-water` scenario is a conformance fixture, not a public tab. Its device models live in `src/simulator/`.

## Public demo deployment (hardened)

The hosted demo (`demo.aeolus.com.au`) uses the standalone
`demo/compose/hosted-runtime.yml`. It is intentionally separate from the base
stack because the public demo must never use host networking or LAN discovery.

The deployment is split into two layers:

```text
demo/infrastructure/terraform (Terraform)
  -> Lightsail + static IP + SSH firewall + Cloudflare Tunnel/DNS/ingress

demo/operations/deploy + demo/compose/hosted-runtime.yml
  -> immutable Aeolus release + active/golden demo lifecycle
```

See **`demo/infrastructure/terraform/README.md`** for the complete first-deployment runbook.

### Runtime / build separation

The Lightsail host does **not** build Aeolus. `demo/compose/hosted-runtime.yml` is
runtime-only and consumes `AEOLUS_APP_IMAGE` / `AEOLUS_FRONTEND_IMAGE`. Local or
CI builds use the explicit `demo/compose/hosted-build.yml` overlay.

For a first deployment, the recommended path is operator-PC `transfer` mode:

```bash
./demo/operations/deploy/deploy-from-pc.sh
```

It builds images locally, streams them over source-restricted SSH, starts the
hardened stack without `--build`, and health-checks the release. A failed health
gate attempts to restore the complete previous deployment source + image configuration.

The production stack enforces:

- bridge networking only;
- no public MQTT/backend/frontend/database ports;
- Cloudflare Tunnel as the sole application ingress;
- SSH as the only Lightsail public port, source-restricted by Terraform;
- `no-new-privileges`, dropped Linux capabilities and resource ceilings;
- no Docker socket mounts;
- active DB mounted into Aeolus, golden DB never mounted into Aeolus.

Cloudflare Tunnel/DNS/ingress are preferably managed by Terraform. Manual
Cloudflare dashboard configuration remains possible by setting
`manage_cloudflare=false`.

### Golden / active database and reset

```text
/opt/aeolus-demo/
├── app/
├── golden/aeolus-demo.db   # immutable, verified reset source
└── data/aeolus.db          # active disposable DB
```

After seeding/reviewing the final release, run on the demo host:

```bash
./demo/operations/deploy/seed-and-create-golden.sh
```

`demo/operations/create-golden.sh` stops DB writers, checkpoints SQLite WAL, runs an
integrity check, preserves the prior golden, and creates the new read-only snapshot.
Checksum and metadata sidecars are built as fresh temporary files and atomically
renamed into place so a previous `0444` sidecar is never truncated in place. The
new checksum is verified before the snapshot is accepted. On success, and on
interrupted/failure recovery, ownership of the active runtime database is restored
to the configured backend uid/gid before backend/simulator restart.

`demo/operations/reset.sh` requires the golden `.sha256` sidecar and refuses to stop
services or replace the active database unless verification succeeds. The systemd
timer in `demo/operations/systemd/` restores the demo around 03:30 Sydney each day.
`demo/operations/deploy/deploy-from-pc.sh` enables that timer only when the golden DB and checksum
both exist and verify successfully; failure leaves the timer disabled. The external
Cloudflare release gate is also fatal rather than advisory. Manual remote reset
from an operator machine is:

```bash
./demo/operations/deploy/reset-remote.sh
```

Reset remains a presentation-quality mechanism, not a security boundary.

The golden database is bound to the demo's keyring (`AEOLUS_DEMO_SECRETS_DIR`), which a reset keeps. A golden created before the upgrade that encrypts stored secrets has no binding, and the backend refuses to start on it once the keyring is bound ([Secrets at rest](#secrets-at-rest)). After deploying that upgrade, recreate the golden with `seed-and-create-golden.sh` before the next reset.

### GitHub release workflow

`.github/workflows/deploy-demo.yml` no longer SSHes to the VM. A manually
dispatched workflow verifies the selected ref and publishes commit-addressed
backend/simulator + frontend images to GHCR. The operator then deploys those
images from a source-restricted PC in `registry` mode.

This keeps the Lightsail SSH firewall independent of GitHub-hosted runner IPs.
For the first deployment, GHCR is optional; local image transfer is simpler.

Terraform state under `demo/infrastructure/terraform` contains sensitive Cloudflare tunnel
material and is ignored by Git. Treat it as a secret.

## Logging

The backend uses pino structured logs.

A bounded in-memory log buffer supplies the dashboard log viewer. Container logs use size and file-count rotation in Docker Compose.

Logs must not contain credentials (`src/log-safety.ts`, tested end to end by `log-safety.integration.test.ts`):

- request bodies are never logged; a body the parser refuses (malformed JSON, too large) is logged as a category, method, path and request id, and the response carries the same request id with a fixed message;
- errors are logged as type, message, stack and scalar codes only, never the bodies, configs or headers attached to them;
- fields named like secrets (`password`, `apiKey`, `token`, `secret`, `authorization`, `body`) are censored;
- request paths, authored HTTP URLs and webhook targets are logged without query strings;
- a final pass over every line, before stdout and the log buffer, masks Project API keys, JWTs and bearer tokens.

Free-form secrets such as passwords have no recognisable shape, so the last pass cannot catch them; they are kept out by never logging bodies.

## Metrics

`prom-client` exposes:

- process and runtime metrics;
- HTTP metrics;
- MQTT throughput;
- device and automation counts;
- automation execution data.

Prometheus output is served at `/metrics`. When `METRICS_TOKEN` is set, requests require its bearer token.

The authenticated dashboard summary is served at `/api/metrics/summary`.

`MetricsHistoryService` can write selected aggregated metrics into the Data Store when it is enabled.

## Health and diagnostics

- `/api/health` reports backend, broker, device and automation status.
- `/api/system` reports host details.
- `/api/system/logs` reports recent application logs.
- `/api/system/version` reports local build information without making a network request. An administrator can explicitly run `POST /api/system/version/check` to compare the installed semantic version with the latest published GitHub release.

Aeolus reports update availability but does not update itself from the dashboard. Upgrades are applied through the deployment environment.

## CI

GitHub Actions runs:

### On pushes and pull requests

- repository-wide ESLint;
- backend typecheck;
- backend tests with coverage (`npm run test:coverage:no-broker`), which excludes the
  seven Docker-gated suites owned by the `integration` job below. The remaining
  `__integration__` suites are broker-free and stay in this pass because the global
  90% branch threshold depends on them;
- broker-backed integration + vertical E2E tests (a dedicated `integration` job
  on an ubuntu runner that pre-pulls `eclipse-mosquitto:2` and runs the whole
  `__integration__` suite serially via `npm run test:integration` — the Docker-gated
  tests self-skip on dev machines without Docker);
- frontend typecheck;
- frontend tests with coverage.

### On main pushes

- backend image build (gated on the `integration` job);
- frontend image build.

### Daily when main changed

- startup of the disposable E2E stack (`e2e/docker-compose.e2e.yml`), not the base stack;
- Chromium Playwright end-to-end tests;
- an API-key scan of the test artifacts and report;
- failure log and report upload, skipped when the scan finds a key.

## Build commands

```bash
npm ci
npx tsc --noEmit
npm run test:coverage:no-broker
npm run build

cd frontend
npm ci
npx tsc --noEmit -p tsconfig.json
npm run test:coverage
npm run build
```

## Backups and upgrades

Before changing a production installation:

1. back up the database and deployment configuration;
2. pull or build the new images;
3. start the backend and allow migrations to complete;
4. check health, logs and connector status;
5. verify the important physical paths.

The migration runner creates its own pre-migration database checkpoint, but this does not replace an off-host deployment backup. Back up the keyring as well as the database ([Secrets at rest](#secrets-at-rest)).

See [Production deployment](../production-deployment.md).

## Secrets at rest

The backend encrypts the credentials it stores (hardening H2): every connector `password` field (the Hue and Aeolus Remote API keys), the database JWT secret (used when `JWT_SECRET` is unset) and the backend and shared MQTT passwords. User passwords, refresh tokens, Project API keys and MQTT device passwords are stored only as hashes and are unchanged. The cryptography is described in [Tokens and API keys](../security/tokens-and-api.md#keyring).

**The keyring.** The root keys live in a keyring file in `AEOLUS_SECRETS_DIR`, on its own volume (`aeolus_secrets` in Compose), never in the database volume. The backend must be able to write it: it records its first binding there, and key rotation updates it. On the first start of a database that has no keyring binding and when no keyring exists, a keyring is created and the database is bound to it. From then on the database **will not start without that keyring**, and a replacement is never generated. Back it up with `aeolus-secrets backup` (passphrase-protected) and keep the backup off the host: see [Production deployment](../production-deployment.md#the-keyring-back-it-up-separately).

**The first start after upgrading** encrypts the existing secrets before any service reads them, keeping their values, so dashboard sessions, MQTT devices and connectors carry on unchanged:

1. A checkpoint copy of the database is written to `AEOLUS_SECRETS_DIR/pre-secrets-<time>.db` (private, outside the database directory). It holds the old plaintext.
2. Every secret is encrypted into a staging table and decrypted again to check it; plaintext is untouched.
3. One transaction replaces every value with its encrypted form and marks the database encrypted. A crash leaves either all plaintext (the next start repeats the migration) or all encrypted.
4. Every value is compared with the checkpoint, the checkpoint is deleted, and the database is compacted (`VACUUM`, WAL truncation).

The log reports what was encrypted, never a value. A connector that held the literal `********` instead of its key (an old bug) has the field cleared and asks for the key again.

**When startup refuses.** Each refusal names the cause and the command; nothing is changed.

| Cause | What to do |
|---|---|
| The keyring is missing | Restore it: `aeolus-secrets restore --in <keyring-backup>` |
| The keyring belongs to another installation, or lacks a key the database needs | Restore this installation's keyring backup (one that holds the named key ids) |
| The keyring is readable by other users (POSIX) | `chmod 600` the file and `chmod 700` its directory |
| The keyring has been bound before, but this database has no binding: an older backup from before encryption, restored over a bound installation, or a different database | If it is the database you intend to run: `aeolus-secrets adopt --db <path>`, then start (its secrets are then encrypted) |
| The database is encrypted, but a secret location holds plaintext: a deliberate restore or edit, or an older release has run against it | If deliberate: `aeolus-secrets migrate --db <path> --reencrypt-plaintext`. Plaintext is never accepted automatically |
| An encrypted value fails to decrypt (modified, moved to another record, or a different key) | Restore the matching keyring, or a database backup that belongs to it |

Run these commands with the backend stopped. In Compose:

```bash
docker compose stop backend
docker compose run --rm --no-deps backend node dist/cli/aeolus-secrets.js verify --db /app/data/aeolus.db
docker compose start backend
```

`verify` opens the database read-only and prints counts, locations and key ids, never a value. `migrate --db <path>` runs the same migration as startup, offline.

**Older releases.** A release before H2 cannot read encrypted values. Going back means restoring a database backup made before the upgrade, with the older release; an explicit decrypting downgrade command is planned (hardening H2c).

**Plaintext that encryption does not remove.** Encryption protects the live database and backups made after it. It does not erase earlier copies of the old values:

- database backups, volume snapshots and VM images made before the upgrade;
- `aeolus.db.pre-migration.*.bak` checkpoints beside the database from earlier schema migrations, and `hue-credentials.json.migrated` from the legacy Hue import (the first start lists any it finds; it does not delete them);
- the deleted stage-1 checkpoint and the old database and WAL pages: `VACUUM` and WAL truncation rewrite the files, but freed filesystem blocks, the filesystem journal, SSD and SD-card wear-levelled blocks, the page cache and swap can keep the old bytes. Deletion is not secure erasure.

Treat those copies as holding the credentials until they expire. To make them worthless, rotate the credentials: regenerate the shared MQTT password from the dashboard (the backend's own broker password is regenerated at every start), rotate each Aeolus Remote key on its publishing installation, and re-pair Hue. A command that also rotates the JWT secret is planned (hardening H2c).
## Project APIs in operation

Published Project APIs ([reference](project-apis.md)) are served by the backend port at
`/api/exposed/v1/<slug>/...`.

- **Network.** The supported deployment is a private LAN or a VPN. Plain HTTP on a trusted
  LAN is an explicit development choice: API keys cross it unencrypted. Otherwise terminate
  TLS in a reverse proxy, set `TRUST_PROXY_HOPS=1` and `EXPOSED_API_REQUIRE_HTTPS=true`, and
  keep the backend port unreachable except through the proxy. The proxy must overwrite
  `X-Forwarded-Proto`, never pass on a client's. A Caddy example:

  ```text
  aeolus.example.lan {
      reverse_proxy /api/exposed/* 127.0.0.1:3001 {
          header_up X-Forwarded-Proto https
      }
  }
  ```

- **Backups.** Publications, snapshots, clients, key hashes, grants and the audit log are all
  in the SQLite database, so the normal database backup covers them. Keys cannot be
  recovered from a backup, only their hashes. **Restoring an older backup restores the access
  it recorded**: a key or grant revoked after the backup was taken is valid again. After a
  restore, review the Endpoints view and revoke again anything revoked since.
- **Keys held by a reading installation.** An installation that reads another with the Aeolus
  Remote connector stores that key in its connector configuration, encrypted under its
  keyring ([Secrets at rest](#secrets-at-rest)). Its database backups contain a usable key only
  together with its keyring, or if made before it encrypted its secrets. Revoke the key on the
  publishing installation if either may have been exposed.
- **Rotation and revocation.** Rotate a key from the Endpoints view, choosing the new key's
  expiry and how long the old one overlaps; revoke a key the moment it may have leaked.
  Both take effect on the next request, without a restart.
- **Limits** are in memory and reset when the backend restarts.
- **Testing from the UI** sends the request from the backend to itself over loopback HTTP.
  With `EXPOSED_API_REQUIRE_HTTPS=true` such a test reports `403`; test through the proxy
  with `curl` instead.
