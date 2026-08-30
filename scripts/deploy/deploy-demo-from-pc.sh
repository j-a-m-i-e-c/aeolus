#!/usr/bin/env bash
# Build or select a public-demo release on this machine, sync deployment source
# to the Lightsail host, load/pull immutable images, and restart the stack.
#
# Default mode (`transfer`) needs no registry: Docker images are built locally
# and streamed over SSH. This is ideal for the first deployment with port 22
# restricted to your own public IP.
#
# Registry mode (`registry`) skips local builds and pulls images on the host:
#   DEMO_IMAGE_MODE=registry \
#   DEMO_APP_IMAGE=ghcr.io/owner/aeolus-demo-app:<sha> \
#   DEMO_FRONTEND_IMAGE=ghcr.io/owner/aeolus-demo-frontend:<sha> \
#   ./scripts/deploy/deploy-demo-from-pc.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${DEMO_IMAGE_MODE:-transfer}"
DEMO_SSH_USER="${DEMO_SSH_USER:-ubuntu}"
DEMO_APP_DIR="${DEMO_APP_DIR:-/opt/aeolus-demo/app}"
DEMO_ROOT="$(dirname "$DEMO_APP_DIR")"
DEMO_PUBLIC_ORIGIN="${DEMO_PUBLIC_ORIGIN:-https://demo.aeolus.com.au}"
DEMO_PUBLIC_WS_URL="${DEMO_PUBLIC_WS_URL:-wss://demo.aeolus.com.au/ws}"
SSH_PORT="${DEMO_SSH_PORT:-22}"

log() { printf '[deploy-demo] %s\n' "$*"; }
die() { printf '[deploy-demo] ERROR: %s\n' "$*" >&2; exit 1; }

# If Terraform is installed and state exists, use its outputs as convenient
# defaults. Explicit environment values always win.
TF_DIR="$ROOT/infra/public-demo"
if command -v terraform >/dev/null 2>&1 && [ -d "$TF_DIR/.terraform" ]; then
  if [ -z "${DEMO_SSH_HOST:-}" ]; then
    DEMO_SSH_HOST="$(terraform -chdir="$TF_DIR" output -raw static_ipv4 2>/dev/null || true)"
  fi
  if [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
    CLOUDFLARE_TUNNEL_TOKEN="$(terraform -chdir="$TF_DIR" output -raw cloudflare_tunnel_token 2>/dev/null || true)"
  fi
fi

[ -n "${DEMO_SSH_HOST:-}" ] || die "DEMO_SSH_HOST is required (or apply infra/public-demo with Terraform first)"
command -v ssh >/dev/null 2>&1 || die "ssh not found"
command -v scp >/dev/null 2>&1 || die "scp not found"
command -v tar >/dev/null 2>&1 || die "tar not found"
command -v gzip >/dev/null 2>&1 || die "gzip not found"

ssh_args=(-p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
if [ -n "${DEMO_SSH_KEY:-}" ]; then
  ssh_args+=(-i "$DEMO_SSH_KEY")
fi
remote="${DEMO_SSH_USER}@${DEMO_SSH_HOST}"

# Wait for Terraform/cloud-init host bootstrap when this is a brand-new VM.
log "Checking demo host ${remote}…"
ssh "${ssh_args[@]}" "$remote" "test -f '${DEMO_ROOT}/.bootstrap-complete' || { echo 'Host bootstrap is not complete yet.' >&2; exit 20; }" \
  || die "host is unreachable or bootstrap has not completed"

commit="$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || true)"
if [ -z "$commit" ]; then
  commit="local-$(date -u +%Y%m%d%H%M%S)"
fi
build_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "$MODE" = "transfer" ]; then
  command -v docker >/dev/null 2>&1 || die "Docker is required in transfer mode"
  DEMO_APP_IMAGE="${DEMO_APP_IMAGE:-aeolus-demo-app:${commit}}"
  DEMO_FRONTEND_IMAGE="${DEMO_FRONTEND_IMAGE:-aeolus-demo-frontend:${commit}}"

  log "Building immutable app image ${DEMO_APP_IMAGE} locally…"
  docker build \
    --build-arg BUILD_COMMIT="$commit" \
    --build-arg BUILD_DATE="$build_date" \
    -t "$DEMO_APP_IMAGE" "$ROOT"

  log "Building public-demo frontend image ${DEMO_FRONTEND_IMAGE} locally…"
  docker build \
    --build-arg VITE_PUBLIC_DEMO=true \
    --build-arg VITE_API_URL="$DEMO_PUBLIC_ORIGIN" \
    --build-arg VITE_WS_URL="$DEMO_PUBLIC_WS_URL" \
    -t "$DEMO_FRONTEND_IMAGE" "$ROOT/frontend"
else
  [ "$MODE" = "registry" ] || die "DEMO_IMAGE_MODE must be 'transfer' or 'registry'"
  [ -n "${DEMO_APP_IMAGE:-}" ] || die "DEMO_APP_IMAGE is required in registry mode"
  [ -n "${DEMO_FRONTEND_IMAGE:-}" ] || die "DEMO_FRONTEND_IMAGE is required in registry mode"
fi

log "Syncing deployment source to ${DEMO_APP_DIR}…"
# Keep the complete prior deployment source + host .env as a rollback unit. The
# source tree is only operational tooling (Compose/seed/reset/docs); containers
# still run immutable images. A failed release swaps this directory back too.
previous_app="${DEMO_APP_DIR}.previous"
ssh "${ssh_args[@]}" "$remote" "DEMO_APP_DIR='${DEMO_APP_DIR}' PREVIOUS_APP='${previous_app}' bash -s" <<'SOURCE_BACKUP_EOF'
set -euo pipefail
rm -rf "$PREVIOUS_APP"
# A source tree without its host-only .env is not a deployable rollback unit.
# This matters on the very first release: an interrupted source sync must never
# masquerade as a previous working deployment.
if [ -f "$DEMO_APP_DIR/docker-compose.public-demo.yml" ] && [ -s "$DEMO_APP_DIR/.env" ]; then
  cp -a "$DEMO_APP_DIR" "$PREVIOUS_APP"
fi
rm -rf "$DEMO_APP_DIR"
mkdir -p "$DEMO_APP_DIR"
if [ -f "$PREVIOUS_APP/.env" ]; then
  cp -p "$PREVIOUS_APP/.env" "$DEMO_APP_DIR/.env"
fi
SOURCE_BACKUP_EOF
tar \
  --exclude='.git' \
  --exclude='.terraform' \
  --exclude='*.tfstate' \
  --exclude='*.tfstate.*' \
  --exclude='terraform.tfvars' \
  --exclude='node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='dist' \
  --exclude='frontend/dist' \
  --exclude='data' \
  --exclude='demo-data' \
  --exclude='.env' \
  --exclude='*.db' \
  -C "$ROOT" -czf - . \
  | ssh "${ssh_args[@]}" "$remote" "mkdir -p '${DEMO_APP_DIR}' && tar -xzf - -C '${DEMO_APP_DIR}'"

if [ "$MODE" = "transfer" ]; then
  log "Streaming release images to the host (no registry required)…"
  docker save "$DEMO_APP_IMAGE" "$DEMO_FRONTEND_IMAGE" | gzip \
    | ssh "${ssh_args[@]}" "$remote" 'gzip -dc | docker load'
fi

# First deploy needs the tunnel token. Later deploys preserve the existing token
# if it is not supplied again.
log "Writing non-source deployment configuration…"
config_tmp="$(mktemp)"
trap 'rm -f "$config_tmp"' EXIT
chmod 600 "$config_tmp"
{
  printf '%s\n' "$DEMO_APP_IMAGE"
  printf '%s\n' "$DEMO_FRONTEND_IMAGE"
  printf '%s\n' "$DEMO_PUBLIC_ORIGIN"
  printf '%s\n' "$DEMO_PUBLIC_WS_URL"
  printf '%s\n' "${CLOUDFLARE_TUNNEL_TOKEN:-}"
} > "$config_tmp"
remote_config="/tmp/aeolus-demo-deploy-config.$$"
scp_args=(-P "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
if [ -n "${DEMO_SSH_KEY:-}" ]; then
  scp_args+=(-i "$DEMO_SSH_KEY")
fi
scp "${scp_args[@]}" "$config_tmp" "${remote}:${remote_config}" >/dev/null
ssh "${ssh_args[@]}" "$remote" "chmod 600 '${remote_config}' && DEMO_APP_DIR='${DEMO_APP_DIR}' DEMO_ROOT='${DEMO_ROOT}' CONFIG_FILE='${remote_config}' bash -s" <<'REMOTE_EOF'
set -euo pipefail
trap 'rm -f "$CONFIG_FILE"' EXIT
# bash -s is itself reading this script from stdin, so keep deployment config
# on a separate descriptor. Redirecting stdin here would make Bash interpret the
# first config value (the image tag) as the next shell command.
exec 3< "$CONFIG_FILE"
IFS= read -r app_image <&3
IFS= read -r frontend_image <&3
IFS= read -r public_origin <&3
IFS= read -r ws_url <&3
IFS= read -r supplied_tunnel_token <&3
exec 3<&-

env_file="${DEMO_APP_DIR}/.env"
tmp="${env_file}.tmp.$$"
touch "$env_file"
chmod 600 "$env_file"
if [ -s "$env_file" ]; then
  cp -p "$env_file" "${DEMO_APP_DIR}/.env.previous"
  chmod 600 "${DEMO_APP_DIR}/.env.previous"
fi

get_existing() {
  local key="$1"
  sed -n "s/^${key}=//p" "$env_file" | tail -n 1
}

tunnel_token="$supplied_tunnel_token"
if [ -z "$tunnel_token" ]; then
  tunnel_token="$(get_existing CLOUDFLARE_TUNNEL_TOKEN)"
fi
if [ -z "$tunnel_token" ]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN is required on the first deployment" >&2
  exit 31
fi

# Rebuild the managed deployment keys while preserving any unrelated operator
# settings already present in .env.
runtime_uid="$(id -u)"
runtime_gid="$(id -g)"

grep -v -E '^(AEOLUS_APP_IMAGE|AEOLUS_FRONTEND_IMAGE|DEMO_PUBLIC_ORIGIN|DEMO_PUBLIC_WS_URL|CLOUDFLARE_TUNNEL_TOKEN|AEOLUS_DEMO_DATA_DIR|AEOLUS_DEMO_GOLDEN_DB|AEOLUS_RUNTIME_UID|AEOLUS_RUNTIME_GID)=' "$env_file" > "$tmp" || true
{
  printf 'AEOLUS_APP_IMAGE=%s\n' "$app_image"
  printf 'AEOLUS_FRONTEND_IMAGE=%s\n' "$frontend_image"
  printf 'DEMO_PUBLIC_ORIGIN=%s\n' "$public_origin"
  printf 'DEMO_PUBLIC_WS_URL=%s\n' "$ws_url"
  printf 'CLOUDFLARE_TUNNEL_TOKEN=%s\n' "$tunnel_token"
  printf 'AEOLUS_DEMO_DATA_DIR=%s/data\n' "$DEMO_ROOT"
  printf 'AEOLUS_DEMO_GOLDEN_DB=%s/golden/aeolus-demo.db\n' "$DEMO_ROOT"
  printf 'AEOLUS_RUNTIME_UID=%s\n' "$runtime_uid"
  printf 'AEOLUS_RUNTIME_GID=%s\n' "$runtime_gid"
} >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$env_file"
REMOTE_EOF
rm -f "$config_tmp"
trap - EXIT
if [ "$MODE" = "registry" ]; then
  log "Pulling published release images on the host…"
  ssh "${ssh_args[@]}" "$remote" "cd '${DEMO_APP_DIR}' && docker compose -f docker-compose.public-demo.yml pull backend frontend simulator"
fi

log "Starting release without compiling on the VM…"
if ! ssh "${ssh_args[@]}" "$remote" "cd '${DEMO_APP_DIR}' && docker compose -f docker-compose.public-demo.yml up -d --remove-orphans && ./scripts/demo-health-check.sh"; then
  log "New release failed health checks. Attempting full source + image rollback…"
  ssh "${ssh_args[@]}" "$remote" "DEMO_APP_DIR='${DEMO_APP_DIR}' PREVIOUS_APP='${previous_app}' bash -s" <<'ROLLBACK_EOF' || true
set -euo pipefail
if [ ! -d "$PREVIOUS_APP" ] || [ ! -f "$PREVIOUS_APP/docker-compose.public-demo.yml" ] || [ ! -s "$PREVIOUS_APP/.env" ]; then
  echo 'No complete previous deployment with host configuration exists.' >&2
  exit 1
fi
failed="${DEMO_APP_DIR}.failed.$(date -u +%Y%m%dT%H%M%SZ)"
if [ -f "$DEMO_APP_DIR/docker-compose.public-demo.yml" ]; then
  (cd "$DEMO_APP_DIR" && docker compose -f docker-compose.public-demo.yml down --remove-orphans) || true
fi
mv "$DEMO_APP_DIR" "$failed"
mv "$PREVIOUS_APP" "$DEMO_APP_DIR"
cd "$DEMO_APP_DIR"
docker compose -f docker-compose.public-demo.yml up -d --remove-orphans
./scripts/demo-health-check.sh
echo "Previous release restored. Failed release preserved at $failed"
ROLLBACK_EOF
  die "deployment failed; full rollback was attempted"
fi

log "Installing/updating nightly reset units…"
ssh "${ssh_args[@]}" "$remote" "cd '${DEMO_APP_DIR}' && sudo cp scripts/systemd/aeolus-demo-reset.service scripts/systemd/aeolus-demo-reset.timer /etc/systemd/system/ && sudo systemctl daemon-reload"

golden_db="${DEMO_ROOT}/golden/aeolus-demo.db"
# A file merely existing is not enough to arm an automated destructive reset.
# Require its checksum sidecar and prove the pair before enabling the timer.
# Keep the destructive reset timer disarmed until *all* deployment gates have
# passed. A valid golden is necessary but not sufficient: if the public route
# later fails, the deployment itself is failed and must leave the timer off.
ssh "${ssh_args[@]}" "$remote" "sudo systemctl disable --now aeolus-demo-reset.timer >/dev/null 2>&1 || true"
if ssh "${ssh_args[@]}" "$remote" "test -f '$golden_db' && test -f '$golden_db.sha256' && cd '${DEMO_ROOT}/golden' && sha256sum -c 'aeolus-demo.db.sha256' >/dev/null"; then
  log "Verified golden snapshot exists; reset timer remains disarmed until the public release gate passes."
  golden_exists=1
else
  # First deploy or invalid/incomplete golden: fail safe. A Persistent timer must
  # never catch up by restoring an unverified snapshot.
  golden_exists=0
fi

ssh "${ssh_args[@]}" "$remote" "docker image prune -f >/dev/null || true"
log "Internal deployment health gate passed."
if command -v curl >/dev/null 2>&1; then
  public_ok=1
  public_failed=""
  curl --fail --silent --show-error --max-time 10 "${DEMO_PUBLIC_ORIGIN}/api/health" >/dev/null 2>&1 \
    || { public_ok=0; public_failed="${public_failed} GET /api/health"; }
  curl --fail --silent --show-error --max-time 10 "${DEMO_PUBLIC_ORIGIN}/" >/dev/null 2>&1 \
    || { public_ok=0; public_failed="${public_failed} GET /"; }
  # A public demo can serve / and /api/health while anonymous demo auth is dead
  # (e.g. the backend is up but the tunnel route to it 502s, or demo mode was not
  # actually enabled in the running app). Nothing in the demo is reachable without
  # this endpoint, so it is part of the public gate rather than a manual check.
  curl --fail --silent --show-error --max-time 10 \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{}' \
    "${DEMO_PUBLIC_ORIGIN}/api/auth/demo-session" >/dev/null 2>&1 \
    || { public_ok=0; public_failed="${public_failed} POST /api/auth/demo-session"; }
  if [ "$public_ok" = "1" ]; then
    log "Public Cloudflare route healthy (/, /api/health, /api/auth/demo-session): ${DEMO_PUBLIC_ORIGIN}"
  else
    log "WARNING: internal health is good but the public Cloudflare route failed:${public_failed}"
    log "         Check tunnel/frontend/backend logs on the host before announcing this release."
    if [ "${public_failed#*demo-session}" != "$public_failed" ]; then
      log "         A failing demo-session means anonymous visitors cannot use the demo at all."
    fi
  fi
else
  die "curl is required for the public Cloudflare release gate"
fi
# A failed public gate is a failed deployment. Leave the reset timer disabled.
if [ "${public_ok:-1}" != "1" ]; then
  die "RELEASE GATE NOT MET: public checks failed:${public_failed}"
fi

# Arm the reset only after both prerequisites are proven: a verified golden and
# a healthy externally reachable release. This ordering is intentional so any
# failure above leaves the timer fail-closed.
if [ "$golden_exists" = "1" ]; then
  log "All release gates passed; enabling nightly reset timer…"
  ssh "${ssh_args[@]}" "$remote" "sudo systemctl enable --now aeolus-demo-reset.timer"
  log "Golden snapshot verified. Deployment complete."
else
  log "No verified golden snapshot exists yet. Nightly reset remains disabled until the golden is created."
fi
