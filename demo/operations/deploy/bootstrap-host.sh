#!/usr/bin/env bash
# Bootstrap an Ubuntu Lightsail host for the Aeolus public demo.
# Intended for Terraform user_data, but safe to run manually as root.
set -euo pipefail

DEMO_USER="${DEMO_USER:-ubuntu}"
DEMO_ROOT="${DEMO_ROOT:-/opt/aeolus-demo}"

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap-host.sh must run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg sqlite3 tar gzip

install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
. /etc/os-release
arch="$(dpkg --print-architecture)"
echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if id "$DEMO_USER" >/dev/null 2>&1; then
  usermod -aG docker "$DEMO_USER"
fi

mkdir -p "$DEMO_ROOT/app" "$DEMO_ROOT/data" "$DEMO_ROOT/golden"
if id "$DEMO_USER" >/dev/null 2>&1; then
  chown -R "$DEMO_USER:$DEMO_USER" "$DEMO_ROOT"
fi
chmod 0750 "$DEMO_ROOT" "$DEMO_ROOT/data" "$DEMO_ROOT/golden"

timedatectl set-timezone Australia/Sydney || true
printf 'bootstrap_complete=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEMO_ROOT/.bootstrap-complete"
chmod 0644 "$DEMO_ROOT/.bootstrap-complete"

echo "Aeolus demo host bootstrap complete. Re-login before using Docker without sudo."
