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

/** Transition group for the ROV changing depth or flying a transect. */
const ROV_MOVE_GROUP = "rov-move";
/**
 * Depth of the seabed under the survey box, in metres.
 *
 * Everything vertical about the ROV is measured against this one number. The pane
 * used to place the vehicle from its altitude alone, which put it a few pixels off
 * the bottom no matter how shallow it actually was.
 */
const ROV_SEABED_DEPTH = 385;
/** Depth the vehicle is launched and recovered to, in metres. */
const ROV_LAUNCH_DEPTH = 60;
/** Depth the survey box is flown at, in metres. */
const ROV_SURVEY_DEPTH = 355;
/** Deepest the vehicle may be commanded, keeping it clear of the bottom. */
const ROV_MAX_DEPTH = 370;
/** Vertical speed of the vehicle, in metres per second. */
const ROV_SPEED_MPS = 0.5;
/** How much faster than reality the ROV demo runs. */
const ROV_TIME_SCALE = 60;
/** Tether load with the vehicle just below the surface and no current, in newtons. */
const ROV_TETHER_BASE = 210;
/** Added tether load per metre of depth, in newtons. */
const ROV_TETHER_PER_METRE = 0.28;
/** Added tether load per knot of cross-current while the vehicle is under way. */
const ROV_TETHER_PER_KNOT_UNDERWAY = 300;
/** Added tether load per knot once the vehicle stops fighting the current. */
const ROV_TETHER_PER_KNOT_HOLDING = 120;
/** Background cross-current in the survey box, in knots. */
const ROV_CURRENT_CALM = 0.2;
/** Cross-current the demo injects, in knots. */
const ROV_CURRENT_INJECTED = 1.4;

/**
 * Where the ROV is in its mission, as a phase.
 *
 * `at-surface` and `on-station` are both stationary, and `approaching-seabed` is a
 * descent that has run out of water beneath it — states an operator needs told
 * apart, which one "holding" cannot do.
 */
type RovPhase = "at-surface" | "diving" | "approaching-seabed" | "on-station" | "surveying" | "holding" | "recovering";

/**
 * Everything the water column implies at one vehicle depth.
 *
 * Depth is the only input. Altitude, tether load and visibility all fall out of it,
 * so no two of them can be animated into contradicting each other.
 */
function rovWater(depth: number, crossCurrentKt: number, stationKeeping: boolean): Record<string, number> {
  const safe = Math.max(0, Math.min(ROV_SEABED_DEPTH, depth));
  // A vehicle holding station is not dragging the tether across the current, so
  // the load genuinely comes off — that relief is what makes a protective hold
  // verifiable rather than cosmetic.
  const perKnot = stationKeeping ? ROV_TETHER_PER_KNOT_HOLDING : ROV_TETHER_PER_KNOT_UNDERWAY;
  // Altitude is derived from the *published* depth, not the raw one, so the two
  // readings agree exactly rather than to within a rounding step.
  const published = Math.round(safe * 10) / 10;
  return {
    depth: published,
    altitude: Math.round((ROV_SEABED_DEPTH - published) * 10) / 10,
    tetherTension: Math.round(ROV_TETHER_BASE + published * ROV_TETHER_PER_METRE + crossCurrentKt * perKnot),
    // Daylight runs out with depth and stirred sediment cuts it further.
    visibility: Math.round(Math.max(4, 18 - published / 60 - crossCurrentKt * 4) * 10) / 10,
  };
}

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
  rovVehicle: { on: true, mode: "at-surface" as RovPhase, targetDepth: ROV_SURVEY_DEPTH, lights: true, thrusterPct: 12, transectLegs: 0 },
  // Altitude is not authored here: it is derived from the seabed depth and the
  // vehicle's depth, so the two readings can never disagree.
  rovTelemetry: { ...rovWater(ROV_LAUNCH_DEPTH, ROV_CURRENT_CALM, false), heading: 88, battery: 78, verticalSpeed: 0, mode: "at-surface" as RovPhase, seabedDepth: ROV_SEABED_DEPTH, crossCurrentKt: ROV_CURRENT_CALM },
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
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle)?.cancelTransitions(ROV_MOVE_GROUP);
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovVehicle)?.update({ ...INITIAL.rovVehicle }, { forcePublish: true });
    this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry)?.update({ ...INITIAL.rovTelemetry }, { forcePublish: true });
  }

  /** Battery falls with work done; it never climbs back on its own. */
  private drainRovBattery(telemetry: SimulatedStateController, amount: number): number {
    return Math.round(Math.max(8, Number(telemetry.read().battery ?? 78) - amount) * 10) / 10;
  }

  /** The phase the vehicle rests in once it stops at `depth`. */
  private rovRestingPhase(depth: number): RovPhase {
    return depth <= ROV_LAUNCH_DEPTH + 20 ? "at-surface" : "on-station";
  }

  private rovCurrent(telemetry: SimulatedStateController): number {
    const value = Number(telemetry.read().crossCurrentKt);
    return Number.isFinite(value) ? value : ROV_CURRENT_CALM;
  }

  moveRov(vehicle: SimulatedStateController, mode: "dive" | "recover", targetDepth: number): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    if (!telemetry) return;
    const start = Number(telemetry.read().depth ?? ROV_LAUNCH_DEPTH);
    const target = mode === "recover"
      ? ROV_LAUNCH_DEPTH
      : Math.max(ROV_LAUNCH_DEPTH, Math.min(ROV_MAX_DEPTH, targetDepth));
    const direction = target >= start ? 1 : -1;
    const durationMs = Math.max(700, Math.round(Math.abs(target - start) / ROV_SPEED_MPS * 1000 / ROV_TIME_SCALE));
    const underway: RovPhase = mode === "dive" ? "diving" : "recovering";
    const current = this.rovCurrent(telemetry);
    vehicle.update({ on: true, mode: underway, targetDepth: target, thrusterPct: 44 }, { forcePublish: true });

    vehicle.transition({
      durationMs,
      steps: 16,
      group: ROV_MOVE_GROUP,
      frame: (progress) => {
        const depth = start + (target - start) * progress;
        const arrived = progress >= 1;
        // Running out of water beneath you is worth saying out loud, and it is a
        // fact about depth rather than a separate flag someone has to maintain.
        const phase: RovPhase = arrived
          ? this.rovRestingPhase(depth)
          : underway === "diving" && ROV_SEABED_DEPTH - depth <= 60
            ? "approaching-seabed"
            : underway;
        telemetry.update({
          ...rovWater(depth, current, false),
          mode: phase,
          verticalSpeed: arrived ? 0 : Math.round(direction * ROV_SPEED_MPS * 10) / 10,
          battery: this.drainRovBattery(telemetry, 0.3),
        }, { forcePublish: true });
        return arrived ? { mode: phase, thrusterPct: 16 } : {};
      },
    });
  }

  /**
   * Fly one transect leg.
   *
   * A leg is bounded rather than an open-ended mode, so the vehicle ends back on
   * station with a completed leg behind it instead of a survey that never finishes
   * and a timer that never stops.
   */
  surveyRov(vehicle: SimulatedStateController): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    if (!telemetry) return;
    const startHeading = Number(telemetry.read().heading ?? 88);
    const depth = Number(telemetry.read().depth ?? ROV_SURVEY_DEPTH);
    const current = this.rovCurrent(telemetry);
    vehicle.update({ mode: "surveying", thrusterPct: 34, lights: true }, { forcePublish: true });
    telemetry.update({ mode: "surveying", verticalSpeed: 0 }, { forcePublish: true });

    vehicle.transition({
      durationMs: 6400,
      steps: 16,
      group: ROV_MOVE_GROUP,
      frame: (progress) => {
        const done = progress >= 1;
        telemetry.update({
          // The vehicle flies a line at constant altitude; only its heading and
          // battery move, so depth and altitude stay coherent throughout.
          ...rovWater(depth, current, false),
          heading: Math.round((startHeading + 34 * progress) % 360),
          mode: done ? this.rovRestingPhase(depth) : "surveying",
          verticalSpeed: 0,
          battery: this.drainRovBattery(telemetry, 0.5),
        }, { forcePublish: true });
        return done
          ? { mode: this.rovRestingPhase(depth), thrusterPct: 16, transectLegs: Number(vehicle.read().transectLegs ?? 0) + 1 }
          : {};
      },
    });
  }

  holdRov(vehicle: SimulatedStateController): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    if (!telemetry) return;
    vehicle.cancelTransitions(ROV_MOVE_GROUP);
    const depth = Number(telemetry.read().depth ?? ROV_LAUNCH_DEPTH);
    const current = this.rovCurrent(telemetry);
    vehicle.update({ mode: "holding", targetDepth: Math.round(depth * 10) / 10, thrusterPct: 26 }, { forcePublish: true });
    telemetry.update({
      // Station keeping takes the drag off the tether, so the load measurably
      // falls. That relief is the observation a protective hold is verified by.
      ...rovWater(depth, current, true),
      mode: "holding",
      verticalSpeed: 0,
    }, { forcePublish: true });
  }

  rovCrossCurrent(): void {
    const telemetry = this.controller(RESEARCH_VESSEL_DEVICE_KEYS.rovTelemetry);
    if (!telemetry) return;
    const depth = Number(telemetry.read().depth ?? ROV_LAUNCH_DEPTH);
    const holding = String(telemetry.read().mode || "at-surface") === "holding";
    // The current is the physical cause; the tether load, the heading offset and the
    // lost visibility all follow from it rather than being written independently.
    telemetry.update({
      crossCurrentKt: ROV_CURRENT_INJECTED,
      ...rovWater(depth, ROV_CURRENT_INJECTED, holding),
      heading: Math.round((Number(telemetry.read().heading ?? 88) + 28) % 360),
    }, { forcePublish: true });
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
    // As with the winch, the resulting-state patch is left unused: every phase and
    // reading is written by the movement itself, so nothing is reported that has not
    // physically happened.
    if (mode === "dive" || mode === "recover") {
      env.moveRov(ctx.state, mode, Number.isFinite(target) ? target : mode === "dive" ? ROV_SURVEY_DEPTH : ROV_LAUNCH_DEPTH);
      return { accepted: true };
    }
    if (mode === "survey") { env.surveyRov(ctx.state); return { accepted: true }; }
    if (mode === "hold") { env.holdRov(ctx.state); return { accepted: true }; }
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
