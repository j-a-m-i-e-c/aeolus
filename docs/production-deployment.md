# Production Deployment Guide

A practical guide for running Aeolus on a Raspberry Pi in production. Covers authentication, MQTT security, TLS, firewalling, backups, monitoring, and updates.

Aeolus runs as four long-running services defined in `docker-compose.yml`, plus a one-shot Mosquitto config initializer:

| Service | Network | Port | Description |
|---------|---------|------|-------------|
| `mosquitto-config-init` | one-shot | — | Seeds the Docker-managed live Mosquitto config volume from the committed baseline on first creation |
| `aeolus-mosquitto` | bridge | `1883` | Eclipse Mosquitto MQTT broker |
| `aeolus-mosquitto-reloader` | shares Mosquitto's PID namespace | — | Sidecar that watches the shared Mosquitto config volume and sends `SIGHUP` to the broker when the password file or config changes |
| `aeolus-backend` | **host** | `3001` | Express API + automation engine + WebSocket |
| `aeolus-frontend` | bridge | `3000` → `8080` | React dashboard (nginx-unprivileged) |

> The backend uses `network_mode: host` so it can do UDP-broadcast discovery (Kasa) and reach LAN devices (Hue bridge) directly. That means the backend binds port `3001` straight onto the host rather than through Docker port mapping.

> The `seed` service is defined behind the `seed` Compose profile for one-shot demo seeding. It is **not** started by `docker compose up` — run it on demand (`make seed PASS=...`).

---

## 1. Authentication & First-Run Setup

Authentication is always on — there is no anonymous/disabled mode for the dashboard. On first launch (no admin exists yet), Aeolus serves a **Setup Page** on every route. Create the admin account there:

- Username (non-empty)
- Password (minimum 8 characters)

After setup you get a JWT-based session: a short-lived access token (15 min) held in memory plus an httpOnly refresh cookie (7 days). Non-admin users belong to groups with per-tab `read` / `interact` / `write` permissions.

For the full auth model — token flow, group permissions, user management API, and emergency admin recovery — see **[security reference](security/README.md)**.

### JWT secret

By default Aeolus generates a random 256-bit signing key on first run and stores it in the database. To pin it across rebuilds (recommended if you ever restore to a different machine), set `JWT_SECRET`. Changing the secret invalidates all existing sessions.

---

## 2. MQTT Broker Security

The committed `mosquitto/mosquitto.conf` ships with `allow_anonymous true` — fine for a trusted LAN during setup, but you should lock it down for production.

### Security modes in Aeolus

The **Security → MQTT Security** screen supports three modes:

| Level | Description |
|-------|-------------|
| **Open** | No authentication, for development or a tightly trusted network |
| **Shared Password** | One credential shared by external devices |
| **Per-Device** | A separate username and password for each device |

The backend provisioning service can write the Mosquitto configuration and password file, then reload the broker. The default Compose stack wires this up through the Docker-managed `mosquitto_config` volume (`MQTT_PASSWORD_FILE` / `MQTT_CONFIG_FILE`) and the `aeolus-mosquitto-reloader` sidecar, which `SIGHUP`s Mosquitto when the files change (`MQTT_RELOAD_STRATEGY=none`; the backend writes files and lets the sidecar reload). A one-shot init service seeds the runtime volume from the committed `mosquitto/mosquitto.conf` when the volume is first created. The tracked `mosquitto/` directory is source-only and is never recursively owned by a running container. No Docker socket is mounted; the reload happens over a shared PID namespace, not the Docker API.

> **Opt-in by default:** dashboard-managed provisioning (Shared Password / Per-Device) is gated behind `MQTT_MANAGED_PROVISIONING_ENABLED`, which defaults to `false`. The plumbing above is present, but the managed security levels stay disabled until you set `MQTT_MANAGED_PROVISIONING_ENABLED=true`. With it disabled, use the manual procedure below. The Docker socket is deliberately never mounted — do not expose it to make this feature work.

See [MQTT security](security/mqtt.md) for the credential model and provisioning API.

### Manual broker configuration

If dashboard-managed provisioning is disabled, manage the live Docker volume directly rather than editing the tracked `mosquitto/` source directory. Start the broker once so the config volume is created and seeded:

```bash
docker compose up -d mosquitto
```

Create or update a broker password inside the live config volume:

```bash
docker compose exec -u 0 mosquitto \
  mosquitto_passwd -b -c /mosquitto/config/password_file aeolus 'replace-this-password'
```

Add more users without `-c`, because `-c` recreates the file:

```bash
docker compose exec -u 0 mosquitto \
  mosquitto_passwd -b /mosquitto/config/password_file another-user 'another-password'
```

Copy the current live config out, edit it locally, then copy it back. This deliberately operates on runtime state rather than the committed template:

```bash
docker compose cp mosquitto:/mosquitto/config/mosquitto.conf ./mosquitto.runtime.conf
```

Set the relevant lines to:

```conf
listener 1883
allow_anonymous false
password_file /mosquitto/config/password_file
persistence true
persistence_location /mosquitto/data/
log_dest stdout
```

Then install it into the live volume and reload the broker:

```bash
docker compose cp ./mosquitto.runtime.conf mosquitto:/mosquitto/config/mosquitto.conf
docker compose exec -u 0 mosquitto kill -HUP 1
rm ./mosquitto.runtime.conf
```

Configure the backend credential in `.env`, URL-encoding reserved password characters:

```env
MQTT_BROKER_URL=mqtt://aeolus:replace-this-password@localhost:1883
```

Recreate the backend and inspect the logs:

```bash
docker compose up -d --force-recreate backend
docker logs aeolus-mosquitto --tail 50
docker logs aeolus-backend --tail 50
```

Back up the `mosquitto_config` Docker volume with the rest of the deployment state if you manage broker credentials manually.

---

## 3. HTTPS via Reverse Proxy

The default frontend build talks directly to `http://<host>:3001` and `ws://<host>:3001/ws`. When the dashboard itself is served over HTTPS, browsers will block those insecure requests. Build the frontend with secure API and WebSocket URLs before placing it behind a reverse proxy.

For a single origin such as `https://aeolus.local`, create `frontend/.env.production.local`:

```env
VITE_API_URL=https://aeolus.local
VITE_WS_URL=wss://aeolus.local/ws
```

Then rebuild the frontend:

```bash
docker compose build --no-cache frontend
docker compose up -d frontend
```

Keep that local environment file out of version control if it contains site-specific hostnames.

### Caddy example

```caddyfile
https://aeolus.local {
  tls internal

  handle /api/* {
    reverse_proxy localhost:3001
  }

  handle /ws {
    reverse_proxy localhost:3001
  }

  handle {
    reverse_proxy localhost:3000
  }
}
```

```bash
sudo systemctl reload caddy
```

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name aeolus.local;

    ssl_certificate /etc/ssl/certs/aeolus.crt;
    ssl_certificate_key /etc/ssl/private/aeolus.key;

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://localhost:3000;
    }
}
```

Public tunnels should point at the reverse proxy, not only at the frontend container, so `/api` and `/ws` share the same protected origin. Restrict public access with the tunnel provider's identity controls as well as Aeolus authentication.

For either example, set `TRUST_PROXY_HOPS=1` in the project `.env` and recreate the backend. Caddy supplies the forwarded scheme/client address automatically; the nginx example above sets them explicitly. With exactly one trusted hop, `AUTH_COOKIE_SECURE=auto` sees the original HTTPS scheme and the rate limiter keys requests by the original client IP rather than by the proxy. Leave `TRUST_PROXY_HOPS=0` when clients connect to Aeolus directly.

---

## 4. Firewall Rules

Use UFW to restrict access to the LAN only. Replace `192.168.1.0/24` with your actual subnet.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (so you don't lock yourself out)
sudo ufw allow ssh

# Allow Aeolus ports from the LAN only
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp  # Frontend
sudo ufw allow from 192.168.1.0/24 to any port 3001 proto tcp  # Backend API
sudo ufw allow from 192.168.1.0/24 to any port 1883 proto tcp  # MQTT

# Deny those ports from anywhere else (implicit with default deny, but explicit is clearer)
sudo ufw deny 3000
sudo ufw deny 3001
sudo ufw deny 1883

sudo ufw enable
sudo ufw status verbose
```

> UFW processes rules in order. The `allow from LAN` rules match before the `deny` rules for LAN traffic, while WAN traffic hits the deny rules.

---

## 5. Backup & Restore

Aeolus application state such as configuration, automations, users, history and Data Store content lives in a single SQLite database (`better-sqlite3`, WAL mode) inside a Docker volume. Mosquitto is a separate service and can persist broker/security state (for example credentials) outside that database, so back up any deployment-specific broker files as well when you use them.

> **Data volume ownership.** The backend runs as an unprivileged user and needs to write to the data directory (WAL mode creates `-wal`/`-shm` sidecar files there). The container entrypoint automatically fixes the volume's ownership on boot, so a fresh deployment just works. If you ever see the backend crash-loop with `SQLITE_READONLY_DIRECTORY` or a "Data directory is not writable" error (for example after restoring a backup with `sudo`, which can leave root-owned files), correct the ownership and restart:
>
> ```bash
> docker compose run --rm --no-deps --user root --entrypoint sh backend -c "chown -R aeolus:aeolus /app/data"
> docker compose restart backend
> ```

### Locate the database

Docker Compose volume names depend on the project directory or `-p` project name. Ask Docker for the mounted host path instead of assuming a fixed volume name:

```bash
BACKEND_DATA_DIR=$(docker inspect aeolus-backend \
  --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}')
DB_PATH="$BACKEND_DATA_DIR/aeolus.db"
printf '%s\n' "$DB_PATH"
```

### Safe backup

Because the database runs in WAL mode, copying only `aeolus.db` while the backend is running can miss data still in the write-ahead log.

**Option A: stop, copy, restart**

```bash
mkdir -p "$HOME/backups/aeolus"
docker compose stop backend
sudo cp "$DB_PATH" "$HOME/backups/aeolus/aeolus-$(date +%Y%m%d-%H%M%S).db"
docker compose start backend
```

**Option B: SQLite online backup**

Install the SQLite CLI on the host, then create a consistent snapshot without stopping Aeolus:

```bash
mkdir -p "$HOME/backups/aeolus"
sudo sqlite3 "$DB_PATH" \
  ".backup '$HOME/backups/aeolus/aeolus-$(date +%Y%m%d-%H%M%S).db'"
```

### Automated nightly backup

Create `~/scripts/backup-aeolus.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="$HOME/backups/aeolus"
RETENTION_DAYS=14
BACKEND_DATA_DIR=$(docker inspect aeolus-backend \
  --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}')
DB_PATH="$BACKEND_DATA_DIR/aeolus.db"

mkdir -p "$BACKUP_DIR"
sudo sqlite3 "$DB_PATH" \
  ".backup '$BACKUP_DIR/aeolus-$(date +%Y%m%d-%H%M%S).db'"
find "$BACKUP_DIR" -name 'aeolus-*.db' -mtime +"$RETENTION_DAYS" -delete
```

```bash
chmod +x ~/scripts/backup-aeolus.sh
crontab -e
```

```cron
0 3 * * * /home/pi/scripts/backup-aeolus.sh >> /home/pi/backups/backup.log 2>&1
```

### Restore

Stop the stack before replacing the database:

```bash
BACKEND_DATA_DIR=$(docker inspect aeolus-backend \
  --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}')
docker compose down
sudo cp "$HOME/backups/aeolus/aeolus-20260717-030000.db" \
  "$BACKEND_DATA_DIR/aeolus.db"
docker compose up -d
```

### Automatic pre-migration backups

When Aeolus upgrades to a new version that includes schema migrations, it automatically creates a WAL-consistent backup of the database before applying any changes. These are stored alongside the DB file as `aeolus.db.pre-migration.<timestamp>.bak` (the 5 most recent are retained). If an upgrade goes wrong, you can restore from one of these without needing your own backup. Migrations are transactional — a failed migration rolls back cleanly and Aeolus refuses to start rather than leaving the database half-changed.

---

## 6. Monitoring

### Health endpoint

```bash
curl http://localhost:3001/api/health
```

Returns MQTT connection state, device count, uptime, and memory usage. Use it for external monitoring.

### Prometheus metrics

The backend exposes `/metrics` in Prometheus text-exposition format (MQTT throughput, device counts, automation execution, HTTP stats, WebSocket connections, system resources).

```bash
curl http://localhost:3001/metrics
```

If you set `METRICS_TOKEN`, the endpoint requires `Authorization: Bearer <token>` and bypasses JWT auth so Prometheus can scrape it without a user account. When unset, the endpoint is open (fine for local-only deployments). Aeolus also has a built-in two-tier metrics history with charts in the **Data** tab, so Grafana is optional.

### Docker health checks

The backend container declares a healthcheck (`wget --spider http://localhost:3001/api/health`, 30s interval, 3 retries). Docker reports an unhealthy status, but Compose does not restart a running container solely because its healthcheck fails. Use an external monitor, systemd policy or another narrowly scoped supervisor if automatic recovery is required.

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

### Container logs

```bash
docker logs aeolus-backend --tail 100
docker logs aeolus-backend -f
docker logs aeolus-backend 2>&1 | grep -i error
```

Application logs are also viewable in the dashboard's **System** tab.

### Simple uptime alert

```cron
# Check health every 5 minutes, notify on failure
*/5 * * * * curl -sf http://localhost:3001/api/health > /dev/null || echo "Aeolus backend is DOWN" | mail -s "Aeolus Alert" you@example.com
```

Or run [Uptime Kuma](https://github.com/louislam/uptime-kuma) on the same Pi for a dashboard with notifications.

---

## 7. Environment Variables

`docker-compose.yml` explicitly allowlists the supported backend settings from the project `.env` file. This keeps normal configuration predictable without passing every ambient shell variable into the container. `AEOLUS_PUBLIC_DEMO` is intentionally excluded; only the dedicated public-demo overlays can enable that mode.

| Variable | Default | Production value | Description |
|----------|---------|------------------|-------------|
| `NODE_ENV` | `production` in Compose | `production` | Suppresses stack traces in error responses; source development may override to `development` |
| `PORT` | `3001` | `3001` | Backend API port (set via `API_PORT` in compose) |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | deployment-specific | Broker URL; set it in `.env` when the broker requires credentials |
| `MQTT_TOPICS` | `#` | `#` | MQTT subscription filter |
| `DB_PATH` | `./data/aeolus.db` | `/app/data/aeolus.db` | Database path (the Docker volume path) |
| `LOG_LEVEL` | `info` in Compose | `info` | Log verbosity (`debug`, `info`, `warn`, `error`); source development may override to `debug` |
| `RATE_LIMIT_RPM` | `1000` | `1000` | Max API requests per minute per IP |
| `CORS_ORIGINS` | _(empty)_ | `https://aeolus.local` | Extra allowed CORS origins (comma-separated); LAN origins are allowed by default |
| `TRUST_PROXY_HOPS` | `0` | `1` behind one Caddy/nginx proxy | Number of trusted reverse-proxy hops; keep 0 for direct/LAN access |
| `AUTH_COOKIE_SECURE` | `auto` | `auto` behind a correctly trusted HTTPS proxy | Refresh-cookie Secure policy |
| `STATE_HISTORY_MAX` | `100` | `100` | Max state-history records kept per device |
| `HISTORY_RECORD_INTERVAL` | `5000` | `5000` | Minimum ms between recorded state-history points (throttle) |
| `JWT_SECRET` | _(auto-generated)_ | _(your 256-bit key)_ | JWT signing key; auto-generated and stored in the DB if unset |
| `MQTT_PASSWORD_FILE` | `mosquitto/password_file` | deployment-specific | Password-file path used only by provisioning-enabled deployments |
| `AEOLUS_PROJECT_DIR` | _(process.cwd())_ | deployment-specific | Project/config root used only by provisioning-enabled deployments |
| `METRICS_TOKEN` | _(empty)_ | _(your token)_ | Bearer token to protect `/metrics`; open when unset |
| `FRONTEND_PORT` | `3000` | `3000` | Frontend container host port |
| `VITE_API_URL` | `http://<host>:3001` | site URL | Build-time frontend API URL, required for HTTPS deployments |
| `VITE_WS_URL` | `ws://<host>:3001/ws` | site WebSocket URL | Build-time frontend WebSocket URL, required for HTTPS deployments |
| `MQTT_PORT` | `1883` | `1883` | MQTT broker host port |

Example production `.env`:

```env
NODE_ENV=production
LOG_LEVEL=info
RATE_LIMIT_RPM=1000
CORS_ORIGINS=https://aeolus.local
JWT_SECRET=replace-with-a-long-random-string
METRICS_TOKEN=replace-with-a-random-token
# Set to 1 only when exactly one trusted reverse proxy terminates HTTPS.
TRUST_PROXY_HOPS=1
AUTH_COOKIE_SECURE=auto
```

When Aeolus is behind one Caddy/nginx reverse proxy, `TRUST_PROXY_HOPS=1` lets Express use that hop's forwarded scheme/IP for secure-cookie detection and per-client rate limiting. Do not set a larger value than the actual trusted proxy chain, and never use an unrestricted `trust proxy=true`.

---

## 8. Updates

Aeolus does **not** self-update from the web UI (that feature, and the Docker socket mount it required, were removed for security — see Section 9). Updates are applied externally.

### Manual update (via SSH)

```bash
cd ~/aeolus
git pull --ff-only origin main
docker compose up --build -d
```

This pulls the latest code, rebuilds images, and restarts containers. The dashboard's **System** tab shows the current build commit and an "update available" badge by comparing against the latest commit on `main` — it surfaces that an update exists, but applying it is a manual step.

### Rollback

```bash
git log --oneline -5
git checkout <previous-commit-sha>
docker compose up --build -d
```

Or restore from a database backup if data was affected (Section 5).

---

## 9. Security Hardening

The default deployment removes several high-risk host-control paths, but it should still be treated as an edge service that needs ordinary network and host hardening:

- **No Docker socket mount** — the backend container has no access to `/var/run/docker.sock`, so a compromised container cannot control the host's Docker daemon. Mosquitto reloads do not require that privilege: the default stack uses a narrowly scoped `mosquitto-reloader` sidecar sharing Mosquitto's PID namespace and watching the shared config directory. Dashboard-managed provisioning itself remains opt-in.
- **Read-only system router** — `/api/system` is GET-only (diagnostics, logs, version check). There are no shutdown, reboot, update, or prune endpoints; host control is done via SSH/Docker, not the web app.
- **No git or Docker CLI in the production image** — the build commit is baked into `dist/build-info.json` at build time, so no runtime git is needed.
- **Backend runs as a non-root user** — the container starts as root only long enough for the entrypoint to repair data-volume ownership, then drops to the unprivileged `aeolus` user via `gosu` before running Node. The application process never runs as root.
- **Authentication always on** — bcrypt (cost 12) password hashing, short-lived JWTs, httpOnly refresh cookies, and login rate-limiting (5 attempts/min per IP).
- **Sandboxed automations** — user scripts run in `isolated-vm` V8 isolates (32 MB cap, 5 s timeout, no filesystem, no module imports).
- **LAN-only by default** — combine with the firewall rules (Section 4) and a TLS reverse proxy (Section 3) for a hardened deployment.

> The production image still includes `python3`, `make`, and `g++` — they're required to compile the native addons (`isolated-vm`, `better-sqlite3`, `bcrypt`) during install. They are build dependencies for those modules, not host-control tooling.
