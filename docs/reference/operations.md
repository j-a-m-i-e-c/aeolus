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
| `LOG_LEVEL` | `debug` outside Compose | pino level |
| `NODE_ENV` | `development` | Runtime environment |
| `STATE_HISTORY_MAX` | `100` | History entries per device |
| `HISTORY_RECORD_INTERVAL` | `5000` | Minimum stored-history interval |
| `RATE_LIMIT_RPM` | `1000` | Global requests per minute per IP |
| `CORS_ORIGINS` | empty | Additional allowed origins |
| `JWT_SECRET` | generated and stored | Optional explicit JWT signing key |
| `METRICS_TOKEN` | unset | Optional bearer token for `/metrics` |
| `AEOLUS_PROJECT_DIR` | process working directory | Mosquitto config root for provisioning-enabled deployments |
| `MQTT_PASSWORD_FILE` | `<project>/mosquitto/password_file` | Password-file path for provisioning-enabled deployments |

Docker Compose also accepts deployment variables such as `API_PORT`, `FRONTEND_PORT`, `MQTT_PORT`, `BUILD_COMMIT` and `BUILD_DATE`. The browser endpoints `VITE_API_URL` and `VITE_WS_URL` are Vite build-time variables, not backend runtime variables.

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

The provisioning service needs writable access to the Mosquitto configuration and password file, plus a way to reload the broker. The default `docker-compose.yml` provides that plumbing without a Docker socket: `./mosquitto` is shared with the backend and broker, and the `mosquitto-reloader` sidecar watches that directory and sends Mosquitto `SIGHUP` after atomic config changes. Dashboard-managed Shared Password / Per-Device provisioning is still deliberately opt-in behind `MQTT_MANAGED_PROVISIONING_ENABLED=true`; with the default `false` setting, manage broker credentials through the deployment instead. See [MQTT security](../security/mqtt.md).

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

Simulated actuators are ordinary generic MQTT devices. Their acknowledgement capability is configured through the normal `PUT /api/devices/:id/mqtt-command-profile` path by a seed-time bootstrap (`scripts/seed/simulator-bootstrap.mjs`), not by the simulator itself.

In the public-demo overlay the simulator runs as a `simulator` service (no published ports, internal broker only):

```bash
make demo-up        # backend demo mode + simulator
make demo-reset     # restart the simulator; it republishes initial state on reconnect
```

The reference `reference-water` scenario is a conformance fixture, not a public tab. See `.kiro/specs/phase-2-mqtt-simulator/` for the design and the Phase 3 migration handoff.

## Public demo deployment (hardened)

The hosted demo (`demo.aeolus.com.au`) uses the standalone
`docker-compose.public-demo.yml`. It is intentionally separate from the base
stack because the public demo must never use host networking or LAN discovery.

The deployment is split into two layers:

```text
infra/public-demo (Terraform)
  -> Lightsail + static IP + SSH firewall + Cloudflare Tunnel/DNS/ingress

scripts/deploy + docker-compose.public-demo.yml
  -> immutable Aeolus release + active/golden demo lifecycle
```

See **`infra/public-demo/README.md`** for the complete first-deployment runbook.

### Runtime / build separation

The Lightsail host does **not** build Aeolus. `docker-compose.public-demo.yml` is
runtime-only and consumes `AEOLUS_APP_IMAGE` / `AEOLUS_FRONTEND_IMAGE`. Local or
CI builds use the explicit `docker-compose.public-demo.build.yml` overlay.

For a first deployment, the recommended path is operator-PC `transfer` mode:

```bash
./scripts/deploy/deploy-demo-from-pc.sh
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
./scripts/deploy/seed-demo-and-create-golden.sh
```

`scripts/create-demo-golden.sh` stops DB writers, checkpoints SQLite WAL, runs an
integrity check, preserves the prior golden, and creates the new read-only snapshot.
Checksum and metadata sidecars are built as fresh temporary files and atomically
renamed into place so a previous `0444` sidecar is never truncated in place. The
new checksum is verified before the snapshot is accepted. On success, and on
interrupted/failure recovery, ownership of the active runtime database is restored
to the configured backend uid/gid before backend/simulator restart.

`scripts/reset-demo.sh` requires the golden `.sha256` sidecar and refuses to stop
services or replace the active database unless verification succeeds. The systemd
timer in `scripts/systemd/` restores the demo around 03:30 Sydney each day.
`deploy-demo-from-pc.sh` enables that timer only when the golden DB and checksum
both exist and verify successfully; failure leaves the timer disabled. The external
Cloudflare release gate is also fatal rather than advisory. Manual remote reset
from an operator machine is:

```bash
./scripts/deploy/reset-demo-remote.sh
```

Reset remains a presentation-quality mechanism, not a security boundary.

### GitHub release workflow

`.github/workflows/deploy-demo.yml` no longer SSHes to the VM. A manually
dispatched workflow verifies the selected ref and publishes commit-addressed
backend/simulator + frontend images to GHCR. The operator then deploys those
images from a source-restricted PC in `registry` mode.

This keeps the Lightsail SSH firewall independent of GitHub-hosted runner IPs.
For the first deployment, GHCR is optional; local image transfer is simpler.

Terraform state under `infra/public-demo` contains sensitive Cloudflare tunnel
material and is ignored by Git. Treat it as a secret.

## Logging

The backend uses pino structured logs.

A bounded in-memory log buffer supplies the dashboard log viewer. Container logs use size and file-count rotation in Docker Compose.

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
- `/api/system/version` reports build information and checks the public GitHub main branch for a newer commit.

Aeolus reports update availability but does not update itself from the dashboard. Upgrades are applied through the deployment environment.

## CI

GitHub Actions runs:

### On pushes and pull requests

- repository-wide ESLint;
- backend typecheck;
- backend tests with coverage;
- broker-backed integration + vertical E2E tests (a dedicated `integration` job
  on an ubuntu runner that pre-pulls `eclipse-mosquitto:2` and runs the
  `__integration__` suite — the Docker-gated tests that self-skip on dev
  machines without Docker);
- frontend typecheck;
- frontend tests with coverage.

### On main pushes

- backend image build (gated on the `integration` job);
- frontend image build.

### Daily when main changed

- Docker Compose startup;
- Chromium Playwright end-to-end tests;
- failure log and report upload.

## Build commands

```bash
npm ci
npx tsc --noEmit
npx vitest run --coverage
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

The migration runner creates its own pre-migration database checkpoint, but this does not replace an off-host deployment backup.

See [Production deployment](../production-deployment.md).
