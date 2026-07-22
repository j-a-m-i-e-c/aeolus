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

The backend image ships an entrypoint (`docker-entrypoint.sh`) that repairs the
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
- frontend typecheck;
- frontend tests with coverage.

### On main pushes

- backend image build;
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
