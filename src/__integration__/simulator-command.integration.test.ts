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
import { STIMULUS, PUMP_COMMAND_TOPIC } from "../simulator/scenarios/reference-water.js";

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
    env = await createSimulatorE2E({ ackDelayMs: 40 });
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
    await waitFor(() => true, { timeoutMs: 200, intervalMs: 50 }); // let the stimulus arm the fault

    const result = await pumpCommand(env, true, undefined, "acknowledged");
    expect(result.lifecycleState).toBe("FAILED");
    expect(env.store.get(result.commandId!)?.lifecycleState).toBe("FAILED");
  }, 20000);

  it("derives TIMED_OUT when the simulator drops the ACK", async () => {
    env.controlClient.publish(`${EVENTS}/${STIMULUS.dropNextPumpAck}`, automationEvent(STIMULUS.dropNextPumpAck, {}));
    await waitFor(() => true, { timeoutMs: 200, intervalMs: 50 });

    const result = await pumpCommand(env, true, undefined, "acknowledged");
    expect(result.lifecycleState).toBe("TIMED_OUT");
  }, 20000);

  it("derives STATE_MISMATCH when the observed flow never matches but the device replies", async () => {
    // Suppress the flow observation; the ACK still settles as a non-matching
    // observation for the flow condition -> STATE_MISMATCH.
    env.controlClient.publish(`${EVENTS}/${STIMULUS.suppressNextFlow}`, automationEvent(STIMULUS.suppressNextFlow, {}));
    await waitFor(() => true, { timeoutMs: 200, intervalMs: 50 });

    const confirm: ConfirmOptions = {
      condition: (state) => Number(state.litresPerMinute) > 0,
      deviceId: FLOW,
      timeoutMs: 8000,
    };
    const result = await pumpCommand(env, true, confirm, "observed");
    expect(result.lifecycleState).toBe("STATE_MISMATCH");
  }, 20000);

  it("times out an observed command when both flow and ACK are suppressed", async () => {
    env.controlClient.publish(`${EVENTS}/${STIMULUS.suppressNextFlow}`, automationEvent(STIMULUS.suppressNextFlow, {}));
    env.controlClient.publish(`${EVENTS}/${STIMULUS.dropNextPumpAck}`, automationEvent(STIMULUS.dropNextPumpAck, {}));
    await waitFor(() => true, { timeoutMs: 300, intervalMs: 50 });

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
