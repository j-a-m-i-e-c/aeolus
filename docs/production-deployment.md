# Production Deployment Guide

A practical guide for running Aeolus on a Raspberry Pi in production. Covers authentication, MQTT security, TLS, firewalling, backups, monitoring, and updates.

Aeolus runs as three containers defined in `docker-compose.yml`:

| Service | Network | Port | Description |
|---------|---------|------|-------------|
| `aeolus-mosquitto` | bridge | `1883` | Eclipse Mosquitto MQTT broker |
| `aeolus-backend` | **host** | `3001` | Express API + automation engine + WebSocket |
| `aeolus-frontend` | bridge | `3000` → `80` | React dashboard (nginx) |

> The backend uses `network_mode: host` so it can do UDP-broadcast discovery (Kasa) and reach LAN devices (Hue bridge) directly. That means the backend binds port `3001` straight onto the host rather than through Docker port mapping.

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

The backend provisioning service can write the Mosquitto configuration and password file, then reload the broker. That requires deployment-specific access to those files and to a broker reload mechanism.

> **Default Docker Compose note:** the committed `docker-compose.yml` deliberately does not mount the Docker socket or the Mosquitto configuration into the backend container. As a result, automatic broker reconfiguration from the dashboard is not wired into the default hardened Compose deployment. Use the manual procedure below, or create a narrowly scoped provisioning arrangement for your environment. Do not expose the full Docker socket merely to make this feature work.

See [MQTT security](security/mqtt.md) for the credential model and provisioning API.

### Manual broker configuration

The default Compose deployment is easiest to secure with a host-managed password file and a small override file.

1. Create the password file on the host:

```bash
mkdir -p mosquitto
touch mosquitto/password_file

docker run --rm \
  -v "$PWD/mosquitto:/work" \
  eclipse-mosquitto:2 \
  mosquitto_passwd -b -c /work/password_file aeolus 'replace-this-password'
```

Add more users without `-c`, because `-c` recreates the file:

```bash
docker run --rm \
  -v "$PWD/mosquitto:/work" \
  eclipse-mosquitto:2 \
  mosquitto_passwd -b /work/password_file another-user 'another-password'
```

2. Update `mosquitto/mosquitto.conf`:

```conf
listener 1883
allow_anonymous false
password_file /mosquitto/config/password_file
persistence true
persistence_location /mosquitto/data/
log_dest stdout
```

3. Create a named override file — for example `docker-compose.broker.yml` — so the broker can read the file and the backend uses its own broker credential. Use an explicitly named override (loaded with `-f`) rather than `docker-compose.override.yml`, which Compose would auto-load and apply silently:

```yaml
services:
  mosquitto:
    volumes:
      - ./mosquitto/password_file:/mosquitto/config/password_file:ro

  backend:
    environment:
      MQTT_BROKER_URL: ${MQTT_BROKER_URL}
```

4. Add the URL to `.env`. URL-encode any reserved characters in the password.

```env
MQTT_BROKER_URL=mqtt://aeolus:replace-this-password@localhost:1883
```

5. Recreate the services with the broker override loaded explicitly and inspect the logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.broker.yml up -d --force-recreate
docker logs aeolus-mosquitto --tail 50
docker logs aeolus-backend --tail 50
```

The host password file is ignored by Git. Back it up securely with the rest of the deployment configuration.

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
    }

    location /ws {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location / {
        proxy_pass http://localhost:3000;
    }
}
```

Public tunnels should point at the reverse proxy, not only at the frontend container, so `/api` and `/ws` share the same protected origin. Restrict public access with the tunnel provider's identity controls as well as Aeolus authentication.

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

All persistent state lives in a single SQLite database (`better-sqlite3`, WAL mode) inside a Docker volume.

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

`docker-compose.yml` sets the core backend variables. Compose-level values such as `API_PORT`, `FRONTEND_PORT` and `MQTT_PORT` can be placed in the project `.env` file. Backend variables that are hard-coded in the base Compose file require an override file, as shown in the MQTT example above.

| Variable | Default | Production value | Description |
|----------|---------|------------------|-------------|
| `NODE_ENV` | `development` | `production` | Suppresses stack traces in error responses, enables optimizations |
| `PORT` | `3001` | `3001` | Backend API port (set via `API_PORT` in compose) |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | deployment-specific | Broker URL; override the base Compose environment when credentials are required |
| `MQTT_TOPICS` | `#` | `#` | MQTT subscription filter |
| `DB_PATH` | `./data/aeolus.db` | `/app/data/aeolus.db` | Database path (the Docker volume path) |
| `LOG_LEVEL` | `debug` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `RATE_LIMIT_RPM` | `1000` | `1000` | Max API requests per minute per IP |
| `CORS_ORIGINS` | _(empty)_ | `https://aeolus.local` | Extra allowed CORS origins (comma-separated); LAN origins are allowed by default |
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
```

---

## 8. Updates

Aeolus does **not** self-update from the web UI (that feature, and the Docker socket mount it required, were removed for security — see Section 9). Updates are applied externally.

### Manual update (via SSH)

```bash
cd ~/aeolus
git pull origin main
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

- **No Docker socket mount** — the backend container has no access to `/var/run/docker.sock`, so a compromised container cannot control the host's Docker daemon.
  This also means the current dashboard MQTT provisioning service cannot reload the Mosquitto container in the default Compose deployment. Configure MQTT manually or provide a narrower external reload mechanism.
- **Read-only system router** — `/api/system` is GET-only (diagnostics, logs, version check). There are no shutdown, reboot, update, or prune endpoints; host control is done via SSH/Docker, not the web app.
- **No git or Docker CLI in the production image** — the build commit is baked into `dist/build-info.json` at build time, so no runtime git is needed.
- **Authentication always on** — bcrypt (cost 12) password hashing, short-lived JWTs, httpOnly refresh cookies, and login rate-limiting (5 attempts/min per IP).
- **Sandboxed automations** — user scripts run in `isolated-vm` V8 isolates (32 MB cap, 5 s timeout, no filesystem, no module imports).
- **LAN-only by default** — combine with the firewall rules (Section 4) and a TLS reverse proxy (Section 3) for a hardened deployment.

> The production image still includes `python3`, `make`, and `g++` — they're required to compile the native addons (`isolated-vm`, `better-sqlite3`, `bcrypt`) during install. They are build dependencies for those modules, not host-control tooling.
