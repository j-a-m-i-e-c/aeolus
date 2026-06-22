# Requirements: Multi-Domain Seed Demo

## Introduction

The seed demo is the first experience someone has with Aeolus after `docker compose up`. It needs to immediately communicate that this is not just a home automation platform — it's an edge automation platform that works across wildly different domains.

Each tab in the seeded dashboard represents a distinct deployment scenario, complete with realistic devices, working automations (Logic + UI), and domain-appropriate data. The goal is that someone exploring the seed for 5 minutes understands what Aeolus is and what it can do — without any hardware.

---

## Requirement 1: Multi-Domain Tab Structure

**User Story:** As a new user exploring Aeolus, I want the seed demo to show multiple tabs representing different deployment domains, so I immediately understand the platform is not limited to home automation.

### Acceptance Criteria

1. The seed SHALL create 7 custom tabs, each representing a different domain:
   - **Smart Home** — the familiar home automation use case
   - **Research Vessel** — ocean/marine science monitoring
   - **Agriculture** — farm/greenhouse with soil, irrigation, weather
   - **Underground Mining** — environmental monitoring, gas detection, equipment status
   - **Spacecraft** — life support, power systems, orbital telemetry
   - **Escape Room** — commercial puzzle room with sensors, locks, timers, game master controls
   - **Zombie Apocalypse** — survival bunker (perimeter defence, supplies, generator)
2. Each tab SHALL have a distinct, descriptive name visible in the sidebar.
3. Tab ordering SHALL present Smart Home first (most relatable), then increasingly exotic domains.

---

## Requirement 2: Realistic Devices Per Domain

**User Story:** As a new user, I want each tab to show devices that make sense for that domain, so the demo feels authentic rather than generic.

### Acceptance Criteria

1. Each domain tab SHALL have 4–8 simulated devices with domain-appropriate names, types, and state.
2. Devices SHALL have realistic state values (e.g. soil moisture 42%, hull pressure 1.013 bar, O2 level 20.9%).
3. Device types SHALL use the existing Aeolus device types (sensor, switch, light, climate, plug) mapped to domain-appropriate names.
4. Devices SHALL appear in a Device Grid pane on each tab.

---

## Requirement 3: Working Automations With Custom UI

**User Story:** As a new user, I want each tab to have at least one working automation with a custom UI component, so I can see the paired Logic+UI model in action.

### Acceptance Criteria

1. Each domain tab SHALL have multiple automation panes, each with both Logic and UI source populated.
2. Logic scripts SHALL use the `automation()` helper so the flow diagram renders (demonstrates visual feedback).
3. UI components SHALL use `aeolus.read()` to display live state and at least one interactive element (`aeolus.fire()` or `aeolus.control()`).
4. Automations SHALL be enabled by default so they respond to simulated events.
5. UI components SHALL be visually polished with SVG graphics or domain-themed styling where appropriate.
6. The exact number of automations per tab will be determined during design — expect 3–6 per domain to fully showcase the platform.

---

## Requirement 4: Domain-Appropriate Data Store Collections

**User Story:** As a new user, I want to see example data in the Data Store that matches each domain, so I understand how automations accumulate data over time.

### Acceptance Criteria

1. The seed SHALL populate at least one Data Store collection per domain with 20–50 timestamped records of realistic data.
2. Collections SHALL have meaningful names (e.g. "soil-moisture-readings", "hull-pressure-log", "o2-levels").
3. Records SHALL span a realistic time range (e.g. last 24–72 hours) so charts look populated.

---

## Requirement 5: Seed Script Replaces Existing Demo

**User Story:** As a developer running the seed, I want it to cleanly replace any existing seed data without affecting manually-created content.

### Acceptance Criteria

1. The seed script SHALL delete all previously-seeded automations, layout, devices, and data store collections before inserting new data.
2. The seed script SHALL NOT delete manually-created automations or tabs that weren't part of the seed.
3. Seeded entities SHALL be identifiable (e.g. via a naming convention or metadata flag) so they can be cleanly removed on re-seed.

---

## Requirement 6: Self-Documenting Experience

**User Story:** As a new user, I want the seed demo to feel like a guided tour of the platform's capabilities without needing external documentation.

### Acceptance Criteria

1. Each automation's UI component SHALL include a brief description of what it does and what domain it represents.
2. Automation names SHALL be descriptive (e.g. "Hull Pressure Alert", "Irrigation Controller", "Perimeter Breach Detector").
3. The Smart Home tab SHALL feel familiar to anyone who has used home automation. The exotic tabs SHALL feel like plausible deployments, not jokes (even the zombie one should have a serious engineering vibe with a humorous premise).

---

## Requirement 7: No External Dependencies

**User Story:** As a new user with no hardware, I want the entire seed demo to work with zero physical devices or network services.

### Acceptance Criteria

1. All devices SHALL be simulated — the seed creates them directly in the device registry without requiring MQTT messages.
2. Automations SHALL be fireable manually (via "Fire Now" button) to demonstrate execution without waiting for real events.
3. The seed SHALL work on a fresh Aeolus install with only the three default Docker containers running.
