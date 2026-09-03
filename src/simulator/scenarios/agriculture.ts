// src/simulator/scenarios/agriculture.ts — Agriculture physical world.
//
// The four Agriculture automations are separate Aeolus applications, while all
// physical truth lives here in the MQTT simulator. Automation Events are bounded
// external-world stimuli; physical commands still use the normal generic-MQTT
// command/ACK/observation path.

import type {
  AnyDeviceDefinition,
  DeviceModelFactoryContext,
  SimulatedDeviceModel,
  SimulatedInboundCommand,
  SimulatedCommandOutcome,
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
  shedFill: "farm-shed-fill",
  houseFill: "farm-house-fill",
  energiser: "farm-fence-energiser",
  collars: "farm-collars",
  dogs: "farm-working-dogs",
  recall: "farm-recall",
  troughs: "farm-troughs",
  troughRefill: "farm-trough-refill",
  battery: "farm-battery",
  chargerBank: "farm-charger-bank",
} as const;

export const AGRICULTURE_STATE_TOPICS = {
  dam: "sensor/farm/dam",
  header: "sensor/farm/header-tank",
  shed: "sensor/farm/shed-tank",
  house: "sensor/farm/house-tank",
  pump: "switch/farm/dam-pump/state",
  flow: "sensor/farm/transfer-flow",
  shedFill: "switch/farm/shed-fill/state",
  houseFill: "switch/farm/house-fill/state",
  energiser: "sensor/fence/energiser",
  collars: "sensor/fence/collars",
  // Same collar network as the cattle, so the same topic family and the same
  // Livestock automation trigger.
  dogs: "sensor/fence/working-dogs",
  recall: "switch/fence/recall/state",
  troughs: "sensor/farm/troughs",
  troughRefill: "switch/farm/trough-refill/state",
  battery: "sensor/farm/energy/battery",
  chargerBank: "switch/farm/charger-bank/state",
} as const;

export const AGRICULTURE_COMMAND_TOPICS = {
  pump: "switch/farm/dam-pump/set",
  shedFill: "switch/farm/shed-fill/set",
  houseFill: "switch/farm/house-fill/set",
  recall: "switch/fence/recall/set",
  troughRefill: "switch/farm/trough-refill/set",
  chargerBank: "switch/farm/charger-bank/set",
} as const;

export const AGRICULTURE_STIMULUS = {
  headerLow: "farm/sim/header-low",
  propertyDemand: "farm/sim/property-water-demand",
  boundaryBreach: "farm/sim/livestock-boundary-breach",
  moveHerd: "farm/sim/livestock-move-herd",
  fenceFault: "farm/sim/livestock-fence-fault",
  fenceRestore: "farm/sim/livestock-fence-restore",
  troughsLow: "farm/sim/troughs-low",
  troughsDrink: "farm/sim/troughs-drink",
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
const SHED_CAPACITY_L = 8_000;
const HOUSE_CAPACITY_L = 4_000;
const TROUGH_LOW_THRESHOLD = 45;
/** Transition group for a working-dog deployment. */
const DOG_WORK_GROUP = "dog-work";

/**
 * Bounding box of the simulated property. The dogs wear real GPS collars, so they
 * report latitude and longitude like the hardware would; consumers map those into
 * whatever view they draw. Coordinates are a plausible slice of pastoral NSW.
 */
const PROPERTY_BOUNDS = {
  north: -33.8210,
  south: -33.8290,
  west: 149.5680,
  east: 149.5810,
} as const;

/** Where each fixed point of interest sits, as a 0..1 fraction of the property box. */
const DOG_KENNEL = { x: 0.08, y: 0.86 };
/** Roughly the middle of each paddock, used as the drive-to destination. */
const PADDOCK_CENTRES: Record<string, { x: number; y: number }> = {
  A: { x: 0.27, y: 0.45 },
  B: { x: 0.72, y: 0.45 },
};
/** Where strays end up after a breach, per breached sector. */
const BREACH_POINTS: Record<string, { x: number; y: number }> = {
  east: { x: 0.95, y: 0.32 },
  west: { x: 0.04, y: 0.32 },
};

/** Convert a property-relative point into the GPS position a collar would report. */
function toGps(point: { x: number; y: number }): { lat: number; lon: number } {
  const lat = PROPERTY_BOUNDS.north + (PROPERTY_BOUNDS.south - PROPERTY_BOUNDS.north) * point.y;
  const lon = PROPERTY_BOUNDS.west + (PROPERTY_BOUNDS.east - PROPERTY_BOUNDS.west) * point.x;
  // Six decimals is about 0.1 m — the precision a real collar reports, and enough
  // that a consumer never has to render a raw float artefact.
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

/** Interpolate between two property-relative points. */
function between(from: { x: number; y: number }, to: { x: number; y: number }, progress: number) {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

/** One GPS-collared working dog. */
interface WorkingDog extends SimulatedState {
  name: string;
  /** kenneled → released → intercepting → driving → returning → kenneled. */
  activity: string;
  lat: number;
  lon: number;
  battery: number;
  /** Which stray the dog is working, when it is working one. */
  targetStray: number | null;
}

interface DogPackState extends SimulatedState {
  dogs: WorkingDog[];
  /** How many dogs are out of the kennel. */
  deployed: number;
  working: boolean;
}

/** Build the pack's resting state. Dogs sit in the kennel with topped-up collars. */
function kenneledPack(): DogPackState {
  const kennel = toGps(DOG_KENNEL);
  return {
    working: false,
    deployed: 0,
    dogs: [
      { name: "Scout", activity: "kenneled", ...kennel, battery: 91, targetStray: null },
      { name: "Moss", activity: "kenneled", ...kennel, battery: 88, targetStray: null },
    ],
  };
}
const BASE_LOAD_KW = 0.72;
const PUMP_LOAD_KW = 1.05;
const CHARGER_LOAD_KW = 0.45;

interface WaterTankState { value: number; litres: number }
interface PumpState { on: boolean; running: boolean }
interface FlowState extends SimulatedState {
  litresPerMinute: number;
  totalLitres: number;
  batchActive: boolean;
  batchTargetLitres: number;
  batchTransferredLitres: number;
}
interface CollarState {
  herd: number;
  tracked: number;
  strays: number;
  avgBattery: number;
  paddock: string;
  breachSector: string | null;
  movement: string;
}
interface TroughState extends SimulatedState {
  total: number;
  low: number;
  refilling: number;
  average: number;
  levels: number[];
  lowIds: string[];
  refillTargets: string[];
  drinkingIds: string[];
  drinkingHead: number;
  drinkingActive: boolean;
  drinkingProgress: number;
  consumptionTodayLitres: number;
  lastDrinkLitres: number;
  refillFlowLpm: number;
  /** idle · approaching · drinking · clearing · refilling. */
  phase: string;
  /** True from the moment cattle start walking in until the last one leaves. */
  herdPresent: boolean;
  /** Completed herd visits, which is also what rotates the visited cluster. */
  visit: number;
  /** Paddock whose trough cluster the current or last visit used. */
  visitPaddock: string;
}
interface BatteryState {
  soc: number;
  solarKw: number;
  loadKw: number;
  available: boolean;
  baseLoadKw: number;
  pumpKw: number;
  chargerKw: number;
  chargerOn: boolean;
}

const INITIAL_TROUGH_LEVELS = [86, 78, 91, 82, 74, 88, 79, 93, 84, 76, 90, 81, 87, 77, 92, 85, 73, 89, 80, 94];

function tankState(levelPct: number, capacityLitres: number): SimulatedState {
  const value = Math.max(0, Math.min(100, levelPct));
  return { value, litres: Math.round((value / 100) * capacityLitres) };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function troughId(index: number): string {
  return `T${index + 1}`;
}

/** Litres drawn per percentage point of a trough. */
const TROUGH_LITRES_PER_PERCENT = 3.2;
/** Head of cattle that come in to water together. */
const TROUGH_HERD_HEAD = 18;
/** Transition group for the herd-visit sequence. */
const TROUGH_VISIT_GROUP = "trough-visit";
/** Transition group for a manifold refill. */
const TROUGH_REFILL_GROUP = "trough-refill";

/**
 * The five troughs reticulated to one paddock, matching the paddock rows the pane
 * draws. Cattle can only drink from the paddock they are standing in, so this is
 * what ties trough location to herd location.
 */
function paddockCluster(paddock: string): number[] {
  const row = Math.max(0, Math.min(3, (paddock.charCodeAt(0) || 65) - 65));
  return [0, 1, 2, 3, 4].map((offset) => row * 5 + offset);
}

/**
 * Which troughs the herd uses on a given visit.
 *
 * A rotating window over the paddock's cluster rather than a random pick: the
 * hosted demo and its tests both need repeatability, but the same four troughs
 * draining on every single visit was what made the scenario look scripted.
 */
function visitedTroughs(paddock: string, visit: number): number[] {
  const cluster = paddockCluster(paddock);
  const start = visit % cluster.length;
  const count = 3 + (visit % 2);
  return Array.from({ length: count }, (_, offset) => cluster[(start + offset) % cluster.length]);
}

function summarizeTroughs(
  levels: number[],
  extras: Partial<TroughState> = {},
): TroughState {
  const clean = levels.map((value) => Math.max(0, Math.min(100, Math.round(value * 10) / 10)));
  const lowIds = clean.map((value, index) => ({ value, id: troughId(index) })).filter((entry) => entry.value < TROUGH_LOW_THRESHOLD).map((entry) => entry.id);
  return {
    total: 20,
    low: lowIds.length,
    refilling: 0,
    average: average(clean),
    levels: clean,
    lowIds,
    refillTargets: [],
    drinkingIds: [],
    drinkingHead: 0,
    drinkingActive: false,
    drinkingProgress: 0,
    consumptionTodayLitres: 1240,
    lastDrinkLitres: 0,
    refillFlowLpm: 0,
    phase: "idle",
    herdPresent: false,
    visit: 0,
    visitPaddock: "A",
    ...extras,
  };
}

const INITIAL = {
  dam: { value: 82, litres: 49_200 } as WaterTankState,
  header: { value: 65, litres: 3_250 } as WaterTankState,
  shed: { value: 72, litres: 5_760 } as WaterTankState,
  house: { value: 64, litres: 2_560 } as WaterTankState,
  pump: { on: false, running: false } as PumpState,
  flow: { litresPerMinute: 0, totalLitres: 18_420, batchActive: false, batchTargetLitres: 0, batchTransferredLitres: 0 } as FlowState,
  shedFill: { on: false, zone: "shed" },
  houseFill: { on: false, zone: "house" },
  energiser: { voltage: 7.2, current: 0.4, fault: false },
  collars: {
    herd: 30,
    tracked: 30,
    strays: 0,
    avgBattery: 74,
    paddock: "A",
    breachSector: null,
    movement: "grazing",
  } as CollarState,
  // The dog pack's resting state comes from kenneledPack(), which builds a fresh
  // object each time so a reset cannot hand out a shared mutable array of dogs.
  recall: { active: false },
  troughs: summarizeTroughs(INITIAL_TROUGH_LEVELS) as TroughState,
  troughRefill: { active: false },
  battery: {
    soc: 78,
    solarKw: 2.1,
    loadKw: BASE_LOAD_KW,
    available: true,
    baseLoadKw: BASE_LOAD_KW,
    pumpKw: 0,
    chargerKw: 0,
    chargerOn: false,
  } as BatteryState,
  chargerBank: { on: false, watts: 0 },
};

class AgricultureEnvironment {
  private readonly controllers = new Map<string, SimulatedStateController>();
  private pumpKw = 0;
  private chargerKw = 0;
  private transferTimer?: ReturnType<typeof setTimeout>;
  private transferFailsafeTimer?: ReturnType<typeof setTimeout>;


  register(key: string, controller: SimulatedStateController): void {
    this.controllers.set(key, controller);
  }

  controller(key: string): SimulatedStateController | undefined {
    return this.controllers.get(key);
  }

  reset(): void {
    this.resetWater();
    this.resetLivestock();
    this.resetTroughs();
    this.resetEnergy();
  }

  lowerHeader(): void {
    const header = this.controller(AGRICULTURE_DEVICE_KEYS.header);
    header?.update(tankState(25, HEADER_CAPACITY_L));
    // Re-publish after a short hold so the low state is visible before the
    // automation's recovery path is evaluated again.
    header?.update({}, { forcePublish: true, delayMs: 5000 });
  }

  propertyWaterDemand(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.house)?.update(tankState(50, HOUSE_CAPACITY_L));
    this.controller(AGRICULTURE_DEVICE_KEYS.shed)?.update(tankState(60, SHED_CAPACITY_L));
  }

  boundaryBreach(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.collars)?.update({
      strays: 2,
      breachSector: "east",
      movement: "boundary-breach",
    });
  }

  moveHerd(): void {
    const collars = this.controller(AGRICULTURE_DEVICE_KEYS.collars);
    if (!collars) return;
    const current = collars.read();
    const next = current.paddock === "A" ? "B" : "A";
    collars.update({ paddock: next, strays: 0, breachSector: null, movement: "rotating" });
    collars.update({ movement: "grazing" }, { delayMs: 2200 });
  }

  fenceFault(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.energiser)?.update({ voltage: 1.6, current: 0.08, fault: true });
  }

  restoreFence(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.energiser)?.update({ ...INITIAL.energiser });
  }

  drinkTroughs(): void {
    const troughs = this.controller(AGRICULTURE_DEVICE_KEYS.troughs);
    if (!troughs) return;
    const state = troughs.read() as TroughState;
    // `herdPresent` is the guard rather than a timer handle: it is the physical fact
    // that cattle are at the water, it covers walking in and clearing out as well
    // as drinking, and it survives however the visit is being animated.
    if (state.herdPresent || Number(state.refilling || 0) > 0) return;

    // Cattle drink from the paddock they are standing in, so the herd's location
    // decides which cluster empties.
    const collars = this.controller(AGRICULTURE_DEVICE_KEYS.collars)?.read() as CollarState | undefined;
    const paddock = String(collars?.paddock ?? "A");
    const visit = Math.max(0, Number(state.visit) || 0) + 1;

    const startLevels = Array.isArray(state.levels) ? [...state.levels] : [...INITIAL_TROUGH_LEVELS];
    const drinkIndexes = visitedTroughs(paddock, visit);
    const finalLevels = [...startLevels];
    let totalConsumed = 0;
    drinkIndexes.forEach((index, offset) => {
      const before = Number(startLevels[index]) || 0;
      // Deterministic per-visit variation: repeated visits differ without becoming
      // unrepeatable for a test or the hosted demo.
      const drop = 38 + ((visit * 7 + offset * 5) % 15);
      const after = Math.max(16, before - drop);
      finalLevels[index] = after;
      totalConsumed += Math.round((before - after) * TROUGH_LITRES_PER_PERCENT);
    });
    const drinkingIds = drinkIndexes.map(troughId);
    const startingConsumption = Number(state.consumptionTodayLitres || 0);

    // Cattle are walking in, not drinking yet. Saying so is the point: the pane can
    // explain why an automatic refill is holding off.
    troughs.update(summarizeTroughs(startLevels, {
      phase: "approaching",
      herdPresent: true,
      visit,
      visitPaddock: paddock,
      drinkingIds,
      drinkingHead: TROUGH_HERD_HEAD,
      drinkingActive: false,
      drinkingProgress: 0,
      consumptionTodayLitres: startingConsumption,
      lastDrinkLitres: 0,
      refillFlowLpm: 0,
    }), { forcePublish: true });

    // One visit: approach, drink, clear. Levels fall only while cattle are actually
    // at the water, so the drop is something you watch rather than a step change.
    const APPROACH_END = 0.19;
    const DRINK_END = 0.81;
    troughs.transition({
      durationMs: 8000,
      steps: 24,
      group: TROUGH_VISIT_GROUP,
      frame: (progress) => {
        const finished = progress >= 1;
        let phase = "clearing";
        let drinkProgress = 1;
        if (progress < APPROACH_END) {
          phase = "approaching";
          drinkProgress = 0;
        } else if (progress < DRINK_END) {
          phase = "drinking";
          drinkProgress = (progress - APPROACH_END) / (DRINK_END - APPROACH_END);
        } else if (finished) {
          phase = "idle";
        }

        const levels = startLevels.map((start, index) => start + (finalLevels[index] - start) * drinkProgress);
        return summarizeTroughs(levels, {
          phase,
          herdPresent: !finished,
          visit,
          visitPaddock: paddock,
          drinkingIds: phase === "drinking" ? drinkingIds : [],
          drinkingHead: finished ? 0 : TROUGH_HERD_HEAD,
          drinkingActive: phase === "drinking",
          drinkingProgress: Math.round(drinkProgress * 100),
          consumptionTodayLitres: startingConsumption + Math.round(totalConsumed * drinkProgress),
          lastDrinkLitres: finished ? totalConsumed : 0,
          refillFlowLpm: 0,
        });
      },
    });
  }

  lowerTroughs(): void {
    this.drinkTroughs();
  }

  setEnergyLow(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.battery)?.update({ soc: 18, solarKw: 0.3, available: false });
    this.publishEnergyLoad();
  }

  restoreEnergy(): void {
    this.controller(AGRICULTURE_DEVICE_KEYS.battery)?.update({ soc: 78, solarKw: 2.1, available: true });
    this.publishEnergyLoad();
  }

  resetWater(): void {
    this.clearTransferTimers();
    this.pumpKw = 0;
    this.controller(AGRICULTURE_DEVICE_KEYS.dam)?.update({ ...INITIAL.dam }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.header)?.update({ ...INITIAL.header }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.shed)?.update({ ...INITIAL.shed }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.house)?.update({ ...INITIAL.house }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.pump)?.update({ ...INITIAL.pump }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.flow)?.update({ ...INITIAL.flow }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.shedFill)?.update({ ...INITIAL.shedFill }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.houseFill)?.update({ ...INITIAL.houseFill }, { forcePublish: true });
    this.publishEnergyLoad();
  }

  resetLivestock(): void {
    // Cancel the pack's own movement first, so a reset mid-recall does not leave a
    // transition writing dog positions over the state just restored. Scoped to the
    // dog group, so nothing else in the simulated property is disturbed.
    const dogs = this.controller(AGRICULTURE_DEVICE_KEYS.dogs);
    dogs?.cancelTransitions(DOG_WORK_GROUP);
    this.controller(AGRICULTURE_DEVICE_KEYS.energiser)?.update({ ...INITIAL.energiser }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.collars)?.update({ ...INITIAL.collars }, { forcePublish: true });
    dogs?.update(kenneledPack(), { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.recall)?.update({ ...INITIAL.recall }, { forcePublish: true });
  }

  resetTroughs(): void {
    this.clearTroughTimers();
    this.controller(AGRICULTURE_DEVICE_KEYS.troughs)?.update({ ...INITIAL.troughs, levels: [...INITIAL_TROUGH_LEVELS] }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.troughRefill)?.update({ ...INITIAL.troughRefill }, { forcePublish: true });
  }

  resetEnergy(): void {
    this.chargerKw = 0;
    this.controller(AGRICULTURE_DEVICE_KEYS.chargerBank)?.update({ ...INITIAL.chargerBank }, { forcePublish: true });
    this.controller(AGRICULTURE_DEVICE_KEYS.battery)?.update({ ...INITIAL.battery }, { forcePublish: true });
    this.publishEnergyLoad();
  }

  setPumpLoad(on: boolean): void {
    this.pumpKw = on ? PUMP_LOAD_KW : 0;
    this.publishEnergyLoad();
  }

  setChargerLoad(on: boolean): void {
    this.chargerKw = on ? CHARGER_LOAD_KW : 0;
    this.publishEnergyLoad();
  }

  private publishEnergyLoad(): void {
    const battery = this.controller(AGRICULTURE_DEVICE_KEYS.battery);
    if (!battery) return;
    const loadKw = Math.round((BASE_LOAD_KW + this.pumpKw + this.chargerKw) * 100) / 100;
    battery.update({
      baseLoadKw: BASE_LOAD_KW,
      pumpKw: this.pumpKw,
      chargerKw: this.chargerKw,
      chargerOn: this.chargerKw > 0,
      loadKw,
    });
  }

  scheduleTransfer(litres: number): void {
    const dam = this.controller(AGRICULTURE_DEVICE_KEYS.dam);
    const header = this.controller(AGRICULTURE_DEVICE_KEYS.header);
    const flow = this.controller(AGRICULTURE_DEVICE_KEYS.flow);
    if (!dam || !header || !flow) return;

    this.clearTransferTimers();
    const damLitres = Number(dam.read().litres) || 0;
    const headerLitres = Number(header.read().litres) || 0;
    const actual = Math.max(0, Math.min(litres, damLitres, HEADER_CAPACITY_L - headerLitres));
    const initialFlow = flow.read() as FlowState;
    const startingTotal = Number(initialFlow.totalLitres || 0);
    if (actual <= 0) {
      flow.update({ litresPerMinute: 0, batchActive: false, batchTargetLitres: 0, batchTransferredLitres: 0 });
      return;
    }

    const steps = Math.max(4, Math.min(8, Math.ceil(actual / 200)));
    let delivered = 0;
    let step = 0;
    flow.update({
      litresPerMinute: 120,
      totalLitres: startingTotal,
      batchActive: true,
      batchTargetLitres: Math.round(actual),
      batchTransferredLitres: 0,
    }, { forcePublish: true });

    const tick = (): void => {
      step += 1;
      const remaining = actual - delivered;
      const stepLitres = step >= steps ? remaining : Math.min(remaining, actual / steps);
      delivered += stepLitres;

      const currentDam = Number(dam.read().litres) || 0;
      const currentHeader = Number(header.read().litres) || 0;
      const moved = Math.max(0, Math.min(stepLitres, currentDam, HEADER_CAPACITY_L - currentHeader));
      const nextDam = currentDam - moved;
      const nextHeader = currentHeader + moved;
      dam.update({ value: Math.round((nextDam / DAM_CAPACITY_L) * 1000) / 10, litres: Math.round(nextDam) });
      header.update({ value: Math.round((nextHeader / HEADER_CAPACITY_L) * 1000) / 10, litres: Math.round(nextHeader) });
      flow.update({
        litresPerMinute: 120,
        totalLitres: Math.round((startingTotal + delivered) * 10) / 10,
        batchActive: true,
        batchTargetLitres: Math.round(actual),
        batchTransferredLitres: Math.round(delivered * 10) / 10,
      }, { forcePublish: true });

      if (step >= steps || delivered >= actual - 0.1) {
        this.transferTimer = undefined;
        // Aeolus should issue the normal OFF command after seeing the batch
        // totalizer reach its target. This bounded fallback keeps the physical
        // simulator truthful if that control path fails.
        this.transferFailsafeTimer = setTimeout(() => {
          this.transferFailsafeTimer = undefined;
          const pump = this.controller(AGRICULTURE_DEVICE_KEYS.pump);
          const currentFlow = flow.read() as FlowState;
          if (currentFlow.batchActive) {
            flow.update({ litresPerMinute: 0, batchActive: false }, { forcePublish: true });
            pump?.update({ on: false, running: false }, { forcePublish: true });
            this.setPumpLoad(false);
          }
        }, 900);
        return;
      }
      this.transferTimer = setTimeout(tick, 420);
    };

    this.transferTimer = setTimeout(tick, 320);
  }

  stopFlow(): void {
    this.clearTransferTimers();
    const flow = this.controller(AGRICULTURE_DEVICE_KEYS.flow);
    const current = flow?.read() as FlowState | undefined;
    flow?.update({
      litresPerMinute: 0,
      batchActive: false,
      batchTargetLitres: Number(current?.batchTargetLitres || 0),
      batchTransferredLitres: Number(current?.batchTransferredLitres || 0),
    }, { forcePublish: true });
  }

  refillDownstream(zone: "shed" | "house", targetPct: number): void {
    const header = this.controller(AGRICULTURE_DEVICE_KEYS.header);
    const tank = this.controller(zone === "shed" ? AGRICULTURE_DEVICE_KEYS.shed : AGRICULTURE_DEVICE_KEYS.house);
    if (!header || !tank) return;

    const capacity = zone === "shed" ? SHED_CAPACITY_L : HOUSE_CAPACITY_L;
    const headerState = header.read();
    const tankCurrent = tank.read();
    const currentLitres = Number(tankCurrent.litres) || 0;
    const requestedLitres = Math.max(0, (Math.max(0, Math.min(100, targetPct)) / 100) * capacity - currentLitres);
    const headerLitres = Number(headerState.litres) || 0;
    const minimumHeaderReserve = HEADER_CAPACITY_L * 0.2;
    const available = Math.max(0, headerLitres - minimumHeaderReserve);
    const actual = Math.min(requestedLitres, available);
    if (actual <= 0) return;

    const nextTankLitres = currentLitres + actual;
    const nextHeaderLitres = headerLitres - actual;
    tank.update({
      value: Math.round((nextTankLitres / capacity) * 1000) / 10,
      litres: Math.round(nextTankLitres),
    }, { delayMs: 900 });
    header.update({
      value: Math.round((nextHeaderLitres / HEADER_CAPACITY_L) * 1000) / 10,
      litres: Math.round(nextHeaderLitres),
    }, { delayMs: 900 });
  }

  completeRecall(): void {
    const collars = this.controller(AGRICULTURE_DEVICE_KEYS.collars);
    if (!collars) return;
    // `paddock` is deliberately absent from these patches. A breach does not move
    // the herd's paddock, so recall has nothing to restore — and naming it here is
    // how the herd used to be teleported to Paddock A from wherever it had actually
    // rotated to.
    collars.update({ movement: "returning" }, { delayMs: 120 });
    collars.update({ strays: 0, breachSector: null, movement: "contained" }, { delayMs: 1400 });
    collars.update({ movement: "grazing" }, { delayMs: 2200 });

    // The dogs are a separate physical device and their movement is deliberately
    // NOT what tells Aeolus the herd is contained — the collars above are. The pack
    // is dispatched alongside so the recall is something you can watch happen,
    // and it keeps working after the command has already been verified.
    this.deployDogs();
  }

  /**
   * Send the pack out to the strays and back.
   *
   * Timing matters for a reason beyond looking right: containment above lands at
   * about 1.4s, well inside the recall command's five-second observation window, so
   * the command reaches OBSERVED on collar evidence. The dogs then trot home over
   * the following few seconds, after the command has already completed. The visible
   * sequence is longer than the verified one, which is exactly the distinction the
   * showcase is trying to make.
   */
  private deployDogs(): void {
    const dogsController = this.controller(AGRICULTURE_DEVICE_KEYS.dogs);
    const collars = this.controller(AGRICULTURE_DEVICE_KEYS.collars);
    if (!dogsController) return;

    const collarState = collars?.read() as CollarState | undefined;
    const paddock = String(collarState?.paddock ?? "A");
    const sector = String(collarState?.breachSector ?? "east");
    const home = PADDOCK_CENTRES[paddock] ?? PADDOCK_CENTRES.A;
    const breach = BREACH_POINTS[sector] ?? BREACH_POINTS.east;

    const resting = kenneledPack();
    // Each dog takes a slightly different line, so the pack reads as two animals
    // working rather than one sprite drawn twice.
    const spread = [-0.035, 0.035];

    dogsController.update({
      ...resting,
      working: true,
      deployed: resting.dogs.length,
      dogs: resting.dogs.map((dog, index) => ({
        ...dog,
        activity: "released",
        targetStray: index,
      })),
    }, { forcePublish: true });

    dogsController.transition({
      durationMs: 6600,
      steps: 22,
      group: DOG_WORK_GROUP,
      frame: (progress) => {
        // Out to the breach for the first third, driving the strays home for the
        // second, then back to the kennel.
        let activity: string;
        let point: { x: number; y: number };
        if (progress < 0.34) {
          activity = "intercepting";
          point = between(DOG_KENNEL, breach, progress / 0.34);
        } else if (progress < 0.62) {
          activity = "driving";
          point = between(breach, home, (progress - 0.34) / 0.28);
        } else if (progress < 1) {
          activity = "returning";
          point = between(home, DOG_KENNEL, (progress - 0.62) / 0.38);
        } else {
          activity = "kenneled";
          point = DOG_KENNEL;
        }

        const finished = progress >= 1;
        return {
          working: !finished,
          deployed: finished ? 0 : resting.dogs.length,
          dogs: resting.dogs.map((dog, index) => ({
            ...dog,
            activity,
            ...toGps({ x: point.x + (finished ? 0 : spread[index]), y: point.y }),
            // Working collars drain measurably faster than resting ones.
            battery: Math.max(0, Math.round(dog.battery - progress * 3)),
            targetStray: finished || activity === "returning" ? null : index,
          })),
        };
      },
    });
  }

  startTroughRefill(targetIds: string[]): void {
    const troughs = this.controller(AGRICULTURE_DEVICE_KEYS.troughs);
    if (!troughs) return;
    const state = troughs.read() as TroughState;
    // Never fill a trough cattle are standing at, and never stack two refills.
    if (state.herdPresent || Number(state.refilling || 0) > 0) return;
    const startLevels = Array.isArray(state.levels) ? [...state.levels] : [...INITIAL_TROUGH_LEVELS];
    const targets = (targetIds.length > 0 ? targetIds : state.lowIds || []).filter((id) => /^T(?:[1-9]|1\d|20)$/.test(id));
    if (targets.length === 0) return;

    const consumptionToday = Number(state.consumptionTodayLitres || 0);
    const lastDrink = Number(state.lastDrinkLitres || 0);
    const visit = Math.max(0, Number(state.visit) || 0);

    // Float valves close at slightly different points, so troughs finish between
    // 78% and 90% rather than every one landing on an identical figure.
    const finalLevels = [...startLevels];
    targets.forEach((id, offset) => {
      const index = Number(id.slice(1)) - 1;
      const target = 78 + ((visit * 3 + offset * 5) % 13);
      finalLevels[index] = Math.max(Number(startLevels[index]) || 0, target);
    });

    troughs.update(summarizeTroughs(startLevels, {
      phase: "refilling",
      herdPresent: false,
      visit,
      visitPaddock: String(state.visitPaddock ?? "A"),
      refilling: targets.length,
      refillTargets: targets,
      drinkingProgress: 100,
      consumptionTodayLitres: consumptionToday,
      lastDrinkLitres: lastDrink,
      refillFlowLpm: 46,
    }), { forcePublish: true });

    // Water arrives at a rate, so levels climb. Jumping to a mid value and then to
    // a flat 90 made a physical refill look like two assignments.
    troughs.transition({
      durationMs: 5200,
      steps: 16,
      group: TROUGH_REFILL_GROUP,
      frame: (progress) => {
        const finished = progress >= 1;
        const levels = startLevels.map((start, index) => start + (finalLevels[index] - start) * progress);
        return summarizeTroughs(levels, {
          phase: finished ? "idle" : "refilling",
          herdPresent: false,
          visit,
          visitPaddock: String(state.visitPaddock ?? "A"),
          refilling: finished ? 0 : targets.length,
          refillTargets: finished ? [] : targets,
          drinkingProgress: 100,
          consumptionTodayLitres: consumptionToday,
          lastDrinkLitres: lastDrink,
          // Flow stops when the last valve closes, which is the observation the
          // refill command is waiting on.
          refillFlowLpm: finished ? 0 : 46,
        });
      },
    });
  }

  dispose(): void {
    this.clearTransferTimers();
    this.clearTroughTimers();
  }

  private clearTransferTimers(): void {
    if (this.transferTimer) clearTimeout(this.transferTimer);
    if (this.transferFailsafeTimer) clearTimeout(this.transferFailsafeTimer);
    this.transferTimer = undefined;
    this.transferFailsafeTimer = undefined;
  }

  private clearTroughTimers(): void {
    // Both trough animations are owned by the trough controller, so cancelling its
    // groups stops them without this scenario tracking any timer handles.
    const troughs = this.controller(AGRICULTURE_DEVICE_KEYS.troughs);
    troughs?.cancelTransitions(TROUGH_VISIT_GROUP);
    troughs?.cancelTransitions(TROUGH_REFILL_GROUP);
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
  initialState: SimulatedState,
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

function commandDefinition(
  key: string,
  name: string,
  stateTopic: string,
  commandTopic: string,
  initialState: SimulatedState,
  env: AgricultureEnvironment,
  onCommand: (ctx: DeviceModelFactoryContext, command: SimulatedInboundCommand) => SimulatedCommandOutcome | Promise<SimulatedCommandOutcome>,
): AnyDeviceDefinition {
  return {
    key,
    name,
    stateTopic,
    commandTopic,
    initialState,
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => {
      env.register(ctx.key, ctx.state);
      return {
        getState: () => ctx.state.read(),
        onCommand: (command) => onCommand(ctx, command),
      };
    },
  };
}

export function createAgricultureScenario(): SimulatorScenario {
  const env = new AgricultureEnvironment();

  const pump = commandDefinition(
    AGRICULTURE_DEVICE_KEYS.pump,
    "Dam Transfer Pump",
    AGRICULTURE_STATE_TOPICS.pump,
    AGRICULTURE_COMMAND_TOPICS.pump,
    { ...INITIAL.pump },
    env,
    (_ctx, command) => {
      const on = command.params.on;
      if (typeof on !== "boolean") return { accepted: false, error: "dam-pump requires boolean on" };
      env.setPumpLoad(on);
      if (on) {
        const requested = Number(command.params.litres);
        env.scheduleTransfer(Number.isFinite(requested) ? Math.max(100, Math.min(3000, requested)) : 500);
      } else {
        env.stopFlow();
      }
      return { accepted: true, state: { patch: { on, running: on } } };
    },
  );

  const shedFill = commandDefinition(
    AGRICULTURE_DEVICE_KEYS.shedFill,
    "Shed Tank Fill Valve",
    AGRICULTURE_STATE_TOPICS.shedFill,
    AGRICULTURE_COMMAND_TOPICS.shedFill,
    { ...INITIAL.shedFill },
    env,
    (ctx, command) => {
      if (command.params.on !== true) return { accepted: false, error: "shed-fill requires on=true" };
      const target = Number(command.params.targetPct);
      env.refillDownstream("shed", Number.isFinite(target) ? target : 80);
      ctx.state.update({ on: false }, { delayMs: 1200 });
      return { accepted: true, state: { patch: { on: true } } };
    },
  );

  const houseFill = commandDefinition(
    AGRICULTURE_DEVICE_KEYS.houseFill,
    "House Tank Fill Valve",
    AGRICULTURE_STATE_TOPICS.houseFill,
    AGRICULTURE_COMMAND_TOPICS.houseFill,
    { ...INITIAL.houseFill },
    env,
    (ctx, command) => {
      if (command.params.on !== true) return { accepted: false, error: "house-fill requires on=true" };
      const target = Number(command.params.targetPct);
      env.refillDownstream("house", Number.isFinite(target) ? target : 75);
      ctx.state.update({ on: false }, { delayMs: 1200 });
      return { accepted: true, state: { patch: { on: true } } };
    },
  );

  const recall = commandDefinition(
    AGRICULTURE_DEVICE_KEYS.recall,
    "Virtual Fence Recall",
    AGRICULTURE_STATE_TOPICS.recall,
    AGRICULTURE_COMMAND_TOPICS.recall,
    { ...INITIAL.recall },
    env,
    (ctx, command) => {
      if (command.params.active !== true) return { accepted: false, error: "recall requires active=true" };
      env.completeRecall();
      ctx.state.update({ active: false }, { delayMs: 1800 });
      return { accepted: true, state: { patch: { active: true } } };
    },
  );

  const troughRefill = commandDefinition(
    AGRICULTURE_DEVICE_KEYS.troughRefill,
    "Trough Refill Manifold",
    AGRICULTURE_STATE_TOPICS.troughRefill,
    AGRICULTURE_COMMAND_TOPICS.troughRefill,
    { ...INITIAL.troughRefill },
    env,
    (ctx, command) => {
      if (command.params.active !== true) return { accepted: false, error: "trough refill requires active=true" };
      const targets = Array.isArray(command.params.targets)
        ? command.params.targets.filter((value): value is string => typeof value === "string")
        : [];
      env.startTroughRefill(targets);
      ctx.state.update({ active: false }, { delayMs: 2800 });
      return { accepted: true, state: { patch: { active: true } } };
    },
  );

  const chargerBank = commandDefinition(
    AGRICULTURE_DEVICE_KEYS.chargerBank,
    "Shed Charger Bank",
    AGRICULTURE_STATE_TOPICS.chargerBank,
    AGRICULTURE_COMMAND_TOPICS.chargerBank,
    { ...INITIAL.chargerBank },
    env,
    (_ctx, command) => {
      const on = command.params.on;
      if (typeof on !== "boolean") return { accepted: false, error: "charger-bank requires boolean on" };
      env.setChargerLoad(on);
      return { accepted: true, state: { patch: { on, watts: on ? CHARGER_LOAD_KW * 1000 : 0 } } };
    },
  );

  const devices: AnyDeviceDefinition[] = [
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.dam, "Farm Dam", AGRICULTURE_STATE_TOPICS.dam, { ...INITIAL.dam }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.header, "Header Tank", AGRICULTURE_STATE_TOPICS.header, { ...INITIAL.header }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.shed, "Shed Tank", AGRICULTURE_STATE_TOPICS.shed, { ...INITIAL.shed }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.house, "House Tank", AGRICULTURE_STATE_TOPICS.house, { ...INITIAL.house }, env),
    pump,
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.flow, "Transfer Flow", AGRICULTURE_STATE_TOPICS.flow, { ...INITIAL.flow }, env),
    shedFill,
    houseFill,
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.energiser, "Fence Energiser", AGRICULTURE_STATE_TOPICS.energiser, { ...INITIAL.energiser }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.collars, "GPS Cattle Collars", AGRICULTURE_STATE_TOPICS.collars, { ...INITIAL.collars }, env),
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.dogs, "GPS Working Dog Collars", AGRICULTURE_STATE_TOPICS.dogs, kenneledPack(), env),
    recall,
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.troughs, "Distributed Troughs", AGRICULTURE_STATE_TOPICS.troughs, { ...INITIAL.troughs, levels: [...INITIAL_TROUGH_LEVELS] }, env),
    troughRefill,
    sensorDefinition(AGRICULTURE_DEVICE_KEYS.battery, "Site Battery", AGRICULTURE_STATE_TOPICS.battery, { ...INITIAL.battery }, env),
    chargerBank,
  ];

  return {
    key: AGRICULTURE_SCENARIO_KEY,
    devices,
    stimuli: {
      [AGRICULTURE_STIMULUS.headerLow]: () => env.lowerHeader(),
      [AGRICULTURE_STIMULUS.propertyDemand]: () => env.propertyWaterDemand(),
      [AGRICULTURE_STIMULUS.boundaryBreach]: () => env.boundaryBreach(),
      [AGRICULTURE_STIMULUS.moveHerd]: () => env.moveHerd(),
      [AGRICULTURE_STIMULUS.fenceFault]: () => env.fenceFault(),
      [AGRICULTURE_STIMULUS.fenceRestore]: () => env.restoreFence(),
      [AGRICULTURE_STIMULUS.troughsLow]: () => env.lowerTroughs(),
      [AGRICULTURE_STIMULUS.troughsDrink]: () => env.drinkTroughs(),
      [AGRICULTURE_STIMULUS.energyLow]: () => env.setEnergyLow(),
      [AGRICULTURE_STIMULUS.energyRestore]: () => env.restoreEnergy(),
      [AGRICULTURE_STIMULUS.waterReset]: () => env.resetWater(),
      [AGRICULTURE_STIMULUS.livestockReset]: () => env.resetLivestock(),
      [AGRICULTURE_STIMULUS.troughsReset]: () => env.resetTroughs(),
      [AGRICULTURE_STIMULUS.energyReset]: () => env.resetEnergy(),
      [AGRICULTURE_STIMULUS.reset]: () => env.reset(),
    },
    dispose: () => env.dispose(),
  };
}
