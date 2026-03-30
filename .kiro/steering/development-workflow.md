---
inclusion: auto
description: Development workflow, git conventions, code standards, and project structure for Aeolus
---

# Aeolus Development Workflow

## Git Commit Conventions

Follow the Conventional Commits specification (https://www.conventionalcommits.org/).

### Commit Format

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

### Types

- `feat` — new feature or capability
- `fix` — bug fix
- `refactor` — code change that neither fixes a bug nor adds a feature
- `docs` — documentation only changes
- `style` — formatting, missing semicolons, etc. (no code logic change)
- `test` — adding or updating tests
- `chore` — build process, tooling, dependencies, CI/CD
- `perf` — performance improvement
- `ci` — CI/CD pipeline changes

### Scopes

- `mqtt` — MQTT ingestion service
- `devices` — device registry
- `automations` — automation engine
- `api` — REST API and WebSocket
- `dashboard` — frontend React dashboard
- `hue` — Philips Hue integration
- `docker` — Docker and docker-compose
- `deps` — dependency changes

### Rules

- Use imperative mood: "add feature" not "added feature" or "adds feature"
- Keep the subject line under 72 characters
- Do not end the subject line with a period
- Separate subject from body with a blank line
- Reference spec task IDs in the body when applicable (e.g. "Implements task 2.1")
- Each commit should represent a single logical change — do not bundle unrelated changes
- Never commit broken code to main — every commit should build and pass tests

### Examples

```
feat(mqtt): add broker connection with exponential backoff retry

Implements task 1.1 — MQTT ingestion service connects to Mosquitto
on startup with configurable host/port and retries up to 5 times.

feat(devices): add device registry with SQLite persistence

feat(dashboard): add device grid with toggle controls

fix(hue): handle bridge timeout during light discovery

refactor(api): extract device validation into middleware

test(automations): add unit tests for rule execution engine

chore(docker): add Mosquitto broker to docker-compose

docs: update comprehensive documentation with API endpoints
```

## Branch Strategy

- `main` — production-ready code, always deployable
- Feature branches are optional for larger changes but not required for this project
- If using branches: `feat/<short-name>`, `fix/<short-name>`

## Development Workflow

### For each spec task:

1. Read the task requirements and acceptance criteria
2. Implement the minimal code to satisfy the criteria
3. Write or update tests
4. Verify the code builds without errors
5. Commit with a descriptive conventional commit message
6. Move to the next task

### Commit Granularity

- One commit per logical unit of work (not per file)
- A spec task may result in 1-3 commits depending on complexity
- Infrastructure/config changes get their own commit
- Test additions can be in the same commit as the feature or separate
- Commit after every completed sub-task — do not batch multiple sub-tasks into one commit
- Never leave uncommitted work when moving to the next task

## Code Standards

### TypeScript

- Strict mode enabled in tsconfig
- Explicit return types on exported functions
- Use `interface` for object shapes, `type` for unions/intersections
- Avoid `any` — use `unknown` and narrow with type guards
- Use `const` by default, `let` only when reassignment is needed

### File Naming

- Use kebab-case for all file names: `device-registry.ts`, `mqtt-service.ts`
- Use PascalCase for React components: `DeviceCard.tsx`, `Dashboard.tsx`
- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces

### Project Structure

```
aeolus/
├── src/
│   ├── api/           # Express routes and middleware
│   ├── core/          # Core engine (device registry, state management)
│   ├── mqtt/          # MQTT connection and message handling
│   ├── automations/   # Automation engine and DSL
│   ├── integrations/  # Integration interface and implementations
│   │   └── hue/      # Philips Hue integration
│   ├── websocket/     # WebSocket server
│   └── index.ts       # Entry point
├── frontend/          # React + Vite dashboard
│   ├── src/
│   │   ├── components/
│   │   ├── store/     # Zustand stores
│   │   ├── lib/       # Utilities
│   │   └── App.tsx
│   └── index.html
├── automations/       # User-defined automation rule files
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── docs/
```

### Error Handling

- Use try-catch in async functions
- Log errors with context (what was being attempted, relevant IDs)
- Never swallow errors silently — always log at minimum
- Return meaningful error responses from API endpoints
- Use custom error classes for domain-specific errors

### Logging

- Use a structured logger (pino recommended, same as lol-main)
- Log levels: error, warn, info, debug
- Include context in log messages (device ID, topic, action type)
- Never log sensitive data (API keys, passwords)

### Testing

- Use Vitest as the test runner
- Unit tests for core logic (device registry, automation engine, message normalization)
- Integration tests for API endpoints
- Test files live next to source files: `device-registry.test.ts`
- Aim for test coverage on all core modules before moving to frontend

## Environment Configuration

- Use `.env` files for local development
- Use environment variables for all configurable values
- Never commit `.env` files or secrets
- Document all required environment variables in README and comprehensive docs

## Dependencies

- Minimize dependencies — prefer standard library where possible
- Pin major versions in package.json
- Document why each dependency is needed
- Prefer well-maintained, widely-used packages