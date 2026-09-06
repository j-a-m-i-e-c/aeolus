import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { SimulatorDeviceRegistry } from "../device-registry.js";
import { FaultController } from "../fault-controller.js";
import type { ScenarioStimulusContext, SimulatedInboundCommand } from "../types.js";
import {
  BUNKER_COMMAND_TOPICS,
  BUNKER_DEVICE_KEYS,
  BUNKER_STIMULUS,
  createOffGridBunkerScenario,
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

  it("walks contacts in from the treeline instead of materialising them at the fence", async () => {
    const { fire, perimeter } = setup(200);
    await fire(BUNKER_STIMULUS.shuffle);
    // They start at the treeline, outside the alert ring, so nothing is raised yet.
    expect(Number(perimeter().rangeM)).toBeGreaterThan(Number(perimeter().detectRangeM));
    expect(Number(perimeter().contacts)).toBe(0);
    expect(perimeter().movement).toBe("approaching");

    let closest = Number(perimeter().rangeM);
    for (let step = 0; step < 6; step += 1) {
      vi.advanceTimersByTime(400);
      const range = Number(perimeter().rangeM);
      expect(range).toBeLessThanOrEqual(closest);
      closest = range;
    }
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
    // They are still out there; they are simply no longer worth raising.
    expect(Number(gone.ambientContacts)).toBeGreaterThan(0);
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

  it("models low reserve then generator recovery", async () => {
    const { fire, send, state } = setup();
    await fire(BUNKER_STIMULUS.lowPower);
    expect(state(BUNKER_DEVICE_KEYS.power).battery).toBe(27);
    expect((await send(BUNKER_COMMAND_TOPICS.generator, { on: true })).accepted).toBe(true);
    vi.advanceTimersByTime(1900);
    expect(state(BUNKER_DEVICE_KEYS.power).battery).toBe(31);
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
