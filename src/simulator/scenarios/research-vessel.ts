import type {
  AnyDeviceDefinition,
  DeviceModelFactoryContext,
  SimulatedInboundCommand,
  SimulatedCommandOutcome,
  SimulatedState,
  SimulatedStateController,
  SimulatorScenario,
} from "../types.js";

export const RESEARCH_VESSEL_SCENARIO_KEY = "research-vessel";

export const RESEARCH_VESSEL_DEVICE_KEYS = {
  ctdWinch: "vessel-ctd-winch",
  ctdSonde: "vessel-ctd-sonde",
  rovVehicle: "vessel-rov-vehicle",
  rovTelemetry: "vessel-rov-telemetry",
  tsgPump: "vessel-tsg-pump",
  tsg: "vessel-tsg",
} as const;

export const RESEARCH_VESSEL_STATE_TOPICS = {
  ctdWinch: "switch/vessel/ctd-winch/state",
  ctdSonde: "sensor/ctd/sonde",
  rovVehicle: "switch/rov/vehicle/state",
  rovTelemetry: "sensor/rov/telemetry",
  tsgPump: "switch/vessel/tsg-pump/state",
  tsg: "sensor/underway/tsg",
} as const;

export const RESEARCH_VESSEL_COMMAND_TOPICS = {
  ctdWinch: "switch/vessel/ctd-winch/set",
  rovVehicle: "switch/rov/vehicle/set",
  tsgPump: "switch/vessel/tsg-pump/set",
} as const;

export const RESEARCH_VESSEL_STIMULUS = {
  ctdSnag: "vessel/sim/ctd-snag",
  ctdReset: "vessel/sim/ctd-reset",
  rovCrossCurrent: "vessel/sim/rov-cross-current",
  rovReset: "vessel/sim/rov-reset",
  oceanFront: "vessel/sim/ocean-front",
  underwayReset: "vessel/sim/underway-reset",
  reset: "vessel/sim/reset",
} as const;

/** Transition group for the CTD winch paying out or hauling in. */
const CTD_WINCH_GROUP = "ctd-winch";
/** Depth the sonde sits at when it is out of the water, in metres. */
const CTD_DECK_DEPTH = 3;
/** Deepest the wire can go, in metres. */
const CTD_MAX_DEPTH = 480;
/** Wire speed, in metres per second. */
const CTD_SPEED_MPS = 0.9;
/**
 * How much faster than reality the demo runs.
 *
 * A 420 m cast at 0.9 m/s is nearly eight minutes of wire, which no one is going
 * to watch. Scaling time rather than speed keeps the relationship honest: a deeper
 * cast still takes proportionally longer, so depth and duration cannot disagree.
 */
const CTD_TIME_SCALE = 90;
/** Wire tension with nothing hanging on it, in newtons. */
const CTD_TENSION_ON_DECK = 220;
/** Wire tension holding the package still in the water, in newtons. */
const CTD_TENSION_HELD = 245;
/** Wire tension while the drum is turning, in newtons. */
const CTD_TENSION_HAULING = 265;
/** Wire tension when the package has fouled, in newtons. */
const CTD_TENSION_SNAG = 760;

/**
 * Where the wire is, as a phase rather than a boolean.
 *
 * `on-deck` and `at-depth` are both "the winch is not turning", but they are not
 * the same situation: the valid next action differs, and collapsing them into one
 * "holding" state is what made Hold look like a required step between deploying
 * and recovering.
 */
type CtdPhase = "on-deck" | "deploying" | "at-depth" | "recovering" | "holding";

function ctdWater(depth: number): Record<string, number> {
  const safe = Math.max(0, Math.min(500, depth));
  const temperature = 18.5 - 14.3 / (1 + Math.exp(-(safe - 90) / 18));
  const salinity = 35.0 - 0.4 / (1 + Math.exp(-(safe - 90) / 40));
  const oxygen = 6.3 - Math.min(2.0, safe / 420);
  return {
    depth: Math.round(safe * 10) / 10,
    temperature: Math.round(temperature * 100) / 100,
    salinity: Math.round(salinity * 1000) / 1000,
    oxygen: Math.round(oxygen * 100) / 100,
    conductivity: 4.21,
  };
}

const INITIAL = {
  ctdWinch: { on: false, mode: "on-deck" as CtdPhase, payOut: CTD_DECK_DEPTH, rate: 0, tension: CTD_TENSION_ON_DECK, targetDepth: 420 },
  // Chemistry is never authored separately from depth: the sonde reads whatever
  // the water column holds where it is, including sitting on deck.
  ctdSonde: { ...ctdWater(CTD_DECK_DEPTH), verticalSpeed: 0 },
  rovVehicle: { on: true, mode: "holding", targetDepth: 310, lights: true, thrusterPct: 18 },
  rovTelemetry: { depth: 310, heading: 88, battery: 78, tetherTension: 310, altitude: 8.2, visibility: 14, mode: "holding" },
  tsgPump: { on: true },
  tsg: { sst: 18.4, salinity: 35.2, flow: 2.1, chlorophyll: 0.8, turbidity: 0.5 },
};

class VesselEnvironment {
  private readonly controllers = new Map<string, SimulatedStateController>();

  register(key: string, controller: SimulatedStateController): void { this.controllers.set(key, controller); }
  controller(key: string): SimulatedStateController | undefined { return this.controllers.get(key); }
  reset(): void { this.resetCtd(); this.resetRov(); this.resetUnderway(); }

  resetCtd(): void {
    // Stop the wire before restoring it, or the movement in flight would keep
    // writing over the state this reset is putting back.
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch)?.cancelTransitions(CTD_WINCH_GROUP);
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch)?.update({ ...INITIAL.ctdWinch }, { forcePublish: true });
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.ctdSonde)?.update({ ...INITIAL.ctdSonde }, { forcePublish: true });
  }

  /** The phase the wire rests in once it stops at `depth`. */
  private ctdRestingPhase(depth: number): CtdPhase {
    return depth <= CTD_DECK_DEPTH + 2 ? "on-deck" : "at-depth";
  }

  /**
   * Pay out or haul in. Starting a move replaces any move already running, because
   * both share one transition group — so an operator can reverse direction without
   * being made to press Hold first.
   */
  moveCtd(winch: SimulatedStateController, mode: "deploy" | "recover", targetDepth: number): void {
    const sonde = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.ctdSonde);
    if (!sonde) return;
    const start = Number(sonde.read().depth ?? CTD_DECK_DEPTH);
    const target = mode === "recover"
      ? CTD_DECK_DEPTH
      : Math.max(CTD_DECK_DEPTH, Math.min(CTD_MAX_DEPTH, targetDepth));
    const direction = target >= start ? 1 : -1;
    const durationMs = Math.max(600, Math.round(Math.abs(target - start) / CTD_SPEED_MPS * 1000 / CTD_TIME_SCALE));
    const phase: CtdPhase = mode === "deploy" ? "deploying" : "recovering";
    winch.update({
      on: true,
      mode: phase,
      targetDepth: target,
      rate: direction * CTD_SPEED_MPS,
      tension: CTD_TENSION_HAULING,
    }, { forcePublish: true });

    winch.transition({
      durationMs,
      steps: 16,
      group: CTD_WINCH_GROUP,
      frame: (progress) => {
        const depth = start + (target - start) * progress;
        const arrived = progress >= 1;
        // The sonde is the instrument; the winch only knows how much wire is out.
        // Both are written from the same position so they cannot contradict.
        sonde.update({
          ...ctdWater(depth),
          verticalSpeed: arrived ? 0 : direction * CTD_SPEED_MPS,
        }, { forcePublish: true });
        return {
          payOut: Math.round(depth * 10) / 10,
          ...(arrived
            ? { on: false, rate: 0, mode: this.ctdRestingPhase(depth), tension: depth <= CTD_DECK_DEPTH + 2 ? CTD_TENSION_ON_DECK : CTD_TENSION_HELD }
            : {}),
        };
      },
    });
  }

  /** Arrest the wire where it is, whether an operator asked or the interlock did. */
  holdCtd(winch: SimulatedStateController): void {
    winch.cancelTransitions(CTD_WINCH_GROUP);
    const sonde = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.ctdSonde);
    const depth = Math.round(Number(sonde?.read().depth ?? CTD_DECK_DEPTH) * 10) / 10;
    const onDeck = depth <= CTD_DECK_DEPTH + 2;
    winch.update({
      on: false,
      // Paused in the water column is a real state with its own next actions;
      // stopped on deck is simply back where it started.
      mode: onDeck ? "on-deck" : "holding",
      payOut: depth,
      rate: 0,
      tension: onDeck ? CTD_TENSION_ON_DECK : CTD_TENSION_HELD,
    }, { forcePublish: true });
    sonde?.update({ verticalSpeed: 0 }, { forcePublish: true });
  }

  snagCtd(): void {
    const winch = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch);
    const sonde = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.ctdSonde);
    if (!winch || !sonde) return;
    // The package has fouled: it stops descending while the drum keeps turning, so
    // the load goes into the wire. Cancelling the movement *is* the snag — there is
    // no separate "snagged" flag for the automation to trust.
    winch.cancelTransitions(CTD_WINCH_GROUP);
    winch.update({ on: true, mode: "deploying", rate: 0.15, tension: CTD_TENSION_SNAG }, { forcePublish: true });
    sonde.update({ verticalSpeed: 0.05 }, { forcePublish: true });
  }

  resetRov(): void {
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle)?.update({ ...INITIAL.rovVehicle }, { forcePublish: true });
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry)?.update({ ...INITIAL.rovTelemetry }, { forcePublish: true });
  }

  moveRov(vehicle: SimulatedStateController, mode: "dive" | "recover", targetDepth: number): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry); if (!telemetry) return;
    const start = Number(telemetry.read().depth ?? 310); const target = Math.max(20, Math.min(430, targetDepth)); const name = mode === "dive" ? "diving" : "recovering";
    vehicle.update({ on: true, mode: name, targetDepth: target, thrusterPct: 42 });
    [0.3, 0.62, 1].forEach((fraction, index) => {
      const depth = start + (target - start) * fraction; const delayMs = [550, 1300, 2300][index];
      telemetry.update({ depth: Math.round(depth), mode: index === 2 ? "holding" : name, battery: Math.max(10, Number(telemetry.read().battery ?? 78) - (index + 1) * 0.4), altitude: Math.max(5.5, 10 - depth / 100), tetherTension: 320 + Math.round(depth * 0.28) }, { delayMs });
      if (index === 2) vehicle.update({ mode: "holding", targetDepth: target, thrusterPct: 20 }, { delayMs: delayMs + 40 });
    });
  }

  surveyRov(vehicle: SimulatedStateController): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry); if (!telemetry) return;
    vehicle.update({ mode: "survey", thrusterPct: 36, lights: true });
    telemetry.update({ mode: "surveying", heading: 96, altitude: 6.4, tetherTension: 390, battery: Math.max(10, Number(telemetry.read().battery ?? 78) - 0.5) });
    telemetry.update({ heading: 104, altitude: 6.1, battery: Math.max(10, Number(telemetry.read().battery ?? 78) - 1.2) }, { delayMs: 1600 });
  }

  holdRov(vehicle: SimulatedStateController): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry); if (!telemetry) return;
    vehicle.update({ mode: "holding", targetDepth: Number(telemetry.read().depth ?? 310), thrusterPct: 26 });
    telemetry.update({ mode: "holding", tetherTension: 420, heading: 92 });
  }

  rovCrossCurrent(): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry); if (!telemetry) return;
    telemetry.update({ tetherTension: 735, heading: Number(telemetry.read().heading ?? 88) + 28, visibility: 9, mode: String(telemetry.read().mode || "holding") }, { forcePublish: true });
  }

  resetUnderway(): void {
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.tsgPump)?.update({ ...INITIAL.tsgPump }, { forcePublish: true });
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.tsg)?.update({ ...INITIAL.tsg }, { forcePublish: true });
  }

  setTsgPump(on: boolean): void {
    const tsg = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.tsg); if (!tsg) return;
    tsg.update({ flow: on ? 2.1 : 0 }, { delayMs: 120 });
  }

  oceanFront(): void {
    const tsg = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.tsg); if (!tsg || Number(tsg.read().flow ?? 0) <= 0.2) return;
    tsg.update({ sst: 17.8, salinity: 35.05, chlorophyll: 1.1, turbidity: 0.7 }, { delayMs: 250 });
    tsg.update({ sst: 16.8, salinity: 34.86, chlorophyll: 1.8, turbidity: 1.0 }, { delayMs: 850 });
    tsg.update({ sst: 15.9, salinity: 34.72, chlorophyll: 2.5, turbidity: 1.3 }, { delayMs: 1500 });
  }
}

function sensorDefinition(key: string, name: string, stateTopic: string, initialState: SimulatedState, env: VesselEnvironment): AnyDeviceDefinition {
  return { key, name, stateTopic, initialState, createModel: (ctx) => { env.register(ctx.key, ctx.state); return { getState: () => ctx.state.read() }; } };
}

function commandDefinition(
  key: string,
  name: string,
  stateTopic: string,
  commandTopic: string,
  initialState: SimulatedState,
  env: VesselEnvironment,
  onCommand: (ctx: DeviceModelFactoryContext, command: SimulatedInboundCommand) => SimulatedCommandOutcome | Promise<SimulatedCommandOutcome>,
): AnyDeviceDefinition {
  return {
    key, name, stateTopic, commandTopic, initialState,
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => { env.register(ctx.key, ctx.state); return { getState: () => ctx.state.read(), onCommand: (command) => onCommand(ctx, command) }; },
  };
}

export function createResearchVesselScenario(): SimulatorScenario {
  const env = new VesselEnvironment();

  const ctdWinch = commandDefinition(RESEARCH_VESSEL_DEVICE_KEYS.ctdWinch, "CTD Winch", RESEARCH_VESSEL_STATE_TOPICS.ctdWinch, RESEARCH_VESSEL_COMMAND_TOPICS.ctdWinch, { ...INITIAL.ctdWinch }, env, (ctx, command) => {
    const mode = String(command.params.mode || ""); const target = Number(command.params.targetDepth);
    // The runtime's resulting-state patch is deliberately unused: every phase and
    // tension value below is written by the movement itself, so the wire's reported
    // state is always something that physically happened rather than something the
    // command asserted on acceptance.
    if (mode === "hold") { env.holdCtd(ctx.state); return { accepted: true }; }
    if (mode !== "deploy" && mode !== "recover") return { accepted: false, error: "ctd-winch mode must be deploy|recover|hold" };
    const safeTarget = Number.isFinite(target) ? target : mode === "deploy" ? 420 : CTD_DECK_DEPTH;
    env.moveCtd(ctx.state, mode, safeTarget);
    return { accepted: true };
  });

  const rovVehicle = commandDefinition(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle, "ROV Vehicle Controller", RESEARCH_VESSEL_STATE_TOPICS.rovVehicle, RESEARCH_VESSEL_COMMAND_TOPICS.rovVehicle, { ...INITIAL.rovVehicle }, env, (ctx, command) => {
    const mode = String(command.params.mode || ""); const target = Number(command.params.targetDepth);
    if (mode === "dive" || mode === "recover") { env.moveRov(ctx.state, mode, Number.isFinite(target) ? target : mode === "dive" ? 360 : 25); return { accepted: true, state: { patch: { on: true, mode: mode === "dive" ? "diving" : "recovering", targetDepth: target } } }; }
    if (mode === "survey") { env.surveyRov(ctx.state); return { accepted: true, state: { patch: { mode: "survey", thrusterPct: 36 } } }; }
    if (mode === "hold") { env.holdRov(ctx.state); return { accepted: true, state: { patch: { mode: "holding", thrusterPct: 26 } } }; }
    return { accepted: false, error: "rov mode must be dive|survey|hold|recover" };
  });

  const tsgPump = commandDefinition(RESEARCH_VESSEL_DEVICE_KEYS.tsgPump, "Flow-through Seawater Pump", RESEARCH_VESSEL_STATE_TOPICS.tsgPump, RESEARCH_VESSEL_COMMAND_TOPICS.tsgPump, { ...INITIAL.tsgPump }, env, (_ctx, command) => {
    if (typeof command.params.on !== "boolean") return { accepted: false, error: "tsg-pump requires boolean on" };
    env.setTsgPump(command.params.on); return { accepted: true, state: { patch: { on: command.params.on } } };
  });

  return {
    key: RESEARCH_VESSEL_SCENARIO_KEY,
    devices: [
      ctdWinch,
      sensorDefinition(RESEARCH_VESSEL_DEVICE_KEYS.ctdSonde, "CTD Sonde", RESEARCH_VESSEL_STATE_TOPICS.ctdSonde, { ...INITIAL.ctdSonde }, env),
      rovVehicle,
      sensorDefinition(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry, "ROV Telemetry", RESEARCH_VESSEL_STATE_TOPICS.rovTelemetry, { ...INITIAL.rovTelemetry }, env),
      tsgPump,
      sensorDefinition(RESEARCH_VESSEL_DEVICE_KEYS.tsg, "Underway TSG", RESEARCH_VESSEL_STATE_TOPICS.tsg, { ...INITIAL.tsg }, env),
    ],
    stimuli: {
      [RESEARCH_VESSEL_STIMULUS.ctdSnag]: () => env.snagCtd(),
      [RESEARCH_VESSEL_STIMULUS.ctdReset]: () => env.resetCtd(),
      [RESEARCH_VESSEL_STIMULUS.rovCrossCurrent]: () => env.rovCrossCurrent(),
      [RESEARCH_VESSEL_STIMULUS.rovReset]: () => env.resetRov(),
      [RESEARCH_VESSEL_STIMULUS.oceanFront]: () => env.oceanFront(),
      [RESEARCH_VESSEL_STIMULUS.underwayReset]: () => env.resetUnderway(),
      [RESEARCH_VESSEL_STIMULUS.reset]: () => env.reset(),
    },
  };
}
