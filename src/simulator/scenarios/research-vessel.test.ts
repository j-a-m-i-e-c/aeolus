import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "../device-registry.js";
import { FaultController } from "../fault-controller.js";
import type { ScenarioStimulusContext, SimulatedInboundCommand } from "../types.js";
import {
  RESEARCH_VESSEL_COMMAND_TOPICS,
  RESEARCH_VESSEL_DEVICE_KEYS,
  RESEARCH_VESSEL_STATE_TOPICS,
  RESEARCH_VESSEL_STIMULUS,
  createResearchVesselScenario,
} from "./research-vessel.js";

function logger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

function setup() {
  const published: Array<{ topic: string; payload: string }> = [];
  const registry = new SimulatorDeviceRegistry({ publish: (topic, payload) => published.push({ topic, payload }), logger: logger(), maxDelayMs: 0 });
  const faults = new FaultController({ maxDelayMs: 0, logger: logger() });
  const scenario = createResearchVesselScenario();
  for (const definition of scenario.devices) registry.register(definition);

  const fire = async (name: string): Promise<void> => {
    const ctx: ScenarioStimulusContext = {
      stimulus: { name, payload: {}, meta: { eventId: "event-1", timestamp: 1, source: { kind: "automation" } }, receivedAt: 1 },
      devices: registry, faults, logger: logger(),
    };
    await scenario.stimuli[name](ctx);
  };
  const last = (topic: string): Record<string, unknown> | undefined => {
    const entries = published.filter((entry) => entry.topic === topic);
    return entries.length ? JSON.parse(entries.at(-1)!.payload) as Record<string, unknown> : undefined;
  };
  const command = (topic: string, params: Record<string, unknown>): SimulatedInboundCommand => ({ topic, params, rawPayload: params, receivedAt: 1 });
  return { registry, scenario, fire, last, command };
}

describe("research-vessel simulator scenario", () => {
  it("registers four acknowledgement-capable vessel actuators", () => {
    const { registry, scenario } = setup();
    expect(registry.getByCommandTopic(RESEARCH_VESSEL_COMMAND_TOPICS.dp)?.definition.key).toBe(RESEARCH_VESSEL_DEVICE_KEYS.dp);
    expect(registry.getByCommandTopic(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch)?.definition.key).toBe(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch);
    expect(registry.getByCommandTopic(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle)?.definition.key).toBe(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle);
    expect(registry.getByCommandTopic(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump)?.definition.key).toBe(RESEARCH_VESSEL_DEVICE_KEYS.tsgPump);
    expect(scenario.devices.filter((device) => device.commandProfile?.acknowledgement.supported)).toHaveLength(4);
  });

  it("models current shear as external drift and DP recovery as a physical command", async () => {
    const { registry, fire, command, last } = setup();
    await fire(RESEARCH_VESSEL_STIMULUS.currentShear);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.gnss)).toMatchObject({ driftM: 8.4 });
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.current)).toMatchObject({ speedKn: 2.1 });
    const dp = registry.get(RESEARCH_VESSEL_DEVICE_KEYS.dp)!;
    const outcome = await dp.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.dp, { engaged: true, mode: "recover" }));
    expect(outcome).toMatchObject({ accepted: true });
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.gnss)).toMatchObject({ driftM: 1.4, heading: 142 });
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.dp)).toMatchObject({ engaged: true, mode: "holding" });
  });

  it("runs a CTD cast through simulator-owned depth progression", async () => {
    const { registry, command, last } = setup();
    const winch = registry.get(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch)!;
    const outcome = await winch.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 }));
    expect(outcome).toMatchObject({ accepted: true });
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.ctdSonde)).toMatchObject({ depth: 420, verticalSpeed: 0 });
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.ctdWinch)).toMatchObject({ on: false, mode: "holding", payOut: 420 });
  });

  it("injects a CTD snag without directly claiming an Aeolus failure", async () => {
    const { registry, fire, command, last } = setup();
    await fire(RESEARCH_VESSEL_STIMULUS.ctdSnag);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.ctdWinch)).toMatchObject({ on: true, tension: 760 });
    const winch = registry.get(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch)!;
    await winch.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "hold", targetDepth: 120 }));
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.ctdWinch)).toMatchObject({ on: false, mode: "holding", tension: 245 });
  });

  it("models a deep ROV cross-current and a protective vehicle hold", async () => {
    const { registry, fire, command, last } = setup();
    await fire(RESEARCH_VESSEL_STIMULUS.rovCrossCurrent);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.rovTelemetry)).toMatchObject({ tetherTension: 735 });
    const vehicle = registry.get(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle)!;
    await vehicle.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "hold", targetDepth: 310 }));
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.rovTelemetry)).toMatchObject({ mode: "holding", tetherTension: 420 });
  });

  it("gives underway science a real pump and a physical hydrographic-front progression", async () => {
    const { registry, fire, command, last } = setup();
    const pump = registry.get(RESEARCH_VESSEL_DEVICE_KEYS.tsgPump)!;
    await pump.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump, { on: false }));
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ flow: 0 });
    await pump.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump, { on: true }));
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ flow: 2.1 });
    await fire(RESEARCH_VESSEL_STIMULUS.oceanFront);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ sst: 15.9, salinity: 34.72, chlorophyll: 2.5 });
  });

  it("domain resets do not reset unrelated vessel systems", async () => {
    const { fire, last } = setup();
    await fire(RESEARCH_VESSEL_STIMULUS.currentShear);
    await fire(RESEARCH_VESSEL_STIMULUS.oceanFront);
    await fire(RESEARCH_VESSEL_STIMULUS.stationReset);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.gnss)).toMatchObject({ driftM: 1.2 });
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ sst: 15.9 });
  });
});
