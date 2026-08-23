#!/usr/bin/env bash
# Operator-PC preflight for provisioning/deploying the hosted public demo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="$ROOT/infra/public-demo"
failures=0

ok()   { printf '[preflight] OK: %s\n' "$*"; }
warn() { printf '[preflight] WARN: %s\n' "$*"; }
fail() { printf '[preflight] FAIL: %s\n' "$*" >&2; failures=$((failures + 1)); }

for cmd in aws terraform docker ssh scp tar gzip; do
  if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd available"; else fail "$cmd is required"; fi
done

if command -v aws >/dev/null 2>&1; then
  if aws sts get-caller-identity >/dev/null 2>&1; then
    ok "AWS credentials are usable"
  else
    fail "AWS credentials are not configured/usable (aws sts get-caller-identity failed)"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then ok "Docker engine reachable"; else fail "Docker CLI exists but engine is not reachable"; fi
fi

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  ok "CLOUDFLARE_API_TOKEN is set (value not printed)"
else
  warn "CLOUDFLARE_API_TOKEN is not set; required when Terraform manage_cloudflare=true"
fi

if [ -f "$TF_DIR/terraform.tfvars" ]; then
  ok "infra/public-demo/terraform.tfvars exists"
else
  warn "terraform.tfvars not created yet; copy terraform.tfvars.example and fill current AWS/Cloudflare IDs"
fi

if command -v terraform >/dev/null 2>&1 && [ -d "$TF_DIR/.terraform" ]; then
  if terraform -chdir="$TF_DIR" validate >/dev/null 2>&1; then
    ok "Terraform configuration validates with installed providers"
  else
    fail "terraform validate failed; run it in infra/public-demo for details"
  fi
else
  warn "Terraform has not been initialized here yet; run terraform init before validate/apply"
fi

if command -v curl >/dev/null 2>&1; then
  ok "curl available for public route smoke test"
else
  warn "curl unavailable; deployment will skip the external Cloudflare smoke test"
fi

if [ "$failures" -ne 0 ]; then
  printf '[preflight] %d blocking issue(s) found.\n' "$failures" >&2
  exit 1
fi
printf '[preflight] No blocking local prerequisites found.\n'
