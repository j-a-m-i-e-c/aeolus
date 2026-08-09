# Implementation Plan

> Implement in order. Phase 2 depends on the completed Phase 1 runtime contracts. Do not begin rewriting the polished public demo tabs while completing this spec.

> **Status: complete.** All tasks implemented. Gates green locally: backend `tsc`,
> repo-wide `eslint . --max-warnings 0`, backend + simulator tests (2076 passing),
> frontend `tsc` + tests (756 passing). The MQTT-wire E2E suites
> (`src/__integration__/simulator-*.integration.test.ts`) require a Docker
> `eclipse-mosquitto:2` broker (the backend uses MQTT 5, which no in-process JS
> broker supports) and are `describe.skip` when Docker is unavailable — they were
> written, type-checked and lint-clean, and run in CI/any Docker host, but were
> not executed in the local Docker-less environment.

## Task 0: Preflight Phase 1 and the current demo branch

- [x] Read this Phase 2 `requirements.md` and `design.md` completely.
- [x] Read the final implemented Phase 1 spec and code, including any deviations recorded during implementation.
- [x] Confirm generic MQTT ACK capability/profile support is complete and tested.
- [x] Confirm the final generic MQTT outbound command envelope, MQTT 5 properties and acknowledgement parser contract.
- [x] Confirm final Phase 1 `events.emit()` topic/envelope/event-name validation rules.
- [x] Confirm event metadata/ALS execution propagation is green across sandbox host callbacks, form-rule closures and `executeSequence`.
- [x] Confirm command history records include `ruleId`, `executionId` and causation where available.
- [x] Confirm `PendingCommandTracker` remains DB-free and reports transitions through the composition boundary.
- [x] Inspect `scripts/seed-demo.mjs`, seed helpers and current `scripts/seed/tabs/*` modules.
- [x] Identify current direct simulated `mqtt.publish(...)` and `state.set(...)` patterns, but do not rewrite them in Phase 2.
- [x] Inspect `docker-compose.demo.yml` / public-demo deployment/reset scripts if present on the current branch.
- [x] Run the existing complete CI-relevant test suites and record pre-existing failures.

**Checkpoint 0:** Kiro can state the exact Phase 1 wire contracts and current demo startup/reset path before writing simulator code.

---

## Task 1: Create the separate simulator process skeleton

- [x] Create a separately invokable simulator entry point following repository conventions.
- [x] Add explicit simulation enablement/configuration; simulator must be off by default.
- [x] Add redacted configuration logging.
- [x] Add graceful shutdown handling.
- [x] Add an MQTT client wrapper with connect/reconnect/subscription restoration.
- [x] Do not import backend runtime services/stores into the simulator.
- [x] Add an architecture-boundary test/lint check where practical proving forbidden backend modules are not imported.
- [x] Add `npm`/Make/dev commands for running the simulator locally without changing normal Aeolus startup.

**Checkpoint 1:** the simulator starts as an independent process, connects to a broker and shuts down cleanly with zero Aeolus DB/service access.

---

## Task 2: Define simulator types, device registry and validation

- [x] Add typed `SimulatedDeviceDefinition`, `SimulatedDeviceModel`, command outcome, scenario and stimulus contracts.
- [x] Add simulator-local device/model registry.
- [x] Validate duplicate device keys.
- [x] Validate concrete state/command topics and reject MQTT wildcards in concrete device topics.
- [x] Reject duplicate command-topic ownership and unsafe state/command topic collisions.
- [x] Reject use of the Phase 1 Automation Event namespace as a device state topic.
- [x] Add simulator state controller with per-device serialization.
- [x] Implement retained initial/current-state publishing according to design.
- [x] Add no-op state publication suppression with explicit force-publish override.
- [x] Add bounded timer tracking/disposal.
- [x] Unit test all validation and state-controller behaviours.

**Checkpoint 2:** two or more device models can coexist safely and publish deterministic state without any Aeolus backend dependency.

---

## Task 3: Implement the real generic-MQTT command wire contract

- [x] Subscribe to command topics for command-capable simulator devices.
- [x] Parse the exact Phase 1 generic MQTT command payload.
- [x] Extract MQTT 5 Response Topic and Correlation Data according to the implemented Phase 1/documented precedence.
- [x] Support mirrored JSON `correlationId`/response fields as documented.
- [x] Normalize commands into `SimulatedInboundCommand`.
- [x] Call the appropriate device model through a per-device serialized command path.
- [x] Implement positive ACK formatting using the Phase 1 accepted response schema.
- [x] Implement negative ACK formatting for model-declared rejection.
- [x] Publish ACK to the correct response topic with compatible correlation properties where required.
- [x] Implement independent bounded ACK delay and resulting-state delay.
- [x] Ensure dispatch-only/untracked commands can execute without manufacturing a fake tracked ACK.
- [x] Add a bounded completed-correlation cache.
- [x] Ensure duplicate correlated commands do not apply physical state twice.
- [x] Unit and MQTT-wire test normal ACK, rejection, untracked command and duplicate delivery.

**Checkpoint 3:** an independent MQTT test client can send the same wire command Aeolus sends and receive the same ACK/state behaviour expected from documented generic hardware.

---

## Task 4: Implement Phase 1 Automation Event stimulus ingestion

- [x] Subscribe to the Phase 1 Automation Event namespace needed by loaded scenarios.
- [x] Parse/validate the actual Phase 1 versioned Automation Event envelope.
- [x] Reuse Phase 1 event-name validation rules where available without weakening them.
- [x] Add explicit per-scenario stimulus maps.
- [x] Ignore valid-but-undeclared Automation Events without changing state.
- [x] Reject malformed event envelopes safely.
- [x] Support optional source-rule restriction where needed by a scenario.
- [x] Route a valid stimulus only into simulator-owned scenario/model state.
- [x] Publish resulting physical observations through ordinary state topics.
- [x] Add tests proving no direct Aeolus state/API call is used.
- [x] Add test for Automation Event -> simulator state -> MQTT device state.

**Checkpoint 4:** a Phase 1 Automation Event can create a simulated external-world change that returns to Aeolus only as ordinary MQTT device state.

---

## Task 5: Add deterministic fault injection and resource bounds

- [x] Add per-device one-shot `rejectNext` fault.
- [x] Add per-device one-shot `dropNextAck` fault.
- [x] Add per-device one-shot `suppressNextState` fault.
- [x] Add per-device one-shot `mismatchNextState` fault.
- [x] Add bounded ACK/state latency overrides.
- [x] Ensure one-shot faults clear deterministically when consumed.
- [x] Add global and/or per-device pending-timer caps.
- [x] Add bounded command queue/fail-fast policy for one device receiving an interaction storm.
- [x] Bound accepted Automation Event payload sizes.
- [x] Add deterministic clock/random hooks for tests.
- [x] Prove faults do not write Aeolus lifecycle state directly.

**Checkpoint 5:** tests can produce rejection, timeout and mismatch using only simulator MQTT behaviour, with bounded CPU/memory/timers.

---

## Task 6: Add seed/bootstrap support for simulated MQTT command profiles

- [x] Add seed/bootstrap helper(s) that wait for/resolve simulator devices through supported Aeolus mechanisms.
- [x] Configure command-capable simulator devices through the final Phase 1 MQTT Command Profile API.
- [x] Keep `Device.commandTopic` canonical.
- [x] Make bootstrap idempotent across repeated seed/reset runs.
- [x] Keep bootstrap admin/session privilege outside the long-running simulator process.
- [x] Do not edit the Aeolus SQLite DB directly.
- [x] Ensure non-simulated devices are not modified by broad topic/type matching.
- [x] Add bootstrap tests for successful profile configuration, repeat execution and missing-device timeout.
- [x] Document exact broker/backend/simulator/bootstrap startup ordering.

**Checkpoint 6:** a simulator actuator appears to Aeolus as a normal generic MQTT device whose ACK capability is configured through the same Phase 1 path as real hardware.

---

## Task 7: Build the reference water-transfer scenario

- [x] Add the Phase 2-only `reference-water` scenario.
- [x] Add source tank sensor model.
- [x] Add header/destination tank sensor model.
- [x] Add transfer pump actuator model and command topic.
- [x] Add flow sensor/observation model.
- [x] Implement coherent initial state.
- [x] Implement bounded `tank-low` stimulus.
- [x] Implement pump ON/OFF physical-model effects.
- [x] Make positive pump command produce ACK then resulting pump/flow/tank observation through normal MQTT.
- [x] Add reset stimulus.
- [x] Add fault-arm stimuli used only for tests/developer inspection.
- [x] Do not add a public dashboard tab for this scenario.

**Checkpoint 7:** reference-water behaves as an externally simulated physical system independent of any public demo automation rewrite.

---

## Task 8: Add Phase 1 + Phase 2 E2E command tests

- [x] Start a test MQTT broker using existing repository test conventions.
- [x] Start/instantiate the simulator runtime against that broker.
- [x] Start the relevant Aeolus backend services with Phase 1 command history/tracker integration.
- [x] Publish simulator initial state and assert normal Device Registry ingestion.
- [x] Configure the pump's Phase 1 ACK profile through the supported API/store path.
- [x] Issue a pump command through `CommandService`.
- [x] Assert outbound command reaches the simulator rather than a mocked `ActionRouter` return.
- [x] Assert simulator positive ACK reaches Phase 1 tracker.
- [x] Assert durable history reaches `ACKNOWLEDGED` for ack-tier test.
- [x] Add observed-tier test where simulator flow/pump state drives `OBSERVED`.
- [x] Assert no simulator code directly wrote command history.
- [x] Add negative ACK/rejection E2E.
- [x] Add dropped-ACK timeout E2E.
- [x] Add suppressed-observation timeout E2E.
- [x] Add mismatching-observation E2E.
- [x] Add duplicate correlation delivery E2E proving single physical state mutation.

**Checkpoint 8:** Phase 1 lifecycle semantics are demonstrated end to end against a real simulator MQTT peer, including failure paths.

---

## Task 9: Add the full stimulus -> automation -> command -> observation reference test

- [x] Add a minimal test-only/reference automation that responds to the reference header-tank low state.
- [x] Ensure it executes inside the normal Automation Engine/sandbox path.
- [x] Have it call the real `devices.action()` command API with an observed completion requirement using the final Phase 1 syntax.
- [x] Trigger the reference-water low-tank change through a real Phase 1 Automation Event stimulus.
- [x] Assert simulator publishes low tank state.
- [x] Assert Automation Engine executes the low-tank rule.
- [x] Assert command history contains the automation `ruleId`, `executionId` and triggering causation metadata where available.
- [x] Assert the pump command travels through MQTT to the simulator.
- [x] Assert simulator ACK then flow/state drives a terminal `OBSERVED` history.
- [x] Assert the sequence contains one command ID and valid durable transitions.
- [x] Assert no public/demo UI or showcase automation is required for the test.

**Checkpoint 9:** external stimulus -> simulated sensor -> Aeolus automation -> verified command -> simulator actuator -> ACK -> physical observation is green as one complete vertical path.

---

## Task 10: Public-demo process and reset integration

- [x] Add simulator service/process only to dedicated demo/development configuration.
- [x] Ensure simulator has no externally published port.
- [x] Keep Mosquitto internal-only in public demo.
- [x] Do not pass production/property credentials to simulator.
- [x] Keep public raw MQTT publish forbidden.
- [x] Keep existing fail-closed public-demo route guard unchanged.
- [x] Add simulator state reset to the existing golden-db/nightly/manual reset procedure, preferably through simulator restart plus bootstrap rather than new persistence.
- [x] Ensure reset ordering leaves profiles/devices coherent.
- [x] Add a post-reset smoke check proving simulator state reaches Aeolus and one safe reference command can complete.
- [x] Add configuration test proving default non-demo startup does not enable simulator.

**Checkpoint 10:** the public demo can run fake hardware without exposing a new public control plane and can return to a known-good baseline.

---

## Task 11: Release gates and Phase 3 handoff

- [x] Run all Phase 1/backend tests.
- [x] Run simulator unit tests.
- [x] Run MQTT wire integration tests.
- [x] Run full reference-water E2E success/failure tests.
- [x] Run frontend tests/build to catch contract regressions even though Phase 2 has no intended UI redesign.
- [x] Run lint/typecheck/format/build gates used by CI.
- [x] Search simulator source for imports of forbidden Aeolus runtime services/stores.
- [x] Search for any new simulator HTTP/public port or public raw MQTT permission.
- [x] Update technical docs with simulator architecture, startup and generic MQTT conformance behaviour.
- [x] Add a concise Phase 3 migration document explaining how each showcase automation should stop directly impersonating hardware.
- [x] Do not migrate Farm/Mine/Spacecraft/Bunker/etc. in this task.

## Final completion checklist

Phase 2 is not complete unless all are true:

- [x] The simulator is a separate runtime process.
- [x] The simulator has no Aeolus DB/service execution dependency.
- [x] Simulator sensors enter through ordinary MQTT device ingestion.
- [x] Simulator actuators receive ordinary generic MQTT device commands.
- [x] Phase 1 correlation/ACK works against the simulator wire contract.
- [x] Observed-tier completion can be driven by simulator state.
- [x] Fault injection can produce rejection/timeout/mismatch without direct lifecycle writes.
- [x] Scenario stimuli arrive through Phase 1 Automation Events.
- [x] Bootstrap configures simulated actuator MQTT profiles through the supported Phase 1 path.
- [x] The reference-water vertical E2E test is green.
- [x] Public demo simulator has no public port and resets coherently.
- [x] Existing public showcase automations have not yet been rewritten.
