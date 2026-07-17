---
inclusion: auto
description: Development workflow, code standards and current repository structure for Aeolus
---

# Aeolus development workflow

## Git conventions

Use Conventional Commits:

```text
<type>(<scope>): <description>
```

Common types:

```text
feat fix refactor docs test chore perf ci
```

Common scopes:

```text
mqtt devices automations api dashboard connectors data-store auth docker deps
```

Keep a commit focused and leave the repository buildable.

## TypeScript

- Strict mode is required.
- Prefer explicit types at module boundaries.
- Use `interface` for object contracts and `type` for unions.
- Avoid `any`; use `unknown` and narrow it.
- Use `const` unless reassignment is necessary.
- Use clear names in domain code.

## API and persistence

- Validate request data with Zod middleware.
- Use parameterised SQLite statements.
- Return consistent JSON errors.
- Log failures with useful context.
- Add schema changes as numbered migrations under `src/db/migrations/`.
- Do not edit a deployed schema only through ad hoc startup SQL.

## Error handling

- Use the API error classes for expected HTTP failures.
- Do not expose production stack traces.
- Do not silently convert a failed physical operation into success.
- Sandbox failures return structured results and must not crash the backend.

## Tests

Before a significant commit:

```bash
make verify
```

Useful additional checks:

```bash
npx vitest run --coverage
cd frontend && npm run test:coverage && cd ..
make e2e
```

Use:

- unit tests for focused behaviour;
- property tests for invariants;
- integration tests for real route/storage boundaries;
- Playwright for browser and full-stack workflows.

## Repository structure

```text
aeolus/
├── src/
│   ├── api/                 # Express routes, middleware and schemas
│   ├── auth/                # Human auth, permissions and MQTT credentials
│   ├── core/                # Device registry, event bus, history and types
│   ├── mqtt/                # MQTT service, envelopes and provisioning
│   ├── automations/         # Engine, sandbox, state and command lifecycle
│   ├── connectors/          # Connector framework, Hue, Kasa and template
│   ├── data-store/          # Collections, buckets and retention
│   ├── metrics/             # Prometheus and history aggregation
│   ├── websocket/           # Real-time server
│   ├── db/                  # better-sqlite3, migrations and checkpoints
│   └── index.ts             # Composition root
├── frontend/src/
│   ├── components/
│   ├── pages/
│   ├── store/
│   ├── lib/
│   ├── sandbox/             # iframe host, broker and runtime
│   └── types/
├── docs/
│   ├── reference/
│   ├── security/
│   └── how-to/
├── scripts/
├── e2e/
└── .github/workflows/
```

## Adding an API route

1. Add or update the route in `src/api/routes/`.
2. Add a Zod schema when input is accepted.
3. Apply the correct authentication and permission middleware.
4. Add route tests.
5. Update `docs/reference/api.md`.

## Adding a connector

1. Copy `src/connectors/_template/`.
2. Implement the connector module and tests.
3. Import and register the bundled connector in `src/index.ts`.
4. Add a specialised frontend pane only when the generic device UI is insufficient.
5. Update the connector guide or reference when the contract changes.

## Adding a frontend feature

1. Add the component, page, store or sandbox code.
2. Follow `docs/BRANDING.md`.
3. Test pure and jsdom-suitable behaviour with Vitest.
4. Use Playwright for real iframe, Monaco or drag-and-drop behaviour.
5. Update `docs/reference/dashboard.md` when the visible platform changes.

## Documentation

Follow `.kiro/steering/documentation-updates.md`. Do not put new material into the old comprehensive compatibility stub.

Last reviewed: 2026-07-17
