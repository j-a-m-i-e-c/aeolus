# Contributing to Aeolus

Thanks for your interest in contributing to Aeolus! This guide will help you get started.

## Getting Started

1. Use the pinned Node version. `.nvmrc` holds it (`nvm use` picks it up), and both
   `package.json` files enforce it via `engines`. Aeolus pins one exact Node patch
   release because the `isolated-vm` automation runtime is a native V8 addon tied to a
   specific ABI — and a mismatch disables the sandbox with only a log warning rather
   than failing loudly, so automations silently stop running. See
   [ADR-0010](docs/adr/0010-node-24-runtime.md). If `npm ci` prints an `EBADENGINE`
   warning, stop and switch Node rather than continuing.
2. Fork the repository
3. Clone your fork: `git clone https://github.com/YOUR_USERNAME/aeolus.git`
4. Install dependencies:
   ```bash
   cd aeolus
   npm ci
   cd frontend && npm ci && cd ..
   ```
5. Copy the environment file: `cp .env.example .env`
6. Start with Docker Compose: `docker compose up -d --build`

   On Docker Desktop (Windows/macOS), host networking is not reachable on `localhost`. Opt in to bridge networking by loading the desktop override explicitly:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.desktop.yml up -d --build
   ```

   The override is never auto-loaded, so the default `docker compose up` keeps the deterministic host-networking path used on the Pi/Linux deployment.

The backend runs on port 3001, the frontend on port 3000, and Mosquitto on port 1883.

## Development Workflow

1. Create a branch from `main`: `git checkout -b feat/your-feature`
2. Make your changes
3. Run the local verification gate: `make verify`
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(dashboard): add new pane type for weather data
   fix(kasa): handle timeout during device discovery
   docs: update API reference with new endpoint
   ```
5. Push and open a Pull Request against `main`

## Commit Convention

We use Conventional Commits with scoped types:

- `feat(scope)` — new feature
- `fix(scope)` — bug fix
- `refactor(scope)` — code change that neither fixes a bug nor adds a feature
- `docs` — documentation changes
- `test(scope)` — adding or updating tests
- `chore(scope)` — build, tooling, dependencies

Scopes: `mqtt`, `devices`, `automations`, `api`, `dashboard`, `hue`, `kasa`, `docker`, `deps`

## Adding a New Connector

Aeolus uses a pluggable connector framework. To add a new device integration:

1. Copy `src/connectors/_template/` to `src/connectors/your-connector/`
2. Implement the `Connector` interface
3. Export `metadata`, `configSchema`, and `createConnector` from `index.ts`
4. Register in `src/index.ts`

See `src/connectors/README.md` for the full developer guide.

## Code Standards

- TypeScript strict mode
- Use `interface` for object shapes, `type` for unions
- Explicit return types on exported functions
- kebab-case for file names, PascalCase for components
- No `any` — use `unknown` and narrow with type guards

## Testing

- Vitest as the test runner
- Test files live next to source: `device-registry.test.ts`
- Property-based tests use fast-check

## Pull Request Checklist

- [ ] Code builds without errors
- [ ] Typecheck, lint and tests pass (`make verify`)
- [ ] Follows Conventional Commits format
- [ ] Behaviour changes documented in the narrow relevant file under `docs/reference/` or `docs/security/`
- [ ] New API endpoints documented in `docs/reference/api.md`
- [ ] No secrets or API keys committed

## Questions?

Open a [GitHub Issue](https://github.com/j-a-m-i-e-c/aeolus/issues) or start a [Discussion](https://github.com/j-a-m-i-e-c/aeolus/discussions).
