// src/__integration__/simulator-automation-vertical.integration.test.ts
// phase-2-mqtt-simulator Task 9 (Phase 2.5) — the full-engine vertical proof.
//
//   Automation Event stimulus
//        -> simulator lowers the header-tank sensor
//        -> MQTT device state ingested by Aeolus
//        -> AutomationEngine matches a REAL registered rule and runs it
//        -> the rule's action issues an OBSERVED-tier pump command
//        -> CommandService (inside the engine-established ALS context)
//        -> MQTT -> simulator actuator -> ACK + independent flow observation
//        -> durable OBSERVED command linked to the engine's own executionId
//
// Unlike the hand-driven vertical test (which manually enters an execution
// context and calls CommandService.execute), this test hands the whole path to
// the AutomationEngine: it registers a rule, lets the engine's DEVICE_STATE_CHANGE
// listener match it, and lets executeDirectRule establish the execution context
// (executionId/causationId/automationId) that the command is stamped with. That
// is the exact path Phase 3 depends on.
//
// A form/direct rule is used so the path runs without isolated-vm (the in-isolate
// script body is proven separately by the Phase 1 engine tests). It still needs a
// real MQTT 5 broker, so it runs against a throwaway eclipse-mosquitto:2 container
// and skips without Docker.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { ActionResult, ConfirmOptions, EventContext, Rule } from "../core/types.js";
import { automationSource } from "../automations/command-service.js";
import { AutomationEngine } from "../automations/automation-engine.js";
import { AUTOMATION_FIRED } from "../core/event-bus.js";
import {
  createSimulatorE2E,
  startDockerBroker,
  type DockerBroker,
  waitFor,
  automationEvent,
  dockerAvailable,
  AEOLUS_DEVICE_IDS,
  STATE_TOPICS,
  type SimulatorE2E,
} from "./simulator-harness.js";
import { STIMULUS } from "../simulator/scenarios/reference-water.js";

const describeE2E = dockerAvailable() ? describe : describe.skip;

const PUMP = AEOLUS_DEVICE_IDS.pump;
const FLOW = AEOLUS_DEVICE_IDS.flow;
const EVENTS = "aeolus/events/reference-control";
const RULE_ID = "reference-water-refill-rule";

describeE2E("Phase 2 reference-water vertical E2E (real AutomationEngine)", () => {
  let broker: DockerBroker;
  let env: SimulatorE2E;
  let engine: AutomationEngine;

  // ONE mosquitto container for the whole file; see simulator-command test.
  beforeAll(async () => {
    broker = await startDockerBroker();
  }, 120000);

  afterAll(() => {
    broker?.stop();
  });

  beforeEach(async () => {
    env = await createSimulatorE2E({ broker });
    engine = new AutomationEngine(env.eventBus, { commandService: env.commandService });
  }, 30000);

  afterEach(async () => {
    engine.dispose();
    await env.stop();
  });

  it("engine-driven rule issues an OBSERVED pump command linked to the engine execution", async () => {
    // Capture the executionId the engine allocates for this rule's execution so
    // we can prove the durable command is linked to the SAME execution.
    let firedExecutionId: string | undefined;
    env.eventBus.on(AUTOMATION_FIRED, (e: { ruleId: string; executionId: string }) => {
      if (e.ruleId === RULE_ID) firedExecutionId = e.executionId;
    });

    // A REAL rule: triggered by the header-tank state topic, fires when the tank
    // runs low, and issues an OBSERVED-tier pump command confirmed by the
    // independent flow sensor. The engine awaits the returned Command_Result.
    let commandResult: Promise<ActionResult> | undefined;
    const rule: Rule = {
      id: RULE_ID,
      name: "Refill header tank when low",
      topic: STATE_TOPICS.headerTank,
      triggerType: "mqtt",
      condition: (ctx: EventContext) => Number(ctx.state.levelPct) <= 30,
      action: (_ctx: EventContext) => {
        const confirm: ConfirmOptions = {
          condition: (state) => Number(state.litresPerMinute) > 0,
          deviceId: FLOW,
          timeoutMs: 8000,
        };
        commandResult = env.commandService.execute(
          { type: "device_action", target: PUMP, params: { actionType: "command", payload: { on: true } } },
          automationSource(RULE_ID),
          confirm,
          "observed",
        );
        return commandResult;
      },
    };
    engine.register(rule);

    // Stimulus: a trusted automation event over MQTT drives the simulator to
    // lower the header tank below the rule's threshold.
    env.controlClient.publish(`${EVENTS}/${STIMULUS.tankLow}`, automationEvent(STIMULUS.tankLow, { reason: "engine-vertical" }));

    await waitFor(() => commandResult !== undefined, { label: "engine fired the rule and issued a command", timeoutMs: 8000 });
    const result = await commandResult!;

    // The command reached OBSERVED via the real wire.
    expect(result.lifecycleState).toBe("OBSERVED");
    expect(result.commandId).toBeDefined();

    // The engine actually emitted its "started" signal for this rule.
    expect(firedExecutionId).toBeDefined();

    // The durable record is linked to the engine's own execution (not a manually
    // constructed context) and retains automation provenance.
    const record = env.store.get(result.commandId!);
    expect(record).toBeDefined();
    expect(record?.lifecycleState).toBe("OBSERVED");
    expect(record?.terminalAt).toBeGreaterThan(0);
    expect(record?.sourceKind).toBe("automation");
    expect(record?.ruleId).toBe(RULE_ID);
    expect(record?.executionId).toBe(firedExecutionId);
    expect(record?.causationId).toBeDefined();
    expect(record?.effectiveTier).toBe("observed");

    // The full observed-tier lifecycle really happened: ACK -> ACKNOWLEDGED, then
    // the independent flow report -> OBSERVED.
    expect(record?.transitions.map((t) => t.toState)).toEqual([
      "REQUESTED",
      "DISPATCHED",
      "ACKNOWLEDGED",
      "OBSERVED",
    ]);

    // Exactly one durable command for this rule.
    expect(env.store.list({ ruleId: RULE_ID })).toHaveLength(1);

    // The physical world really moved.
    expect(Number(env.registry.getById(FLOW)?.state.litresPerMinute)).toBeGreaterThan(0);
  }, 25000);
});
