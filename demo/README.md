# Aeolus demo subsystem

Everything that exists specifically to build, seed, host, reset or provision the Aeolus showcase lives here.

The word **demo** used to refer to several different things spread across the repository. This directory makes the boundaries explicit while keeping genuine product code in the product tree.

## Boundaries

### 1. Local showcase

A normal Aeolus stack plus simulated hardware and the restricted public-demo UI/session behaviour. It is useful for exercising the showcase on a developer machine or a Pi before a hosted release.

Compose definition: [`compose/local-showcase.yml`](compose/local-showcase.yml).

It is an **overlay** on the normal root [`../docker-compose.yml`](../docker-compose.yml):

```bash
docker compose --project-directory . \
  -f docker-compose.yml \
  -f demo/compose/local-showcase.yml \
  up -d --build
```

The `make demo-up`, `make demo-reset` and `make seed-demo` wrappers use this combination.

```bash
make demo-up                       # build + start with the overlay
make seed-demo PASS=<password>     # PASS is required; no default exists
make demo-reset                    # restart the simulator only; the database is untouched
```

Notes that are easy to discover the hard way:

- **It builds from source, including native modules.** `better-sqlite3`, `isolated-vm` and `bcrypt` compile during the image build, so a first build on a Raspberry Pi takes a long time and needs a 64-bit OS.
- **`make demo-up` does not stamp the build.** `BUILD_COMMIT`/`BUILD_DATE` are only set by `make deploy`, so the dashboard's version panel reports `unknown`. Pass them explicitly when the stamp matters:
  ```bash
  BUILD_COMMIT=$(git rev-parse --short HEAD) BUILD_DATE=$(git log -1 --format=%cI HEAD) \
    docker compose --project-directory . -f docker-compose.yml \
    -f demo/compose/local-showcase.yml up -d --build
  ```
- **Demo mode is a boot-time decision.** It is read once at backend start and `VITE_PUBLIC_DEMO` is a frontend *build* argument, so switching modes is a rebuild and container recreate rather than a restart. `make demo-up` does both. Seeding refuses when the running backend disagrees with the seed it was asked for, before touching any data — check by hand with `curl -X POST http://localhost:3001/api/auth/demo-session`, which answers 404 in normal mode.
- **A full wipe must use the overlay.** A bare `docker compose down -v` leaves the simulator running and drops the broker's retained device state, which is why `make seed-demo` restarts the simulator before seeding.

**What this stack does not exercise.** It is a different Compose file from the hosted runtime, so validating here says nothing about Cloudflare Tunnel ingress, the golden/active database split, the nightly reset timer or the hosted resource limits. Those are only covered by the hosted release runbook below.

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

The showcase has an additional authoring rule: `logic/index.ts` and `ui/index.tsx` are readable orchestration/composition roots. They intentionally show the project's main control flow, state inputs and operator intents, while lower-level domain behaviour and visual complexity live in clearly named files behind them. Opening **Logic**, **UI**, then **Files** should answer “how does it think?”, “how does it present itself?” and “how is it implemented?”. See [`seed/projects/README.md`](seed/projects/README.md).

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
