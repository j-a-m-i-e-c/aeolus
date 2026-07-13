# Frontend Test Coverage — Design

## Strategy (two-pronged)

1. **Exclude** the files that are genuinely hard to exercise in jsdom and are the
   intended domain of e2e tests. This removes large 0% denominators that no unit test
   should be chasing. Each exclusion is justified below.
2. **Test** the remaining untested/under-tested files that ARE jsdom-friendly, until
   overall lines clear 90%.

Do #1 first (it re-baselines the percentage), then re-run coverage and let the numbers
tell you how much of #2 is actually required.

## Part 1 — Coverage excludes (add to `frontend/vite.config.ts` → `test.coverage.exclude`)

Append these globs, keeping the existing entries. Justification is per the platform's
"high-effort / low-jsdom-fit → e2e" call already made for the app:

| File | Why excluded |
|------|--------------|
| `src/components/ScriptEditor.tsx` | Monaco editor — needs a real DOM/worker; e2e territory |
| `src/components/UiEditor.tsx` | Monaco editor — same |
| `src/lib/monaco-setup.ts` | Monaco worker/env wiring — nothing meaningful to unit-test |
| `src/components/MetricSparkline.tsx` | SVG chart — geometry/paths, not logic; visual e2e |
| `src/components/StateHistoryChart.tsx` | SVG chart — same |
| `src/pages/data-store/TimeSeriesChart.tsx` | SVG chart — same |
| `src/components/FlowDiagram.tsx` | Node/edge flow diagram — layout-heavy; visual e2e |
| `src/components/panes/types.ts` | Type-only module (mirrors backend excluding `types/**`) |

That is **8 files**. Do NOT exclude anything else without adding a row here explaining why.

> **Decision:** `src/components/panes/AutomationPane.tsx` (~1000 lines) is intentionally
> **NOT excluded** — we're covering it with unit tests (mock its embedded Monaco editor).
> See tasks.md Bucket B. It's the highest-effort item; do it last.

## Part 2 — Tests to write

See `tasks.md` for the ranked, per-file checklist with current coverage. Two buckets:

- **Bucket B — untested (0%–~40%) but jsdom-friendly**: write fresh `*.test.tsx`.
- **Bucket C — present but <90% lines**: extend existing tests to hit the uncovered
  lines listed by the coverage report.

## Test conventions (match the existing suite — copy these patterns)

- Runner: Vitest + jsdom + React Testing Library. Global setup is
  `frontend/src/test-setup.ts` (registers `@testing-library/jest-dom` matchers and
  runs `cleanup()` after each test). No per-file setup needed for those.
- **Zustand stores are mocked per-test with `vi.hoisted` + `vi.mock`.** Canonical
  template: `frontend/src/pages/SetupPage.test.tsx` (mocks `../store/auth-store`,
  drives the form, asserts calls + error/loading states).
- **Thin wrapper panes**: mock the wrapped component and assert it renders. Template:
  `frontend/src/components/panes/SystemStatsPane.test.tsx`. Use this for
  `AutomationRulesPane` (mock `../AutomationsPage`) and `ConnectorsPane`.
- **Components that embed Monaco** (e.g. `AutomationsPage` in code mode, and
  `panes/AutomationPane`): mock the editor import (`vi.mock("./ScriptEditor", ...)` /
  `vi.mock("@monaco-editor/react", ...)`) so the test exercises the surrounding logic
  without loading Monaco.
- Prefer role/label/text queries (`getByRole`, `getByLabelText`, `getByText`) over
  test-ids where the markup allows; use `data-testid` only for mocked stand-ins.
- For `fetch`/network, mock the api-client module or `global.fetch` per test.
- Routing (`App.tsx`): wrap in `MemoryRouter` if needed and mock `useAuthStore`
  selector states (`loading` / `needsSetup` / `isAuthenticated`) to hit each branch.

## Part 3 — The gate (add to `frontend/vite.config.ts` → `test.coverage`)

Mirror the backend's gate. Start at backend parity and ratchet up later if desired:

```ts
thresholds: {
  lines: 90,
  functions: 75,
  branches: 70,
  statements: 90,
},
```

Notes:
- Frontend branches already sit at ~84% and functions rise well past 75% once Part 2
  lands, so these are a safe floor, not a stretch. Bump them toward the achieved
  numbers once green if you want a tighter ratchet.
- No per-directory floors are required initially (backend uses them for historically
  weak areas). Add them only if a specific dir needs protection.

## Verification

1. `cd frontend && npm run test:coverage` → must report ≥90% lines and exit 0.
2. `cd frontend && npx tsc --noEmit -p tsconfig.json` → clean.
3. From repo root: `npx eslint . --max-warnings 0` → clean.
4. The `frontend` CI job enforces the gate automatically (already runs
   `npm run test:coverage`).

## Risks / gotchas

- `ScheduleViewerPane.tsx` appears only self-referenced (not imported by
  `pane-registry.ts` or anywhere). **Verify** whether it's a registered pane before
  spending effort: if live → test it; if dead → propose deletion to the user (do not
  silently delete); as a last resort exclude with justification.
- `AutomationsPage.tsx` (776 lines) is live via `AutomationRulesPane`. It's testable
  (forms + fetch) but sizeable — mock any Monaco/editor import and focus on list
  rendering, create/edit/delete flows, and error states.
- Don't inflate coverage by importing modules without asserting behavior. Every added
  test must assert something real.
