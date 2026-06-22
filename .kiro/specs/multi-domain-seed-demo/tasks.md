# Tasks: Multi-Domain Seed Demo

## Implementation Tasks

- [ ] 1. Refactor seed script structure
  - [ ] 1.1 Create new `scripts/seed-demo.mjs` (replace existing)
  - [ ] 1.2 Implement authentication flow (accept USER/PASS CLI args)
  - [ ] 1.3 Implement clean-up logic (delete all `[SEED]` prefixed entities)
  - [ ] 1.4 Implement helper functions for creating devices, automations, layout, and data store records
  - [ ] 1.5 Add error handling and progress logging

- [ ] 2. Smart Home tab (carry-overs from existing seed)
  - [ ] 2.1 Define devices (lights, sensors, plug, thermostat)
  - [ ] 2.2 Evening Mode automation (Logic + UI)
  - [ ] 2.3 Energy Monitor automation (Logic + UI)
  - [ ] 2.4 Weather Station automation (Logic + UI)
  - [ ] 2.5 Reef Monitor, Lighting Controller, Fermentation Tracker (carry over as-is)
  - [ ] 2.6 Generate `energy-readings` data store collection
  - [ ] 2.7 Define pane layout (device grid + automation panes)

- [ ] 3. Research Vessel tab
  - [ ] 3.1 Define devices (CTD sonde, winch, GNSS, thrusters, thermosalinograph, fluorometer, ROV)
  - [ ] 3.2 CTD Profiler automation ⭐ — depth profile plot (Logic + UI)
  - [ ] 3.3 Dynamic Positioning automation — thruster vectors + drift circle (Logic + UI)
  - [ ] 3.4 Underway Seawater automation — live strip charts (Logic + UI)
  - [ ] 3.5 ROV Dive Telemetry automation — depth ladder (Logic + UI)
  - [ ] 3.6 Generate `ctd-casts` + `underway-seawater` data store collections
  - [ ] 3.7 Define pane layout

- [ ] 4. Agriculture tab (carry-overs from existing seed)
  - [ ] 4.1 Define devices (soil moisture, weather, tank, valves, solar, greenhouse zones)
  - [ ] 4.2 Irrigation Controller automation ⭐ — Dam → Header Tank → Beds flow diagram (Logic + UI)
  - [ ] 4.3 Greenhouse automation — zone moisture/light gauges (Logic + UI)
  - [ ] 4.4 Tank Level Monitor automation — level gauge + projection (Logic + UI)
  - [ ] 4.5 Generate `soil-moisture` data store collection
  - [ ] 4.6 Define pane layout

- [ ] 5. Underground Mining tab
  - [ ] 5.1 Define devices (gas detectors, primary/booster fans, personnel tags, refuge chamber, sump pumps)
  - [ ] 5.2 Atmospheric Monitoring automation — multi-gas danger-zone bars (Logic + UI)
  - [ ] 5.3 Ventilation on Demand automation ⭐ — mine network graph + airflow (Logic + UI)
  - [ ] 5.4 Personnel Muster automation — roster by level + muster button (Logic + UI)
  - [ ] 5.5 Dewatering Cascade automation — shaft cross-section + pump stages (Logic + UI)
  - [ ] 5.6 Generate `gas-readings` + `dewatering-log` data store collections
  - [ ] 5.7 Define pane layout

- [ ] 6. Spacecraft tab
  - [ ] 6.1 Define devices (O2 gen, CO2 scrubber, solar array, battery, reaction wheels, sun sensor, ground link, telemetry buffer)
  - [ ] 6.2 Life Support (ECLSS) automation — atmospheric composition bars (Logic + UI)
  - [ ] 6.3 Power System (EPS) automation — solar→battery→loads flow + eclipse timeline (Logic + UI)
  - [ ] 6.4 Attitude Control (ADCS) automation — orientation + reaction-wheel dials (Logic + UI)
  - [ ] 6.5 Ground Station Comms (TT&C) automation ⭐ — AOS/LOS pass timeline (Logic + UI)
  - [ ] 6.6 Generate `telemetry-downlink` + `power-history` data store collections
  - [ ] 6.7 Define pane layout

- [ ] 7. Escape Room tab
  - [ ] 7.1 Define devices (puzzles, mag locks, DMX lighting, hint screen, smoke machine)
  - [ ] 7.2 Puzzle Sequencer automation — progress tracker (Logic + UI)
  - [ ] 7.3 Game Master Console automation ⭐ — countdown + transport controls (Logic + UI)
  - [ ] 7.4 Hint System automation — composer + sent log (Logic + UI)
  - [ ] 7.5 Effects & Lighting automation — DMX scene selector (Logic + UI)
  - [ ] 7.6 Generate `game-sessions` data store collection
  - [ ] 7.7 Define pane layout

- [ ] 8. Off-Grid Bunker tab
  - [ ] 8.1 Define devices (perimeter sensors, flood lights, generator, solar+battery, NBC filter, supply store, radio/mesh)
  - [ ] 8.2 Perimeter Defence automation — bunker map + breach log (Logic + UI)
  - [ ] 8.3 Off-Grid Power automation ⭐ — fuel gauge + days-of-power countdown (Logic + UI)
  - [ ] 8.4 Air Filtration (NBC) automation — airflow schematic + seal toggle (Logic + UI)
  - [ ] 8.5 Supply Inventory automation — resource bars + depletion countdown (Logic + UI)
  - [ ] 8.6 Generate `perimeter-events` + `supply-history` data store collections
  - [ ] 8.7 Define pane layout

- [ ] 9. Integration and testing
  - [ ] 9.1 Run full seed on a fresh Aeolus instance and verify all tabs render
  - [ ] 9.2 Verify all automations fire correctly via "Fire Now" button
  - [ ] 9.3 Verify custom UI components render without errors
  - [ ] 9.4 Verify Data Store collections appear in Data Explorer with populated charts
  - [ ] 9.5 Verify re-seed cleans and replaces cleanly without affecting non-seed data
  - [ ] 9.6 Update `make seed` command if arguments/usage change

- [ ] 10. Documentation
  - [ ] 10.1 Capture screenshots of the five portfolio hero panes
  - [ ] 10.2 Update README seed section with screenshots if appropriate
