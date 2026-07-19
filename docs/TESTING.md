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

`src/__integration__/` runs real Express routes and SQLite-backed services. Current coverage includes API routes, Data Store behaviour, metrics history, the MQTT-to-automation pipeline, and the command acknowledgement flow.

### Frontend tests

Frontend Vitest tests cover stores, utilities and practical component behaviour. Browser-specific areas such as Monaco, drag-and-drop and real iframe communication are covered more effectively through Playwright.

### End-to-end tests

Playwright starts against the Docker Compose stack and exercises first-run setup, authentication and user-visible workflows in a real browser.

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
| Sandbox error classification | ✓ | ✓ | | |
| Command lifecycle transitions | ✓ | ✓ | | |
| Pending-command tracker (ack/timeout/cancel) | ✓ | ✓ | ✓ | |
| Completion-tier resolution | ✓ | ✓ | | |
| Command envelope (MQTT 5 correlation) | | ✓ | | |
| Fail-fast automation body ordering | ✓ | ✓ | | |
| Bulk action arithmetic | | ✓ | | |
| MQTT topic parsing | ✓ | ✓ | ✓ | |
| MQTT ack routing (correlationId resolution) | ✓ | | ✓ | |
| MQTT ingestion → device registry | | | ✓ | |
| MQTT → automation engine → action dispatch | | | ✓ | |
| Command → ack → ACKNOWLEDGED / TIMED_OUT | | | ✓ | |
| HTTP API → auth → Zod → SQLite | | | ✓ | |
| Data Store (write/query/retention/KV) | ✓ | | ✓ | |
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

The automation line threshold is lower because the native isolate boundary is excluded from direct coverage. The surrounding runtime, lifecycle and integration behaviour is tested separately.

Frontend thresholds from `frontend/vite.config.ts` are 90% for lines, statements, functions and branches over the included jsdom-suitable source.

## Common commands

```bash
# Backend tests
npm test

# Backend coverage
npx vitest run --coverage

# Frontend tests and coverage
cd frontend
npm test
npm run test:coverage

# End-to-end tests against a running stack
cd ..
npm run test:e2e

# Full local typecheck, lint and unit test gate
make verify

# Fresh Docker stack followed by end-to-end tests
make e2e-fresh
```

## CI

### Pushes and pull requests

- repository-wide ESLint with zero warnings;
- backend TypeScript check;
- backend tests with coverage;
- frontend TypeScript check;
- frontend tests with coverage.

### Pushes to `main`

After the normal checks pass, CI builds backend and frontend Docker images.

### Daily E2E

When `main` has changed in the previous 24 hours, the daily workflow:

1. builds and starts Docker Compose;
2. installs Chromium;
3. runs Playwright;
4. uploads reports and backend logs on failure;
5. tears the stack down.

The workflow can also be triggered manually.

## Test-writing guidelines

- Place tests next to the code they describe.
- Prefer behaviour and contracts over implementation detail.
- Use property tests where many inputs should obey the same invariant.
- Use integration tests for route and persistence boundaries.
- Use Playwright for browser APIs, sandboxed iframes, Monaco and drag-and-drop.
- Add a regression test when fixing a bug.
- Keep test names readable as specifications.
