#!/usr/bin/env bash
# demo/operations/health-check.sh — gate demo availability on backend + frontend.
#
# The public demo publishes no host ports (Cloudflare Tunnel is the only
# ingress), so health is checked from INSIDE each service container. A release
# is not healthy unless both the API and the static dashboard are serving.
#
# Configuration (override via environment):
#   COMPOSE_FILE      compose file to drive        (demo/compose/hosted-runtime.yml)
#   HEALTH_ATTEMPTS   number of polls              (30)
#   HEALTH_SLEEP_SEC  seconds between polls        (2)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=demo/operations/lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"

log() { printf '[demo-health] %s\n' "$*"; }

command -v docker >/dev/null 2>&1 || { echo "[demo-health] docker not found" >&2; exit 1; }

for attempt in $(seq 1 "$ATTEMPTS"); do
  backend_ok=0
  frontend_ok=0

  if demo_compose exec -T backend \
      wget --no-verbose --tries=1 -O /dev/null http://localhost:3001/api/health >/dev/null 2>&1; then
    backend_ok=1
  fi

  # 127.0.0.1 rather than localhost: nginx binds IPv4 only on 0.0.0.0:8080, the
  # container resolves localhost to ::1 first, and BusyBox wget does not fall
  # back to IPv4, so localhost would always report the dashboard as down.
  if demo_compose exec -T frontend \
      wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:8080/ >/dev/null 2>&1; then
    frontend_ok=1
  fi

  if [ "$backend_ok" = "1" ] && [ "$frontend_ok" = "1" ]; then
    log "backend + frontend healthy (attempt ${attempt}/${ATTEMPTS})"
    exit 0
  fi

  log "not healthy yet (attempt ${attempt}/${ATTEMPTS}; backend=${backend_ok} frontend=${frontend_ok}); retrying in ${SLEEP_SEC}s"
  sleep "$SLEEP_SEC"
done

echo "[demo-health] stack did not become healthy within budget" >&2
echo "[demo-health] service state:" >&2
demo_compose ps >&2 || true
echo "[demo-health] backend logs (last 80 lines):" >&2
demo_compose logs --tail=80 backend >&2 || true
echo "[demo-health] frontend logs (last 80 lines):" >&2
demo_compose logs --tail=80 frontend >&2 || true
echo "[demo-health] mosquitto logs (last 40 lines):" >&2
demo_compose logs --tail=40 mosquitto >&2 || true
exit 1
