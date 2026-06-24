# Tasks: Multi-Domain Seed Demo

## Implementation Tasks

- [x] 0. Enabling API change
  - [x] 0.1 Expose optional `timestamp` on Data Store record write (route + schema + test) so the seed can backdate historical time-series

- [x] 1. Modular seed structure
  - [x] 1.1 `scripts/seed-demo.mjs` orchestrator (clean → automations → devices → data store → layout → fire)
  - [x] 1.2 Authentication flow (USER/PASS CLI args)
  - [x] 1.3 Clean-slate logic (delete all automations + clear layout)
  - [x] 1.4 `scripts/seed/lib.mjs` helpers (api, devices, automations [mqtt + cron], data store, layout, genSeries)
  - [x] 1.5 Error handling + progress logging + `_validate.mjs` transpile harness

- [x] 2. Smart Home tab (option b — home-only) — Evening Mode (new), Energy Monitor, Weather Station, Indoor Climate. Aquarium/brewery carry-overs dropped.

- [x] 3. Research Vessel tab — CTD Profiler ⭐, Dynamic Positioning, Underway Seawater, ROV Telemetry
- [x] 4. Agriculture tab (flagship agritech) — Irrigation & Water ⭐, Smart Fencing, Crop Health, Frost Guard
- [x] 5. Underground Mining tab — Atmospheric Monitoring, Ventilation on Demand ⭐, Personnel Muster, Dewatering Cascade
- [x] 6. Spacecraft tab — Life Support, Power System, Attitude Control, Ground Station Comms ⭐
- [x] 7. Escape Room tab — Puzzle Sequencer, Game Master Console ⭐, Hint System, Effects & Lighting
- [x] 8. Off-Grid Bunker tab — Perimeter Defence, Off-Grid Power ⭐, Air Filtration (NBC), Supply Inventory
- [x] 9. Space tab (live public APIs, no keys) — Upcoming Launches ⭐, ISS Tracker, Space Weather, Moon & Meteors

- [ ] 10. Integration and testing (on a running stack)
  - [x] 10.1 Static validation — all 28 automations' Logic + UI transpile via esbuild
  - [ ] 10.2 Run full seed on a fresh Aeolus instance; verify all tabs render
  - [ ] 10.3 Verify automations fire via "Fire Now"; custom UIs render without errors
  - [ ] 10.4 Verify Space tab live API calls populate (needs internet on the host)
  - [ ] 10.5 Verify Data Store collections appear in Data Explorer with populated charts
  - [ ] 10.6 Verify re-seed cleans + replaces cleanly

- [ ] 11. Manual build (dogfooding) + cleanup
  - [ ] 11.1 Hand-build the Local Conditions tab in the UI per `docs/guides/local-conditions-tab.md`
  - [ ] 11.2 Remove temp dev files (`scripts/seed/_validate.mjs`, `_old-seed.mjs`) before final commit
  - [ ] 11.3 Capture screenshots of the portfolio hero panes for the README
