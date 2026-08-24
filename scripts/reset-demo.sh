#!/usr/bin/env bash
# scripts/reset-demo.sh — restore the public Aeolus demo to its golden snapshot.
#
# Runs on the demo HOST (not inside a container). It performs the orderly reset
# sequence from the Public Demo requirements §19:
#
#   stop app services -> delete active DB (+ WAL/SHM) -> copy golden -> active
#   -> start app services -> health-check -> restore availability
#
# The database swap happens while the backend is STOPPED so the active SQLite
# file is never overwritten under a running Aeolus (requirements §19). The
# immutable golden database is only ever the copy SOURCE and is never mounted
# into the app, so normal demo operation cannot mutate it (requirements §18).
#
# Reset is a presentation-quality mechanism, NOT a security control — the demo
# must stay safe even if a reset never runs (requirements §2.4). Safe to run at
# any time (nightly timer or manual/emergency use).
#
# Configuration (override via environment):
#   COMPOSE_FILE            compose file to drive          (docker-compose.public-demo.yml)
#   AEOLUS_DEMO_GOLDEN_DB   immutable golden snapshot path (/opt/aeolus-demo/golden/aeolus-demo.db)
#   AEOLUS_DEMO_DATA_DIR    active data directory (bind mount) (/opt/aeolus-demo/data)
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.public-demo.yml}"
GOLDEN_DB="${AEOLUS_DEMO_GOLDEN_DB:-/opt/aeolus-demo/golden/aeolus-demo.db}"
DATA_DIR="${AEOLUS_DEMO_DATA_DIR:-/opt/aeolus-demo/data}"
ACTIVE_DB="${DATA_DIR}/aeolus.db"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEALTH_SCRIPT="${SCRIPT_DIR}/demo-health-check.sh"

log() { printf '[reset-demo] %s\n' "$*"; }
die() { printf '[reset-demo] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
[ -f "$GOLDEN_DB" ] || die "golden database not found: $GOLDEN_DB"
if [ -f "${GOLDEN_DB}.sha256" ]; then
  log "Verifying golden snapshot checksum…"
  (cd "$(dirname "$GOLDEN_DB")" && sha256sum -c "$(basename "${GOLDEN_DB}.sha256")") >/dev/null \
    || die "golden database checksum verification failed"
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

log "Stopping app services (backend, simulator) so the active DB can be swapped safely…"
# The broker and cloudflared stay up; only the DB-writing services must stop.
compose stop backend simulator

log "Removing active database and its WAL/SHM sidecars…"
rm -f "$ACTIVE_DB" "${ACTIVE_DB}-wal" "${ACTIVE_DB}-shm"

log "Copying immutable golden snapshot -> active database…"
mkdir -p "$DATA_DIR"
cp "$GOLDEN_DB" "$ACTIVE_DB"
chmod 0644 "$ACTIVE_DB"

# The hardened public-demo backend starts directly as an unprivileged numeric
# user. systemd runs this reset as root, so restore bind-mount ownership before
# starting the container. Manual resets by the deployment user already create a
# correctly owned copy.
runtime_uid="${AEOLUS_RUNTIME_UID:-1000}"
runtime_gid="${AEOLUS_RUNTIME_GID:-1000}"
if [ "$(id -u)" -eq 0 ]; then
  chown "${runtime_uid}:${runtime_gid}" "$DATA_DIR" "$ACTIVE_DB"
fi

log "Starting app services…"
compose up -d backend simulator

log "Waiting for the backend to report healthy…"
if [ -x "$HEALTH_SCRIPT" ]; then
  COMPOSE_FILE="$COMPOSE_FILE" "$HEALTH_SCRIPT"
else
  log "health-check script not found/executable ($HEALTH_SCRIPT); skipping gate"
fi

log "Reset complete — demo restored from golden snapshot."
