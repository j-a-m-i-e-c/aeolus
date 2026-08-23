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

restart_needed=0
cleanup() {
  if [ "$restart_needed" = "1" ]; then
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
rm -f "$tmp"
cp "$ACTIVE_DB" "$tmp"
chmod 0444 "$tmp"
mv -f "$tmp" "$GOLDEN_DB"
sha256sum "$GOLDEN_DB" > "${GOLDEN_DB}.sha256"
chmod 0444 "${GOLDEN_DB}.sha256"

meta="${GOLDEN_DB}.meta"
{
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'app_image=%s\n' "${AEOLUS_APP_IMAGE:-$(docker inspect --format='{{.Config.Image}}' aeolus-demo-backend 2>/dev/null || echo unknown)}"
  printf 'frontend_image=%s\n' "${AEOLUS_FRONTEND_IMAGE:-$(docker inspect --format='{{.Config.Image}}' aeolus-demo-frontend 2>/dev/null || echo unknown)}"
  printf 'sha256=%s\n' "$(sha256sum "$GOLDEN_DB" | awk '{print $1}')"
} > "$meta"
chmod 0444 "$meta"

log "Golden snapshot created: $GOLDEN_DB"
log "SHA-256: $(awk '{print $1}' "${GOLDEN_DB}.sha256")"

log "Restarting app services…"
compose up -d backend simulator
restart_needed=0

if [ -x "$HEALTH_SCRIPT" ]; then
  COMPOSE_FILE="$COMPOSE_FILE" "$HEALTH_SCRIPT"
fi

# The deploy step installs the units but deliberately leaves the Persistent
# timer disabled until a verified golden exists. Enable it only after the
# snapshot and restarted application have both passed health checks.
if systemctl cat aeolus-demo-reset.timer >/dev/null 2>&1; then
  log "Enabling nightly reset timer now that the golden snapshot is verified…"
  sudo systemctl enable --now aeolus-demo-reset.timer
else
  log "WARNING: aeolus-demo-reset.timer is not installed; install the systemd units before launch."
fi
log "Golden snapshot ready. Nightly resets can now restore it safely."
