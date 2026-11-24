# Testing strategy

Aeolus uses several test layers because no single style catches the full range of problems in an edge platform.

## Test tools

- **Vitest** for backend and frontend tests
- **fast-check** for property-based testing (randomised inputs proving invariants)
- **supertest** for in-process HTTP integration tests (real Express middleware chain without a listening port)
- **Testing Library** and jsdom for React behaviour
- **Playwright** for browser and full-stack end-to-end tests

## Test layers

### Unit tests

Colocated `*.test.ts` and `*.test.tsx` files test modules with focused dependencies.

```text
src/connectors/connector-manager.ts
src/connectors/connector-manager.test.ts
```

### Property-based tests

`*.property.test.ts` files generate varied inputs and check invariants, especially around parsers, lifecycle transitions, registries, migrations and validation.

### Backend integration tests

`src/__integration__/` runs real Express routes and SQLite-backed services. Current coverage includes API routes, Data Store behaviour, metrics history, the MQTT-to-automation pipeline, command acknowledgement, public-demo reset invariants, and a Linux-only real `isolated-vm` execution test. The isolate test proves Node globals are unavailable, optional capabilities do not break bootstrap, async host-mediated device commands cross the boundary, `actionAll()` keeps its predicate inside the isolate, and timeout/runtime errors are classified. A companion test proves an authored `http` `timeoutMs` reaches the host, defaults when absent and is clamped when excessive.

The demo operations regression suite also checks the golden/checksum contract. A non-root functional regression runs the real golden creator twice with prior sidecars made `0444`; structural tests remain active everywhere so checksum-required reset and timer/release-gate safety do not silently regress.

### Frontend tests

Frontend Vitest tests cover stores, utilities and practical component behaviour. Browser-specific areas such as Monaco, drag-and-drop and real iframe communication are covered more effectively through Playwright.

### End-to-end tests

Playwright runs against the disposable E2E stack (`e2e/docker-compose.e2e.yml`) and exercises first-run setup, authentication and user-visible workflows in a real browser.

#### Disposable stack only

The specs are destructive: they replace the whole dashboard layout, delete test automations by name and create API clients and keys. So the suite never runs against an everyday installation:

- the E2E stack has its own Compose project (`aeolus-e2e`), volume and ports (SPA on 3100, API on 3011), which are also the suite's defaults;
- its backend sets `AEOLUS_E2E=true`, which adds `"e2e": true` to `/api/health`. The marker comes only from the environment; the base `docker-compose.yml` never passes it;
- `e2e/global-setup.ts` refuses to run unless the backend at `E2E_API_URL` reports the marker and the SPA at `E2E_BASE_URL` sends its API calls to that same backend;
- the Project API spec revokes its keys and disables its client when it ends, pass or fail.

To run against dev servers instead of Docker, start the backend with `AEOLUS_E2E=true` and a throwaway `DB_PATH`, and set `E2E_BASE_URL` and `E2E_API_URL`.

#### API keys in E2E artifacts

`e2e/project-endpoints.spec.ts` issues a real Project API key, so its artifacts must not carry one:

- the spec turns trace, video and automatic screenshots off;
- `maskedScreenshot()` in `e2e/credential-safety.ts` is the only screenshot call in `e2e/`; it masks the key fields and refuses to capture if a key is visible anywhere else;
- the key is entered without `fill()`, whose step title would contain it, and assertions about it are boolean so a failure message cannot print it;
- on failure, the DOM is scrubbed before Playwright writes its page snapshot to `error-context.md`;
- Playwright's global teardown runs `scripts/e2e/credential-scan.mjs` over `test-results/` and fails the run if it finds the `aeo_<16 hex>_<43 base64url>` format in a file, a ZIP entry (traces, the HTML report's embedded data), a gzip stream or a base64 run. An archive it cannot read also counts as a finding.

Pixels cannot be scanned, which is why screenshots rely on masking. `npm run test:e2e-safety` tests the scanner and checks statically that every screenshot goes through the masked helper.

## Test pyramid

```text
            ╱╲
           ╱  ╲
          ╱ E2E╲         Playwright, Docker Compose, real browser
         ╱──────╲
        ╱Integra-╲
       ╱  tion    ╲      Real Express + SQLite + wiring, no Docker
      ╱────────────╲
     ╱  Property +  ╲
    ╱     Unit       ╲   Randomised + focused module tests
   ╱──────────────────╲
```

Each layer catches different classes of problems. Move up only when the
lower layers cannot exercise the boundary (e.g. WebSocket delivery needs a
browser; auth cookie rotation needs real HTTP).

## What is tested where

| Boundary / concern | Unit | Property | Integration | E2E |
|---|:---:|:---:|:---:|:---:|
| Sandbox error classification | ✓ | ✓ | ✓ (real V8 on Linux) | |
| Command lifecycle transitions | ✓ | ✓ | | |
| Pending-command tracker (ack/timeout/cancel) | ✓ | ✓ | ✓ | |
| Completion-tier resolution | ✓ | ✓ | | |
| Command envelope (MQTT 5 correlation) | | ✓ | | |
| Fail-fast automation body ordering | ✓ | ✓ | | |
| Bulk action arithmetic / isolate boundary | | ✓ | ✓ (real V8 on Linux) | |
| MQTT topic parsing | ✓ | ✓ | ✓ | |
| MQTT ack routing (correlationId resolution) | ✓ | | ✓ | |
| MQTT ingestion → device registry | | | ✓ | |
| MQTT → automation engine → action dispatch | | | ✓ | |
| Command → ack → ACKNOWLEDGED / TIMED_OUT | | | ✓ | |
| HTTP API → auth → Zod → SQLite | | | ✓ | |
| Demo golden/checksum/reset/deploy invariants | ✓ | | ✓ | |
| Shared outbound HTTP / SSRF policy | ✓ | | ✓ (timeout bridge, real V8 on Linux) | |
| Shared Automation State (durable current values/reactive triggers) | ✓ | | ✓ | |
| Data Store Collections (write/query/retention) | ✓ | | ✓ | |
| Metrics sampling and aggregation | | | ✓ | |
| Connector lifecycle (register/restore/discovery) | ✓ | | | ✓ |
| WebSocket real-time delivery | | | | ✓ |
| Auth token refresh / cookie rotation | | | | ✓ |
| First-run setup and dashboard workflows | | | | ✓ |
| Custom UI sandbox (iframe isolation) | | | | ✓ |

Blank cells mean the concern is not tested at that layer. This is
intentional — each layer covers what it is best suited for, minimising
expensive E2E runs while keeping confidence high at the boundaries that
matter.

## Coverage thresholds

Backend thresholds from `vitest.config.ts`:

| Scope | Lines | Branches | Functions |
|---|---:|---:|---:|
| Global | 90% | 90% | 90% |
| `src/core/` | 85% | global | global |
| `src/mqtt/` | 80% | global | global |
| `src/data-store/` | 80% | global | global |
| `src/automations/` | 50% | global | global |

The automation line threshold is lower because broad coverage instrumentation excludes the native isolate boundary. The surrounding runtime and lifecycle are tested normally, while a focused Linux integration test executes a real `isolated-vm` Sandbox without relying on coverage instrumentation.

Frontend thresholds from `frontend/vite.config.ts` are 90% for lines, statements, functions and branches over the included jsdom-suitable source.

## Common commands

```bash
# Backend tests
npm test

# Backend coverage, everything including the Docker-gated suites
npm run test:coverage

# Backend coverage as CI's backend job runs it: the seven Docker-gated suites are
# excluded because the dedicated serial integration job owns them
npm run test:coverage:no-broker

# Broker-backed integration suites, serially (needs Docker; self-skips without it)
npm run test:integration

# RainViewer radar collector (scripts/radar, node:test; outside vitest's src/ root)
npm run test:radar

# E2E artifact credential scanner (scripts/e2e, node:test)
npm run test:e2e-safety

# Frontend tests and coverage
cd frontend
npm test
npm run test:coverage

# End-to-end tests against the disposable E2E stack (start it with make e2e-up)
cd ..
npm run test:e2e

# Full local typecheck, lint and unit test gate
make verify

# Recreate the disposable E2E stack from an empty volume, then run end-to-end tests
make e2e-fresh

# Stop the disposable E2E stack and delete its volume
make e2e-down
```

## CI

### Pushes and pull requests

- repository-wide ESLint with zero warnings;
- backend TypeScript check;
- backend tests with coverage, excluding the seven Docker-gated suites from this parallel pass (the other `__integration__` suites stay in it, because the 90% branch threshold depends on them);
- broker-backed integration and simulator vertical tests in a dedicated serial job;
- frontend TypeScript check;
- frontend tests with coverage.

### Pushes to `main`

After the normal checks pass, CI builds backend and frontend Docker images.

### Daily E2E

When `main` has changed in the previous 24 hours, the daily workflow:

1. builds and starts the disposable E2E stack;
2. installs Chromium;
3. runs Playwright;
4. scans `test-results/` and `playwright-report/` for API keys, failing the job on a finding;
5. on failure, prints backend logs and uploads the report, unless the scan found a key;
6. tears the stack down.

The workflow can also be triggered manually.

## Test-writing guidelines

- Place tests next to the code they describe.
- Prefer behaviour and contracts over implementation detail.
- Use property tests where many inputs should obey the same invariant.
- Use integration tests for route and persistence boundaries.
- Use Playwright for browser APIs, sandboxed iframes, Monaco and drag-and-drop.
- Add a regression test when fixing a bug.
- Keep test names readable as specifications.
