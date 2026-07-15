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

For the full auth model — token flow, group permissions, user management API, and emergency admin recovery — see **[`AUTHENTICATION.md`](AUTHENTICATION.md)**.

### JWT secret

By default Aeolus generates a random 256-bit signing key on first run and stores it in the database. To pin it across rebuilds (recommended if you ever restore to a different machine), set `JWT_SECRET`. Changing the secret invalidates all existing sessions.

---

## 2. MQTT Broker Security

The committed `mosquitto/mosquitto.conf` ships with `allow_anonymous true` — fine for a trusted LAN during setup, but you should lock it down for production.

### Recommended: manage it from the dashboard

Aeolus manages MQTT authentication for you from the **Security** tab. Choose one of three levels:

| Level | Description |
|-------|-------------|
| **Open** | No authentication (development / trusted networks) |
| **Shared Password** | One credential shared by all devices |
| **Per-Device** | A unique username/password per device |

Switching levels regenerates the Mosquitto password file and reloads the broker automatically. Per-device credentials are created under **Security → MQTT Credentials**; the password is shown once on creation. The backend maintains its own credential (`aeolus-backend`) automatically. See [`AUTHENTICATION.md`](AUTHENTICATION.md#mqtt-credential-workflow) for the credential workflow and device firmware notes.

### Manual fallback

If you'd rather configure the broker by hand instead of through the dashboard:

```bash
# Create the password file (runs inside the Mosquitto container)
docker exec -it aeolus-mosquitto mosquitto_passwd -c /mosquitto/config/passwd aeolus

# Add more users without -c (which would overwrite the file)
docker exec -it aeolus-mosquitto mosquitto_passwd /mosquitto/config/passwd another_user
```

Then edit `mosquitto/mosquitto.conf`:

```conf
listener 1883
allow_anonymous false
password_file /mosquitto/config/passwd
persistence true
persistence_location /mosquitto/data/
log_dest stdout
```

Point the backend at the broker with credentials (only needed for the manual approach — `docker-compose.yml` otherwise sets `MQTT_BROKER_URL` to `mqtt://localhost:1883`):

```env
MQTT_BROKER_URL=mqtt://aeolus:your_password@localhost:1883
```

Restart the stack:

```bash
docker compose down && docker compose up -d
```

---

## 3. HTTPS via Reverse Proxy

The frontend serves on port 3000 (HTTP) and the backend API on port 3001. Use a reverse proxy for TLS termination.

### Option A: Caddy (simplest)

```bash
sudo apt install caddy
```

Edit `/etc/caddy/Caddyfile`:

```caddyfile
# For LAN access with an automatic self-signed cert
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
sudo systemctl restart caddy
```

### Option B: nginx with self-signed certs

```bash
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/ssl/private/aeolus.key \
  -out /etc/ssl/certs/aeolus.crt \
  -subj "/CN=aeolus.local"
```

Create `/etc/nginx/sites-available/aeolus`:

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

```bash
sudo ln -s /etc/nginx/sites-available/aeolus /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx
```

### Option C: Public access via Cloudflare Tunnel

If you need external access without opening ports:

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Authenticate and create the tunnel
cloudflared tunnel login
cloudflared tunnel create aeolus
cloudflared tunnel route dns aeolus aeolus.yourdomain.com

# Run the tunnel
cloudflared tunnel --url http://localhost:3000 run aeolus
```

Cloudflare handles TLS automatically — no certs to manage.

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

```bash
docker volume inspect aeolus_backend_data | grep Mountpoint
# Typically: /var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db
```

### Safe backup

Because the database runs in WAL mode, a plain `cp` of the `.db` file while the backend is running can miss data still in the write-ahead log. Two safe options:

**Option A — stop, copy, restart (simplest, guaranteed consistent):**

```bash
docker compose stop backend
sudo cp /var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db \
  ~/backups/aeolus-$(date +%Y%m%d-%H%M%S).db
docker compose start backend
```

**Option B — online consistent copy (no downtime):**

```bash
# Copies a consistent snapshot even while the DB is in use
sqlite3 /var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db \
  ".backup '/home/pi/backups/aeolus-$(date +%Y%m%d-%H%M%S).db'"
```

### Automated nightly backup

Create `~/scripts/backup-aeolus.sh`:

```bash
#!/bin/bash
BACKUP_DIR="$HOME/backups/aeolus"
DB_PATH="/var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/aeolus-$(date +%Y%m%d-%H%M%S).db'"

# Remove backups older than the retention period
find "$BACKUP_DIR" -name "aeolus-*.db" -mtime +$RETENTION_DAYS -delete

echo "Backup complete. $(ls "$BACKUP_DIR" | wc -l) backups retained."
```

```bash
chmod +x ~/scripts/backup-aeolus.sh
crontab -e
```

```cron
# Daily backup at 3 AM
0 3 * * * /home/pi/scripts/backup-aeolus.sh >> /home/pi/backups/backup.log 2>&1
```

### Restore

```bash
docker compose down
sudo cp ~/backups/aeolus-20240115-030000.db \
  /var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db
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

The backend container declares a healthcheck (`wget --spider http://localhost:3001/api/health`, 30s interval, 3 retries). With `restart: unless-stopped`, Docker restarts unhealthy containers automatically.

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

`docker-compose.yml` sets the core backend variables directly (`PORT`, `MQTT_BROKER_URL`, `DB_PATH`, `MQTT_TOPICS`, `NODE_ENV`, `LOG_LEVEL`). The remaining variables below are tuning knobs and secrets you can add to a `.env` file in the project root.

| Variable | Default | Production value | Description |
|----------|---------|------------------|-------------|
| `NODE_ENV` | `development` | `production` | Suppresses stack traces in error responses, enables optimizations |
| `PORT` | `3001` | `3001` | Backend API port (set via `API_PORT` in compose) |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | `mqtt://localhost:1883` | MQTT broker URL (include credentials only for the manual MQTT-auth approach) |
| `MQTT_TOPICS` | `#` | `#` | MQTT subscription filter |
| `DB_PATH` | `./data/aeolus.db` | `/app/data/aeolus.db` | Database path (the Docker volume path) |
| `LOG_LEVEL` | `debug` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `RATE_LIMIT_RPM` | `1000` | `1000` | Max API requests per minute per IP |
| `CORS_ORIGINS` | _(empty)_ | `https://aeolus.local` | Extra allowed CORS origins (comma-separated); LAN origins are allowed by default |
| `STATE_HISTORY_MAX` | `100` | `100` | Max state-history records kept per device |
| `HISTORY_RECORD_INTERVAL` | `5000` | `5000` | Minimum ms between recorded state-history points (throttle) |
| `JWT_SECRET` | _(auto-generated)_ | _(your 256-bit key)_ | JWT signing key; auto-generated and stored in the DB if unset |
| `MQTT_PASSWORD_FILE` | `mosquitto/password_file` | `mosquitto/password_file` | Path Aeolus writes when managing MQTT credentials |
| `AEOLUS_PROJECT_DIR` | _(process.cwd())_ | _(project root)_ | Directory used to locate `mosquitto/mosquitto.conf` for the provisioning service; defaults to the working directory |
| `METRICS_TOKEN` | _(empty)_ | _(your token)_ | Bearer token to protect `/metrics`; open when unset |
| `FRONTEND_PORT` | `3000` | `3000` | Frontend container host port |
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

Aeolus ships hardened for an internet-adjacent home/edge deployment:

- **No Docker socket mount** — the backend container has no access to `/var/run/docker.sock`, so a compromised container cannot control the host's Docker daemon.
- **Read-only system router** — `/api/system` is GET-only (diagnostics, logs, version check). There are no shutdown, reboot, update, or prune endpoints; host control is done via SSH/Docker, not the web app.
- **No git or Docker CLI in the production image** — the build commit is baked into `dist/build-info.json` at build time, so no runtime git is needed.
- **Authentication always on** — bcrypt (cost 12) password hashing, short-lived JWTs, httpOnly refresh cookies, and login rate-limiting (5 attempts/min per IP).
- **Sandboxed automations** — user scripts run in `isolated-vm` V8 isolates (32 MB cap, 5 s timeout, no filesystem, no module imports).
- **LAN-only by default** — combine with the firewall rules (Section 4) and a TLS reverse proxy (Section 3) for a hardened deployment.

> The production image still includes `python3`, `make`, and `g++` — they're required to compile the native addons (`isolated-vm`, `better-sqlite3`, `bcrypt`) during install. They are build dependencies for those modules, not host-control tooling.
