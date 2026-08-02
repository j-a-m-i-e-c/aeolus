# Implementation Plan: Connector Correctness Release Gates

## Overview

Bring the bundled Kasa and Hue connectors into conformance with the Action
Catalog, brightness and multi-instance contracts, then add the production-
composition integration coverage that would have caught the divergence. Work
proceeds connector-by-connector (Kasa first — it has the most self-contained
fixes), then Hue, then identity, then the shared integration suite. Tasks marked
`*` are optional test tasks that can be deferred for a faster path but are
recommended before promotion.

## Tasks

- [x] 1. Kasa power-state correctness (H1, H2)
  - [x] 1.1 Add the canonical `kasaPowerState` helper
    - Created `src/connectors/kasa/kasa-power-state.ts` with `KasaSysInfo` and
      `kasaPowerState(sysInfo)` — `light_state.on_off` precedence, then
      `relay_state`, else `false`
    - _Requirements: 1.1, 1.2, 1.3, 1.7_
  - [x] 1.2 Use the helper in discovery and toggle
    - Replaced the precedence-buggy inline `isOn` in `mapDevice()` and the
      `relay_state`-only read in the `toggle` case with `kasaPowerState(sysInfo)`
    - _Requirements: 1.4, 1.5, 1.6_
  - [x]* 1.3 Property test — Property 1 (power state precedence is total/correct)
    - `src/connectors/kasa/kasa-power-state.test.ts`, 200 runs
    - _Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7_
  - [x]* 1.4 Unit tests — plug on, bulb on, both absent, toggle uses canonical state
    - In `kasa-power-state.test.ts` + existing branch tests
    - _Requirements: 1.4, 1.5, 1.6, 1.7_

- [x] 2. Kasa truthful action catalog (H3)
  - [x] 2.1 Add explicit `getActionCatalog(deviceId)` returning only toggle/on/off
    - _Requirements: 2.1, 2.2_
  - [x] 2.2 Stop advertising unimplemented capabilities
    - Bulbs and plugs register `capabilities: ["on/off"]`; energy telemetry stays
      in `device.state` only
    - _Requirements: 2.3, 2.4_
  - [x]* 2.3 Catalog test — advertises only implemented actions
    - `src/connectors/kasa/kasa-connector.correctness.test.ts`
    - _Validates: Requirements 2.1–2.4_

- [x] 3. Kasa bounded discovery listeners (H4)
  - [x] 3.1 Register scan-local handlers and remove them on scan completion
    - `client.off(...)` runs in a `finally` (success/timeout/error); mapping and
      de-dup preserved
    - _Requirements: 3.1, 3.2, 3.4_
  - [x]* 3.2 Fake-timer test — listener count invariant across N polls
    - In `kasa-connector.correctness.test.ts` (real EventEmitter FakeClient)
    - _Validates: Requirements 3.1, 3.2, 3.3_

- [x] 4. Checkpoint — verify Kasa (53 Kasa tests pass)

- [x] 5. Hue explicit action catalog (H5)
  - [x] 5.1 Add `getActionCatalog(deviceId)` from the cached `CapabilitySet`
    - toggle/on/off/rename/delete always; brightness (0–100) iff hasBrightness;
      color iff hasColor; color-temp iff hasColorTemp; color-temp now reachable
    - _Requirements: 4.1, 4.2, 4.3, 4.6_
  - [x] 5.2 Implement explicit `on` / `off` cases in `execute()`
    - PUT `{ on: true }` / `{ on: false }`
    - _Requirements: 4.4_
  - [x]* 5.3 / 5.4 Catalog + on/off tests
    - `src/connectors/hue/hue-connector.catalog.test.ts`
    - _Validates: Requirements 4.1–4.6_

- [x] 6. Hue canonical brightness (H6)
  - [x] 6.1 Convert native `bri` → 0–100 in `extractDeviceState`
    - _Requirements: 5.1, 5.2_
  - [x] 6.2 Update `DeviceDetail` brightness slider to `min=0 max=100`
    - Also updated `HueControlPane` slider + `hueToHsl` to the 0–100 scale
    - _Requirements: 5.4_
  - [x] 6.3 Update Hue snippets/examples to 0–100
    - _Requirements: 5.5_
  - [x]* 6.4 Brightness unit tests updated (capability-mapper: 200→79)
    - _Validates: Requirements 5.1, 5.2, 5.3, 5.6_

- [x] 7. Checkpoint — verify Hue (93 Hue backend + frontend pane/detail tests pass)

- [x] 8. Globally unique device identity (H7)
  - **No migration.** IDs change directly; old references are acceptable collateral.
  - [x] 8.1 Hue identity from `uniqueid`
    - Exported `hueDeviceId(uniqueId, index)`; `hue-<sanitised uniqueid>`,
      fallback `hue-light-<index>` + warning; `deviceMap` re-keyed; name separate
    - _Requirements: 6.1, 6.4, 6.5_
  - [x] 8.2 Kasa identity from native `deviceId`/MAC
    - `kasa-<sanitised deviceId>`; alias→name; host fallback + warning
    - _Requirements: 6.2, 6.3, 6.4, 6.5_
  - [x]* 8.3 Identity tests (stable across rename; unique; uniqueid-driven)
    - _Validates: Requirements 6.1, 6.2, 6.3, 6.4_

- [x] 9. Checkpoint — verify identity (273 connector tests incl. multi-instance pass)

- [x] 10. Production-composition command-path integration suite (Req 7, review M4)
  - [x] 10.1 Wire the real composition graph in a new integration suite
    - `src/__integration__/production-command-path.integration.test.ts`
    - _Requirements: 7.1_
  - [x] 10.2 Assert the command-path scenarios (9 tests)
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 11. Final checkpoint — full verification and docs
  - Backend `vitest run` (1787 passed), frontend (751 passed), `tsc --noEmit`
    (backend + frontend clean), ESLint clean on changed files
  - Updated `docs/reference/connectors.md` (identity + catalog + brightness units)
  - No regression to authorization/scoping/event-admission suites (Req 8)

## Notes

- `*` tasks are optional test tasks; the non-`*` implementation tasks are the
  release-gate work.
- Each task references requirements for traceability.
- No migration for the identity change (task 8): Aeolus has no production users
  yet, so device IDs change directly and old references are acceptable collateral.
  Do not build migration machinery.
- Established stack only: TypeScript (strict), Vitest, fast-check, React,
  Zustand, Tailwind, supertest.
- Reviews M1 (Hue 2xx error parsing), M2 (device-removal reconciliation) and M3
  (optimistic on/off state) are intentionally out of scope and tracked in
  `docs/BACKLOG.md`.
