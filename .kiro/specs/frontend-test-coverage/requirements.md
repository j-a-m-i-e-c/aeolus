# Frontend Test Coverage — Requirements

## Goal

Raise the **frontend** (`frontend/`) test coverage to **>90% lines** and add a
coverage **threshold gate** to `frontend/vite.config.ts`, mirroring the gate the
backend already has in `vitest.config.ts`.

## Why

The backend enforces coverage in CI (`vitest.config.ts` → `test.coverage.thresholds`:
`lines: 90, branches: 70, functions: 75`, plus per-directory floors). The frontend
has **no** `thresholds` block, so coverage can silently regress. The frontend CI job
(`.github/workflows/ci.yml` → `frontend`) already runs `npm run test:coverage`, so
adding a `thresholds` block is sufficient to enforce the gate — no workflow change
needed (vitest exits non-zero when a threshold is unmet).

## Baseline (captured this session)

Overall from `cd frontend && npm run test:coverage`:

| Metric | Current |
|--------|---------|
| Lines | **55.51%** |
| Branches | 83.94% |
| Functions | 71.52% |
| Statements | 55.51% |

Lines are dragged down almost entirely by a small set of large, near-0% files. Some
are genuinely hard to exercise in jsdom (Monaco editors, SVG charts, the flow diagram)
and are excluded as e2e territory. The rest — including the ~1000-line AutomationPane
(testable once its embedded editor is mocked) — are covered by unit tests in this spec.

## Success criteria

1. `cd frontend && npm run test:coverage` reports **≥90% lines** overall and **passes**
   its configured thresholds (exit code 0).
2. `frontend/vite.config.ts` has a `test.coverage.thresholds` block (the gate).
3. The exclude list in `frontend/vite.config.ts` only excludes files with a written
   justification (see design.md) — no blanket exclusions to game the number.
4. All new tests pass; `cd frontend && npx tsc --noEmit -p tsconfig.json` stays clean;
   `npx eslint . --max-warnings 0` (from repo root) stays clean.
5. No production code deleted solely to raise coverage without confirming it is dead.

## Out of scope

- Backend coverage (already gated).
- e2e tests (tracked separately under `e2e/`). The excluded files below are the
  intended domain of e2e, not unit tests.
