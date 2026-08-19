import type {
  AnyDeviceDefinition,
  DeviceModelFactoryContext,
  SimulatedInboundCommand,
  SimulatedCommandOutcome,
  SimulatedState,
  SimulatedStateController,
  SimulatorScenario,
} from "../types.js";

export const WILDLIFE_SCENARIO_KEY = "wildlife";

export const WILDLIFE_DEVICE_KEYS = {
  camera: "wildlife-camera",
  detection: "wildlife-detection",
  deterrent: "wildlife-deterrent",
  nest: "wildlife-nest",
  power: "wildlife-power",
} as const;

export const WILDLIFE_STATE_TOPICS = {
  camera: "sensor/wildlife/camera",
  detection: "sensor/wildlife/detection",
  deterrent: "switch/wildlife/deterrent/state",
  nest: "sensor/wildlife/nest",
  power: "sensor/wildlife/site-power",
} as const;

export const WILDLIFE_COMMAND_TOPICS = {
  deterrent: "switch/wildlife/deterrent/set",
} as const;

export const WILDLIFE_STIMULUS = {
  native: "wildlife/sim/native-detection",
  fox: "wildlife/sim/fox-detection",
  cat: "wildlife/sim/cat-detection",
  nestVisit: "wildlife/sim/nest-visit",
  heatWave: "wildlife/sim/nest-heat",
  nestReset: "wildlife/sim/nest-reset",
  reset: "wildlife/sim/reset",
} as const;

const INITIAL = {
  camera: { online: true, model: "TrailCam-01", accelerator: "Hailo-8L", fps: 30, inferenceMs: 17, framesToday: 18432 },
  detection: { eventId: "dawn-001", species: "ringtail-possum", label: "Ringtail Possum", category: "native", confidence: 0.91, distanceM: 7.2, direction: "east", ts: 0 },
  deterrent: { active: false, mode: "light-sound", target: "none", pulseMs: 0, activationsToday: 3 },
  nest: { temp: 31.8, humidity: 61, occupied: true, adultPresent: false, adultGliders: 2, joeys: 2, visitsToday: 7, thermalState: "normal" },
  power: { solarW: 41, battery: 87, nodeW: 8.4, status: "solar" },
};

class WildlifeEnvironment {
  private controllers = new Map<string, SimulatedStateController>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private seq = 10;
  private nativeIndex = 0;

  register(key: string, controller: SimulatedStateController): void { this.controllers.set(key, controller); }
  controller(key: string): SimulatedStateController | undefined { return this.controllers.get(key); }
  later(delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, delayMs);
    this.timers.add(timer);
  }
  clearTimers(): void { for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }

  reset(): void {
    this.clearTimers();
    this.controller(WILDLIFE_DEVICE_KEYS.camera)?.update({ ...INITIAL.camera }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.detection)?.update({ ...INITIAL.detection, ts: Date.now() - 16000 }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.deterrent)?.update({ ...INITIAL.deterrent }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.nest)?.update({ ...INITIAL.nest }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.power)?.update({ ...INITIAL.power }, { forcePublish: true });
  }

  detection(kind: "native" | "fox" | "cat"): void {
    const detection = this.controller(WILDLIFE_DEVICE_KEYS.detection);
    const camera = this.controller(WILDLIFE_DEVICE_KEYS.camera);
    if (!detection || !camera) return;
    this.seq += 1;
    const natives = [
      { species: "ringtail-possum", label: "Ringtail Possum", confidence: 0.94, distanceM: 7.2 },
      { species: "echidna", label: "Short-beaked Echidna", confidence: 0.89, distanceM: 5.8 },
      { species: "lyrebird", label: "Superb Lyrebird", confidence: 0.96, distanceM: 9.4 },
    ];
    const selected = kind === "fox"
      ? { species: "red-fox", label: "Red Fox", confidence: 0.97, distanceM: 11.3 }
      : kind === "cat"
        ? { species: "feral-cat", label: "Feral Cat", confidence: 0.93, distanceM: 6.6 }
        : natives[(this.nativeIndex = (this.nativeIndex + 1) % natives.length)];
    const category = kind === "native" ? "native" : "predator";
    camera.update({ framesToday: Number(camera.read().framesToday ?? 18432) + 28, inferenceMs: kind === "native" ? 18 : 16 });
    detection.update({ eventId: `wild-${this.seq}`, ...selected, category, direction: kind === "fox" ? "west" : "east", ts: Date.now() }, { forcePublish: true, delayMs: 160 });
  }

  setDeterrent(controller: SimulatedStateController, active: boolean, target: string, pulseMs: number): void {
    if (!active) { controller.update({ active: false, target: "none", pulseMs: 0 }); return; }
    const activations = Number(controller.read().activationsToday ?? 0) + 1;
    controller.update({ active: true, target, pulseMs, activationsToday: activations });
    this.later(Math.max(800, Math.min(7000, pulseMs || 4200)), () => controller.update({ active: false, target: "none", pulseMs: 0 }, { forcePublish: true }));
  }

  nestVisit(): void {
    const nest = this.controller(WILDLIFE_DEVICE_KEYS.nest); if (!nest || Boolean(nest.read().adultPresent)) return;
    nest.update({ adultPresent: true, occupied: true, visitsToday: Number(nest.read().visitsToday ?? 11) + 1, temp: Math.min(34, Number(nest.read().temp ?? 31.8) + 0.4) }, { forcePublish: true });
    this.later(2400, () => nest.update({ adultPresent: false }, { forcePublish: true }));
  }

  nestHeat(): void {
    const nest = this.controller(WILDLIFE_DEVICE_KEYS.nest); if (!nest) return;
    nest.update({ temp: 35.6, humidity: 50, thermalState: "watch" }, { forcePublish: true });
    this.later(650, () => nest.update({ temp: 38.2, humidity: 45, thermalState: "high" }, { forcePublish: true }));
  }

  nestReset(): void { this.controller(WILDLIFE_DEVICE_KEYS.nest)?.update({ ...INITIAL.nest }, { forcePublish: true }); }
  dispose(): void { this.clearTimers(); }
}

function sensorDefinition(key: string, name: string, topic: string, initialState: SimulatedState, env: WildlifeEnvironment): AnyDeviceDefinition {
  return { key, name, stateTopic: topic, initialState, createModel: (ctx) => { env.register(ctx.key, ctx.state); return { getState: () => ctx.state.read() }; } };
}

function commandDefinition(
  key: string, name: string, stateTopic: string, commandTopic: string, initialState: SimulatedState, env: WildlifeEnvironment,
  onCommand: (ctx: DeviceModelFactoryContext, command: SimulatedInboundCommand) => SimulatedCommandOutcome,
): AnyDeviceDefinition {
  return {
    key, name, stateTopic, commandTopic, initialState,
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (ctx) => { env.register(ctx.key, ctx.state); return { getState: () => ctx.state.read(), onCommand: (command) => onCommand(ctx, command) }; },
  };
}

export function createWildlifeScenario(): SimulatorScenario {
  const env = new WildlifeEnvironment();
  const deterrent = commandDefinition(
    WILDLIFE_DEVICE_KEYS.deterrent, "Humane Predator Deterrent", WILDLIFE_STATE_TOPICS.deterrent, WILDLIFE_COMMAND_TOPICS.deterrent, { ...INITIAL.deterrent }, env,
    (ctx, command) => {
      if (typeof command.params.active !== "boolean") return { accepted: false, error: "deterrent requires boolean active" };
      const active = command.params.active;
      const target = String(command.params.target || "predator");
      const pulseMs = Number(command.params.pulseMs || 4200);
      env.setDeterrent(ctx.state, active, target, pulseMs);
      return { accepted: true, state: { patch: active ? { active: true, target, pulseMs } : { active: false, target: "none", pulseMs: 0 } } };
    },
  );

  return {
    key: WILDLIFE_SCENARIO_KEY,
    devices: [
      sensorDefinition(WILDLIFE_DEVICE_KEYS.camera, "Trail Camera Edge Node", WILDLIFE_STATE_TOPICS.camera, { ...INITIAL.camera }, env),
      sensorDefinition(WILDLIFE_DEVICE_KEYS.detection, "Wildlife Classifier", WILDLIFE_STATE_TOPICS.detection, { ...INITIAL.detection, ts: Date.now() - 16000 }, env),
      deterrent,
      sensorDefinition(WILDLIFE_DEVICE_KEYS.nest, "Sugar Glider Den Monitor", WILDLIFE_STATE_TOPICS.nest, { ...INITIAL.nest }, env),
      sensorDefinition(WILDLIFE_DEVICE_KEYS.power, "Wildlife Edge Power", WILDLIFE_STATE_TOPICS.power, { ...INITIAL.power }, env),
    ],
    stimuli: {
      [WILDLIFE_STIMULUS.native]: () => env.detection("native"),
      [WILDLIFE_STIMULUS.fox]: () => env.detection("fox"),
      [WILDLIFE_STIMULUS.cat]: () => env.detection("cat"),
      [WILDLIFE_STIMULUS.nestVisit]: () => env.nestVisit(),
      [WILDLIFE_STIMULUS.heatWave]: () => env.nestHeat(),
      [WILDLIFE_STIMULUS.nestReset]: () => env.nestReset(),
      [WILDLIFE_STIMULUS.reset]: () => env.reset(),
    },
    dispose: () => env.dispose(),
  };
}
