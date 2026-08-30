#!/usr/bin/env bash
# Create/replace the immutable golden database used by the public demo reset.
# Run on the demo host AFTER the final seed has been reviewed in the browser.
#
# The backend is stopped before checkpoint/copy so the snapshot contains all WAL
# transactions. Existing goldens are retained as timestamped backups.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.public-demo.yml}"
DATA_DIR="${AEOLUS_DEMO_DATA_DIR:-/opt/aeolus-demo/data}"
GOLDEN_DB="${AEOLUS_DEMO_GOLDEN_DB:-/opt/aeolus-demo/golden/aeolus-demo.db}"
ACTIVE_DB="${DATA_DIR}/aeolus.db"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEALTH_SCRIPT="${SCRIPT_DIR}/demo-health-check.sh"

log() { printf '[golden-demo] %s\n' "$*"; }
die() { printf '[golden-demo] ERROR: %s\n' "$*" >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

command -v docker >/dev/null 2>&1 || die "docker not found"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum not found"
[ -f "$ACTIVE_DB" ] || die "active database not found: $ACTIVE_DB"

mkdir -p "$(dirname "$GOLDEN_DB")"

runtime_uid="${AEOLUS_RUNTIME_UID:-1000}"
runtime_gid="${AEOLUS_RUNTIME_GID:-1000}"
restore_runtime_ownership() {
  if [ "$(id -u)" -eq 0 ]; then
    log "Restoring runtime ownership (${runtime_uid}:${runtime_gid}) on ${DATA_DIR}…"
    chown -R "${runtime_uid}:${runtime_gid}" "$DATA_DIR"
  fi
}

reset_unit_present=0
if command -v systemctl >/dev/null 2>&1 && systemctl cat aeolus-demo-reset.timer >/dev/null 2>&1; then
  reset_unit_present=1
  # A snapshot operation and the nightly reset must never race. Keep the timer
  # disabled until the replacement golden and its checksum have been verified.
  sudo systemctl disable --now aeolus-demo-reset.timer >/dev/null 2>&1 || true
fi

restart_needed=0
cleanup() {
  if [ "$restart_needed" = "1" ]; then
    log "Restoring runtime ownership after interrupted snapshot…"
    restore_runtime_ownership || true
    log "Restarting backend and simulator after interrupted snapshot…"
    compose up -d backend simulator >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log "Stopping backend and simulator for a consistent SQLite snapshot…"
compose stop backend simulator
restart_needed=1

# Force any remaining WAL frames into the main database before copying. The
# host bootstrap installs sqlite3, but fail rather than creating a questionable
# golden if it is missing.
command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 not found (host bootstrap should install it)"
log "Checkpointing SQLite WAL and checking integrity…"
sqlite3 "$ACTIVE_DB" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
integrity="$(sqlite3 "$ACTIVE_DB" 'PRAGMA integrity_check;' | tail -n 1)"
[ "$integrity" = "ok" ] || die "active database integrity check failed: $integrity"

if [ -f "$GOLDEN_DB" ]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup="${GOLDEN_DB}.${stamp}.bak"
  log "Preserving previous golden as $backup"
  cp -p "$GOLDEN_DB" "$backup"
fi

tmp="${GOLDEN_DB}.tmp.$$"
checksum_tmp="${GOLDEN_DB}.sha256.tmp.$$"
meta_tmp="${GOLDEN_DB}.meta.tmp.$$"
rm -f "$tmp" "$checksum_tmp" "$meta_tmp"
cp "$ACTIVE_DB" "$tmp"
chmod 0444 "$tmp"
mv -f "$tmp" "$GOLDEN_DB"

# Build sidecars through fresh staging files. The previous sidecars are 0444 by
# design, so truncating them in-place makes a second refresh fail for the normal
# deployment user even though replacing them atomically is safe.
sha256sum "$GOLDEN_DB" > "$checksum_tmp"
chmod 0444 "$checksum_tmp"
mv -f "$checksum_tmp" "${GOLDEN_DB}.sha256"

{
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'app_image=%s\n' "${AEOLUS_APP_IMAGE:-$(docker inspect --format='{{.Config.Image}}' aeolus-demo-backend 2>/dev/null || echo unknown)}"
  printf 'frontend_image=%s\n' "${AEOLUS_FRONTEND_IMAGE:-$(docker inspect --format='{{.Config.Image}}' aeolus-demo-frontend 2>/dev/null || echo unknown)}"
  printf 'sha256=%s\n' "$(sha256sum "$GOLDEN_DB" | awk '{print $1}')"
} > "$meta_tmp"
chmod 0444 "$meta_tmp"
mv -f "$meta_tmp" "${GOLDEN_DB}.meta"

log "Verifying replacement golden snapshot…"
(cd "$(dirname "$GOLDEN_DB")" && sha256sum -c "$(basename "${GOLDEN_DB}.sha256")") >/dev/null \
  || die "new golden database checksum verification failed"

log "Golden snapshot created: $GOLDEN_DB"
log "SHA-256: $(awk '{print $1}' "${GOLDEN_DB}.sha256")"

# Same invariant the nightly reset upholds: the hardened backend runs as an
# unprivileged numeric user, so every active SQLite file must belong to it before
# the container starts. This matters here because the WAL checkpoint above can
# create -wal/-shm as whoever ran this script; under sudo that would hand the
# backend a readable-but-unwritable database (SQLITE_READONLY on first write).
# The golden snapshot itself lives outside DATA_DIR and stays read-only.
restore_runtime_ownership

log "Restarting app services…"
compose up -d backend simulator
restart_needed=0

if [ -x "$HEALTH_SCRIPT" ]; then
  COMPOSE_FILE="$COMPOSE_FILE" "$HEALTH_SCRIPT"
fi

# The deploy step installs the units but deliberately leaves the Persistent
# timer disabled until a verified golden exists. Enable it only after the
# snapshot and restarted application have both passed health checks.
if [ "$reset_unit_present" = "1" ]; then
  log "Enabling nightly reset timer now that the golden snapshot is verified…"
  sudo systemctl enable --now aeolus-demo-reset.timer
else
  log "WARNING: aeolus-demo-reset.timer is not installed; install the systemd units before launch."
fi
log "Golden snapshot ready. Nightly resets can now restore it safely."
