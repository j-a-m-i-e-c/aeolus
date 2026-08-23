#!/usr/bin/env bash
# Run ON the demo host after first deployment. Seeds the final demo build, lets
# the seed settle, then creates and verifies the immutable golden snapshot.
set -euo pipefail
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.public-demo.yml}"
SEED_USER="${SEED_USER:-admin}"

if [ -z "${SEED_PASS:-}" ]; then
  if [ -t 0 ]; then
    read -r -s -p "Demo admin seed password: " SEED_PASS
    printf '\n'
  else
    echo "SEED_PASS is required when not running interactively" >&2
    exit 1
  fi
fi
[ ${#SEED_PASS} -ge 8 ] || { echo "SEED_PASS must be at least 8 characters" >&2; exit 1; }

printf '[seed-golden] Seeding final public demo state…\n'
docker compose -f "$COMPOSE_FILE" --profile seed run --rm \
  -e SEED_USER="$SEED_USER" -e SEED_PASS="$SEED_PASS" seed

printf '[seed-golden] Checking application after seed…\n'
./scripts/demo-health-check.sh

printf '[seed-golden] Creating immutable golden snapshot…\n'
./scripts/create-demo-golden.sh

printf '[seed-golden] Done. Test a reset before launch: ./scripts/reset-demo.sh\n'
