#!/usr/bin/env bash
# scripts/demo-health-check.sh — gate demo availability on backend health.
#
# The public demo publishes no host ports (Cloudflare Tunnel is the only
# ingress), so this checks /api/health from INSIDE the backend container over
# the compose network rather than a host port. Used by reset-demo.sh and the
# deploy workflow to confirm the stack is serving before restoring availability.
#
# Exit 0 when healthy; non-zero if it never becomes healthy within the budget.
#
# Configuration (override via environment):
#   COMPOSE_FILE      compose file to drive        (docker-compose.public-demo.yml)
#   HEALTH_ATTEMPTS   number of polls              (30)
#   HEALTH_SLEEP_SEC  seconds between polls        (2)
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.public-demo.yml}"
ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
SLEEP_SEC="${HEALTH_SLEEP_SEC:-2}"

log() { printf '[demo-health] %s\n' "$*"; }

command -v docker >/dev/null 2>&1 || { echo "[demo-health] docker not found" >&2; exit 1; }

for attempt in $(seq 1 "$ATTEMPTS"); do
  if docker compose -f "$COMPOSE_FILE" exec -T backend \
      wget --no-verbose --tries=1 -O /dev/null http://localhost:3001/api/health >/dev/null 2>&1; then
    log "backend healthy (attempt ${attempt}/${ATTEMPTS})"
    exit 0
  fi
  log "not healthy yet (attempt ${attempt}/${ATTEMPTS}); retrying in ${SLEEP_SEC}s"
  sleep "$SLEEP_SEC"
done

echo "[demo-health] backend did not become healthy within budget" >&2
echo "[demo-health] service state:" >&2
docker compose -f "$COMPOSE_FILE" ps >&2 || true
echo "[demo-health] backend logs (last 80 lines):" >&2
docker compose -f "$COMPOSE_FILE" logs --tail=80 backend >&2 || true
echo "[demo-health] mosquitto logs (last 40 lines):" >&2
docker compose -f "$COMPOSE_FILE" logs --tail=40 mosquitto >&2 || true
exit 1
