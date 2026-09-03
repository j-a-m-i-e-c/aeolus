import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "../device-registry.js";
import { FaultController } from "../fault-controller.js";
import type { ScenarioStimulusContext, SimulatedInboundCommand } from "../types.js";
import {
  createWildlifeScenario,
  WILDLIFE_COMMAND_TOPICS,
  WILDLIFE_DEVICE_KEYS,
  WILDLIFE_STATE_TOPICS,
  WILDLIFE_STIMULUS,
} from "./wildlife.js";

function logger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

/**
 * Drives the scenario through the real device registry rather than a hand-rolled
 * stub, so timed transitions, delay clamping and publish suppression behave the
 * way they do at runtime.
 */
function setup(maxDelayMs = 0) {
  const published: Array<{ topic: string; payload: string }> = [];
  const registry = new SimulatorDeviceRegistry({
    publish: (topic, payload) => published.push({ topic, payload }),
    logger: logger(),
    maxDelayMs,
  });
  const faults = new FaultController({ maxDelayMs: 0, logger: logger() });
  const scenario = createWildlifeScenario();
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

  const state = (key: string): Record<string, unknown> =>
    registry.get(key)!.controller.read() as Record<string, unknown>;

  const last = (topic: string): Record<string, unknown> | undefined => {
    const entries = published.filter((entry) => entry.topic === topic);
    return entries.length > 0 ? (JSON.parse(entries.at(-1)!.payload) as Record<string, unknown>) : undefined;
  };

  const command = (topic: string, params: Record<string, unknown>): SimulatedInboundCommand => ({
    topic,
    params,
    rawPayload: params,
    receivedAt: 1,
  });

  const send = async (topic: string, params: Record<string, unknown>) => {
    const device = registry.getByCommandTopic(topic)!;
    return await device.model.onCommand!(command(topic, params));
  };
  const sendDeterrent = async (params: Record<string, unknown>) => await send(WILDLIFE_COMMAND_TOPICS.deterrent, params);
  const sendDenFan = async (params: Record<string, unknown>) => await send(WILDLIFE_COMMAND_TOPICS.denFan, params);

  return { registry, scenario, fire, state, last, published, sendDeterrent, sendDenFan };
}

describe("wildlife simulator scenario", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("declares exactly two ACK-capable actuators", () => {
    const { scenario } = setup();
    const actuators = scenario.devices.filter((device) => device.commandTopic !== undefined);
    expect(actuators.map((device) => device.key).sort()).toEqual(
      [WILDLIFE_DEVICE_KEYS.denFan, WILDLIFE_DEVICE_KEYS.deterrent].sort(),
    );
    for (const actuator of actuators) {
      expect(actuator.commandProfile?.acknowledgement.supported).toBe(true);
    }
    const deterrent = actuators.find((device) => device.key === WILDLIFE_DEVICE_KEYS.deterrent)!;
    expect(deterrent.commandTopic).toBe(WILDLIFE_COMMAND_TOPICS.deterrent);
    const fan = actuators.find((device) => device.key === WILDLIFE_DEVICE_KEYS.denFan)!;
    expect(fan.commandTopic).toBe(WILDLIFE_COMMAND_TOPICS.denFan);
  });

  it("injects a predator that walks into frame as physical classifier telemetry", async () => {
    const { fire, state, last } = setup();
    await fire(WILDLIFE_STIMULUS.fox);

    // Detected at the edge of range, still closing. Asserted before any timer
    // runs, because the approach is a movement rather than a teleport.
    const onEntry = state(WILDLIFE_DEVICE_KEYS.detection);
    expect(onEntry.category).toBe("predator");
    expect(onEntry.species).toBe("red-fox");
    expect(onEntry.movement).toBe("approaching");
    expect(Number(onEntry.distanceM)).toBeGreaterThan(20);
    expect(Number(onEntry.speedMps)).toBeGreaterThan(0);

    vi.advanceTimersByTime(1500);

    const settled = state(WILDLIFE_DEVICE_KEYS.detection);
    expect(settled.movement).toBe("browsing");
    expect(Number(settled.distanceM)).toBeCloseTo(11.3, 5);
    expect(last(WILDLIFE_STATE_TOPICS.detection)?.distanceM).toBeCloseTo(11.3, 5);
  });

  it("lets an undisturbed animal lose interest and wander off instead of vanishing", async () => {
    const { fire, state } = setup();
    await fire(WILDLIFE_STIMULUS.native);
    vi.advanceTimersByTime(1500);
    expect(state(WILDLIFE_DEVICE_KEYS.detection).movement).toBe("browsing");
    const browsingAt = Number(state(WILDLIFE_DEVICE_KEYS.detection).distanceM);

    // It leaves on its own after a pause, and the record of what it was stays
    // behind — nothing is deleted from the scene.
    vi.advanceTimersByTime(4300);
    const gone = state(WILDLIFE_DEVICE_KEYS.detection);
    expect(gone.movement).toBe("clear");
    expect(Number(gone.distanceM)).toBeGreaterThan(browsingAt);
    expect(gone.species).toBe("echidna");
    expect(Number(gone.speedMps)).toBe(0);
  });

  it("acknowledges a deterrent command before the fan has reached speed", async () => {
    const { state, sendDeterrent } = setup();
    const result = await sendDeterrent({ active: true, target: "Red Fox", pulseMs: 4200, rpm: 2400 });

    expect(result.accepted).toBe(true);
    // ACKNOWLEDGED, not yet OBSERVED: the controller took the target, the
    // tachometer still reads zero.
    const accepted = state(WILDLIFE_DEVICE_KEYS.deterrent);
    expect(accepted.active).toBe(true);
    expect(accepted.target).toBe("Red Fox");
    expect(accepted.commandRpm).toBe(2400);
    expect(accepted.measuredRpm).toBe(0);

    vi.advanceTimersByTime(1500);
    expect(state(WILDLIFE_DEVICE_KEYS.deterrent).measuredRpm).toBe(2400);
  });

  it("scares the predator off when the tachometer reaches speed, not when the command lands", async () => {
    const { fire, state, sendDeterrent } = setup();
    await fire(WILDLIFE_STIMULUS.fox);
    vi.advanceTimersByTime(1500);
    const browsingAt = Number(state(WILDLIFE_DEVICE_KEYS.detection).distanceM);

    await sendDeterrent({ active: true, target: "Red Fox", pulseMs: 4200, rpm: 2400 });
    // The command has been accepted but the fan has not spun up, so the fox has
    // no physical reason to move yet.
    expect(state(WILDLIFE_DEVICE_KEYS.detection).movement).toBe("browsing");
    expect(Number(state(WILDLIFE_DEVICE_KEYS.detection).distanceM)).toBeCloseTo(browsingAt, 5);

    vi.advanceTimersByTime(1500);
    const fled = state(WILDLIFE_DEVICE_KEYS.detection);
    expect(Number(state(WILDLIFE_DEVICE_KEYS.deterrent).measuredRpm)).toBeGreaterThanOrEqual(2000);
    expect(Number(fled.distanceM)).toBeGreaterThan(browsingAt);
    expect(fled.movement).toBe("clear");
    expect(fled.species).toBe("red-fox");
  });

  it("leaves a native animal alone when the deterrent fires", async () => {
    const { fire, state, sendDeterrent } = setup();
    await fire(WILDLIFE_STIMULUS.native);
    vi.advanceTimersByTime(1500);
    const browsingAt = Number(state(WILDLIFE_DEVICE_KEYS.detection).distanceM);

    await sendDeterrent({ active: true, target: "Red Fox", pulseMs: 4200, rpm: 2400 });
    vi.advanceTimersByTime(1500);

    // The deterrent is only ever aimed at predators; a possum browsing nearby is
    // not flushed by it.
    expect(state(WILDLIFE_DEVICE_KEYS.detection).movement).toBe("browsing");
    expect(Number(state(WILDLIFE_DEVICE_KEYS.detection).distanceM)).toBeCloseTo(browsingAt, 5);
  });

  it("runs a bounded pulse and verifies the stop by the fan slowing down", async () => {
    const { state, sendDeterrent } = setup();
    await sendDeterrent({ active: true, target: "Red Fox", pulseMs: 4200, rpm: 2400 });
    vi.advanceTimersByTime(1500);
    expect(state(WILDLIFE_DEVICE_KEYS.deterrent).measuredRpm).toBe(2400);

    vi.advanceTimersByTime(4300);
    const stopped = state(WILDLIFE_DEVICE_KEYS.deterrent);
    expect(stopped.active).toBe(false);
    expect(stopped.target).toBe("none");
    expect(stopped.commandRpm).toBe(0);
    expect(stopped.measuredRpm).toBe(0);
  });

  it("rejects a deterrent command without a boolean active flag", async () => {
    const { state, sendDeterrent } = setup();
    const result = await sendDeterrent({ target: "Red Fox" });
    expect(result.accepted).toBe(false);
    expect(state(WILDLIFE_DEVICE_KEYS.deterrent).active).toBe(false);
  });

  it("cancels animal movement and fan spin-up on reset", async () => {
    const { fire, state } = setup();
    await fire(WILDLIFE_STIMULUS.fox);
    await fire(WILDLIFE_STIMULUS.reset);

    const afterReset = state(WILDLIFE_DEVICE_KEYS.detection);
    expect(afterReset.movement).toBe("clear");
    expect(Number(afterReset.distanceM)).toBeCloseTo(7.2, 5);

    // A cancelled transition must not keep writing over the restored state.
    vi.advanceTimersByTime(10000);
    expect(Number(state(WILDLIFE_DEVICE_KEYS.detection).distanceM)).toBeCloseTo(7.2, 5);
    expect(state(WILDLIFE_DEVICE_KEYS.detection).movement).toBe("clear");
    expect(state(WILDLIFE_DEVICE_KEYS.deterrent).measuredRpm).toBe(0);
  });

  it("models an adult den visit and departure", async () => {
    const { fire, state } = setup();
    await fire(WILDLIFE_STIMULUS.nestVisit);
    expect(state(WILDLIFE_DEVICE_KEYS.nest).adultPresent).toBe(true);
    vi.advanceTimersByTime(2500);
    expect(state(WILDLIFE_DEVICE_KEYS.nest).adultPresent).toBe(false);
  });

  it("climbs the den box through a hot afternoon and recovers on reset", async () => {
    const { fire, state } = setup();
    await fire(WILDLIFE_STIMULUS.heatWave);
    // The heat load is on immediately; the temperature has to travel.
    expect(state(WILDLIFE_DEVICE_KEYS.nest).heatLoad).toBe(true);
    expect(Number(state(WILDLIFE_DEVICE_KEYS.nest).temp)).toBeCloseTo(31.8, 5);

    vi.advanceTimersByTime(1500);
    const hot = state(WILDLIFE_DEVICE_KEYS.nest);
    expect(hot.thermalState).toBe("high");
    expect(Number(hot.temp)).toBeGreaterThanOrEqual(37.5);
    expect(Number(hot.humidity)).toBeLessThan(61);

    await fire(WILDLIFE_STIMULUS.nestReset);
    const reset = state(WILDLIFE_DEVICE_KEYS.nest);
    expect(reset.thermalState).toBe("normal");
    expect(reset.heatLoad).toBe(false);
    expect(Number(reset.temp)).toBeCloseTo(31.8, 5);
  });

  it("acknowledges a cooling command before the impeller is moving air", async () => {
    const { state, sendDenFan } = setup();
    const result = await sendDenFan({ active: true, rpm: 1800 });

    expect(result.accepted).toBe(true);
    const accepted = state(WILDLIFE_DEVICE_KEYS.denFan);
    expect(accepted.active).toBe(true);
    expect(accepted.commandRpm).toBe(1800);
    expect(accepted.measuredRpm).toBe(0);
  });

  it("refuses a fan speed the hardware cannot reach instead of pretending to hold it", async () => {
    const { state, sendDenFan } = setup();
    const result = await sendDenFan({ active: true, rpm: 4000 });
    expect(result.accepted).toBe(false);
    const fan = state(WILDLIFE_DEVICE_KEYS.denFan);
    expect(fan.active).toBe(false);
    expect(fan.commandRpm).toBe(0);
  });

  it("cools the den box once the tachometer proves the fan is moving air", async () => {
    const { fire, state, sendDenFan } = setup();
    await fire(WILDLIFE_STIMULUS.heatWave);
    vi.advanceTimersByTime(1500);
    const hotAt = Number(state(WILDLIFE_DEVICE_KEYS.nest).temp);
    expect(hotAt).toBeGreaterThanOrEqual(37.5);

    await sendDenFan({ active: true, rpm: 1800 });
    // Accepting the command moves no air, so the box is exactly as hot as it was.
    expect(Number(state(WILDLIFE_DEVICE_KEYS.nest).temp)).toBeCloseTo(hotAt, 5);

    vi.advanceTimersByTime(12000);
    const cooled = state(WILDLIFE_DEVICE_KEYS.nest);
    expect(Number(state(WILDLIFE_DEVICE_KEYS.denFan).measuredRpm)).toBeGreaterThanOrEqual(1500);
    expect(Number(cooled.temp)).toBeLessThan(34);
    expect(cooled.thermalState).toBe("normal");
    // The hot part of the afternoon has passed, so the box stays in range.
    expect(cooled.heatLoad).toBe(false);
  });

  it("lets the box heat up again when cooling is stopped while the afternoon is still hot", async () => {
    // Steps take real time here so the recovery can be interrupted part-way. With
    // maxDelayMs 0 every transition collapses into a single tick and there is no
    // mid-transition state to observe.
    const { fire, state, sendDenFan } = setup(1000);
    await fire(WILDLIFE_STIMULUS.heatWave);
    vi.advanceTimersByTime(3000);
    expect(Number(state(WILDLIFE_DEVICE_KEYS.nest).temp)).toBeGreaterThanOrEqual(37.5);

    await sendDenFan({ active: true, rpm: 1800 });
    vi.advanceTimersByTime(2800);
    const partway = Number(state(WILDLIFE_DEVICE_KEYS.nest).temp);
    expect(partway).toBeLessThan(38.4);
    expect(state(WILDLIFE_DEVICE_KEYS.nest).heatLoad).toBe(true);

    await sendDenFan({ active: false });
    vi.advanceTimersByTime(8000);
    const rebound = state(WILDLIFE_DEVICE_KEYS.nest);
    expect(state(WILDLIFE_DEVICE_KEYS.denFan).measuredRpm).toBe(0);
    expect(Number(rebound.temp)).toBeGreaterThan(partway);
    expect(rebound.thermalState).toBe("high");
  });

  it("stands the fan down and cancels the temperature transition on reset", async () => {
    const { fire, state, sendDenFan } = setup();
    await fire(WILDLIFE_STIMULUS.heatWave);
    await sendDenFan({ active: true, rpm: 1800 });
    await fire(WILDLIFE_STIMULUS.nestReset);

    expect(state(WILDLIFE_DEVICE_KEYS.denFan).active).toBe(false);
    expect(state(WILDLIFE_DEVICE_KEYS.denFan).measuredRpm).toBe(0);

    vi.advanceTimersByTime(15000);
    const settled = state(WILDLIFE_DEVICE_KEYS.nest);
    expect(Number(settled.temp)).toBeCloseTo(31.8, 5);
    expect(settled.thermalState).toBe("normal");
    expect(state(WILDLIFE_DEVICE_KEYS.denFan).measuredRpm).toBe(0);
  });
});
