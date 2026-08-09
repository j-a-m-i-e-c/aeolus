// src/__integration__/simulator-command.integration.test.ts
// phase-2-mqtt-simulator Task 8 — Phase 1 + Phase 2 command lifecycle proven end
// to end against the REAL simulator over a REAL MQTT broker (aedes). No mocked
// ActionRouter: every command travels through MqttService -> broker -> simulator
// and every lifecycle outcome is derived by Phase 1 from the simulator's wire
// behaviour. The simulator never writes command history (it has no DB access).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { restSource } from "../automations/command-service.js";
import type { ConfirmOptions } from "../core/types.js";
import { createSimulatorE2E, waitFor, automationEvent, dockerAvailable, AEOLUS_DEVICE_IDS, type SimulatorE2E } from "./simulator-harness.js";
import { STIMULUS, PUMP_COMMAND_TOPIC, DEVICE_KEYS } from "../simulator/scenarios/reference-water.js";

// This end-to-end suite runs against a throwaway eclipse-mosquitto:2 container
// (the backend requires MQTT 5, which no in-process JS broker supports). It is
// skipped automatically when Docker is unavailable.
const describeE2E = dockerAvailable() ? describe : describe.skip;

const PUMP = AEOLUS_DEVICE_IDS.pump;
const FLOW = AEOLUS_DEVICE_IDS.flow;
const EVENTS = "aeolus/events/reference-control";

/** Issue a pump command through the real CommandService boundary. */
function pumpCommand(
  env: SimulatorE2E,
  on: boolean,
  confirm?: ConfirmOptions,
  tier?: "dispatch" | "acknowledged" | "observed",
) {
  return env.commandService.execute(
    { type: "device_action", target: PUMP, params: { actionType: "command", payload: { on } } },
    restSource(),
    confirm,
    tier,
  );
}

describeE2E("Phase 2 simulator command E2E", () => {
  let env: SimulatorE2E;

  beforeEach(async () => {
    env = await createSimulatorE2E();
  }, 30000);

  afterEach(async () => {
    await env.stop();
  });

  it("ingests simulator sensor state into the Aeolus Device Registry over MQTT", () => {
    expect(env.registry.getById(PUMP)).toBeDefined();
    expect(env.registry.getById(FLOW)).toBeDefined();
    expect(env.registry.getById(AEOLUS_DEVICE_IDS.headerTank)).toBeDefined();
    expect(env.registry.getById(AEOLUS_DEVICE_IDS.sourceTank)).toBeDefined();
    expect(env.registry.getById(FLOW)?.state).toMatchObject({ litresPerMinute: 0 });
  });

  it("reaches durable ACKNOWLEDGED via CommandService -> MQTT -> simulator -> ACK", async () => {
    const result = await pumpCommand(env, true, undefined, "acknowledged");
    expect(result.lifecycleState).toBe("ACKNOWLEDGED");
    expect(result.commandId).toBeDefined();

    const record = env.store.get(result.commandId!);
    expect(record?.lifecycleState).toBe("ACKNOWLEDGED");
    expect(record?.terminalAt).toBeGreaterThan(0);
    expect(record?.sourceKind).toBe("rest");
    expect(record?.transitions.map((t) => t.toState)).toContain("ACKNOWLEDGED");
  }, 20000);

  it("reaches durable OBSERVED when the flow sensor confirms the transfer", async () => {
    const confirm: ConfirmOptions = {
      condition: (state) => Number(state.litresPerMinute) > 0,
      deviceId: FLOW,
      timeoutMs: 8000,
    };
    const result = await pumpCommand(env, true, confirm, "observed");
    expect(result.lifecycleState).toBe("OBSERVED");

    const record = env.store.get(result.commandId!);
    expect(record?.lifecycleState).toBe("OBSERVED");
    expect(record?.terminalAt).toBeGreaterThan(0);
    // The flow sensor really reported a non-zero transfer.
    expect(Number(env.registry.getById(FLOW)?.state.litresPerMinute)).toBeGreaterThan(0);
  }, 20000);

  it("derives FAILED from a simulator rejection (negative ACK)", async () => {
    env.controlClient.publish(`${EVENTS}/${STIMULUS.rejectNextPump}`, automationEvent(STIMULUS.rejectNextPump, {}));
    // Wait until the stimulus has actually armed the fault, so the command that
    // follows is guaranteed to hit it (no fixed-sleep race).
    await waitFor(() => env.simulator.getFaults().peek(DEVICE_KEYS.pump)?.rejectNext !== undefined, {
      label: "reject-next-pump fault armed",
      timeoutMs: 5000,
    });

    const result = await pumpCommand(env, true, undefined, "acknowledged");
    expect(result.lifecycleState).toBe("FAILED");
    expect(env.store.get(result.commandId!)?.lifecycleState).toBe("FAILED");
  }, 20000);

  it("derives TIMED_OUT when the simulator drops the ACK", async () => {
    env.controlClient.publish(`${EVENTS}/${STIMULUS.dropNextPumpAck}`, automationEvent(STIMULUS.dropNextPumpAck, {}));
    await waitFor(() => env.simulator.getFaults().peek(DEVICE_KEYS.pump)?.dropNextAck === true, {
      label: "drop-next-pump-ack fault armed",
      timeoutMs: 5000,
    });

    const result = await pumpCommand(env, true, undefined, "acknowledged");
    expect(result.lifecycleState).toBe("TIMED_OUT");
  }, 20000);

  it("reaches ACKNOWLEDGED then TIMES OUT when the ack arrives but the observation never matches", async () => {
    // Corrected ACK/observation semantics: a plain ack advances the command to
    // ACKNOWLEDGED but is NOT itself a settled observation, and a non-matching
    // AMBIENT sensor reading is ignored (it waits). Here the flow reports 120 but
    // the predicate demands an impossible value, so the observation never
    // matches: the command must reach ACKNOWLEDGED (on the ack) and then TIME OUT
    // waiting for the observation — never STATE_MISMATCH off the ack.
    const confirm: ConfirmOptions = {
      condition: (state) => Number(state.litresPerMinute) > 1_000_000,
      deviceId: FLOW,
      timeoutMs: 2000,
    };
    const result = await pumpCommand(env, true, confirm, "observed");
    expect(result.lifecycleState).toBe("TIMED_OUT");

    // It genuinely acknowledged first (distinct from a dispatch-then-timeout).
    const record = env.store.get(result.commandId!);
    expect(record?.transitions.map((t) => t.toState)).toContain("ACKNOWLEDGED");
  }, 20000);

  it("times out an observed command when both flow and ACK are suppressed", async () => {
    env.controlClient.publish(`${EVENTS}/${STIMULUS.suppressNextFlow}`, automationEvent(STIMULUS.suppressNextFlow, {}));
    env.controlClient.publish(`${EVENTS}/${STIMULUS.dropNextPumpAck}`, automationEvent(STIMULUS.dropNextPumpAck, {}));
    // The two stimuli are published in order on the same client; waiting for the
    // second (dropNextAck) to arm implies the first (suppressNextFlow) processed.
    await waitFor(() => env.simulator.getFaults().peek(DEVICE_KEYS.pump)?.dropNextAck === true, {
      label: "drop-next-pump-ack fault armed",
      timeoutMs: 5000,
    });

    const confirm: ConfirmOptions = {
      condition: (state) => Number(state.litresPerMinute) > 0,
      deviceId: FLOW,
      timeoutMs: 1500,
    };
    const result = await pumpCommand(env, true, confirm, "observed");
    expect(result.lifecycleState).toBe("TIMED_OUT");
  }, 20000);

  it("applies a duplicate correlated command only once (no double physical mutation)", async () => {
    const correlationId = "dup-corr-1";
    const payload = JSON.stringify({ on: true, correlationId, responseTopic: "aeolus/acks/dup" });
    const publishOptions = {
      qos: 1 as const,
      properties: { correlationData: Buffer.from(correlationId, "utf8"), responseTopic: "aeolus/acks/dup" },
    };

    // Two identical correlated deliveries straight to the command topic.
    env.controlClient.publish(PUMP_COMMAND_TOPIC, payload, publishOptions);
    env.controlClient.publish(PUMP_COMMAND_TOPIC, payload, publishOptions);

    // The source tank drains once (80 -> 70); a double application would reach 60.
    await waitFor(() => Number(env.registry.getById(AEOLUS_DEVICE_IDS.sourceTank)?.state.levelPct) === 70, {
      label: "source tank drained once",
      timeoutMs: 6000,
    });
    // Give any erroneous second mutation a chance to appear, then assert it did not.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(Number(env.registry.getById(AEOLUS_DEVICE_IDS.sourceTank)?.state.levelPct)).toBe(70);
  }, 20000);
});
