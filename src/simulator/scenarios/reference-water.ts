// src/simulator/scenarios/reference-water.ts
// phase-2-mqtt-simulator Task 7 — the reference water-transfer scenario.
//
// This is an integration FIXTURE that proves the Phase 1 + Phase 2 contracts
// end to end. It is NOT a public showcase tab (Req 8.9). A source tank drains
// into a header tank via a transfer pump; a flow sensor independently observes
// the transfer so an automation can require an OBSERVED-tier command.
//
// Topic convention (resolves the command-topic derivation exactly): actuators
// publish on ".../state" and Aeolus derives the command topic by replacing the
// last segment with "set" — so the pump's simulator command topic
// "switch/reference-water/transfer-pump/set" matches Aeolus with no commandTopic
// API needed.

import type {
  AnyDeviceDefinition,
  DeviceModelFactoryContext,
  SimulatedDeviceModel,
  SimulatedStateController,
  SimulatorScenario,
} from "../types.js";

export const REFERENCE_WATER_SCENARIO_KEY = "reference-water";

/** Simulator-local device keys. */
export const DEVICE_KEYS = {
  sourceTank: "source-tank",
  headerTank: "header-tank",
  pump: "transfer-pump",
  flow: "flow",
} as const;

/** Canonical MQTT state topics. */
export const STATE_TOPICS = {
  sourceTank: "sensor/reference-water/source-tank",
  headerTank: "sensor/reference-water/header-tank",
  pump: "switch/reference-water/transfer-pump/state",
  flow: "sensor/reference-water/flow",
} as const;

/** Pump command topic (matches Aeolus's derivation from the pump state topic). */
export const PUMP_COMMAND_TOPIC = "switch/reference-water/transfer-pump/set";

/** Aeolus device ids (state-topic segments joined with "-"). */
export const AEOLUS_DEVICE_IDS = {
  sourceTank: "sensor-reference-water-source-tank",
  headerTank: "sensor-reference-water-header-tank",
  pump: "switch-reference-water-transfer-pump-state",
  flow: "sensor-reference-water-flow",
} as const;

/** Scenario stimulus event names (Phase 1-valid). */
export const STIMULUS = {
  tankLow: "reference-water.tank-low",
  reset: "reference-water.reset",
  rejectNextPump: "reference-water.reject-next-pump",
  dropNextPumpAck: "reference-water.drop-next-pump-ack",
  suppressNextFlow: "reference-water.suppress-next-flow",
  mismatchNextPumpState: "reference-water.mismatch-next-pump-state",
} as const;

const HEADER_TANK_CAPACITY_L = 5000;
const SOURCE_TANK_CAPACITY_L = 60000;

interface TankState {
  levelPct: number;
  litres: number;
}
interface PumpState {
  on: boolean;
  running: boolean;
}
interface FlowState {
  litresPerMinute: number;
}

/**
 * The coherent state every device starts in, and returns to on `reference-water.reset`.
 *
 * Exported because it is the observable definition of "this scenario is freshly
 * started": the integration harness gates setup on the Aeolus registry reporting
 * exactly these values, which is what makes a shared broker safe between tests.
 * Changing a value here requires no harness change, but DOES change what that gate
 * waits for.
 */
export const INITIAL_STATE = {
  sourceTank: { levelPct: 80, litres: 48000 } as TankState,
  headerTank: { levelPct: 60, litres: 3000 } as TankState,
  pump: { on: false, running: false } as PumpState,
  flow: { litresPerMinute: 0 } as FlowState,
};

function litresFor(levelPct: number, capacity: number): number {
  return Math.round((levelPct / 100) * capacity);
}

export interface ReferenceWaterOptions {
  /** Transfer rate reported by the flow sensor while the pump runs. */
  flowRateLpm?: number;
  /** Header-tank level percentage points added per pump-on command. */
  refillPct?: number;
  /** Source-tank level percentage points removed per pump-on command. */
  drainPct?: number;
  /**
   * Delay (ms) applied to the flow observation so it is published strictly
   * AFTER the (immediate) ACK. This models real hardware — a pump acknowledges
   * the command first, and the independent flow sensor only reports the physical
   * transfer a moment later — and makes the observed-tier lifecycle genuine:
   * DISPATCHED → ACKNOWLEDGED (on the ack) → OBSERVED (on the later flow report),
   * rather than reaching OBSERVED off an ack that smuggled the state.
   */
  observationDelayMs?: number;
  /** Optional ACK delay (ms), used by fault/timeout tests. Default 0 (immediate ACK). */
  ackDelayMs?: number;
}

/**
 * Shared scenario environment: captures each device's state controller as the
 * registry builds the models, so the pump model can drive the flow and tank
 * sensors. Holds a one-shot "suppress next flow" flag armed by a stimulus.
 */
class ReferenceWaterEnvironment {
  private readonly controllers = new Map<string, SimulatedStateController>();
  suppressNextFlow = false;

  register(key: string, controller: SimulatedStateController): void {
    this.controllers.set(key, controller);
  }

  private controller(key: string): SimulatedStateController | undefined {
    return this.controllers.get(key);
  }

  resetAll(): void {
    this.controller(DEVICE_KEYS.sourceTank)?.update({ ...INITIAL_STATE.sourceTank }, { forcePublish: true });
    this.controller(DEVICE_KEYS.headerTank)?.update({ ...INITIAL_STATE.headerTank }, { forcePublish: true });
    this.controller(DEVICE_KEYS.pump)?.update({ ...INITIAL_STATE.pump }, { forcePublish: true });
    this.controller(DEVICE_KEYS.flow)?.update({ ...INITIAL_STATE.flow }, { forcePublish: true });
    this.suppressNextFlow = false;
  }

  lowerHeaderTank(): void {
    this.controller(DEVICE_KEYS.headerTank)?.update({ levelPct: 25, litres: litresFor(25, HEADER_TANK_CAPACITY_L) });
  }

  /** Apply the pump's physical effect to the flow and tank sensors. */
  applyPump(on: boolean, options: Required<Pick<ReferenceWaterOptions, "flowRateLpm" | "refillPct" | "drainPct" | "observationDelayMs">>): void {
    const flow = this.controller(DEVICE_KEYS.flow);
    if (!on) {
      flow?.update({ litresPerMinute: 0 });
      return;
    }

    const header = this.controller(DEVICE_KEYS.headerTank);
    const source = this.controller(DEVICE_KEYS.sourceTank);

    if (header) {
      const currentPct = Number(header.read().levelPct) || 0;
      const levelPct = Math.min(100, currentPct + options.refillPct);
      header.update({ levelPct, litres: litresFor(levelPct, HEADER_TANK_CAPACITY_L) });
    }
    if (source) {
      const currentPct = Number(source.read().levelPct) || 0;
      const levelPct = Math.max(0, currentPct - options.drainPct);
      source.update({ levelPct, litres: litresFor(levelPct, SOURCE_TANK_CAPACITY_L) });
    }

    // The flow observation is what an OBSERVED-tier command watches. A one-shot
    // suppression lets a test drive an observation timeout.
    if (this.suppressNextFlow) {
      this.suppressNextFlow = false;
      return;
    }
    // Publish the flow report AFTER the ACK: the command router publishes the
    // (immediate) ACK as soon as onCommand returns, while this observation is
    // delayed, so Aeolus reaches ACKNOWLEDGED on the ack and only then OBSERVED
    // on the flow report. The scenario no longer depends on state-before-ACK
    // ordering to smuggle an observation onto the ack channel.
    flow?.update(
      { litresPerMinute: options.flowRateLpm },
      options.observationDelayMs > 0 ? { delayMs: options.observationDelayMs } : {},
    );
  }
}

function sensorModel(ctx: DeviceModelFactoryContext, env: ReferenceWaterEnvironment): SimulatedDeviceModel {
  env.register(ctx.key, ctx.state);
  return { getState: () => ctx.state.read() };
}

/** Build the reference-water scenario. */
export function createReferenceWaterScenario(options: ReferenceWaterOptions = {}): SimulatorScenario {
  const settings = {
    flowRateLpm: options.flowRateLpm ?? 120,
    refillPct: options.refillPct ?? 40,
    drainPct: options.drainPct ?? 10,
    observationDelayMs: options.observationDelayMs ?? 50,
  };
  const ackDelayMs = options.ackDelayMs ?? 0;
  const env = new ReferenceWaterEnvironment();

  const sourceTank: AnyDeviceDefinition = {
    key: DEVICE_KEYS.sourceTank,
    name: "Source Tank Level",
    stateTopic: STATE_TOPICS.sourceTank,
    initialState: { ...INITIAL_STATE.sourceTank },
    createModel: (ctx) => sensorModel(ctx, env),
  };

  const headerTank: AnyDeviceDefinition = {
    key: DEVICE_KEYS.headerTank,
    name: "Header Tank Level",
    stateTopic: STATE_TOPICS.headerTank,
    initialState: { ...INITIAL_STATE.headerTank },
    createModel: (ctx) => sensorModel(ctx, env),
  };

  const flow: AnyDeviceDefinition = {
    key: DEVICE_KEYS.flow,
    name: "Transfer Flow",
    stateTopic: STATE_TOPICS.flow,
    initialState: { ...INITIAL_STATE.flow },
    createModel: (ctx) => sensorModel(ctx, env),
  };

  const pump: AnyDeviceDefinition = {
    key: DEVICE_KEYS.pump,
    name: "Transfer Pump",
    stateTopic: STATE_TOPICS.pump,
    commandTopic: PUMP_COMMAND_TOPIC,
    initialState: { ...INITIAL_STATE.pump },
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => {
      env.register(ctx.key, ctx.state);
      return {
        getState: () => ctx.state.read(),
        onCommand: (command) => {
          const on = command.params.on;
          if (typeof on !== "boolean") {
            return { accepted: false, error: "transfer-pump command requires a boolean 'on' parameter" };
          }
          // Schedule the physical effect. The flow observation is published on a
          // delay (see applyPump) so it lands AFTER the ACK the router is about
          // to publish — the ACK is a plain acknowledgement and the flow sensor
          // is the independent observation, exactly as real hardware behaves.
          env.applyPump(on, settings);
          return {
            accepted: true,
            ...(ackDelayMs > 0 ? { acknowledgement: { delayMs: ackDelayMs } } : {}),
            state: { patch: { on, running: on } },
          };
        },
      };
    },
  };

  return {
    key: REFERENCE_WATER_SCENARIO_KEY,
    devices: [sourceTank, headerTank, pump, flow],
    stimuli: {
      [STIMULUS.tankLow]: () => env.lowerHeaderTank(),
      [STIMULUS.reset]: () => env.resetAll(),
      [STIMULUS.rejectNextPump]: (ctx) =>
        ctx.faults.arm(DEVICE_KEYS.pump, { rejectNext: { reason: "simulated interlock open" } }),
      [STIMULUS.dropNextPumpAck]: (ctx) => ctx.faults.arm(DEVICE_KEYS.pump, { dropNextAck: true }),
      [STIMULUS.mismatchNextPumpState]: (ctx) =>
        ctx.faults.arm(DEVICE_KEYS.pump, { mismatchNextState: { on: false, running: false } }),
      [STIMULUS.suppressNextFlow]: () => {
        env.suppressNextFlow = true;
      },
    },
  };
}
