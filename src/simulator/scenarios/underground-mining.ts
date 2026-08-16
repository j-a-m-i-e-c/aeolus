import type {
  AnyDeviceDefinition,
  DeviceModelFactoryContext,
  SimulatedInboundCommand,
  SimulatedCommandOutcome,
  SimulatedState,
  SimulatedStateController,
  SimulatorScenario,
} from "../types.js";

export const UNDERGROUND_MINING_SCENARIO_KEY = "underground-mining";

export const UNDERGROUND_MINING_DEVICE_KEYS = {
  gasL3: "mine-gas-l3",
  gasD7: "mine-gas-d7",
  ventilation: "mine-ventilation-controller",
  personnel: "mine-personnel",
  muster: "mine-muster-controller",
  sump: "mine-deep-sump",
  sumpPump: "mine-sump-pump",
} as const;

export const UNDERGROUND_MINING_STATE_TOPICS = {
  gasL3: "sensor/mine/gas/l3",
  gasD7: "sensor/mine/gas/drift-7",
  ventilation: "switch/mine/ventilation/state",
  personnel: "sensor/mine/personnel",
  muster: "switch/mine/muster/state",
  sump: "sensor/mine/sump/deep",
  sumpPump: "switch/mine/sump-pump/state",
} as const;

export const UNDERGROUND_MINING_COMMAND_TOPICS = {
  ventilation: "switch/mine/ventilation/set",
  muster: "switch/mine/muster/set",
  sumpPump: "switch/mine/sump-pump/set",
} as const;

export const UNDERGROUND_MINING_STIMULUS = {
  gasRise: "mine/sim/gas-rise",
  atmosphereReset: "mine/sim/atmosphere-reset",
  tagDropout: "mine/sim/tag-dropout",
  personnelReset: "mine/sim/personnel-reset",
  heavyInflow: "mine/sim/heavy-inflow",
  sumpReset: "mine/sim/sump-reset",
  reset: "mine/sim/reset",
} as const;

const INITIAL = {
  gasL3: { location: "Level 3", ch4: 0.30, co: 12, o2: 20.8, no2: 1.2 },
  gasD7: { location: "Drift 7", ch4: 0.42, co: 16, o2: 20.7, no2: 1.6 },
  ventilation: { on: true, mode: "auto", demand: 48, primaryRpm: 1136, boosterRpm: 840, airflow: 258 },
  personnel: { underground: 14, l1: 3, l2: 6, l3: 5, refuge: 0, unaccounted: 0, musterState: "normal" },
  muster: { active: false, alarm: false, state: "normal" },
  sump: { levelM: 1.8, inflowLps: 18, dischargeLps: 0, status: "normal" },
  sumpPump: { on: false, mode: "auto", flowLps: 0 },
};

type Domain = "atmosphere" | "personnel" | "sump";

class MineEnvironment {
  private readonly controllers = new Map<string, SimulatedStateController>();
  private readonly timers = new Map<Domain, Set<ReturnType<typeof setTimeout>>>();

  register(key: string, controller: SimulatedStateController): void { this.controllers.set(key, controller); }
  controller(key: string): SimulatedStateController | undefined { return this.controllers.get(key); }

  private clear(domain: Domain): void {
    const set = this.timers.get(domain);
    if (!set) return;
    for (const timer of set) clearTimeout(timer);
    set.clear();
  }

  private later(domain: Domain, delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.timers.get(domain)?.delete(timer);
      fn();
    }, delayMs);
    let set = this.timers.get(domain);
    if (!set) { set = new Set(); this.timers.set(domain, set); }
    set.add(timer);
  }

  reset(): void { this.resetAtmosphere(); this.resetPersonnel(); this.resetSump(); }

  resetAtmosphere(): void {
    this.clear("atmosphere");
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.gasL3)?.update({ ...INITIAL.gasL3 }, { forcePublish: true });
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.gasD7)?.update({ ...INITIAL.gasD7 }, { forcePublish: true });
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.ventilation)?.update({ ...INITIAL.ventilation }, { forcePublish: true });
  }

  gasRise(): void {
    this.clear("atmosphere");
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.gasD7)?.update({ location: "Drift 7", ch4: 1.12, co: 34, o2: 20.3, no2: 3.1 }, { forcePublish: true });
  }

  setVentilation(controller: SimulatedStateController, mode: "auto" | "boost"): void {
    if (mode === "boost") {
      controller.update({ on: true, mode: "boost", demand: 100, primaryRpm: 1500, boosterRpm: 1100, airflow: 330 });
      this.purgeGas();
      return;
    }
    controller.update({ on: true, mode: "auto", demand: 48, primaryRpm: 1136, boosterRpm: 840, airflow: 258 });
  }

  private purgeGas(): void {
    const gas = this.controller(UNDERGROUND_MINING_DEVICE_KEYS.gasD7);
    if (!gas || Number(gas.read().ch4 ?? 0) < 0.5) return;
    this.clear("atmosphere");
    this.later("atmosphere", 650, () => gas.update({ ch4: 0.82, co: 27, o2: 20.45, no2: 2.4 }));
    this.later("atmosphere", 1450, () => gas.update({ ch4: 0.49, co: 20, o2: 20.62, no2: 1.9 }));
    this.later("atmosphere", 2400, () => gas.update({ ch4: 0.36, co: 13, o2: 20.8, no2: 1.3 }));
  }

  resetPersonnel(): void {
    this.clear("personnel");
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.personnel)?.update({ ...INITIAL.personnel }, { forcePublish: true });
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.muster)?.update({ ...INITIAL.muster }, { forcePublish: true });
  }

  startMuster(controller: SimulatedStateController): void {
    this.clear("personnel");
    controller.update({ active: true, alarm: true, state: "mustering" });
    const people = this.controller(UNDERGROUND_MINING_DEVICE_KEYS.personnel);
    if (!people) return;
    people.update({ musterState: "mustering", refuge: 0, unaccounted: 0 });
    const steps = [
      { delay: 700, refuge: 4, l1: 2, l2: 5, l3: 3 },
      { delay: 1450, refuge: 8, l1: 1, l2: 3, l3: 2 },
      { delay: 2250, refuge: 12, l1: 0, l2: 1, l3: 1 },
      { delay: 3100, refuge: 14, l1: 0, l2: 0, l3: 0 },
    ];
    for (const step of steps) {
      this.later("personnel", step.delay, () => {
        people.update({ refuge: step.refuge, l1: step.l1, l2: step.l2, l3: step.l3, musterState: step.refuge === 14 ? "complete" : "mustering" });
        if (step.refuge === 14) controller.update({ active: true, alarm: true, state: "complete" });
      });
    }
  }

  clearMuster(controller: SimulatedStateController): void {
    this.resetPersonnel();
    controller.update({ active: false, alarm: false, state: "normal" }, { forcePublish: true });
  }

  tagDropout(): void {
    const people = this.controller(UNDERGROUND_MINING_DEVICE_KEYS.personnel);
    if (!people || Number(people.read().unaccounted ?? 0) > 0) return;
    people.update({ unaccounted: 1, underground: 14 }, { forcePublish: true });
    this.later("personnel", 2600, () => people.update({ unaccounted: 0 }, { forcePublish: true }));
  }

  resetSump(): void {
    this.clear("sump");
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.sump)?.update({ ...INITIAL.sump }, { forcePublish: true });
    this.controller(UNDERGROUND_MINING_DEVICE_KEYS.sumpPump)?.update({ ...INITIAL.sumpPump }, { forcePublish: true });
  }

  heavyInflow(): void {
    this.clear("sump");
    const sump = this.controller(UNDERGROUND_MINING_DEVICE_KEYS.sump);
    if (!sump) return;
    sump.update({ levelM: 2.8, inflowLps: 82, dischargeLps: 0, status: "rising" }, { forcePublish: true });
    this.later("sump", 600, () => sump.update({ levelM: 4.4, inflowLps: 82, status: "high" }));
  }

  setSumpPump(controller: SimulatedStateController, on: boolean): void {
    if (!on) {
      this.clear("sump");
      controller.update({ on: false, flowLps: 0 });
      this.controller(UNDERGROUND_MINING_DEVICE_KEYS.sump)?.update({ dischargeLps: 0, status: "normal" });
      return;
    }
    controller.update({ on: true, flowLps: 55 });
    const sump = this.controller(UNDERGROUND_MINING_DEVICE_KEYS.sump);
    if (!sump) return;
    this.clear("sump");
    const start = Number(sump.read().levelM ?? 1.8);
    const levels = start > 4 ? [3.5, 2.4, 1.3] : [Math.max(1.3, start - 0.7), 1.3];
    levels.forEach((level, index) => this.later("sump", 650 + index * 750, () => sump.update({ levelM: level, inflowLps: index === levels.length - 1 ? 20 : 36, dischargeLps: 55, status: level <= 1.5 ? "low" : "draining" })));
  }

  dispose(): void {
    this.clear("atmosphere"); this.clear("personnel"); this.clear("sump");
  }
}

function sensorDefinition(key: string, name: string, stateTopic: string, initialState: SimulatedState, env: MineEnvironment): AnyDeviceDefinition {
  return { key, name, stateTopic, initialState, createModel: (ctx) => { env.register(ctx.key, ctx.state); return { getState: () => ctx.state.read() }; } };
}

function commandDefinition(
  key: string,
  name: string,
  stateTopic: string,
  commandTopic: string,
  initialState: SimulatedState,
  env: MineEnvironment,
  onCommand: (ctx: DeviceModelFactoryContext, command: SimulatedInboundCommand) => SimulatedCommandOutcome | Promise<SimulatedCommandOutcome>,
): AnyDeviceDefinition {
  return {
    key, name, stateTopic, commandTopic, initialState,
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => { env.register(ctx.key, ctx.state); return { getState: () => ctx.state.read(), onCommand: (command) => onCommand(ctx, command) }; },
  };
}

export function createUndergroundMiningScenario(): SimulatorScenario {
  const env = new MineEnvironment();

  const ventilation = commandDefinition(
    UNDERGROUND_MINING_DEVICE_KEYS.ventilation,
    "Mine Ventilation Controller",
    UNDERGROUND_MINING_STATE_TOPICS.ventilation,
    UNDERGROUND_MINING_COMMAND_TOPICS.ventilation,
    { ...INITIAL.ventilation },
    env,
    (ctx, command) => {
      const mode = String(command.params.mode || "");
      if (mode !== "auto" && mode !== "boost") return { accepted: false, error: "ventilation mode must be auto|boost" };
      env.setVentilation(ctx.state, mode);
      return { accepted: true, state: { patch: mode === "boost" ? { on: true, mode: "boost", demand: 100, primaryRpm: 1500, boosterRpm: 1100, airflow: 330 } : { on: true, mode: "auto", demand: 48, primaryRpm: 1136, boosterRpm: 840, airflow: 258 } } };
    },
  );

  const muster = commandDefinition(
    UNDERGROUND_MINING_DEVICE_KEYS.muster,
    "Mine Muster Controller",
    UNDERGROUND_MINING_STATE_TOPICS.muster,
    UNDERGROUND_MINING_COMMAND_TOPICS.muster,
    { ...INITIAL.muster },
    env,
    (ctx, command) => {
      if (typeof command.params.active !== "boolean") return { accepted: false, error: "muster controller requires boolean active" };
      if (command.params.active) env.startMuster(ctx.state); else env.clearMuster(ctx.state);
      return { accepted: true, state: { patch: { active: command.params.active, alarm: command.params.active, state: command.params.active ? "mustering" : "normal" } } };
    },
  );

  const sumpPump = commandDefinition(
    UNDERGROUND_MINING_DEVICE_KEYS.sumpPump,
    "Deep Sump Pump",
    UNDERGROUND_MINING_STATE_TOPICS.sumpPump,
    UNDERGROUND_MINING_COMMAND_TOPICS.sumpPump,
    { ...INITIAL.sumpPump },
    env,
    (ctx, command) => {
      if (typeof command.params.on !== "boolean") return { accepted: false, error: "sump pump requires boolean on" };
      env.setSumpPump(ctx.state, command.params.on);
      return { accepted: true, state: { patch: { on: command.params.on, flowLps: command.params.on ? 55 : 0 } } };
    },
  );

  const devices: AnyDeviceDefinition[] = [
    sensorDefinition(UNDERGROUND_MINING_DEVICE_KEYS.gasL3, "Level 3 Multi-Gas", UNDERGROUND_MINING_STATE_TOPICS.gasL3, { ...INITIAL.gasL3 }, env),
    sensorDefinition(UNDERGROUND_MINING_DEVICE_KEYS.gasD7, "Drift 7 Multi-Gas", UNDERGROUND_MINING_STATE_TOPICS.gasD7, { ...INITIAL.gasD7 }, env),
    ventilation,
    sensorDefinition(UNDERGROUND_MINING_DEVICE_KEYS.personnel, "Personnel Tracking", UNDERGROUND_MINING_STATE_TOPICS.personnel, { ...INITIAL.personnel }, env),
    muster,
    sensorDefinition(UNDERGROUND_MINING_DEVICE_KEYS.sump, "Deep Sump Level", UNDERGROUND_MINING_STATE_TOPICS.sump, { ...INITIAL.sump }, env),
    sumpPump,
  ];

  return {
    key: UNDERGROUND_MINING_SCENARIO_KEY,
    devices,
    stimuli: {
      [UNDERGROUND_MINING_STIMULUS.gasRise]: () => env.gasRise(),
      [UNDERGROUND_MINING_STIMULUS.atmosphereReset]: () => env.resetAtmosphere(),
      [UNDERGROUND_MINING_STIMULUS.tagDropout]: () => env.tagDropout(),
      [UNDERGROUND_MINING_STIMULUS.personnelReset]: () => env.resetPersonnel(),
      [UNDERGROUND_MINING_STIMULUS.heavyInflow]: () => env.heavyInflow(),
      [UNDERGROUND_MINING_STIMULUS.sumpReset]: () => env.resetSump(),
      [UNDERGROUND_MINING_STIMULUS.reset]: () => env.reset(),
    },
    dispose: () => env.dispose(),
  };
}
