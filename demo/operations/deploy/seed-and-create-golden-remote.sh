#!/usr/bin/env bash
# First-release helper: open a TTY on the demo host, seed the final public demo,
# and create the verified golden snapshot without putting the seed password in
# local shell history or command arguments.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TF_DIR="$ROOT/demo/infrastructure/terraform"
DEMO_SSH_USER="${DEMO_SSH_USER:-ubuntu}"
DEMO_SSH_PORT="${DEMO_SSH_PORT:-22}"
DEMO_APP_DIR="${DEMO_APP_DIR:-/opt/aeolus-demo/app}"

if [ -z "${DEMO_SSH_HOST:-}" ] && command -v terraform >/dev/null 2>&1 && [ -d "$TF_DIR/.terraform" ]; then
  DEMO_SSH_HOST="$(terraform -chdir="$TF_DIR" output -raw static_ipv4 2>/dev/null || true)"
fi
: "${DEMO_SSH_HOST:?set DEMO_SSH_HOST or apply demo/infrastructure/terraform Terraform first}"

args=(-t -p "$DEMO_SSH_PORT" -o StrictHostKeyChecking=accept-new)
[ -z "${DEMO_SSH_KEY:-}" ] || args+=(-i "$DEMO_SSH_KEY")
ssh "${args[@]}" "${DEMO_SSH_USER}@${DEMO_SSH_HOST}" "cd '${DEMO_APP_DIR}' && ./demo/operations/deploy/seed-and-create-golden.sh"
