#!/usr/bin/env bash
# Shared path/Compose helpers for the hosted Aeolus showcase operations.
#
# Keep the repo root explicit because the hosted Compose definition lives under
# demo/compose/ while its bind mounts, .env file and build contexts are rooted at
# the repository. `--project-directory` makes that relationship unambiguous and
# prevents moving the Compose file from silently changing relative paths.

DEMO_OPERATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AEOLUS_REPO_ROOT="${AEOLUS_REPO_ROOT:-$(cd "${DEMO_OPERATIONS_DIR}/../.." && pwd)}"
DEMO_COMPOSE_FILE="${COMPOSE_FILE:-${AEOLUS_REPO_ROOT}/demo/compose/hosted-runtime.yml}"

# Preserve COMPOSE_FILE as a supported override for systemd/operator tooling,
# but resolve relative overrides against the repository root rather than the
# caller's current directory.
if [[ "$DEMO_COMPOSE_FILE" != /* ]]; then
  DEMO_COMPOSE_FILE="${AEOLUS_REPO_ROOT}/${DEMO_COMPOSE_FILE}"
fi

export AEOLUS_REPO_ROOT

# Invoke the standalone hosted stack with the repo as Compose project directory.
# This keeps `.env`, bind mounts and any build overlay paths rooted consistently.
demo_compose() {
  docker compose --project-directory "$AEOLUS_REPO_ROOT" -f "$DEMO_COMPOSE_FILE" "$@"
}
