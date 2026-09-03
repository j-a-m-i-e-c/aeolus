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

  it("models a deep ROV cross-current and protective vehicle hold", async () => {
    const { registry, fire, command, last } = setup(); await fire(RESEARCH_VESSEL_STIMULUS.rovCrossCurrent);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.rovTelemetry)).toMatchObject({ tetherTension: 735 });
    await registry.get(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle)!.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { mode: "hold", targetDepth: 310 }));
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.rovTelemetry)).toMatchObject({ mode: "holding", tetherTension: 420 });
  });

  it("gives underway science a real pump and hydrographic-front progression", async () => {
    const { registry, fire, command, last } = setup(); const pump = registry.get(RESEARCH_VESSEL_DEVICE_KEYS.tsgPump)!;
    await pump.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump, { on: false })); expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ flow: 0 });
    await pump.model.onCommand!(command(RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump, { on: true })); await fire(RESEARCH_VESSEL_STIMULUS.oceanFront);
    expect(last(RESEARCH_VESSEL_STATE_TOPICS.tsg)).toMatchObject({ sst: 15.9, salinity: 34.72, chlorophyll: 2.5 });
  });
});
