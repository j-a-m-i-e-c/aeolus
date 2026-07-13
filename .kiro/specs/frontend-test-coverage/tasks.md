# Frontend Test Coverage — Tasks

Work top-to-bottom. Run `cd frontend && npm run test:coverage` after each group to see
progress. All paths are relative to `frontend/`. Current % is from the session baseline.

> **STATUS (handoff to smaller model):** overall lines **80.24%** (started 55.51%).
> Done on the strong model: excludes (task 1), App.tsx (2.4 → ~86%), api-client (3.1 → 100%),
> AutomationsPage (2.15), AutomationPane (2.17 → ~81%), and ConnectorsPage (9.9% → ~84%,
> `ConnectorsPage.test.tsx`). The DO-NOT-add-thresholds-yet rule still holds — add the gate
> (task 4) only once overall lines clear 90%. Remaining work is mechanical: the small
> untested components in Bucket B (ActivityFeed, CommandPalette, DeviceCard, DeviceDetail,
> EventLog, PanePicker, SnippetPicker, TimeRangeSelector, useTabPermission, MqttSecurityPage,
> ScheduleViewerPane-verify-first) + Bucket C store branches. ~10 points to go.
>
> Reusable mock patterns proven this session (copy from the done test files):
> - framer-motion: cache the mocked component per key (see AutomationsPage/ConnectorsPage tests).
> - api-client: `const api = vi.hoisted(() => ({ ... }))` then `vi.mock("../lib/api-client", () => api)`.
> - stores: `vi.mock(path, () => ({ useX: (sel) => sel({ ...state }) }))`; add `useX.getState = ...` if the module calls it.
> - Monaco children (ScriptEditor/UiEditor): stub with a plain div, expose `onSave` via a button.

---

- [x] 1. Add the coverage excludes (do this first — it re-baselines the number) — DONE
  - Edit `frontend/vite.config.ts` → `test.coverage.exclude`, appending the **8** globs in
    design.md Part 1 (Monaco editors, SVG charts, FlowDiagram, panes/types.ts).
  - Do NOT exclude `panes/AutomationPane.tsx` — it's unit-tested in task 2.17.
  - Re-run `npm run test:coverage` and record the new overall line %. This is the real
    starting point for the test work below.

- [ ] 2. Bucket B — write tests for untested, jsdom-friendly files
  - [ ] 2.1 `src/hooks/useTabPermission.ts` (0%) — pure hook; test with mocked permissions store. Quick win.
  - [ ] 2.2 `src/components/panes/AutomationRulesPane.tsx` (50%) — trivial wrapper; mock `../AutomationsPage`, assert render. (Template: SystemStatsPane.test.tsx)
  - [ ] 2.3 `src/components/panes/ConnectorsPane.tsx` (50%) — trivial wrapper; same pattern.
  - [x] 2.4 `src/App.tsx` (0% → ~86%) — DONE (`src/App.test.tsx`).
  - [ ] 2.5 `src/components/TimeRangeSelector.tsx` (10%) — small; test option selection + callback.
  - [ ] 2.6 `src/components/DeviceCard.tsx` (17.5%) — render states + click.
  - [ ] 2.7 `src/components/DeviceGrid.tsx` (20%) — renders cards from devices; empty state.
  - [ ] 2.8 `src/components/EventLog.tsx` (7.4%) — renders log entries; empty/filter states.
  - [ ] 2.9 `src/components/ActivityFeed.tsx` (6%) — renders feed items; empty state.
  - [ ] 2.10 `src/components/PanePicker.tsx` (0%) — lists pane types; selecting one calls addPane (mock dashboard store).
  - [ ] 2.11 `src/components/CommandPalette.tsx` (0%) — open/close, search filter, select device callback.
  - [ ] 2.12 `src/components/DeviceDetail.tsx` (0%) — renders device fields; close callback.
  - [ ] 2.13 `src/components/SnippetPicker.tsx` (37.5%) — lists snippets, selection callback (non-Monaco).
  - [ ] 2.14 `src/pages/MqttSecurityPage.tsx` (0%) — live via SecurityPage; mock provisioning store + DeviceCredentialList, test level states/loading.
  - [x] 2.15 `src/components/AutomationsPage.tsx` (1.1% → high) — DONE (`AutomationsPage.test.tsx`, 11 tests).
  - [ ] 2.16 `src/components/panes/ScheduleViewerPane.tsx` (2.9%) — FIRST verify it's a registered/used pane (grep pane-registry). If live → test; if dead → flag to user for deletion; else exclude w/ justification (design.md).
  - [x] 2.17 `src/components/panes/AutomationPane.tsx` (2.6% → ~81%) — DONE (`AutomationPane.test.tsx`, 12 tests: setup/status/editing modes, toggle/fire/save/update, notFound/error, flow/dynamic/activity sections). Optional stretch to 90%: cover the `control`/`publish`/`save`/`fire` helpers, the cron trigger path, and the DynamicCustomSection loading/error branches — but not required if overall lines clear 90%.

- [ ] 3. Bucket C — raise existing files that are present but <90% lines
  (Extend the existing `*.test.*`; target the "Uncovered Line #s" from the coverage report.)
  - [x] 3.1 `src/lib/api-client.ts` (35.8% → 100%) — DONE (extended `api-client.test.ts`).
  - [ ] 3.2 `src/hooks/useDynamicComponent.ts` (64.2%) — cover error/fallback branches (lines ~34-35, 75, 135-186).
  - [ ] 3.3 `src/store/data-store-store.ts` (72.5%) — cover remaining actions/error paths.
  - [ ] 3.4 `src/store/metrics-history-store.ts` (79.4%)
  - [ ] 3.5 `src/store/auth-store.ts` (83.1%) — refresh-timer / failure branches (~165-188, 230-231).
  - [ ] 3.6 `src/store/dashboard-store.ts` (84.1%)
  - [ ] 3.7 `src/store/mqtt-provisioning-store.ts` (86.6%)
  - [ ] 3.8 `src/components/SystemPage.tsx` (85.9%, branches 56%) — cover conditional render branches.
  - [ ] 3.9 `src/components/TabLayout.tsx` (85.4%, funcs 44%) — cover pane add/remove/config handlers.
  - [ ] 3.10 `src/components/Sidebar.tsx` (87.0%) — cover remaining tab drag/rename/delete branches.
  - [ ] 3.11 `src/pages/data-store/SettingsPanel.tsx` (87.8%)

- [ ] 4. Add the threshold gate and verify
  - [ ] 4.1 Add the `thresholds` block from design.md Part 3 to `frontend/vite.config.ts` → `test.coverage`.
  - [ ] 4.2 `cd frontend && npm run test:coverage` → confirm ≥90% lines and exit 0.
  - [ ] 4.3 `cd frontend && npx tsc --noEmit -p tsconfig.json` → clean.
  - [ ] 4.4 From repo root: `npx eslint . --max-warnings 0` → clean.
  - [ ] 4.5 Commit. The `frontend` CI job now enforces the gate (already runs `npm run test:coverage`).

---

## Quick reference — the 8 files EXCLUDED (do not write unit tests for these)

`ScriptEditor.tsx`, `UiEditor.tsx`, `lib/monaco-setup.ts`, `MetricSparkline.tsx`,
`StateHistoryChart.tsx`, `pages/data-store/TimeSeriesChart.tsx`, `FlowDiagram.tsx`,
`panes/types.ts` — these are e2e territory / type-only.

`panes/AutomationPane.tsx` is **NOT** excluded — it's unit-tested (task 2.17).

## Already at/near 100% (leave alone)

Layout, AeolusLogo, Sparkline, SensorPanel, SystemHealth, WelcomeScreen, LoginPage,
SetupPage, SecurityPage, UsersPage, DataStorePage, device-store, pane-registry, env,
cron-utils, most panes, and the mqtt/* + hue/* component sets.
