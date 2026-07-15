---
inclusion: auto
description: Development workflow, git conventions, code standards, and project structure for Aeolus
---

# Aeolus Development Workflow

## Git Commit Conventions

Follow Conventional Commits (https://www.conventionalcommits.org/).

```
<type>(<scope>): <short description>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

**Scopes:** `mqtt`, `devices`, `automations`, `api`, `dashboard`, `hue`, `kasa`, `data-store`, `docker`, `deps`

**Rules:**
- Imperative mood: "add feature" not "added feature"
- Subject line under 72 characters
- Each commit = one logical change, builds and passes tests
- Push directly to main (single developer, no PR required)

## Code Standards

### TypeScript
- `strict: true` and `noImplicitAny: true` in tsconfig
- NO `any` types — use specific types, or `unknown` with type guards as last resort
- If `any` is truly unavoidable (library constraints), add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` with explanation
- Use `interface` for object shapes, `type` for unions/intersections
- Use `const` by default, `let` only when reassignment is needed
- Full variable names — no abbreviations (`context` not `ctx`, `request` not `req` in domain code)

### Naming
- Files: kebab-case (`device-registry.ts`, `mqtt-service.ts`)
- React components: PascalCase (`DeviceCard.tsx`, `DataStorePage.tsx`)
- Variables/functions: camelCase
- Classes/interfaces: PascalCase

### API & Middleware
- All POST/PUT routes use Zod schema validation via `validate()` middleware
- All errors return `{ error: string, details?: unknown }` — never leak stack traces in production
- Use parameterized SQL queries — NEVER string interpolation with user values
- Rate limiting is active (1000 req/min default, configurable via `RATE_LIMIT_RPM`)
- CORS allows localhost, .local hostnames, and private IPs by default

### Error Handling
- Use `AppError`, `BadRequestError`, `NotFoundError` from `src/api/middleware/error-handler.ts`
- Log errors with context (device ID, rule ID, action type)
- Never swallow errors silently — always log at minimum
- Sandbox errors are caught and logged, never propagated to crash the process

### Testing
- Vitest as the test runner
- fast-check for property-based testing (minimum 100 iterations)
- supertest for API integration tests
- Test files live next to source: `*.test.ts`, `*.property.test.ts`
- Run `npx vitest run` before committing
- Run `npx tsc --noEmit` to verify type safety (backend)
- Run `npx tsc --noEmit -p tsconfig.json` in `frontend/` to verify frontend type safety (this is what CI runs — it excludes `@types/node` so test files using Node APIs need `/// <reference types="node" />`)
- Run `npx vitest run --coverage` to verify coverage thresholds are met

### ESLint
- Flat config at `eslint.config.js`
- `@typescript-eslint/no-unused-vars`: error (with `argsIgnorePattern: "^_"`)
- `@typescript-eslint/no-explicit-any`: warn
- `consistent-return`: error
- Run `npx eslint .` to check (non-blocking in CI during rollout)

## Project Structure

```
aeolus/
├── src/
│   ├── api/
│   │   ├── routes/          # Express route handlers
│   │   ├── middleware/      # CORS, rate limiter, validation, error handler
│   │   └── schemas/         # Zod validation schemas per route group
│   ├── core/                # Device registry, event bus, state history, types
│   ├── mqtt/                # MQTT 5.0 service with reconnection + backoff
│   ├── automations/         # Engine, sandbox, transpiler, state store, execution log
│   ├── connectors/          # Pluggable framework (hue/, kasa/, _template/)
│   ├── services/            # Cron, API triggers, system events
│   ├── data-store/          # Time-series collections + key-value buckets
│   ├── websocket/           # WebSocket server (data-driven event mapping)
│   ├── db/                  # sql.js setup, schema, WAL mode
│   └── index.ts             # Entry point + graceful shutdown
├── frontend/src/
│   ├── components/          # UI components + pane wrappers
│   │   └── panes/hue/      # Hue-specific sub-components
│   ├── pages/               # Full-page components (DataStorePage, data-store/)
│   ├── store/               # Zustand stores (device, dashboard, automation-state, data-store)
│   ├── hooks/               # useDynamicComponent (runtime UI loading)
│   ├── lib/                 # API client, WebSocket client, pane registry, cron utils
│   └── types/               # Dashboard types + defaults
├── scripts/                 # seed-demo.mjs, setup-pi.sh, deploy-pi.sh
├── docs/                    # COMPREHENSIVE_DOCUMENTATION, BRANDING, ROADMAP, MICROCONTROLLERS, production-deployment
├── .github/workflows/       # CI/CD pipeline (tsc + test + lint on PR, Docker builds on main)
├── eslint.config.js         # ESLint flat config
├── docker-compose.yml       # Mosquitto + backend + frontend (with health checks + log rotation)
└── Dockerfile               # Multi-stage build (build tools in builder only)
```

## Key Patterns

### Adding a new API endpoint
1. Create/update route handler in `src/api/routes/`
2. Create Zod schema in `src/api/schemas/` if accepting body/params
3. Wire `validate()` middleware on the route
4. Update `docs/COMPREHENSIVE_DOCUMENTATION.md` (API Reference + Additional Endpoints table)

### Adding a new connector
1. Copy `src/connectors/_template/` to `src/connectors/your-connector/`
2. Implement the Connector interface
3. Register in `src/index.ts`
4. Optionally add a frontend pane in `frontend/src/components/panes/`
5. Update comprehensive docs

### Adding a new frontend page/component
1. Create component in `frontend/src/pages/` or `frontend/src/components/`
2. Add route in `App.tsx` if it's a page
3. Add to sidebar/pane registry if needed
4. Follow Aeolus design system (BRANDING.md)
5. Update comprehensive docs (Dashboard Features section)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend API port |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | MQTT broker URL |
| `MQTT_TOPICS` | `#` | Topic subscription filter |
| `DB_PATH` | `./data/aeolus.db` | SQLite database path |
| `LOG_LEVEL` | `info` | pino log level |
| `NODE_ENV` | `development` | Environment (suppresses stack traces in production) |
| `RATE_LIMIT_RPM` | `1000` | Max API requests per minute per IP |
| `CORS_ORIGINS` | _(empty)_ | Additional allowed CORS origins (comma-separated) |

---

**Last Updated**: 2026-05-15
