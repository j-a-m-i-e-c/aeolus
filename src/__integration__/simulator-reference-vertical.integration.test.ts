// src/__integration__/simulator-reference-vertical.integration.test.ts
// phase-2-mqtt-simulator Task 9 — the full vertical proof:
//
//   Automation Event stimulus
//        -> simulator lowers the header-tank sensor
//        -> MQTT device state ingested by Aeolus
//        -> a trusted reference control reaction issues a pump command
//        -> CommandService -> MQTT -> simulator actuator
//        -> ACK + flow observation
//        -> durable OBSERVED command retaining automation/execution/causation metadata
//
// The reaction runs the command through the SAME CommandService path an
// automation uses: an automation-kind Command_Source inside the active execution
// context (ALS), so the durable record carries ruleId/executionId/causationId.
// (The in-isolate sandbox body itself is proven by the Phase 1 engine tests; it
// requires isolated-vm, which is unavailable on the Windows dev box — so this
// vertical test targets the wire + provenance contract that Phase 2 owns.)
//
// Runs against a throwaway eclipse-mosquitto:2 container; skipped without Docker.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ActionResult, ConfirmOptions } from "../core/types.js";
import { automationSource } from "../automations/command-service.js";
import { runInExecutionContext } from "../automations/execution-context.js";
import { DEVICE_STATE_CHANGE } from "../core/event-bus.js";
import { createSimulatorE2E, waitFor, automationEvent, dockerAvailable, AEOLUS_DEVICE_IDS, type SimulatorE2E } from "./simulator-harness.js";
import { STIMULUS } from "../simulator/scenarios/reference-water.js";

const describeE2E = dockerAvailable() ? describe : describe.skip;

const PUMP = AEOLUS_DEVICE_IDS.pump;
const FLOW = AEOLUS_DEVICE_IDS.flow;
const HEADER = AEOLUS_DEVICE_IDS.headerTank;
const EVENTS = "aeolus/events/reference-control";

const RULE_ID = "reference-water-pump-rule";
const EXECUTION_ID = "reference-exec-1";
const CAUSATION_ID = "reference-cause-1";

describeE2E("Phase 2 reference-water vertical E2E", () => {
  let env: SimulatorE2E;

  beforeEach(async () => {
    env = await createSimulatorE2E();
  }, 30000);

  afterEach(async () => {
    await env.stop();
  });

  it("runs stimulus -> automation-sourced command -> OBSERVED with provenance metadata", async () => {
    let fired = false;
    let commandResult: Promise<ActionResult> | undefined;

    // Trusted reference control reaction: when the header tank runs low, issue an
    // OBSERVED-tier pump command confirmed by the independent flow sensor.
    env.eventBus.on(DEVICE_STATE_CHANGE, (event: { deviceId: string; state: Record<string, unknown> }) => {
      if (fired || event.deviceId !== HEADER) return;
      if (Number(event.state.levelPct) > 30) return;
      fired = true;
      const confirm: ConfirmOptions = {
        condition: (state) => Number(state.litresPerMinute) > 0,
        deviceId: FLOW,
        timeoutMs: 8000,
      };
      runInExecutionContext({ executionId: EXECUTION_ID, causationId: CAUSATION_ID, automationId: RULE_ID }, () => {
        commandResult = env.commandService.execute(
          { type: "device_action", target: PUMP, params: { actionType: "command", payload: { on: true } } },
          automationSource(RULE_ID),
          confirm,
          "observed",
        );
      });
    });

    // Stimulus: bounded UI-fire stand-in -> trusted automation event over MQTT.
    env.controlClient.publish(`${EVENTS}/${STIMULUS.tankLow}`, automationEvent(STIMULUS.tankLow, { reason: "vertical-test" }));

    await waitFor(() => commandResult !== undefined, { label: "reaction issued a command", timeoutMs: 8000 });
    const result = await commandResult!;

    // The command reached OBSERVED via the real wire.
    expect(result.lifecycleState).toBe("OBSERVED");
    expect(result.commandId).toBeDefined();

    // The durable record retains Phase 1 automation/execution/causation metadata.
    const record = env.store.get(result.commandId!);
    expect(record).toBeDefined();
    expect(record?.lifecycleState).toBe("OBSERVED");
    expect(record?.terminalAt).toBeGreaterThan(0);
    expect(record?.sourceKind).toBe("automation");
    expect(record?.ruleId).toBe(RULE_ID);
    expect(record?.executionId).toBe(EXECUTION_ID);
    expect(record?.causationId).toBe(CAUSATION_ID);
    expect(record?.effectiveTier).toBe("observed");

    // Exactly one durable command for this rule, ending OBSERVED.
    const forRule = env.store.list({ ruleId: RULE_ID });
    expect(forRule).toHaveLength(1);

    // The command genuinely walked the full observed-tier lifecycle: the ACK
    // advanced it to ACKNOWLEDGED and only the later, independent flow report
    // advanced it to OBSERVED. A plain ack no longer smuggles the observation,
    // so ACKNOWLEDGED is a real, recorded step (not skipped).
    expect(record?.transitions.map((t) => t.toState)).toEqual([
      "REQUESTED",
      "DISPATCHED",
      "ACKNOWLEDGED",
      "OBSERVED",
    ]);

    // The physical world really moved: the flow sensor reported a transfer.
    expect(Number(env.registry.getById(FLOW)?.state.litresPerMinute)).toBeGreaterThan(0);
  }, 25000);
});
