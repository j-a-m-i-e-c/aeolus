# Testing Strategy

Aeolus uses a multi-layered testing approach to ensure reliability across the full stack.

## Test Runner

- **Vitest** — fast, TypeScript-native, ESM-first
- **fast-check** via `@fast-check/vitest` — property-based testing
- **supertest** — HTTP integration testing against Express

## Test Layers

### 1. Unit Tests (`*.test.ts`)

Standard isolated tests with mocked dependencies. Each module has a colocated test file.

```
src/connectors/connector-manager.ts
src/connectors/connector-manager.test.ts
```

**Coverage:** Core services, API routes, middleware, auth, data store, connectors.

### 2. Property-Based Tests (`*.property.test.ts`)

Generate thousands of random inputs to verify invariants hold universally — not just for hand-picked examples.

```typescript
it.prop([fc.string()], "topic parser never throws", (topic) => {
  const result = parseTopic(topic);
  // Always returns ParsedTopic or null — never throws
  expect(result === null || typeof result.deviceId === "string").toBe(true);
});
```

**Coverage:** MQTT topic parsing, device registry, sandbox action dispatch, connector manager, auth services, middleware validation, data store duration parsing.

### 3. Integration Tests (`__integration__/`)

Full Express app with real SQLite database, middleware pipeline, and route handlers. No mocks — tests the actual request/response cycle.

**Coverage:** Device routes, automation routes, data store API, MQTT provisioning.

### 4. Frontend Tests (`frontend/src/**/*.test.ts`)

Component and store tests for the React dashboard using Vitest.

## Coverage Thresholds

Configured in `vitest.config.ts`:

| Scope | Lines | Branches | Functions |
|-------|-------|----------|-----------|
| Global | 90% | 70% | 75% |
| `src/core/` | 85% | — | — |
| `src/mqtt/` | 80% | — | — |
| `src/data-store/` | 80% | — | — |
| `src/automations/` | 50% | — | — |

The lower automations threshold reflects that the V8 sandbox (`isolated-vm`) requires native compilation and is tested primarily through property tests and integration tests rather than direct unit tests.

## Running Tests

```bash
# Run all tests
make test

# Run with coverage report
npx vitest run --coverage

# Run a specific file
npx vitest run src/mqtt/topic-parser.test.ts

# Watch mode (development)
npx vitest
```

## Writing Tests

- **Colocate** test files next to source (`module.ts` → `module.test.ts`)
- **Property tests** go in `module.property.test.ts` for invariant verification
- **Use mocks sparingly** — prefer integration tests for route handlers
- **Name tests descriptively** — the test name should read as a specification

## CI Integration

Tests run automatically on every push and PR via GitHub Actions:
- TypeScript type check (`tsc --noEmit`)
- Full test suite with coverage (`vitest run --coverage`)
- ESLint (blocking — errors fail the build)
