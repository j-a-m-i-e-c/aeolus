#!/usr/bin/env bash
# demo/operations/reset.sh — restore the public Aeolus demo to its golden snapshot.
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
#   COMPOSE_FILE            compose file to drive          (demo/compose/hosted-runtime.yml)
#   AEOLUS_DEMO_GOLDEN_DB   immutable golden snapshot path (/opt/aeolus-demo/golden/aeolus-demo.db)
#   AEOLUS_DEMO_DATA_DIR    active data directory (bind mount) (/opt/aeolus-demo/data)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo/operations/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
GOLDEN_DB="${AEOLUS_DEMO_GOLDEN_DB:-/opt/aeolus-demo/golden/aeolus-demo.db}"
DATA_DIR="${AEOLUS_DEMO_DATA_DIR:-/opt/aeolus-demo/data}"
ACTIVE_DB="${DATA_DIR}/aeolus.db"
HEALTH_SCRIPT="${SCRIPT_DIR}/health-check.sh"

log() { printf '[reset-demo] %s\n' "$*"; }
die() { printf '[reset-demo] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found on PATH"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum not found on PATH"
[ -f "$GOLDEN_DB" ] || die "golden database not found: $GOLDEN_DB"
[ -f "${GOLDEN_DB}.sha256" ] || die "golden checksum not found: ${GOLDEN_DB}.sha256"
log "Verifying golden snapshot checksum…"
(cd "$(dirname "$GOLDEN_DB")" && sha256sum -c "$(basename "${GOLDEN_DB}.sha256")") >/dev/null \
  || die "golden database checksum verification failed"

compose() { demo_compose "$@"; }

runtime_uid="${AEOLUS_RUNTIME_UID:-1000}"
runtime_gid="${AEOLUS_RUNTIME_GID:-1000}"
restore_runtime_ownership() {
  if [ "$(id -u)" -eq 0 ]; then
    log "Restoring runtime ownership (${runtime_uid}:${runtime_gid}) on ${DATA_DIR}…"
    chown -R "${runtime_uid}:${runtime_gid}" "$DATA_DIR"
  fi
}

# Once the app services are stopped the demo is down until they come back. A
# fail-fast abort anywhere in the swap would otherwise leave it down until
# someone noticed, which is how a failed nightly reset turns into an outage.
# Recover on any non-zero exit, and make the failure impossible to miss in
# `systemctl status` / the journal.
services_stopped=0
on_exit() {
  exit_code=$?
  trap - EXIT
  if [ "$exit_code" -eq 0 ] || [ "$services_stopped" -eq 0 ]; then
    exit "$exit_code"
  fi
  {
    printf '\n[reset-demo] ================= RESET FAILED =================\n'
    printf '[reset-demo] Aborted (exit %s) after stopping backend/simulator.\n' "$exit_code"
    printf '[reset-demo] Restarting them so the demo does not stay down…\n'
  } >&2
  restore_runtime_ownership >&2 || true
  if compose up -d backend simulator >&2; then
    printf '[reset-demo] Services restarted. The demo may be serving PRE-RESET data — investigate before the next window.\n' >&2
  else
    printf '[reset-demo] RESTART FAILED — the public demo is DOWN and needs manual repair NOW.\n' >&2
  fi
  printf '[reset-demo] ===============================================\n' >&2
  exit "$exit_code"
}
trap on_exit EXIT

log "Stopping app services (backend, simulator) so the active DB can be swapped safely…"
# The broker and cloudflared stay up; only the DB-writing services must stop.
compose stop backend simulator
services_stopped=1

# Stage the restore beside the active database first. The previous active DB is
# only destroyed once a complete copy exists, so a failed/short copy cannot
# leave the demo with no database at all.
log "Staging the immutable golden snapshot…"
mkdir -p "$DATA_DIR"
staged_db="${ACTIVE_DB}.restoring.$$"
rm -f "$staged_db"
cp "$GOLDEN_DB" "$staged_db"

log "Replacing active database (and dropping its WAL/SHM sidecars)…"
# Keep the old main database in place until the staged copy is ready to rename.
# `mv -f` within DATA_DIR atomically replaces the pathname, so a rename failure
# leaves the previous database intact instead of creating a no-database window.
rm -f "${ACTIVE_DB}-wal" "${ACTIVE_DB}-shm"
mv -f "$staged_db" "$ACTIVE_DB"

log "Setting permissions on the active database…"
chmod 0644 "$ACTIVE_DB"

# The hardened public-demo backend starts directly as an unprivileged numeric
# user (see `user:` in demo/compose/hosted-runtime.yml), so a root-owned active
# DB gives it a readable-but-not-writable database: it starts, then dies with
# SQLITE_READONLY the moment it persists a setting. systemd runs this reset as
# root, so restore bind-mount ownership BEFORE starting the container.
#
# Recursive over the data directory rather than naming files: the backend must
# also be able to create its own -wal/-shm sidecars, and this cannot miss a
# sidecar a previous run left behind. The golden snapshot lives outside this
# directory and is deliberately left untouched.
#
# Manual resets run by the deployment user already produce a correctly owned
# copy, so the chown only applies when running as root.
restore_runtime_ownership

log "Starting app services…"
compose up -d backend simulator

log "Waiting for the backend to report healthy…"
if [ -x "$HEALTH_SCRIPT" ]; then
  COMPOSE_FILE="$DEMO_COMPOSE_FILE" "$HEALTH_SCRIPT"
else
  log "health-check script not found/executable ($HEALTH_SCRIPT); skipping gate"
fi

log "Reset complete — demo restored from golden snapshot."
