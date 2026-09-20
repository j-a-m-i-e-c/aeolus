import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "../device-registry.js";
import { FaultController } from "../fault-controller.js";
import type { ScenarioStimulusContext, SimulatedInboundCommand } from "../types.js";
import {
  BUNKER_COMMAND_TOPICS,
  BUNKER_DEVICE_KEYS,
  BUNKER_STATE_TOPICS,
  BUNKER_STIMULUS,
  createOffGridBunkerScenario,
  waterDrawnLitres,
} from "./off-grid-bunker.js";

function logger(): Logger {
  const noop = (): void => undefined;
  return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger;
}

/**
 * Drives the scenario through the real device registry. `maxDelayMs` defaults to 0,
 * which collapses every transition into a single tick; tests that need to watch a
 * contact part-way across the approach pass a real clamp.
 */
function setup(maxDelayMs = 0) {
  const published: Array<{ topic: string; payload: string }> = [];
  const registry = new SimulatorDeviceRegistry({
    publish: (topic, payload) => published.push({ topic, payload }),
    logger: logger(),
    maxDelayMs,
  });
  const faults = new FaultController({ maxDelayMs: 0, logger: logger() });
  const scenario = createOffGridBunkerScenario();
  for (const definition of scenario.devices) registry.register(definition);

  const fire = async (name: string): Promise<void> => {
    const ctx: ScenarioStimulusContext = {
      stimulus: { name, payload: {}, meta: { eventId: "event-1", timestamp: 1, source: { kind: "automation" } }, receivedAt: 1 },
      devices: registry,
      faults,
      logger: logger(),
    };
    await scenario.stimuli[name](ctx);
  };

  const command = (topic: string, params: Record<string, unknown>): SimulatedInboundCommand => ({ topic, params, rawPayload: params, receivedAt: 1 });
  const send = async (topic: string, params: Record<string, unknown>) => await registry.getByCommandTopic(topic)!.model.onCommand!(command(topic, params));
  const state = (key: string): Record<string, unknown> => registry.get(key)!.controller.read() as Record<string, unknown>;
  const perimeter = () => state(BUNKER_DEVICE_KEYS.perimeter);

  return { registry, scenario, fire, send, state, perimeter, published };
}

describe("bunker simulator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("always tracks something out past the treeline without raising it as a contact", () => {
    const { perimeter } = setup();
    const rest = perimeter();
    expect(Number(rest.contacts)).toBe(0);
    expect(Number(rest.ambientContacts)).toBeGreaterThan(0);
    expect(rest.movement).toBe("clear");
    expect(rest.classification).toBe("distant-movement");
    expect(Number(rest.rangeM)).toBe(Number(rest.trackRangeM));
  });

  it("shows a visible approach before the demo group crosses the alert ring", async () => {
    const { fire, perimeter } = setup(200);
    await fire(BUNKER_STIMULUS.shuffle);
    // The explicit demo stimulus starts just outside the alert ring: far enough to
    // see an approach, close enough that a visitor does not wait ~11 seconds before
    // anything interesting happens.
    expect(Number(perimeter().rangeM)).toBeGreaterThan(Number(perimeter().detectRangeM));
    expect(Number(perimeter().contacts)).toBe(0);
    expect(Number(perimeter().approachGroupSize)).toBeGreaterThan(0);
    expect(perimeter().movement).toBe("approaching");

    vi.advanceTimersByTime(3500);
    // The count is a consequence of range, so the two cannot disagree.
    expect(Number(perimeter().contacts)).toBeGreaterThan(0);
    expect(Number(perimeter().rangeM)).toBeLessThanOrEqual(Number(perimeter().detectRangeM));
    expect(perimeter().classification).toBe("shambling-biped");
  });

  it("injects contacts without commanding floodlights itself", async () => {
    const { fire, state, perimeter } = setup();
    await fire(BUNKER_STIMULUS.shuffle);
    vi.advanceTimersByTime(1000);
    expect(Number(perimeter().contacts)).toBeGreaterThan(0);
    // Deciding to light the approach is the automation's job, not the world's.
    expect(state(BUNKER_DEVICE_KEYS.lights).on).toBe(false);
    expect(Number(state(BUNKER_DEVICE_KEYS.lights).brightness)).toBe(0);
  });

  it("turns contacts back when the floodlights are genuinely bright", async () => {
    const { fire, send, state, perimeter } = setup();
    await fire(BUNKER_STIMULUS.shuffle);
    vi.advanceTimersByTime(1000);
    const atFence = Number(perimeter().rangeM);
    expect(Number(perimeter().contacts)).toBeGreaterThan(0);

    const result = await send(BUNKER_COMMAND_TOPICS.lights, { on: true });
    expect(result.accepted).toBe(true);
    // Accepting the command lights nothing: the fixture is still dark, so nothing
    // has any reason to move.
    expect(Number(state(BUNKER_DEVICE_KEYS.lights).brightness)).toBe(0);
    expect(Number(perimeter().rangeM)).toBeCloseTo(atFence, 5);

    vi.advanceTimersByTime(1200);
    expect(Number(state(BUNKER_DEVICE_KEYS.lights).brightness)).toBe(100);
    expect(Number(perimeter().rangeM)).toBeGreaterThan(atFence);
  });

  it("withdraws contacts past the treeline rather than deleting them", async () => {
    const { fire, perimeter } = setup();
    await fire(BUNKER_STIMULUS.shuffle);
    vi.advanceTimersByTime(1000);
    expect(Number(perimeter().contacts)).toBeGreaterThan(0);

    await fire(BUNKER_STIMULUS.clear);
    vi.advanceTimersByTime(1000);
    const gone = perimeter();
    expect(Number(gone.contacts)).toBe(0);
    expect(gone.movement).toBe("clear");
    expect(Number(gone.rangeM)).toBe(Number(gone.trackRangeM));
    // The explicit group has left tracking range; only unrelated ambient movement
    // remains beyond the treeline.
    expect(Number(gone.approachGroupSize)).toBe(0);
    expect(Number(gone.ambientContacts)).toBeGreaterThan(0);
  });

  it("cancels an approach even when clear is pressed immediately", async () => {
    const { fire, perimeter } = setup(200);
    await fire(BUNKER_STIMULUS.shuffle);
    expect(perimeter().movement).toBe("approaching");

    await fire(BUNKER_STIMULUS.clear);
    vi.advanceTimersByTime(500);

    expect(perimeter().movement).toBe("clear");
    expect(Number(perimeter().approachGroupSize)).toBe(0);
    expect(Number(perimeter().contacts)).toBe(0);
  });

  it("lets contacts lose interest at the fence with no response at all", async () => {
    const { fire, perimeter } = setup();
    await fire(BUNKER_STIMULUS.shuffle);
    vi.advanceTimersByTime(1000);
    expect(perimeter().movement).toBe("at-fence");

    vi.advanceTimersByTime(8000);
    expect(perimeter().movement).toBe("clear");
    expect(Number(perimeter().contacts)).toBe(0);
  });

  it("cancels an approach on reset instead of letting it overwrite the restored state", async () => {
    const { fire, perimeter } = setup(200);
    await fire(BUNKER_STIMULUS.shuffle);
    vi.advanceTimersByTime(600);
    await fire(BUNKER_STIMULUS.reset);
    expect(Number(perimeter().rangeM)).toBe(Number(perimeter().trackRangeM));

    vi.advanceTimersByTime(20000);
    expect(Number(perimeter().rangeM)).toBe(Number(perimeter().trackRangeM));
    expect(Number(perimeter().contacts)).toBe(0);
    expect(perimeter().movement).toBe("clear");
  });

  it("brings the generator up to output instead of asserting it", async () => {
    // showcase-cleanup §9.5. `outputW` used to be written in the same update as `on`,
    // which left a command nothing to prove beyond the contactor closing.
    const { send, state } = setup();
    expect(Number(state(BUNKER_DEVICE_KEYS.generator).outputW)).toBe(0);

    expect((await send(BUNKER_COMMAND_TOPICS.generator, { on: true })).accepted).toBe(true);
    // Accepted, and producing nothing yet: the engine has to come up.
    expect(state(BUNKER_DEVICE_KEYS.generator).on).toBe(true);
    expect(Number(state(BUNKER_DEVICE_KEYS.generator).outputW)).toBe(0);

    vi.advanceTimersByTime(1600);
    expect(Number(state(BUNKER_DEVICE_KEYS.generator).outputW)).toBeGreaterThanOrEqual(1500);
  });

  it("integrates the power balance into the battery instead of asserting a percent", async () => {
    // The generator used to wait 1.8s and then assert `battery: 31` — and rewrite
    // `solarW` while it was there, so starting a generator changed the weather.
    const { fire, send, state } = setup();
    await fire(BUNKER_STIMULUS.lowPower);
    expect(state(BUNKER_DEVICE_KEYS.power).battery).toBe(27);
    const cloudedSolar = Number(state(BUNKER_DEVICE_KEYS.power).solarW);
    // Cloud cover leaves the site running at a deficit, so the bank drains.
    expect(Number(state(BUNKER_DEVICE_KEYS.power).netW)).toBeLessThan(0);
    vi.advanceTimersByTime(6000);
    const drained = Number(state(BUNKER_DEVICE_KEYS.power).battery);
    expect(drained).toBeLessThan(27);

    await send(BUNKER_COMMAND_TOPICS.generator, { on: true });
    vi.advanceTimersByTime(2000);
    // Output now covers the deficit, so the balance turns positive...
    expect(Number(state(BUNKER_DEVICE_KEYS.power).netW)).toBeGreaterThan(0);
    // ...and the sun is exactly where it was. A generator does not move it.
    expect(Number(state(BUNKER_DEVICE_KEYS.power).solarW)).toBe(cloudedSolar);

    vi.advanceTimersByTime(6000);
    expect(Number(state(BUNKER_DEVICE_KEYS.power).battery)).toBeGreaterThan(drained);
  });

  it("spends fuel while the generator is carrying the site", async () => {
    // `fuel` was a number no code path ever touched, which made the gauge decoration.
    const { send, state } = setup();
    const full = Number(state(BUNKER_DEVICE_KEYS.generator).fuel);

    await send(BUNKER_COMMAND_TOPICS.generator, { on: true });
    vi.advanceTimersByTime(20000);

    expect(Number(state(BUNKER_DEVICE_KEYS.generator).fuel)).toBeLessThan(full);
  });

  it("winds generator output down when it is stopped", async () => {
    const { send, state } = setup();
    await send(BUNKER_COMMAND_TOPICS.generator, { on: true });
    vi.advanceTimersByTime(1600);
    expect(Number(state(BUNKER_DEVICE_KEYS.generator).outputW)).toBeGreaterThan(0);

    await send(BUNKER_COMMAND_TOPICS.generator, { on: false });
    vi.advanceTimersByTime(1200);
    expect(Number(state(BUNKER_DEVICE_KEYS.generator).outputW)).toBeLessThanOrEqual(50);
  });

  it("charges the floodlights and a sealed filter to the power bus", async () => {
    const { send, state } = setup();
    const idle = Number(state(BUNKER_DEVICE_KEYS.power).loadW);
    await send(BUNKER_COMMAND_TOPICS.lights, { on: true });
    const lit = Number(state(BUNKER_DEVICE_KEYS.power).loadW);
    expect(lit).toBeGreaterThan(idle);
    await send(BUNKER_COMMAND_TOPICS.filter, { sealed: true });
    expect(Number(state(BUNKER_DEVICE_KEYS.power).loadW)).toBeGreaterThan(lit);
  });

  it("measures the water and leaves the counted stores as counted stores", () => {
    // showcase-cleanup §9.6. Every supply figure used to be published as though a sensor
    // produced it, including 312 tins of beans. The cistern has a level sensor; the rest
    // is an inventory somebody maintains, and the payload now says which is which.
    const { state } = setup();
    const supplies = state(BUNKER_DEVICE_KEYS.supplies);

    // Measured, with the tank it is measuring.
    expect(Number(supplies.waterLitres)).toBeGreaterThan(0);
    expect(Number(supplies.cisternCapacityL)).toBeGreaterThan(Number(supplies.waterLitres));
    // Human-maintained, and no longer pretending to be a reading of anything.
    expect(Number(supplies.beans)).toBeGreaterThan(0);
    expect(Number(supplies.foodDays)).toBeGreaterThan(0);
    // A runway is not a measurement, so the device does not publish one.
    expect(supplies.waterDays).toBeUndefined();
  });

  it("draws the cistern down as the occupants use it", () => {
    const { state } = setup();
    const before = Number(state(BUNKER_DEVICE_KEYS.supplies).waterLitres);

    // Slowly, because eighty days of water is slow. The point is that it moves at all:
    // the level used to be a constant, so the runway derived from it never changed.
    // One litre takes ~13m51s of wall time at four occupants, so this has to span
    // more than that to observe a whole litre leaving.
    vi.advanceTimersByTime(900_000);

    expect(Number(state(BUNKER_DEVICE_KEYS.supplies).waterLitres)).toBeLessThan(before);
  });

  describe("water consumption runs on wall time, not the accelerated power clock", () => {
    // The bug this covers: the cistern was integrated with POWER_TIME_SCALE (300x),
    // the factor that exists so a visitor can watch the battery move. That made an
    // ~80 day water supply fall by a litre every few seconds and published
    // sensor/bunker/supplies continuously. Asserted against the pure helper rather
    // than by advancing a day of timers, so the rate itself is the thing under test.

    it("draws 104 litres per day for four occupants", () => {
      expect(waterDrawnLitres(4, 86_400)).toBeCloseTo(104, 10);
    });

    it("scales with occupancy at 26 litres per person per day", () => {
      expect(waterDrawnLitres(1, 86_400)).toBeCloseTo(26, 10);
      expect(waterDrawnLitres(6, 86_400)).toBeCloseTo(156, 10);
      expect(waterDrawnLitres(0, 86_400)).toBe(0);
    });

    it("takes about fourteen minutes of real time to use one litre", () => {
      // 86400 / 104 ≈ 830.8 s ≈ 13m51s. A power tick is 2 s, so the level sensor
      // stays quiet for hundreds of ticks between publishes.
      expect(waterDrawnLitres(4, 831)).toBeCloseTo(1, 2);
      expect(waterDrawnLitres(4, 2)).toBeLessThan(0.01);
    });

    it("is not multiplied by the power time scale", () => {
      // If POWER_TIME_SCALE (300) still reached the water model, one 2 s tick would
      // consume ~0.72 L and a rounded litre would disappear roughly every other tick.
      const perTick = waterDrawnLitres(4, 2);
      expect(perTick * 300).toBeGreaterThan(0.5);
      expect(perTick).toBeLessThan(0.5);
    });

    it("keeps whole litres in place over a short interval while the battery still moves", async () => {
      const { state, send } = setup();
      const litresBefore = Number(state(BUNKER_DEVICE_KEYS.supplies).waterLitres);

      // Force a large power deficit so the battery is guaranteed to move, then run
      // 30 s of wall time — 15 power ticks.
      await send(BUNKER_COMMAND_TOPICS.lights, { on: true });
      await send(BUNKER_COMMAND_TOPICS.filter, { sealed: true });
      const batteryBefore = Number(state(BUNKER_DEVICE_KEYS.power).battery);
      vi.advanceTimersByTime(30_000);

      // Accelerated: 30 s of wall time is 2.5 simulated hours, so the bank moves.
      expect(Number(state(BUNKER_DEVICE_KEYS.power).battery)).not.toBe(batteryBefore);
      // Wall time: 30 s buys 0.036 L, so the published integer cannot have changed.
      expect(Number(state(BUNKER_DEVICE_KEYS.supplies).waterLitres)).toBe(litresBefore);
    });

    it("publishes no supplies message while no whole litre has been used", () => {
      const { published } = setup();
      const suppliesPublishes = () =>
        published.filter((p) => p.topic === BUNKER_STATE_TOPICS.supplies).length;
      const before = suppliesPublishes();

      vi.advanceTimersByTime(60_000);

      // The level sensor reports a rounded litre reading, and at 104 L/day a minute
      // has not produced one. This is the MQTT spam the spec set out to remove.
      expect(suppliesPublishes()).toBe(before);
    });
  });

  it("radio transmission is bounded", async () => {
    const { send, state } = setup();
    await send(BUNKER_COMMAND_TOPICS.radio, { tx: true });
    expect(state(BUNKER_DEVICE_KEYS.radio).tx).toBe(true);
    vi.advanceTimersByTime(1300);
    expect(state(BUNKER_DEVICE_KEYS.radio).tx).toBe(false);
  });

  it("rejects malformed actuator commands rather than guessing", async () => {
    const { send } = setup();
    expect(await send(BUNKER_COMMAND_TOPICS.lights, {})).toMatchObject({ accepted: false });
    expect(await send(BUNKER_COMMAND_TOPICS.filter, {})).toMatchObject({ accepted: false });
    expect(await send(BUNKER_COMMAND_TOPICS.generator, {})).toMatchObject({ accepted: false });
    expect(await send(BUNKER_COMMAND_TOPICS.radio, {})).toMatchObject({ accepted: false });
  });
});
