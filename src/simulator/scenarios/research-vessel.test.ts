import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

function logger(): Logger { const noop = (): void => undefined; return { info: noop, warn: noop, error: noop, debug: noop } as unknown as Logger; }
/**
 * `maxDelayMs` defaults to 0, which collapses every transition into a single tick.
 * Tests that need to observe a movement part-way through pass a real clamp so the
 * steps take time and can be interrupted.
 */
function setup(maxDelayMs = 0) {
  const published: Array<{ topic: string; payload: string }> = [];
  const registry = new SimulatorDeviceRegistry({ publish: (topic, payload) => published.push({ topic, payload }), logger: logger(), maxDelayMs });
  const faults = new FaultController({ maxDelayMs: 0, logger: logger() });
  const scenario = createResearchVesselScenario(); for (const definition of scenario.devices) registry.register(definition);
  const fire = async (name: string): Promise<void> => { const ctx: ScenarioStimulusContext = { stimulus: { name, payload: {}, meta: { eventId: "event-1", timestamp: 1, source: { kind: "automation" } }, receivedAt: 1 }, devices: registry, faults, logger: logger() }; await scenario.stimuli[name](ctx); };
  const last = (topic: string): Record<string, unknown> | undefined => { const entries = published.filter((entry) => entry.topic === topic); return entries.length ? JSON.parse(entries.at(-1)!.payload) as Record<string, unknown> : undefined; };
  const command = (topic: string, params: Record<string, unknown>): SimulatedInboundCommand => ({ topic, params, rawPayload: params, receivedAt: 1 });
  const send = async (topic: string, params: Record<string, unknown>) => await registry.getByCommandTopic(topic)!.model.onCommand!(command(topic, params));
  const state = (key: string): Record<string, unknown> => registry.get(key)!.controller.read() as Record<string, unknown>;
  const winchState = () => state(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch);
  const sondeState = () => state(RESEARCH_VESSEL_DEVICE_KEYS.ctdSonde);
  return { registry, scenario, fire, last, command, send, state, winchState, sondeState };
}

describe("research-vessel simulator scenario", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("registers exactly three acknowledgement-capable science actuators", () => {
    const { registry, scenario } = setup();
    expect(registry.getByCommandTopic(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch)?.definition.key).toBe(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch);
    expect(registry.getByCommandTopic(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle)?.definition.key).toBe(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle);
    expect(registry.getByCommandTopic(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump)?.definition.key).toBe(RESEARCH_VESSEL_DEVICE_KEYS.tsgPump);
    expect(scenario.devices.filter((device) => device.commandProfile?.acknowledgement.supported)).toHaveLength(3);
  });

  it("starts the CTD on deck rather than parked mid-water", () => {
    const { winchState, sondeState } = setup();
    expect(winchState().mode).toBe("on-deck");
    expect(winchState().on).toBe(false);
    expect(Number(sondeState().depth)).toBeLessThanOrEqual(5);
    expect(Number(sondeState().verticalSpeed)).toBe(0);
  });

  it("runs a CTD cast through simulator-owned depth progression and settles at depth", async () => {
    const { send, winchState, sondeState, last } = setup();
    const outcome = await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    expect(outcome).toMatchObject({ accepted: true });

    // The wire has to travel: accepting the command does not put the sonde at 420 m.
    expect(winchState().mode).toBe("deploying");
    expect(Number(sondeState().depth)).toBeLessThan(20);

    vi.advanceTimersByTime(9000);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.ctdSonde)).toMatchObject({ depth: 420, verticalSpeed: 0 });
    // At depth is a distinct resting phase from on deck; the next valid action differs.
    expect(winchState().mode).toBe("at-depth");
    expect(winchState().on).toBe(false);
  });

  it("takes longer to reach a deeper target, because the wire has one speed", async () => {
    const shallow = setup(400);
    await shallow.send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 60 });
    vi.advanceTimersByTime(900);
    expect(shallow.winchState().mode).toBe("at-depth");

    const deep = setup(400);
    await deep.send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    vi.advanceTimersByTime(900);
    expect(deep.winchState().mode).toBe("deploying");
  });

  it("reverses a descent into a recovery without requiring a hold first", async () => {
    const { send, winchState, sondeState } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    vi.advanceTimersByTime(1200);
    const partway = Number(sondeState().depth);
    expect(partway).toBeGreaterThan(20);
    expect(partway).toBeLessThan(420);

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "recover", targetDepth: 3 });
    expect(winchState().mode).toBe("recovering");
    expect(Number(winchState().rate)).toBeLessThan(0);

    vi.advanceTimersByTime(9000);
    expect(winchState().mode).toBe("on-deck");
    expect(Number(sondeState().depth)).toBeLessThanOrEqual(5);
    expect(Number(sondeState().verticalSpeed)).toBe(0);
  });

  it("distinguishes a mid-water pause from being back on deck", async () => {
    const { send, winchState } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    vi.advanceTimersByTime(1200);

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "hold" });
    expect(winchState().mode).toBe("holding");
    expect(winchState().on).toBe(false);
    expect(Number(winchState().rate)).toBe(0);

    // A pause must actually stop the wire, not merely relabel it.
    const pausedAt = Number(winchState().payOut);
    vi.advanceTimersByTime(9000);
    expect(Number(winchState().payOut)).toBeCloseTo(pausedAt, 5);
    expect(winchState().mode).toBe("holding");
  });

  it("resumes a paused descent to the original target", async () => {
    const { send, winchState, sondeState } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    vi.advanceTimersByTime(1200);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "hold" });
    const pausedAt = Number(sondeState().depth);

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    vi.advanceTimersByTime(9000);
    expect(Number(sondeState().depth)).toBe(420);
    expect(Number(sondeState().depth)).toBeGreaterThan(pausedAt);
    expect(winchState().mode).toBe("at-depth");
  });

  it("keeps sonde chemistry consistent with wherever the package actually is", async () => {
    const { send, sondeState } = setup();
    const onDeck = { ...sondeState() };
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    vi.advanceTimersByTime(9000);
    const atDepth = sondeState();
    // Deep water is colder and less oxygenated. Chemistry is never authored apart
    // from depth, so the two cannot drift into contradiction.
    expect(Number(atDepth.temperature)).toBeLessThan(Number(onDeck.temperature));
    expect(Number(atDepth.oxygen)).toBeLessThan(Number(onDeck.oxygen));
  });

  it("injects a CTD snag that stops the package while the drum keeps turning", async () => {
    const { send, fire, winchState, sondeState } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    vi.advanceTimersByTime(1200);
    const fouledAt = Number(sondeState().depth);

    await fire(RESEARCH_VESSEL_STIMULUS.ctdSnag);
    expect(winchState()).toMatchObject({ on: true, tension: 760 });
    // The load is in the wire because the package is no longer descending.
    vi.advanceTimersByTime(9000);
    expect(Number(sondeState().depth)).toBeCloseTo(fouledAt, 5);

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "hold" });
    expect(winchState()).toMatchObject({ on: false, mode: "holding", tension: 245 });
  });

  it("cancels wire movement on reset instead of letting it overwrite the restored state", async () => {
    const { send, fire, winchState, sondeState } = setup();
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { mode: "deploy", targetDepth: 420 });
    await fire(RESEARCH_VESSEL_STIMULUS.ctdReset);
    expect(winchState().mode).toBe("on-deck");

    vi.advanceTimersByTime(9000);
    expect(winchState().mode).toBe("on-deck");
    expect(Number(sondeState().depth)).toBeLessThanOrEqual(5);
  });

  it("starts the ROV well clear of the seabed, not almost on it", () => {
    const { state } = setup();
    const rov = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    expect(rov.mode).toBe("at-surface");
    expect(Number(rov.depth)).toBe(60);
    // Altitude is the seabed depth minus the vehicle depth, so it can never
    // contradict where the vehicle actually is.
    expect(Number(rov.altitude)).toBe(Number(rov.seabedDepth) - Number(rov.depth));
    expect(Number(rov.altitude)).toBeGreaterThan(300);
  });

  it("keeps depth and altitude coherent at every point of a dive", async () => {
    const { send, state } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 355 });
    const seabed = Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).seabedDepth);

    let lastDepth = 0;
    for (let step = 0; step < 8; step += 1) {
      vi.advanceTimersByTime(700);
      const rov = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
      const depth = Number(rov.depth);
      expect(Number(rov.altitude)).toBeCloseTo(seabed - depth, 1);
      // Descending means the number only ever goes one way.
      expect(depth).toBeGreaterThanOrEqual(lastDepth);
      lastDepth = depth;
    }

    vi.advanceTimersByTime(12000);
    const settled = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    expect(Number(settled.depth)).toBe(355);
    expect(settled.mode).toBe("on-station");
    expect(Number(settled.verticalSpeed)).toBe(0);
    // On station is above the bottom, not on it.
    expect(Number(settled.altitude)).toBeGreaterThan(20);
  });

  it("reports approaching the seabed before it arrives there", async () => {
    const { send, state } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 355 });
    const seen = new Set<string>();
    for (let step = 0; step < 24; step += 1) {
      vi.advanceTimersByTime(400);
      seen.add(String(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).mode));
    }
    expect([...seen]).toContain("diving");
    expect([...seen]).toContain("approaching-seabed");
    expect([...seen]).toContain("on-station");
  });

  it("refuses to fly the vehicle into the bottom", async () => {
    const { send, state } = setup();
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 900 });
    vi.advanceTimersByTime(20000);
    const rov = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    expect(Number(rov.depth)).toBeLessThan(Number(rov.seabedDepth));
    expect(Number(rov.altitude)).toBeGreaterThan(0);
  });

  it("aborts a descent straight into a recovery without a hold in between", async () => {
    const { send, state } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 355 });
    vi.advanceTimersByTime(1500);
    const partway = Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).depth);
    expect(partway).toBeGreaterThan(60);
    expect(partway).toBeLessThan(355);

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "recover", targetDepth: 60 });
    vi.advanceTimersByTime(20000);
    const rov = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    expect(Number(rov.depth)).toBe(60);
    expect(rov.mode).toBe("at-surface");
  });

  it("flies a bounded transect leg and returns to station", async () => {
    const { send, state } = setup();
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 355 });
    vi.advanceTimersByTime(12000);
    const before = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "survey" });
    expect(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).mode).toBe("surveying");

    vi.advanceTimersByTime(9000);
    const after = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    // A transect changes heading and spends battery; it must not quietly change depth.
    expect(after.mode).toBe("on-station");
    expect(Number(after.heading)).not.toBe(Number(before.heading));
    expect(Number(after.depth)).toBe(Number(before.depth));
    expect(Number(after.altitude)).toBe(Number(before.altitude));
    expect(Number(after.battery)).toBeLessThan(Number(before.battery));
    expect(Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle).transectLegs)).toBe(1);
  });

  it("models a deep cross-current whose load a station hold measurably relieves", async () => {
    const { send, fire, state } = setup();
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 355 });
    vi.advanceTimersByTime(12000);
    const calm = Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).tetherTension);

    await fire(RESEARCH_VESSEL_STIMULUS.rovCrossCurrent);
    const loaded = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    expect(Number(loaded.crossCurrentKt)).toBeGreaterThan(1);
    expect(Number(loaded.tetherTension)).toBeGreaterThan(650);
    expect(Number(loaded.tetherTension)).toBeGreaterThan(calm);
    // Visibility drops with the stirred sediment, from the same cause.
    expect(Number(loaded.visibility)).toBeLessThan(14);

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "hold" });
    const held = state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    // The load genuinely comes off, so the protective hold is verifiable rather
    // than cosmetic — and the current is still there.
    expect(held.mode).toBe("holding");
    expect(Number(held.verticalSpeed)).toBe(0);
    expect(Number(held.tetherTension)).toBeLessThan(650);
    expect(Number(held.crossCurrentKt)).toBeGreaterThan(1);
  });

  it("stops the vehicle where it is on a hold, and cancels movement on reset", async () => {
    const { send, fire, state } = setup(400);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 355 });
    vi.advanceTimersByTime(1500);
    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "hold" });
    const heldAt = Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).depth);

    vi.advanceTimersByTime(20000);
    expect(Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).depth)).toBeCloseTo(heldAt, 5);
    expect(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).mode).toBe("holding");

    await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "dive", targetDepth: 355 });
    await fire(RESEARCH_VESSEL_STIMULUS.rovReset);
    expect(Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).depth)).toBe(60);
    vi.advanceTimersByTime(20000);
    expect(Number(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).depth)).toBe(60);
    expect(state(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry).mode).toBe("at-surface");
  });

  it("rejects an unknown ROV mode rather than guessing", async () => {
    const { send } = setup();
    expect(await send(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "wander" })).toMatchObject({ accepted: false });
  });

  it("gives underway science a real pump and hydrographic-front progression", async () => {
    const { registry, fire, command, last } = setup(); const pump = registry.get(RESEARCH_VESSEL_DEVICE_KEYS.tsgPump)!;
    await pump.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump, { on: false })); expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ flow: 0 });
    await pump.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump, { on: true })); await fire(RESEARCH_VESSEL_STIMULUS.oceanFront);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ sst: 15.9, salinity: 34.72, chlorophyll: 2.5 });
  });
});
