# Aeolus public demo infrastructure

This directory provisions the replaceable infrastructure for `demo.aeolus.com.au`.
Terraform owns **infrastructure**, not application releases or the demo database:

```text
Terraform
├── AWS Lightsail instance (Sydney)
├── static IPv4 (operator SSH only)
├── Lightsail firewall (SSH only, source restricted)
├── Cloudflare Tunnel
├── Cloudflare Tunnel ingress
└── demo.aeolus.com.au DNS

Docker Compose + scripts
├── Aeolus release images
├── simulator + Mosquitto + cloudflared runtime
├── active SQLite database
├── golden SQLite snapshot
└── nightly/reset lifecycle
```

That separation is intentional. Replacing a VM is an infrastructure operation;
rolling out or rolling back Aeolus is an application operation.

## Security model

The public demo has **no inbound HTTP, HTTPS, MQTT, backend or database ports**.
Cloudflare Tunnel connects outbound from the VM. The only public Lightsail port is
SSH (`22/tcp`), restricted to `admin_cidrs` and/or the Lightsail browser SSH
service.

Do not set `admin_cidrs = ["0.0.0.0/0"]`. Terraform rejects that configuration.

Terraform state contains the generated Cloudflare tunnel secret and can expose a
usable tunnel token through a sensitive output. Treat `terraform.tfstate` as a
secret: do not commit it, paste it into issues, or put it in a public backup.
For this single-host demo, local state on an encrypted developer machine is a
reasonable starting point. A remote encrypted state backend can be added later
if multiple operators need to manage the infrastructure.

## Prerequisites

On the operator machine:

- AWS account and AWS CLI credentials able to manage Lightsail.
- Terraform.
- A Cloudflare API token supplied as `CLOUDFLARE_API_TOKEN` with permission to
  manage Cloudflare Tunnel for the account and DNS for `aeolus.com.au` (the current provider resources require Cloudflare Tunnel Write and DNS Write).
- Docker, SSH, `tar`, and `gzip` for the first PC-driven deployment.
- On Windows, WSL2 is the recommended shell for the deployment scripts. Docker
  Desktop can expose its Docker engine to WSL2.

The host itself is bootstrapped by Terraform user-data. The manual equivalent is
`demo/operations/deploy/bootstrap-host.sh`.

Before provisioning, the repo can perform a local prerequisite check:

```bash
make public-demo-preflight
```

Warnings for an uninitialised Terraform directory are expected before the first `terraform init`; missing AWS/Docker tooling or unusable AWS credentials are blocking.

## 1. Resolve current Lightsail identifiers

Do not hard-code an Ubuntu blueprint or bundle ID copied from old documentation.
Ask Lightsail what is currently available in Sydney:

```bash
aws lightsail get-regions --include-availability-zones --region ap-southeast-2
aws lightsail get-blueprints --region ap-southeast-2
aws lightsail get-bundles --region ap-southeast-2
```

Pick an active Ubuntu blueprint and the intended 4 GB / 2 vCPU bundle. Put the
actual IDs in `terraform.tfvars`.

## 2. Configure Terraform

```bash
cd demo/infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
```

Fill in:

- `availability_zone`
- `blueprint_id`
- `bundle_id`
- `admin_cidrs` (normally the operator's current public IPv4 as `/32`)
- `cloudflare_account_id`
- `cloudflare_zone_id`

Then export the Cloudflare API token rather than placing it in tfvars:

```bash
export CLOUDFLARE_API_TOKEN='...'
```

`enable_lightsail_browser_ssh = true` is a useful recovery path if the operator's
home IP changes.

## 3. Provision infrastructure

```bash
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply
terraform output
```

The useful outputs are:

```text
static_ipv4
ssh_user
ssh_command
demo_url
cloudflare_tunnel_id
cloudflare_tunnel_token   # sensitive
```

The instance's user-data installs Docker Engine + Compose, SQLite tooling, creates
`/opt/aeolus-demo/{app,data,golden}`, and marks bootstrap completion.

## 4. First deployment from the operator PC

The first deployment deliberately does not need a container registry. From the
repo root:

```bash
./demo/operations/deploy/deploy-from-pc.sh
```

When Terraform has been initialized in `demo/infrastructure/terraform`, the script can read
the static IP and tunnel token from Terraform outputs automatically. Otherwise
set at least:

```bash
export DEMO_SSH_HOST='x.x.x.x'
export CLOUDFLARE_TUNNEL_TOKEN='...'
# optional when the key is not already in ssh-agent/default paths
export DEMO_SSH_KEY='/path/to/key.pem'
```

Default `transfer` mode:

1. builds immutable backend/simulator + frontend images on the operator PC;
2. syncs deployment source needed for Compose/seed/reset tooling;
3. streams the Docker images over the source-restricted SSH connection;
4. writes the host-only `.env` without committing secrets;
5. starts the hardened Compose stack **without compiling on Lightsail**;
6. runs the health gate;
7. installs the nightly reset units and keeps the timer disabled until a verified golden exists;
8. runs the external Cloudflare/demo-session release gate;
9. rolls back to the previous deployment source + image configuration if the release
   health gate fails.

## 5. Seed and create the golden database

After the first release is reachable, review the site, then run from the operator PC:

```bash
./demo/operations/deploy/seed-and-create-golden-remote.sh
```

It opens a TTY on the host and prompts there for the seed-admin password, so the password is not put in local shell history. The equivalent host-side command is `./demo/operations/deploy/seed-and-create-golden.sh`.

The script prompts for the seed-admin password. The golden snapshot process:

1. stops database writers;
2. checkpoints the SQLite WAL;
3. runs `PRAGMA integrity_check`;
4. preserves the previous golden as a timestamped backup;
5. writes the new read-only golden;
6. writes a SHA-256 checksum + release metadata;
7. restarts and health-checks the demo.

Test the restore before launch:

```bash
./demo/operations/reset.sh
```

Then confirm the timer:

```bash
systemctl list-timers aeolus-demo-reset.timer
```

## 6. Later releases: GHCR is optional

`.github/workflows/deploy-demo.yml` now **publishes immutable images only**. It
does not SSH to Lightsail, so the VM firewall does not need to trust ephemeral
GitHub-hosted runner IP ranges.

The workflow publishes commit-addressed images to GitHub Container Registry.
After publishing, deploy from the operator PC:

```bash
export DEMO_IMAGE_MODE=registry
export DEMO_APP_IMAGE='ghcr.io/<owner>/aeolus-demo-app:<full-sha>'
export DEMO_FRONTEND_IMAGE='ghcr.io/<owner>/aeolus-demo-frontend:<full-sha>'
./demo/operations/deploy/deploy-from-pc.sh
```

For the simplest registry deployment, make the two GHCR packages public. If the
packages remain private, log the Lightsail host into `ghcr.io` with a **read-only
package token** before running registry mode. Never put a write-capable GitHub
token in the demo `.env`.

There is no requirement to switch to GHCR immediately. PC `transfer` mode is a
perfectly reasonable release path for a single operator.

## Operations

Manual reset from the operator PC:

```bash
./demo/operations/deploy/reset-remote.sh
```

Host-side reset:

```bash
cd /opt/aeolus-demo/app
./demo/operations/reset.sh
```

Health:

```bash
cd /opt/aeolus-demo/app
./demo/operations/health-check.sh
docker compose --project-directory . -f demo/compose/hosted-runtime.yml ps
```

Logs:

```bash
docker compose --project-directory . -f demo/compose/hosted-runtime.yml logs --tail=100 backend simulator cloudflared
```

## What Terraform deliberately does not manage

- Aeolus image release versions.
- `.env` runtime secrets.
- the active SQLite database.
- the golden SQLite database.
- seed passwords.
- nightly application reset execution state.

Those remain owned by the deployment/reset scripts. This avoids Terraform
provisioners and avoids coupling infrastructure replacement to mutable demo data.
