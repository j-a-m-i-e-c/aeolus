# Production Deployment Guide

A practical guide for running Aeolus on a Raspberry Pi in production. Covers security hardening, backups, monitoring, and maintenance.

---

## 1. MQTT Broker Authentication

By default, Mosquitto allows anonymous connections. For production, enable username/password authentication.

### Create a password file

```bash
# Generate the password file (runs inside the Mosquitto container)
docker exec -it aeolus-mosquitto mosquitto_passwd -c /mosquitto/config/passwd aeolus

# Add additional users without -c (which overwrites the file)
docker exec -it aeolus-mosquitto mosquitto_passwd /mosquitto/config/passwd another_user
```

### Update mosquitto.conf

Edit `mosquitto/mosquitto.conf`:

```conf
listener 1883
allow_anonymous false
password_file /mosquitto/config/passwd
persistence true
persistence_location /mosquitto/data/
log_dest stdout
```

### Update the backend connection

Set credentials in your `.env` file:

```env
MQTT_BROKER_URL=mqtt://aeolus:your_password@localhost:1883
```

Restart the stack:

```bash
docker compose down && docker compose up -d
```

---

## 2. HTTPS via Reverse Proxy

The frontend serves on port 3000 (HTTP) and the backend API on port 3001. Use a reverse proxy for TLS termination.

### Option A: Caddy (simplest)

Install Caddy on the Pi host:

```bash
sudo apt install caddy
```

Edit `/etc/caddy/Caddyfile`:

```caddyfile
# For LAN access with automatic self-signed cert
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

Generate a self-signed certificate:

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

# Authenticate and create tunnel
cloudflared tunnel login
cloudflared tunnel create aeolus
cloudflared tunnel route dns aeolus aeolus.yourdomain.com

# Run the tunnel
cloudflared tunnel --url http://localhost:3000 run aeolus
```

Cloudflare handles TLS automatically — no certs to manage.

---

## 3. Firewall Rules

Use UFW to restrict access to LAN only. Replace `192.168.1.0/24` with your actual LAN subnet.

```bash
# Enable UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (so you don't lock yourself out)
sudo ufw allow ssh

# Allow Aeolus ports from LAN only
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp  # Frontend
sudo ufw allow from 192.168.1.0/24 to any port 3001 proto tcp  # Backend API
sudo ufw allow from 192.168.1.0/24 to any port 1883 proto tcp  # MQTT

# Deny these ports from anywhere else (implicit with default deny, but explicit is clearer)
sudo ufw deny 3000
sudo ufw deny 3001
sudo ufw deny 1883

# Enable the firewall
sudo ufw enable
sudo ufw status verbose
```

> **Note:** UFW processes rules in order. The `allow from LAN` rules above will match before the `deny` rules for LAN traffic, while WAN traffic hits the deny rules.

---

## 4. Backup Strategy

Aeolus stores all persistent data in a SQLite database inside a Docker volume.

### Locate the database

```bash
# Find the volume mount path
docker volume inspect aeolus_backend_data | grep Mountpoint
# Typically: /var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db
```

### Manual backup

```bash
# Copy the database file (safe — SQLite with WAL mode handles this)
sudo cp /var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db \
  ~/backups/aeolus-$(date +%Y%m%d-%H%M%S).db
```

### Automated backup with cron

Create a backup script at `~/scripts/backup-aeolus.sh`:

```bash
#!/bin/bash
BACKUP_DIR="$HOME/backups/aeolus"
DB_PATH="/var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
sudo cp "$DB_PATH" "$BACKUP_DIR/aeolus-$(date +%Y%m%d-%H%M%S).db"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "aeolus-*.db" -mtime +$RETENTION_DAYS -delete

echo "Backup complete. $(ls "$BACKUP_DIR" | wc -l) backups retained."
```

```bash
chmod +x ~/scripts/backup-aeolus.sh
```

Add to crontab (`crontab -e`):

```cron
# Daily backup at 3 AM
0 3 * * * /home/pi/scripts/backup-aeolus.sh >> /home/pi/backups/backup.log 2>&1
```

### Restore procedure

```bash
# Stop the stack
docker compose down

# Replace the database
sudo cp ~/backups/aeolus-20240115-030000.db \
  /var/lib/docker/volumes/aeolus_backend_data/_data/aeolus.db

# Restart
docker compose up -d
```

---

## 5. Monitoring

### Health endpoint

The backend exposes `/api/health` which reports system status:

```bash
curl http://localhost:3001/api/health
```

Returns MQTT connection state, device count, uptime, and memory usage. Use this for external monitoring.

### Docker health checks

Docker automatically monitors container health. Check status:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

The backend container is configured with:
- Health check interval: 30s
- Timeout: 5s
- Start period: 10s
- Retries before unhealthy: 3

Docker will restart unhealthy containers automatically (via `restart: unless-stopped`).

### Container logs

```bash
# View recent logs
docker logs aeolus-backend --tail 100

# Follow logs in real time
docker logs aeolus-backend -f

# Check for errors
docker logs aeolus-backend 2>&1 | grep -i error
```

### Simple alerting with a cron check

Add to crontab for basic uptime monitoring:

```bash
# Check health every 5 minutes, send notification on failure
*/5 * * * * curl -sf http://localhost:3001/api/health > /dev/null || echo "Aeolus backend is DOWN" | mail -s "Aeolus Alert" you@example.com
```

Or use a lightweight tool like [Uptime Kuma](https://github.com/louislam/uptime-kuma) running on the same Pi for a dashboard with notifications.

---

## 6. Docker Socket Trade-off

### Why it's mounted

The backend container has `/var/run/docker.sock` mounted as a volume:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

This enables the **self-update feature** — Aeolus can pull new images and recreate its own containers from the web UI without SSH access.

### What the risk is

Mounting the Docker socket gives the container **full Docker API access** on the host. In theory, a compromised container could:
- Start/stop any container on the host
- Mount host filesystems
- Execute commands on the host via privileged containers

### Why it's acceptable here

- **Single-user system** — Aeolus runs on your personal Pi, not a shared server
- **LAN-only access** — The API is not exposed to the internet (see firewall rules above)
- **No untrusted input** — The self-update endpoint only pulls from the configured git remote
- **Convenience trade-off** — One-click updates from the UI vs. SSH + manual `docker compose` commands

### Mitigation

If you want to reduce exposure:

1. **Restrict with firewall rules** (already covered in Section 3)
2. **Use a Docker socket proxy** like [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) to limit which API calls the container can make
3. **Remove the mount** if you don't need self-update — just comment out the volume line and update manually via SSH

---

## 7. Environment Variables

Reference table of all environment variables with production-recommended values:

| Variable | Default | Production Value | Description |
|----------|---------|-----------------|-------------|
| `NODE_ENV` | `development` | `production` | Suppresses stack traces in error responses, enables optimizations |
| `PORT` | `3001` | `3001` | Backend API port |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | `mqtt://user:pass@localhost:1883` | MQTT broker connection URL (include credentials) |
| `MQTT_TOPICS` | `#` | `#` | MQTT topic subscription filter |
| `DB_PATH` | `./data/aeolus.db` | `/app/data/aeolus.db` | Database path (use the Docker volume path) |
| `LOG_LEVEL` | `debug` | `info` | Log verbosity (`debug`, `info`, `warn`, `error`) |
| `RATE_LIMIT_RPM` | `200` | `200` | Max API requests per minute per IP |
| `CORS_ORIGINS` | _(empty)_ | `https://aeolus.local` | Additional allowed CORS origins (comma-separated) |
| `FRONTEND_PORT` | `3000` | `3000` | Frontend container port mapping |
| `MQTT_PORT` | `1883` | `1883` | MQTT broker port mapping |
| `HUE_BRIDGE_IP` | _(empty)_ | _(your bridge IP)_ | Philips Hue bridge IP address |
| `HUE_API_KEY` | _(empty)_ | _(your API key)_ | Philips Hue API key |
| `AEOLUS_PROJECT_DIR` | _(unset)_ | `/aeolus-host` | Host project directory for self-update feature |

Create your production `.env`:

```env
NODE_ENV=production
PORT=3001
MQTT_BROKER_URL=mqtt://aeolus:your_secure_password@localhost:1883
MQTT_TOPICS=#
DB_PATH=/app/data/aeolus.db
LOG_LEVEL=info
RATE_LIMIT_RPM=200
CORS_ORIGINS=https://aeolus.local
AEOLUS_PROJECT_DIR=/aeolus-host
```

---

## 8. Update Procedure

### Option A: Manual update (via SSH)

```bash
cd ~/aeolus
git pull origin main
docker compose up --build -d
```

This pulls the latest code, rebuilds images, and restarts containers with zero-downtime (containers restart one at a time).

### Option B: Self-update button (via web UI)

Aeolus includes a built-in update button in the settings page. It:

1. Runs `git pull` inside the mounted project directory
2. Rebuilds and restarts containers via the Docker socket
3. Reports progress in the UI

This requires the Docker socket mount and `AEOLUS_PROJECT_DIR` to be configured (both are set by default in `docker-compose.yml`).

### Rollback

If an update breaks something:

```bash
# Check recent commits
git log --oneline -5

# Roll back to previous version
git checkout <previous-commit-sha>
docker compose up --build -d
```

Or restore from a database backup if data was affected (see Section 4).
