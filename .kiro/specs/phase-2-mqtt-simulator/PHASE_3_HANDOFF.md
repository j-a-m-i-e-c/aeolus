# Aeolus Phase 2 → Phase 3 Handoff

Phase 2 (the simulated-hardware runtime) is complete. This document tells the
Phase 3 work exactly what it can build on and how to migrate the public showcase
from *faked* hardware to *simulated* hardware without weakening any contract.

## What Phase 2 delivered

A separate simulator process (`src/simulator/`, run with `npm run sim` / `make sim`)
that speaks **only MQTT** to Aeolus. It holds no Aeolus credentials, opens no
ports, and never imports `CommandService`, `DeviceRegistry`, `AutomationEngine`,
`PendingCommandTracker`, `CommandHistoryStore`, automation state, or SQLite. A
lint-enforced boundary test (`src/simulator/boundary.test.ts`) proves this.

Capabilities Phase 3 can rely on:

- **Generic MQTT devices.** Simulated sensors publish normal state topics;
  actuators subscribe to normal command topics. Actuators use the
  `.../state` → `.../set` convention so Aeolus derives the command topic with no
  `commandTopic` API needed.
- **Real Phase 1 command wire contract.** The simulator parses the exact
  generic-MQTT command payload, resolves correlation using the Phase 1
  precedence (MQTT 5 Correlation Data / Response Topic, else the mirrored JSON
  fields), and publishes the Phase 1 acknowledgement shape
  (`{ correlationId, success }`) only after its model accepts. It never writes a
  command lifecycle state itself.
- **Automation Event stimulus ingestion.** The simulator subscribes to the
  reserved `aeolus/events/#` namespace, validates the real versioned envelope
  (reusing the Phase 1 parser/validator), and routes only events a loaded
  scenario explicitly declares into simulator-owned state. There is no public
  REST/raw-MQTT injection surface.
- **Deterministic faults and bounded resources.** One-shot faults
  (`rejectNext`, `dropNextAck`, `suppressNextState`, `mismatchNextState`) and
  bounded latencies, a shared timer budget, and a per-device command-queue cap.
- **Seed/bootstrap.** `scripts/seed/simulator-bootstrap.mjs` configures each
  simulated actuator's MQTT Command Profile through
  `PUT /api/devices/:id/mqtt-command-profile` — the same path a real device uses.
  Idempotent; admin-privileged; runs only in the seed job, never in the runtime.
- **Reference fixture + E2E.** The `reference-water` scenario (source tank,
  header tank, transfer pump, flow sensor) and Docker-broker integration tests
  (`src/__integration__/simulator-*.integration.test.ts`) prove the full chain:
  stimulus → simulator sensor → Aeolus automation → `CommandService` → MQTT →
  simulator actuator → ACK → flow observation → durable `OBSERVED` with
  automation/execution/causation metadata.

## The chain Phase 3 must preserve

```text
bounded public UI fire
  -> trusted seeded automation
  -> events.emit(<declared event name>)
  -> Phase 1 Automation Event over MQTT (aeolus/events/<ruleId>/<name>)
  -> simulator scenario stimulus changes the simulated world
  -> simulator publishes ordinary MQTT sensor state
  -> Aeolus automation reacts and issues a Verified Command via CommandService
  -> MQTT command -> simulator actuator -> ACK / observed state
  -> durable command lifecycle in Aeolus
```

## Migrating one showcase silo (the pattern)

Today the seeded showcase automations fake hardware in-process, e.g. in
`scripts/seed/tabs/stage-show.mjs` a rule does:

```js
state.set("scene", id);
mqtt.publish("sensor/stage/dmx", JSON.stringify({ master, scene: id, ... }));
```

That single rule is playing controller **and** sensor **and** actuator. Migrate
it in these steps:

1. **Model the hardware in a simulator scenario.** Add a scenario under
   `src/simulator/scenarios/` with the silo's sensors and actuators as
   `SimulatedDeviceDefinition`s (follow `reference-water.ts`). Actuators declare
   a `commandProfile` and implement `onCommand`; sensors just publish state.
   Register the scenario key in `src/simulator/scenarios/index.ts`.
2. **Declare the stimuli.** For each bounded public interaction, declare a
   stimulus handler keyed by the exact event name the trusted automation will
   emit. The handler changes only simulator-owned state.
3. **Split the seeded automation into two trusted rules:**
   - a *stimulus* rule bound to the bounded public UI control that calls
     `events.emit("<silo>.<action>", ...)` (no raw `mqtt.publish`, no faked
     sensor `state.set`);
   - a *control* rule triggered by the resulting device state that issues real
     commands with `devices.action(...)` at the appropriate completion tier.
4. **Bootstrap the profiles.** Add the silo's actuator specs to the bootstrap
   (as `REFERENCE_WATER_ACTUATOR_SPECS` does) so their ACK profiles are
   configured at seed time.
5. **Enable the scenario** in the demo overlay via `AEOLUS_SIMULATOR_SCENARIOS`.
6. **Prove it** with an integration test modelled on the Phase 2 E2E: the public
   fire produces real device state and, where applicable, a durable command.

Do one silo end-to-end before touching the next.

## Non-goals for Phase 3 (unchanged from Phase 2)

Do **not**:

- give public users raw MQTT access or a public simulator/injection endpoint;
- mutate Aeolus device/command state directly from simulator code;
- put simulator state in the Aeolus database;
- add a second command path or bypass `CommandService`;
- build a visual simulator editor or a simulator DSL;
- weaken the Phase 1 event-name, envelope, correlation, or lifecycle rules.

## Verification

- Unit + boundary + scenario tests: `npx vitest run src/simulator`.
- Full E2E (requires Docker): the `src/__integration__/simulator-*.integration.test.ts`
  suites spin a throwaway `eclipse-mosquitto:2` broker and skip automatically when
  Docker is unavailable.
- Full gate: `make verify` (type check + lint + tests).

See `docs/reference/operations.md` (“Demo simulator”) for run/config/reset, and
this spec's `requirements.md` / `design.md` for the full contract.
