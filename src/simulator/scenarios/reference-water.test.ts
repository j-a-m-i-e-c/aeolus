// src/simulator/scenarios/reference-water.test.ts
import { describe, it, expect } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "../device-registry.js";
import { FaultController } from "../fault-controller.js";
import type { ScenarioStimulusContext, SimulatedInboundCommand } from "../types.js";
import {
  createReferenceWaterScenario,
  DEVICE_KEYS,
  STATE_TOPICS,
  PUMP_COMMAND_TOPIC,
  STIMULUS,
} from "./reference-water.js";

function stubLogger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

interface Published {
  topic: string;
  payload: string;
}

function setup() {
  const published: Published[] = [];
  const registry = new SimulatorDeviceRegistry({
    publish: (topic, payload) => published.push({ topic, payload }),
    logger: stubLogger(),
    maxDelayMs: 5000,
  });
  const faults = new FaultController({ maxDelayMs: 5000, logger: stubLogger() });
  const scenario = createReferenceWaterScenario();
  for (const def of scenario.devices) registry.register(def);

  const fire = async (name: string): Promise<void> => {
    const ctx: ScenarioStimulusContext = {
      stimulus: { name, payload: {}, meta: { eventId: "e", timestamp: 0, source: { kind: "automation" } }, receivedAt: 0 },
      devices: registry,
      faults,
      logger: stubLogger(),
    };
    await scenario.stimuli[name](ctx);
  };

  const command = (params: Record<string, unknown>): SimulatedInboundCommand => ({
    topic: PUMP_COMMAND_TOPIC,
    params,
    rawPayload: params,
    receivedAt: 0,
  });

  const lastOn = (topic: string): Record<string, unknown> | undefined => {
    const entries = published.filter((p) => p.topic === topic);
    return entries.length ? (JSON.parse(entries[entries.length - 1].payload) as Record<string, unknown>) : undefined;
  };

  return { registry, faults, scenario, published, fire, command, lastOn };
}

describe("reference-water scenario", () => {
  it("registers four devices with a command-capable pump", () => {
    const { registry, scenario } = setup();
    expect(registry.list()).toHaveLength(4);
    expect(registry.getByCommandTopic(PUMP_COMMAND_TOPIC)?.definition.key).toBe(DEVICE_KEYS.pump);
    const pumpDef = scenario.devices.find((d) => d.key === DEVICE_KEYS.pump);
    expect(pumpDef?.commandProfile?.acknowledgement.supported).toBe(true);
  });

  it("turns the pump on: raises the header tank, drains the source, and reports flow", async () => {
    const { registry, command, published, lastOn } = setup();
    const outcome = await registry.get(DEVICE_KEYS.pump)!.model.onCommand!(command({ on: true }));

    expect(outcome).toMatchObject({ accepted: true, state: { patch: { on: true, running: true } } });
    // Physical effects published on the sensor topics.
    expect(lastOn(STATE_TOPICS.flow)).toEqual({ litresPerMinute: 120 });
    expect(lastOn(STATE_TOPICS.headerTank)).toMatchObject({ levelPct: 100 });
    expect(lastOn(STATE_TOPICS.sourceTank)).toMatchObject({ levelPct: 70 });
    expect(published.length).toBeGreaterThan(0);
  });

  it("rejects a pump command without a boolean 'on'", async () => {
    const { registry, command } = setup();
    const outcome = await registry.get(DEVICE_KEYS.pump)!.model.onCommand!(command({}));
    expect(outcome).toMatchObject({ accepted: false });
  });

  it("turns the pump off: flow returns to zero", async () => {
    const { registry, command, lastOn } = setup();
    await registry.get(DEVICE_KEYS.pump)!.model.onCommand!(command({ on: true }));
    await registry.get(DEVICE_KEYS.pump)!.model.onCommand!(command({ on: false }));
    expect(lastOn(STATE_TOPICS.flow)).toEqual({ litresPerMinute: 0 });
  });

  it("tank-low stimulus lowers the header tank", async () => {
    const { fire, lastOn } = setup();
    await fire(STIMULUS.tankLow);
    expect(lastOn(STATE_TOPICS.headerTank)).toEqual({ levelPct: 25, litres: 1250 });
  });

  it("reset stimulus restores initial state", async () => {
    const { registry, command, fire, lastOn } = setup();
    await registry.get(DEVICE_KEYS.pump)!.model.onCommand!(command({ on: true }));
    await fire(STIMULUS.reset);
    expect(lastOn(STATE_TOPICS.headerTank)).toMatchObject({ levelPct: 60 });
    expect(lastOn(STATE_TOPICS.flow)).toEqual({ litresPerMinute: 0 });
    expect(lastOn(STATE_TOPICS.pump)).toEqual({ on: false, running: false });
  });

  it("fault-arm stimuli arm the corresponding pump faults", async () => {
    const { fire, faults } = setup();
    await fire(STIMULUS.rejectNextPump);
    expect(faults.peek(DEVICE_KEYS.pump)?.rejectNext?.reason).toMatch(/interlock/i);

    await fire(STIMULUS.dropNextPumpAck);
    expect(faults.peek(DEVICE_KEYS.pump)?.dropNextAck).toBe(true);

    await fire(STIMULUS.mismatchNextPumpState);
    expect(faults.peek(DEVICE_KEYS.pump)?.mismatchNextState).toEqual({ on: false, running: false });
  });

  it("suppress-next-flow suppresses only the next flow observation", async () => {
    const { registry, command, fire, published } = setup();
    await fire(STIMULUS.suppressNextFlow);

    await registry.get(DEVICE_KEYS.pump)!.model.onCommand!(command({ on: true }));
    // The header/source updated but no flow publish this time.
    expect(published.some((p) => p.topic === STATE_TOPICS.flow)).toBe(false);

    // The next pump-on publishes flow again (one-shot cleared).
    await registry.get(DEVICE_KEYS.pump)!.model.onCommand!(command({ on: true }));
    expect(published.some((p) => p.topic === STATE_TOPICS.flow)).toBe(true);
  });
});
