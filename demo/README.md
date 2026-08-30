# Aeolus demo subsystem

Everything that exists specifically to build, seed, host, reset or provision the Aeolus showcase lives here.

The word **demo** used to refer to several different things spread across the repository. This directory makes the boundaries explicit while keeping genuine product code in the product tree.

## Boundaries

### 1. Local showcase

A normal Aeolus stack plus simulated hardware and the restricted public-demo UI/session behaviour. It is useful for exercising the showcase on a developer machine.

Compose definition: [`compose/local-showcase.yml`](compose/local-showcase.yml).

It is an **overlay** on the normal root [`../docker-compose.yml`](../docker-compose.yml):

```bash
docker compose --project-directory . \
  -f docker-compose.yml \
  -f demo/compose/local-showcase.yml \
  up -d --build
```

The `make demo-up`, `make demo-reset` and `make seed-demo` wrappers use this combination.

### 2. Public-demo application mode

`AEOLUS_PUBLIC_DEMO=true` activates the fail-closed anonymous showcase policy. That is real application/security behaviour, so it deliberately remains under [`../src/demo/`](../src/demo/) rather than being moved here.

Likewise, the generic MQTT simulator runtime remains under `src/simulator/`. This directory owns the **showcase scenarios and seed content**, not the simulator framework itself.

### 3. Hosted public showcase

The hardened deployment used by `demo.aeolus.com.au`: Cloudflare Tunnel-only ingress, bridge networking, unprivileged containers, simulated hardware, active/golden SQLite separation and the nightly reset lifecycle.

Compose definition: [`compose/hosted-runtime.yml`](compose/hosted-runtime.yml).

```bash
docker compose --project-directory . \
  -f demo/compose/hosted-runtime.yml \
  up -d
```

Production hosts consume already-built images. [`compose/hosted-build.yml`](compose/hosted-build.yml) is a **build-only overlay** for a developer/CI machine:

```bash
docker compose --project-directory . \
  -f demo/compose/hosted-runtime.yml \
  -f demo/compose/hosted-build.yml \
  build backend frontend
```

The repo root is intentionally supplied as Compose's `--project-directory`. That keeps `.env`, bind mounts and build contexts rooted at the repository even though the hosted Compose files live under `demo/compose/`.

## Repository layout

```text
demo/
├── README.md
├── compose/
│   ├── local-showcase.yml     # overlay for normal Aeolus
│   ├── hosted-runtime.yml     # standalone internet-facing demo runtime
│   └── hosted-build.yml       # optional local/CI build overlay
├── config/
│   └── mosquitto.conf         # ephemeral internal broker config
├── seed/
│   ├── seed.mjs               # showcase seeder/orchestrator
│   ├── projects/              # authored Automation Projects
│   ├── tabs/                  # showcase layout/domain manifests
│   └── *-simulator-bootstrap.mjs
├── operations/
│   ├── health-check.sh
│   ├── create-golden.sh
│   ├── reset.sh
│   ├── lib/common.sh          # stable repo/Compose path handling
│   ├── deploy/                # operator + host deployment helpers
│   └── systemd/               # nightly reset unit/timer
└── infrastructure/
    └── terraform/             # Lightsail + Cloudflare infrastructure
```

## Compose naming

There is now only **one normal Aeolus Compose file at the repository root**:

| File | Role |
| --- | --- |
| `docker-compose.yml` | normal Linux/Pi Aeolus stack |

Showcase-only Compose definitions are grouped under `demo/compose/` and use role-based names instead of several similarly named root-level overrides.

`Dockerfile` and `frontend/Dockerfile` are different: they define how the backend/simulator image and frontend image are built. They are not alternate runtime environments and therefore stay with the product code they build.

## Seeding

The showcase seeder is [`seed/seed.mjs`](seed/seed.mjs). The base Compose stack retains a one-shot `seed` profile so a contributor can populate the showcase without installing Node on the host, but all showcase content now lives here.

Direct invocation:

```bash
node demo/seed/seed.mjs http://localhost:3001 admin '<password>'
```

The authored project source under `seed/projects/` is the source of truth for the seeded Automation Projects. Tab modules carry metadata and project references rather than duplicating authored source.

## Hosted operations

The main entry points are:

```bash
# operator PC
./demo/operations/deploy/preflight.sh
./demo/operations/deploy/deploy-from-pc.sh
./demo/operations/deploy/seed-and-create-golden-remote.sh
./demo/operations/deploy/reset-remote.sh

# demo host
./demo/operations/health-check.sh
./demo/operations/create-golden.sh
./demo/operations/reset.sh
```

See [`infrastructure/terraform/README.md`](infrastructure/terraform/README.md) for the full hosted release runbook.

## Ownership rule

This directory owns **showcase-specific content and operations**. It should not become a second application tree.

Keep these elsewhere:

- `src/demo/`: public-demo application/security policy;
- `src/simulator/`: generic simulator runtime;
- `Dockerfile` / `frontend/Dockerfile`: product image builds;
- `.github/workflows/`: GitHub requires workflows there;
- root `docker-compose.yml`: the normal Aeolus runtime definition.

New showcase-only deployment scripts, seed worlds, golden/reset tooling or infrastructure should normally go under `demo/` rather than reappearing in the repository root or generic `scripts/` directory.
