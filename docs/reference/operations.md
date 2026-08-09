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

The provisioning service needs writable access to the Mosquitto configuration and password file, plus a way to reload the broker. The default `docker-compose.yml` intentionally does not grant the backend those host/container privileges. Configure Mosquitto manually in that deployment, or provide a narrowly scoped external provisioning mechanism. See [MQTT security](../security/mqtt.md).

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

The public demo (`demo.aeolus.com.au`) runs from a dedicated, self-contained
stack, **`docker-compose.public-demo.yml`** — not the base compose file. It is
separate because the base backend uses host networking for LAN discovery, which
the public demo must not do. The full policy is `docs/AEOLUS_PUBLIC_DEMO_REQUIREMENTS.md`;
this section is the operational summary.

Bring it up on the demo VM:

```bash
CLOUDFLARE_TUNNEL_TOKEN=... DEMO_PUBLIC_ORIGIN=https://demo.aeolus.com.au \
  docker compose -f docker-compose.public-demo.yml up -d --build
```

What the stack enforces:

- **bridge networking only** — no host networking, no LAN discovery;
- the **broker is internal** — port `1883` is never published;
- the backend and frontend **publish no host ports**; **Cloudflare Tunnel**
  (`cloudflared`) is the sole public ingress. Configure the tunnel's public
  hostname to route `/api/*` and `/ws` to `http://backend:3001` and everything
  else to `http://frontend:80` (token-managed tunnels set ingress in the
  Cloudflare dashboard);
- every service runs with `no-new-privileges`, drops all Linux capabilities,
  has `mem_limit`/`cpus` ceilings, and mounts **no Docker socket**;
- `AEOLUS_PUBLIC_DEMO=true` enables the in-app fail-closed guard; managed MQTT
  provisioning stays off (no broker files are written).

### Golden / active database and reset

The demo uses two databases (requirements §18):

```text
/opt/aeolus-demo/
├── golden/aeolus-demo.db   # immutable known-good snapshot (NOT mounted into the app)
└── data/aeolus.db          # active, disposable DB the backend actually uses
```

Only the active directory (`AEOLUS_DEMO_DATA_DIR`) is bind-mounted into the
backend, so the running application can never mutate the golden snapshot. Build
the golden snapshot once by seeding (`--profile seed`) and copying the resulting
`data/aeolus.db` to `golden/`.

`scripts/reset-demo.sh` restores the demo from golden with the orderly sequence
(stop app services → delete the active DB and its WAL/SHM → copy golden → active
→ start → health-check via `scripts/demo-health-check.sh`). The database is only
swapped while the backend is stopped, so it is never overwritten under a running
Aeolus. Reset is a presentation mechanism, **not** a security control — the demo
stays safe even if it never runs.

A nightly reset (~03:30 Australia/Sydney) is scheduled with the systemd units in
`scripts/systemd/` (`aeolus-demo-reset.{service,timer}`):

```bash
sudo cp scripts/systemd/aeolus-demo-reset.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aeolus-demo-reset.timer
```

### Deploy and manual reset workflows

Two `workflow_dispatch` GitHub Actions drive the demo VM over SSH and are gated
behind the `demo` environment (require admin review):

- **Deploy Aeolus Demo** (`.github/workflows/deploy-demo.yml`) — verify a chosen
  ref, then deploy and health-check it. Never auto-runs on `main`.
- **Reset Public Demo** (`.github/workflows/reset-demo.yml`) — run
  `reset-demo.sh` on demand (emergency restore).

Both need `secrets.DEMO_SSH_HOST` / `DEMO_SSH_USER` / `DEMO_SSH_KEY` and
`vars.DEMO_APP_DIR`. The `CLOUDFLARE_TUNNEL_TOKEN` and golden/active paths live
in an `.env` on the demo host, never in the workflow.

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
