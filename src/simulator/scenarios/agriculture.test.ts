import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "../device-registry.js";
import { FaultController } from "../fault-controller.js";
import type { ScenarioStimulusContext, SimulatedInboundCommand } from "../types.js";
import {
  AGRICULTURE_COMMAND_TOPICS,
  AGRICULTURE_DEVICE_KEYS,
  AGRICULTURE_STATE_TOPICS,
  AGRICULTURE_STIMULUS,
  createAgricultureScenario,
} from "./agriculture.js";

function logger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

function setup() {
  const published: Array<{ topic: string; payload: string }> = [];
  const registry = new SimulatorDeviceRegistry({
    publish: (topic, payload) => published.push({ topic, payload }),
    logger: logger(),
    maxDelayMs: 0,
  });
  const faults = new FaultController({ maxDelayMs: 0, logger: logger() });
  const scenario = createAgricultureScenario();
  for (const definition of scenario.devices) registry.register(definition);

  const fire = async (name: string): Promise<void> => {
    const ctx: ScenarioStimulusContext = {
      stimulus: {
        name,
        payload: {},
        meta: { eventId: "event-1", timestamp: 1, source: { kind: "automation" } },
        receivedAt: 1,
      },
      devices: registry,
      faults,
      logger: logger(),
    };
    await scenario.stimuli[name](ctx);
  };

  const last = (topic: string): Record<string, unknown> | undefined => {
    const entries = published.filter((entry) => entry.topic === topic);
    return entries.length > 0 ? JSON.parse(entries.at(-1)!.payload) as Record<string, unknown> : undefined;
  };

  const command = (topic: string, params: Record<string, unknown>): SimulatedInboundCommand => ({
    topic,
    params,
    rawPayload: params,
    receivedAt: 1,
  });

  return { registry, scenario, fire, last, command, published };
}

describe("agriculture simulator scenario", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("registers all six command-capable Farm actuators", () => {
    const { registry, scenario } = setup();
    expect(registry.getByCommandTopic(AGRICULTURE_COMMAND_TOPICS.pump)?.definition.key).toBe(AGRICULTURE_DEVICE_KEYS.pump);
    expect(registry.getByCommandTopic(AGRICULTURE_COMMAND_TOPICS.shedFill)?.definition.key).toBe(AGRICULTURE_DEVICE_KEYS.shedFill);
    expect(registry.getByCommandTopic(AGRICULTURE_COMMAND_TOPICS.houseFill)?.definition.key).toBe(AGRICULTURE_DEVICE_KEYS.houseFill);
    expect(registry.getByCommandTopic(AGRICULTURE_COMMAND_TOPICS.recall)?.definition.key).toBe(AGRICULTURE_DEVICE_KEYS.recall);
    expect(registry.getByCommandTopic(AGRICULTURE_COMMAND_TOPICS.troughRefill)?.definition.key).toBe(AGRICULTURE_DEVICE_KEYS.troughRefill);
    expect(registry.getByCommandTopic(AGRICULTURE_COMMAND_TOPICS.chargerBank)?.definition.key).toBe(AGRICULTURE_DEVICE_KEYS.chargerBank);
    expect(scenario.devices.filter((device) => device.commandProfile?.acknowledgement.supported)).toHaveLength(6);
  });

  it("models a bounded dam batch with a totalizer and a physical failsafe stop", async () => {
    const { registry, command, last } = setup();
    const pump = registry.get(AGRICULTURE_DEVICE_KEYS.pump)!;
    const outcome = await pump.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.pump, { on: true, litres: 500 }));
    expect(outcome).toMatchObject({ accepted: true, state: { patch: { on: true, running: true } } });
    expect(last(AGRICULTURE_STATE_TOPICS.flow)).toMatchObject({ litresPerMinute: 120, batchActive: true, batchTargetLitres: 500, batchTransferredLitres: 0 });
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ pumpKw: 1.05, loadKw: 1.77 });

    await vi.advanceTimersByTimeAsync(1800);
    expect(last(AGRICULTURE_STATE_TOPICS.header)).toMatchObject({ value: 75, litres: 3750 });
    expect(last(AGRICULTURE_STATE_TOPICS.dam)).toMatchObject({ litres: 48700 });
    expect(last(AGRICULTURE_STATE_TOPICS.flow)).toMatchObject({ batchTransferredLitres: 500, batchActive: true });

    // The automation normally issues OFF when its totalizer delta reaches the
    // target. The simulator has a bounded physical failsafe so a broken control
    // path can never leave the demo pump animation running forever.
    await vi.advanceTimersByTimeAsync(1000);
    expect(last(AGRICULTURE_STATE_TOPICS.flow)).toMatchObject({ litresPerMinute: 0, batchActive: false, batchTransferredLitres: 500 });
    expect(last(AGRICULTURE_STATE_TOPICS.pump)).toMatchObject({ on: false, running: false });
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ pumpKw: 0, loadKw: 0.72 });
  });

  it("makes house and shed tanks physically refill from header storage", async () => {
    const { registry, command, fire, last } = setup();
    await fire(AGRICULTURE_STIMULUS.propertyDemand);
    expect(last(AGRICULTURE_STATE_TOPICS.house)).toMatchObject({ value: 50 });
    expect(last(AGRICULTURE_STATE_TOPICS.shed)).toMatchObject({ value: 60 });

    const houseFill = registry.get(AGRICULTURE_DEVICE_KEYS.houseFill)!;
    await houseFill.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.houseFill, { on: true, targetPct: 75 }));
    expect(last(AGRICULTURE_STATE_TOPICS.house)).toMatchObject({ value: 75, litres: 3000 });
    expect(last(AGRICULTURE_STATE_TOPICS.header)).toMatchObject({ value: 45, litres: 2250 });

    const shedFill = registry.get(AGRICULTURE_DEVICE_KEYS.shedFill)!;
    await shedFill.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.shedFill, { on: true, targetPct: 75 }));
    expect(last(AGRICULTURE_STATE_TOPICS.shed)).toMatchObject({ value: 75, litres: 6000 });
    expect(last(AGRICULTURE_STATE_TOPICS.header)).toMatchObject({ value: 21, litres: 1050 });
  });

  it("recall changes collar telemetry instead of letting the automation fake containment", async () => {
    const { registry, command, fire, last } = setup();
    await fire(AGRICULTURE_STIMULUS.boundaryBreach);
    expect(last(AGRICULTURE_STATE_TOPICS.collars)).toMatchObject({ strays: 2, breachSector: "east" });

    const recall = registry.get(AGRICULTURE_DEVICE_KEYS.recall)!;
    const outcome = await recall.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.recall, { active: true }));
    expect(outcome).toMatchObject({ accepted: true });
    expect(last(AGRICULTURE_STATE_TOPICS.collars)).toMatchObject({ strays: 0, paddock: "A", movement: "grazing" });
  });

  it("returns strays to the paddock the herd is actually in, not always Paddock A", async () => {
    const { registry, command, fire, last } = setup();

    await fire(AGRICULTURE_STIMULUS.moveHerd);
    expect(last(AGRICULTURE_STATE_TOPICS.collars)).toMatchObject({ paddock: "B" });

    await fire(AGRICULTURE_STIMULUS.boundaryBreach);
    expect(last(AGRICULTURE_STATE_TOPICS.collars)).toMatchObject({ strays: 2, paddock: "B" });

    const recall = registry.get(AGRICULTURE_DEVICE_KEYS.recall)!;
    await recall.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.recall, { active: true }));

    // Containment must return the strays to Paddock B. Recall previously named
    // Paddock A in its own state patch, teleporting the whole herd across the
    // property whenever it had rotated away from A.
    expect(last(AGRICULTURE_STATE_TOPICS.collars)).toMatchObject({
      strays: 0,
      paddock: "B",
      movement: "grazing",
    });
  });

  it("works the dogs through the recall without letting them report containment", async () => {
    const { registry, command, fire, last } = setup();

    // Read the model rather than the wire here: nothing has published yet, and the
    // resting pack is the device's declared initial state.
    const resting = registry.get(AGRICULTURE_DEVICE_KEYS.dogs)!.model.getState();
    expect(resting).toMatchObject({ working: false, deployed: 0 });
    expect((resting.dogs as Array<{ name: string; activity: string }>).map((d) => d.name))
      .toEqual(["Scout", "Moss"]);

    await fire(AGRICULTURE_STIMULUS.boundaryBreach);
    const recall = registry.get(AGRICULTURE_DEVICE_KEYS.recall)!;
    await recall.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.recall, { active: true }));

    // The pack leaves the kennel as soon as the recall is accepted.
    const dispatched = last(AGRICULTURE_STATE_TOPICS.dogs)!;
    expect(dispatched).toMatchObject({ working: true, deployed: 2 });

    await vi.advanceTimersByTimeAsync(8000);

    const settled = last(AGRICULTURE_STATE_TOPICS.dogs)!;
    const dogs = settled.dogs as Array<{ activity: string; targetStray: number | null; battery: number }>;
    expect(settled).toMatchObject({ working: false, deployed: 0 });
    for (const dog of dogs) {
      expect(dog.activity).toBe("kenneled");
      expect(dog.targetStray).toBeNull();
      // Working the recall drains the collar measurably.
      expect(dog.battery).toBeLessThan(91);
    }
  });

  it("moves the dogs through interception, driving and returning", async () => {
    const { registry, command, fire, published } = setup();

    await fire(AGRICULTURE_STIMULUS.boundaryBreach);
    const recall = registry.get(AGRICULTURE_DEVICE_KEYS.recall)!;
    await recall.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.recall, { active: true }));
    await vi.advanceTimersByTimeAsync(8000);

    const activities = published
      .filter((entry) => entry.topic === AGRICULTURE_STATE_TOPICS.dogs)
      .map((entry) => (JSON.parse(entry.payload) as { dogs: Array<{ activity: string }> }).dogs[0].activity);

    // The pack visibly does the work in stages rather than teleporting to the
    // strays and back.
    expect(activities).toContain("released");
    expect(activities).toContain("intercepting");
    expect(activities).toContain("driving");
    expect(activities).toContain("returning");
    expect(activities.at(-1)).toBe("kenneled");
  });

  it("returns the pack to the kennel when livestock is reset mid-recall", async () => {
    const { registry, command, fire, last } = setup();

    await fire(AGRICULTURE_STIMULUS.boundaryBreach);
    const recall = registry.get(AGRICULTURE_DEVICE_KEYS.recall)!;
    await recall.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.recall, { active: true }));
    await vi.advanceTimersByTimeAsync(600);

    await fire(AGRICULTURE_STIMULUS.livestockReset);
    // A reset must win: no leftover transition may keep writing dog positions
    // over the state the reset just restored.
    await vi.advanceTimersByTimeAsync(8000);

    const settled = last(AGRICULTURE_STATE_TOPICS.dogs)!;
    expect(settled).toMatchObject({ working: false, deployed: 0 });
    for (const dog of settled.dogs as Array<{ activity: string }>) {
      expect(dog.activity).toBe("kenneled");
    }
  });

  it("models one guarded herd-drinking sequence and a targeted refill", async () => {
    const { registry, command, fire, last } = setup();
    await fire(AGRICULTURE_STIMULUS.troughsDrink);
    expect(last(AGRICULTURE_STATE_TOPICS.troughs)).toMatchObject({ drinkingActive: true, drinkingHead: 18, drinkingProgress: 0 });

    // A second click while the herd visit is active is ignored instead of
    // stacking another delayed drinking sequence on top of the first.
    await fire(AGRICULTURE_STIMULUS.troughsDrink);
    await vi.advanceTimersByTimeAsync(3000);
    const afterDrink = last(AGRICULTURE_STATE_TOPICS.troughs)!;
    expect(afterDrink.drinkingActive).toBe(false);
    expect(afterDrink.low).toBeGreaterThan(0);
    expect(afterDrink.lastDrinkLitres).toBeGreaterThan(0);
    expect(afterDrink.lowIds).toEqual(expect.arrayContaining(["T4", "T5"]));

    const refill = registry.get(AGRICULTURE_DEVICE_KEYS.troughRefill)!;
    await refill.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.troughRefill, {
      active: true,
      targets: afterDrink.lowIds,
    }));
    expect(last(AGRICULTURE_STATE_TOPICS.troughs)).toMatchObject({ refilling: (afterDrink.lowIds as string[]).length });
    await vi.advanceTimersByTimeAsync(2600);
    expect(last(AGRICULTURE_STATE_TOPICS.troughs)).toMatchObject({ low: 0, refilling: 0, refillFlowLpm: 0 });
  });

  it("makes the energy model react to a verified opportunity load", async () => {
    const { registry, command, last } = setup();
    const charger = registry.get(AGRICULTURE_DEVICE_KEYS.chargerBank)!;
    const outcome = await charger.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.chargerBank, { on: true }));
    expect(outcome).toMatchObject({ accepted: true, state: { patch: { on: true, watts: 450 } } });
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ chargerKw: 0.45, chargerOn: true, loadKw: 1.17 });
  });

  it("energy stimuli publish a low-reserve gate and restore it without losing live load breakdown", async () => {
    const { registry, command, fire, last } = setup();
    const pump = registry.get(AGRICULTURE_DEVICE_KEYS.pump)!;
    await pump.model.onCommand!(command(AGRICULTURE_COMMAND_TOPICS.pump, { on: true, litres: 500 }));
    await fire(AGRICULTURE_STIMULUS.energyLow);
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ soc: 18, available: false, pumpKw: 1.05 });
    await fire(AGRICULTURE_STIMULUS.energyRestore);
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ soc: 78, available: true, pumpKw: 1.05 });
  });

  it("domain resets do not reset unrelated Farm systems", async () => {
    const { fire, last } = setup();
    await fire(AGRICULTURE_STIMULUS.headerLow);
    await fire(AGRICULTURE_STIMULUS.energyLow);
    await fire(AGRICULTURE_STIMULUS.waterReset);
    expect(last(AGRICULTURE_STATE_TOPICS.header)).toMatchObject({ value: 65, litres: 3250 });
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ soc: 18, available: false });

    await fire(AGRICULTURE_STIMULUS.energyReset);
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ soc: 78, available: true });
  });

  it("reset restores the coherent nominal state", async () => {
    const { fire, last } = setup();
    await fire(AGRICULTURE_STIMULUS.headerLow);
    await fire(AGRICULTURE_STIMULUS.troughsDrink);
    await fire(AGRICULTURE_STIMULUS.energyLow);
    await fire(AGRICULTURE_STIMULUS.reset);
    expect(last(AGRICULTURE_STATE_TOPICS.header)).toMatchObject({ value: 65, litres: 3250 });
    expect(last(AGRICULTURE_STATE_TOPICS.troughs)).toMatchObject({ low: 0, average: 84 });
    expect(last(AGRICULTURE_STATE_TOPICS.battery)).toMatchObject({ soc: 78, available: true, pumpKw: 0, chargerKw: 0 });
    expect(last(AGRICULTURE_STATE_TOPICS.pump)).toEqual({ on: false, running: false });
  });
});
