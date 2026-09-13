# Aeolus demo subsystem

Everything that exists specifically to build, seed, host, reset or provision the Aeolus showcase lives here.

The word **demo** used to refer to several different things spread across the repository. This directory makes the boundaries explicit while keeping genuine product code in the product tree.

## Boundaries

### Two local modes, not three products

There are only two things you can run locally, and the difference is whether you want
simulated hardware:

| | Command | What you get |
|---|---|---|
| **Real Aeolus** | `make up` | The product. No simulator, no showcase content, no restrictions. |
| **Aeolus + Showcase** | `make showcase` | The *same unrestricted* app plus simulated hardware and seeded showcase content. |

The hosted public demo is not a third mode — it is Aeolus + Showcase plus visitor
restrictions plus host hardening. See the hosted runbook below.

### 1. Aeolus + Showcase (local)

The full application with simulated hardware. Normal login, normal admin, normal
authoring — this is what you want on a Pi while developing or reviewing the showcase.

Compose definition: [`compose/local-showcase.yml`](compose/local-showcase.yml), an
**overlay** on the normal root [`../docker-compose.yml`](../docker-compose.yml):

```bash
make showcase                        # build + start with simulated hardware
make showcase-seed PASS=<password>   # PASS is required; no default exists
make showcase-reset                  # restart the simulator only; the database is untouched
```

#### Arranging the panes

Pane geometry is not written by hand. It lives in
[`seed/layouts/showcase-layout.json`](seed/layouts/showcase-layout.json), and the way to
change it is to drag the panes where you want them and capture the result:

```bash
make showcase                                 # arrange on a real, unrestricted install
make showcase-seed PASS=<password>
#   ... drag and resize the panes in the browser ...
make showcase-capture-layout PASS=<password>  # writes the JSON
git diff demo/seed/layouts/showcase-layout.json
```

Review that diff before committing: this file is the arrangement every future seed
reproduces, and a stray drag looks exactly like an intentional move.

- **Capture on the unrestricted showcase, not the public demo.** Public-demo layout
  persistence is deliberately disabled, so a visitor's rearrangement is never saved and
  there would be nothing to capture.
- **Your own tabs and panes are never captured.** Ownership comes from the seed ledger, so
  a personal tab, or a personal automation's pane sitting on a showcase tab, is reported
  and skipped. This matters more than it sounds: the seeder *retires* showcase-owned tabs
  it no longer declares, so a captured personal tab would be deleted by a later reseed.
- **Tab order is not captured.** The sidebar order is reasoned about in
  [`seed/tabs/index.mjs`](seed/tabs/index.mjs) and stays there, so a stray drag cannot
  silently rewrite the order in which the showcase makes its argument.
- **`make showcase-check-layout PASS=...`** fails if the running install differs from the
  committed file, without writing anything.

This overlay used to also switch the backend into public-demo mode and rebuild the
frontend as an anonymous visitor, which meant you could not review the showcase on
your own machine without losing authoring, admin and most of the API. Those are
unrelated concerns and are now separate files.

Notes that are easy to discover the hard way:

- **It builds from source, including native modules.** `better-sqlite3`, `isolated-vm` and `bcrypt` compile during the image build, so a first build on a Raspberry Pi takes a long time and needs a 64-bit OS.
- **`make showcase` does not stamp the build.** `BUILD_COMMIT`/`BUILD_DATE` are only set by `make deploy`, so the dashboard's version panel reports `unknown`. Pass them explicitly when the stamp matters:
  ```bash
  BUILD_COMMIT=$(git rev-parse --short HEAD) BUILD_DATE=$(git log -1 --format=%cI HEAD) \
    docker compose --project-directory . -f docker-compose.yml \
    -f demo/compose/local-showcase.yml up -d --build
  ```
- **A full wipe drops the retained device state.** `docker compose down -v` removes the broker volume, so the simulator's retained device publishes go with it. `make showcase-seed` restarts the simulator first so the backend sees the simulated actuators before the command-profile step runs.
- **Reseeding is safe.** The seeder reclaims its own fixture set and leaves automations, tabs, collections, buckets and data you created alone. You should not need `down -v` to seed again. See [Showcase ownership](#showcase-ownership) below.

### 2. Public-demo restrictions (local)

Only when the restrictions themselves are what you are testing. Adds the anonymous
visitor session, the demo banner, hidden admin/authoring surfaces and the fail-closed
`PublicDemoGuard` on top of the showcase:

```bash
make public-demo-local                        # showcase + visitor restrictions
make public-demo-local-seed PASS=<password>   # also provisions the demo user/group
```

Compose definition: [`compose/public-demo-local.yml`](compose/public-demo-local.yml).
It defines no simulator of its own — it composes on top of the showcase overlay, so
the simulated hardware is described in exactly one place.

- **This is a boot-time decision.** `AEOLUS_PUBLIC_DEMO` is read once at backend start and `VITE_PUBLIC_DEMO` is a frontend *build* argument, so switching is a rebuild and container recreate rather than a restart. Both targets above do that. Seeding refuses when the running backend disagrees with the seed it was asked for, before touching any data — check by hand with `curl -X POST http://localhost:3001/api/auth/demo-session`, which answers 404 in normal mode.

**What neither local stack exercises.** Both are different Compose files from the hosted runtime, so validating here says nothing about Cloudflare Tunnel ingress, the golden/active database split, the nightly reset timer or the hosted resource limits. Those are only covered by the hosted release runbook below.

### Showcase ownership

Seeding is a reconcile, not a wipe. Rerun `make showcase-seed` as often as you like — you should never need `docker compose down -v` to seed again.

The seeder owns exactly what it declares and nothing else:

| Resource | How a rerun reclaims it | Yours survives because |
|---|---|---|
| Collections, buckets | Each declared name resets only itself | The seeder never enumerates the store to decide what to remove |
| Automations | By id, recorded in a ledger when created | An id the ledger does not name is not touched |
| Tabs, panes | Declared tab ids are replaced; ledger-known tabs it no longer declares are retired | A tab id in neither set is passed through |

**The ledger.** Automations get server-generated ids and carry no ownership column, so nothing on the row connects it back to the `farm-water` key in `seed/tabs/`. The seeder therefore records `module key → rule id` in a Data Store bucket named `_showcase:seed-ledger` as each automation is created. It is visible in the Data Store UI next to the platform's own `_metrics:*` collections, so you can read what the showcase claims.

**One-time adoption.** On an install seeded before the ledger existed there is nothing but the display name to go on, so the first ledger-aware reseed adopts automations whose name exactly matches one the showcase declares, and prints each one. After that, matching is by id only. The single exposure is an automation of yours named exactly e.g. `Water Management` on a pre-ledger install.

**What still wipes everything.** `make reset` and `docker compose down -v`, deliberately. Those are full resets, not reseeds.

### 3. Public-demo application mode

`AEOLUS_PUBLIC_DEMO=true` activates the fail-closed anonymous showcase policy. That is real application/security behaviour, so it deliberately remains under [`../src/demo/`](../src/demo/) rather than being moved here.

Likewise, the generic MQTT simulator runtime remains under `src/simulator/`. This directory owns the **showcase scenarios and seed content**, not the simulator framework itself.

### 4. Hosted public showcase

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
│   ├── local-showcase.yml     # overlay: simulated hardware, still unrestricted
│   ├── public-demo-local.yml  # overlay: visitor restrictions, on top of the above
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
