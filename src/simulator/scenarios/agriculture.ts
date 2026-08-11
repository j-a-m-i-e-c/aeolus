// src/simulator/scenarios/agriculture.ts — Phase 3 Agriculture physical world.
//
// The Farm showcase is intentionally split across several Aeolus automations,
// but all physical truth lives here in the separate MQTT simulator process.
// Automation Events are bounded external-world stimuli; actuator commands use
// the ordinary generic-MQTT command/ACK contract from Phase 1/2.

import type {
  AnyDeviceDefinition,
  DeviceModelFactoryContext,
  SimulatedDeviceModel,
  SimulatedState,
  SimulatedStateController,
  SimulatorScenario,
} from "../types.js";

export const AGRICULTURE_SCENARIO_KEY = "agriculture";

export const AGRICULTURE_DEVICE_KEYS = {
  dam: "farm-dam",
  header: "farm-header-tank",
  shed: "farm-shed-tank",
  house: "farm-house-tank",
  pump: "farm-dam-pump",
  flow: "farm-transfer-flow",
  energiser: "farm-fence-energiser",
  collars: "farm-collars",
  recall: "farm-recall",
  troughs: "farm-troughs",
  troughRefill: "farm-trough-refill",
  battery: "farm-battery",
} as const;

export const AGRICULTURE_STATE_TOPICS = {
  dam: "sensor/farm/dam",
  header: "sensor/farm/header-tank",
  shed: "sensor/farm/shed-tank",
  house: "sensor/farm/house-tank",
  pump: "switch/farm/dam-pump/state",
  flow: "sensor/farm/transfer-flow",
  energiser: "sensor/fence/energiser",
  collars: "sensor/fence/collars",
  recall: "switch/fence/recall/state",
  troughs: "sensor/farm/troughs",
  troughRefill: "switch/farm/trough-refill/state",
  battery: "sensor/farm/energy/battery",
} as const;

export const AGRICULTURE_COMMAND_TOPICS = {
  pump: "switch/farm/dam-pump/set",
  recall: "switch/fence/recall/set",
  troughRefill: "switch/farm/trough-refill/set",
} as const;

export const AGRICULTURE_STIMULUS = {
  headerLow: "farm/sim/header-low",
  boundaryBreach: "farm/sim/livestock-boundary-breach",
  troughsLow: "farm/sim/troughs-low",
  energyLow: "farm/sim/energy-low",
  energyRestore: "farm/sim/energy-restore",
  waterReset: "farm/sim/water-reset",
  livestockReset: "farm/sim/livestock-reset",
  troughsReset: "farm/sim/troughs-reset",
  energyReset: "farm/sim/energy-reset",
  reset: "farm/sim/reset",
} as const;

const DAM_CAPACITY_L = 60_000;
const HEADER_CAPACITY_L = 5_000;

interface WaterTankState { value: number; litres: number }
interface PumpState { on: boolean; running: boolean }
interface FlowState { litresPerMinute: number }
interface CollarState { herd: number; tracked: number; strays: number; avgBattery: number; paddock: string }
interface TroughState { total: number; low: number; refilling: number; average: number }
interface BatteryState { soc: number; solarKw: number; loadKw: number; available: boolean }

const INITIAL = {
  dam: { value: 82, litres: 49_200 } as WaterTankState,
  header: { value: 65, litres: 3_250 } as WaterTankState,
  shed: { value: 78, litres: 17_160 },
  house: { value: 55, litres: 2_200 },
  pump: { on: false, running: false } as PumpState,
  flow: { litresPerMinute: 0 } as FlowState,
  energiser: { voltage: 7.2, current: 0.4, fault: false },
  collars: { herd: 30, tracked: 30, strays: 2, avgBattery: 74, paddock: "A" } as CollarState,
  recall: { active: false },
  troughs: { total: 20, low: 3, refilling: 2, average: 71 } as TroughState,
  troughRefill: { active: false },
  battery: { soc: 78, solarKw: 2.8, loadKw: 1.2, available: true } as BatteryState,
};

// Returns the state type: a fresh object literal is assignable to the
// controller's Partial<SimulatedState> patch parameter, whereas a named-type
// return value would lack the required string index signature.
function tankState(levelPct: number, capacityLitres: number): SimulatedState {
  const value = Math.max(0, Math.min(100, levelPct));
  return { value, litres: Math.round((value / 100) * capacityLitres) };
}

class AgricultureEnvironment {
  private readonly controllers = new Map<string, SimulatedStateController>();

  register(key: string, controller: SimulatedStateController): void {
    this.controllers.set(key, controller);
  }

  controller(key: string): SimulatedStateController | undefined {
    return this.controllers.get(key);
  }

  reset(): void {
    for (const [key, value] of Object.entries(INITIAL)) {
      this.controller(key === "dam" ? AGRICULTURE_DEVICE_KEYS.dam
        : key === "header" ? AGRICULTURE_DEVICE_KEYS.header
        : key === "shed" ? AGRICULTURE_DEVICE_KEYS.shed
        : key === "house" ? AGRICULTURE_DEVICE_KEYS.house
        : key === "pump" ? AGRICULTURE_DEVICE_KEYS.pump
        : key === "flow" ? AGRICULTURE_DEVICE_KEYS.flow
        : key === "energiser" ? AGRICULTURE_DEVICE_KEYS.energiser
        : key === "collars" ? AGRICULTURE_DEVICE_KEYS.collars
        : key === "recall" ? AGRICULTURE_DEVICE_KEYS.recall
        : key === "troughs" ? AGRICULTURE_DEVICE_KEYS.troughs
        : key === "troughRefill" ? AGRICULTURE_DEVICE_KEYS.troughRefill
        : AGRICULTURE_DEVICE_KEYS.battery)?.update({ ...value }, { forcePublish: true });
    }
  }

  lowerHeader(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.header)?.update(tankState(25, HEADER_CAPACITY_L));
  }

  boundaryBreach(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.collars)?.update({ strays: 2, paddock: "boundary-east" });
  }

  lowerTroughs(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.troughs)?.update({ low: 5, refilling: 0, average: 38 });
  }

  setEnergyLow(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.battery)?.update({ soc: 18, solarKw: 0.3, loadKw: 1.6, available: false });
  }

  restoreEnergy(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.battery)?.update({ ...INITIAL.battery });
  }

  resetWater(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.dam)?.update({ ...INITIAL.dam } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.header)?.update({ ...INITIAL.header } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.shed)?.update({ ...INITIAL.shed } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.house)?.update({ ...INITIAL.house } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.pump)?.update({ ...INITIAL.pump } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.flow)?.update({ ...INITIAL.flow } as Record<string, unknown>, { forcePublish: true });
  }

  resetLivestock(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.energiser)?.update({ ...INITIAL.energiser } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.collars)?.update({ ...INITIAL.collars } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.recall)?.update({ ...INITIAL.recall } as Record<string, unknown>, { forcePublish: true });
  }

  resetTroughs(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.troughs)?.update({ ...INITIAL.troughs } as Record<string, unknown>, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.troughRefill)?.update({ ...INITIAL.troughRefill } as Record<string, unknown>, { forcePublish: true });
  }

  resetEnergy(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.battery)?.update({ ...INITIAL.battery } as Record<string, unknown>, { forcePublish: true });
  }

  scheduleTransfer(litres: number): void {
    const dam = this.controller(AGRICULTURE_DEVICE_KEYS.dam);
    const header = this.controller(AGRICULTURE_DEVICE_KEYS.header);
    const flow = this.controller(AGRICULTURE_DEVICE_KEYS.flow);
    if (!dam || !header || !flow) return;

    const damState = dam.read();
    const headerState = header.read();
    const damLitres = Number(damState.litres) || 0;
    const headerLitres = Number(headerState.litres) || 0;
    const actual = Math.max(0, Math.min(litres, damLitres, HEADER_CAPACITY_L - headerLitres));

    // Independent flow observation arrives after the immediate command ACK.
    flow.update({ litresPerMinute: actual > 0 ? 120 : 0 }, { delayMs: 80 });
    if (actual <= 0) return;

    const nextDamLitres = damLitres - actual;
    const nextHeaderLitres = headerLitres + actual;
    dam.update(
      { value: Math.round((nextDamLitres / DAM_CAPACITY_L) * 1000) / 10, litres: Math.round(nextDamLitres) },
      { delayMs: 220 },
    );
    header.update(
      { value: Math.round((nextHeaderLitres / HEADER_CAPACITY_L) * 1000) / 10, litres: Math.round(nextHeaderLitres) },
      { delayMs: 220 },
    );
  }

  stopFlow(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.flow)?.update({ litresPerMinute: 0 }, { delayMs: 80 });
  }

  completeRecall(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.collars)?.update({ strays: 0, paddock: "A" }, { delayMs: 120 });
  }

  completeTroughRefill(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.troughs)?.update({ low: 0, refilling: 0, average: 88 }, { delayMs: 180 });
  }
}

function sensorModel(ctx: DeviceModelFactoryContext, env: AgricultureEnvironment): SimulatedDeviceModel {
  env.register(ctx.key, ctx.state);
  return { getState: () => ctx.state.read() };
}

function sensorDefinition(
  key: string,
  name: string,
  stateTopic: string,
  initialState: Record<string, unknown>,
  env: AgricultureEnvironment,
): AnyDeviceDefinition {
  return {
    key,
    name,
    stateTopic,
    initialState,
    createModel: (ctx) => sensorModel(ctx, env),
  };
}

export function createAgricultureScenario(): SimulatorScenario {
  const env = new AgricultureEnvironment();

  const pump: AnyDeviceDefinition = {
    key: AGRICULTURE_DEVICE_KEYS.pump,
    name: "Dam Transfer Pump",
    stateTopic: AGRICULTURE_STATE_TOPICS.pump,
    commandTopic: AGRICULTURE_COMMAND_TOPICS.pump,
    initialState: { ...INITIAL.pump },
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => {
      env.register(ctx.key, ctx.state);
      return {
        getState: () => ctx.state.read(),
        onCommand: (command) => {
          const on = command.params.on;
          if (typeof on !== "boolean") return { accepted: false, error: "dam-pump requires boolean on" };
          if (on) {
            const requested = Number(command.params.litres);
            env.scheduleTransfer(Number.isFinite(requested) ? Math.max(100, Math.min(3000, requested)) : 500);
          } else {
            env.stopFlow();
          }
          return { accepted: true, state: { patch: { on, running: on } } };
        },
      };
    },
  };

  const recall: AnyDeviceDefinition = {
    key: AGRICULTURE_DEVICE_KEYS.recall,
    name: "Virtual Fence Recall",
    stateTopic: AGRICULTURE_STATE_TOPICS.recall,
    commandTopic: AGRICULTURE_COMMAND_TOPICS.recall,
    initialState: { ...INITIAL.recall },
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => {
      env.register(ctx.key, ctx.state);
      return {
        getState: () => ctx.state.read(),
        onCommand: (command) => {
          if (command.params.active !== true) return { accepted: false, error: "recall requires active=true" };
          env.completeRecall();
          ctx.state.update({ active: false }, { delayMs: 650 });
          return { accepted: true, state: { patch: { active: true } } };
        },
      };
    },
  };

  const troughRefill: AnyDeviceDefinition = {
    key: AGRICULTURE_DEVICE_KEYS.troughRefill,
    name: "Trough Refill Manifold",
    stateTopic: AGRICULTURE_STATE_TOPICS.troughRefill,
    commandTopic: AGRICULTURE_COMMAND_TOPICS.troughRefill,
    initialState: { ...INITIAL.troughRefill },
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => {
      env.register(ctx.key, ctx.state);
      return {
        getState: () => ctx.state.read(),
        onCommand: (command) => {
          if (command.params.active !== true) return { accepted: false, error: "trough refill requires active=true" };
          env.controller(AGRICULTURE_DEVICE_KEYS.troughs)?.update({ refilling: 4 }, { delayMs: 70 });
          env.completeTroughRefill();
          ctx.state.update({ active: false }, { delayMs: 700 });
          return { accepted: true, state: { patch: { active: true } } };
        },
      };
    },
  };

  const devices: AnyDeviceDefinition[] = [
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.dam, "Farm Dam", AGRICULTURE_STATE_TOPICS.dam, { ...INITIAL.dam }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.header, "Header Tank", AGRICULTURE_STATE_TOPICS.header, { ...INITIAL.header }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.shed, "Shed Tank", AGRICULTURE_STATE_TOPICS.shed, { ...INITIAL.shed }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.house, "House Tank", AGRICULTURE_STATE_TOPICS.house, { ...INITIAL.house }, env),
    pump,
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.flow, "Transfer Flow", AGRICULTURE_STATE_TOPICS.flow, { ...INITIAL.flow }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.energiser, "Fence Energiser", AGRICULTURE_STATE_TOPICS.energiser, { ...INITIAL.energiser }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.collars, "GPS Cattle Collars", AGRICULTURE_STATE_TOPICS.collars, { ...INITIAL.collars }, env),
    recall,
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.troughs, "Distributed Troughs", AGRICULTURE_STATE_TOPICS.troughs, { ...INITIAL.troughs }, env),
    troughRefill,
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.battery, "Site Battery", AGRICULTURE_STATE_TOPICS.battery, { ...INITIAL.battery }, env),
  ];

  return {
    key: AGRICULTURE_SCENARIO_KEY,
    devices,
    stimuli: {
      [AGRICULTURE_STIMULUS.headerLow]: () => env.lowerHeader(),
      [AGRICULTURE_STIMULUS.boundaryBreach]: () => env.boundaryBreach(),
      [AGRICULTURE_STIMULUS.troughsLow]: () => env.lowerTroughs(),
      [AGRICULTURE_STIMULUS.energyLow]: () => env.setEnergyLow(),
      [AGRICULTURE_STIMULUS.energyRestore]: () => env.restoreEnergy(),
      [AGRICULTURE_STIMULUS.waterReset]: () => env.resetWater(),
      [AGRICULTURE_STIMULUS.livestockReset]: () => env.resetLivestock(),
      [AGRICULTURE_STIMULUS.troughsReset]: () => env.resetTroughs(),
      [AGRICULTURE_STIMULUS.energyReset]: () => env.resetEnergy(),
      [AGRICULTURE_STIMULUS.reset]: () => env.reset(),
    },
  };
}
