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

/** Transition group for the animal's own movement through the camera's field. */
const ANIMAL_MOVE_GROUP = "animal-move";
/** Transition group for the deterrent fan spinning up and down. */
const DETERRENT_RPM_GROUP = "deterrent-rpm";
/** Fan speed the deterrent controller is asked for, in rpm. */
const DETERRENT_TARGET_RPM = 2400;
/** Tachometer reading that counts as the fan being up to speed. */
const DETERRENT_VERIFIED_RPM = 2000;

const INITIAL = {
  camera: { online: true, model: "TrailCam-01", accelerator: "Hailo-8L", fps: 30, inferenceMs: 17, framesToday: 18432 },
  detection: { eventId: "dawn-001", species: "ringtail-possum", label: "Ringtail Possum", category: "native", confidence: 0.91, distanceM: 7.2, speedMps: 0, movement: "clear", direction: "east", ts: 0 },
  // `commandRpm` is what the controller was told; `measuredRpm` is what the
  // tachometer reads. Keeping them apart is what lets a command distinguish
  // ACKNOWLEDGED from OBSERVED instead of trusting the actuator's own flag.
  deterrent: { active: false, mode: "light-sound", target: "none", pulseMs: 0, activationsToday: 3, commandRpm: 0, measuredRpm: 0 },
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
    // Stop any movement or spin-up still in flight, or it would keep writing over
    // the state this reset is restoring.
    this.controller(WILDLIFE_DEVICE_KEYS.detection)?.cancelTransitions(ANIMAL_MOVE_GROUP);
    this.controller(WILDLIFE_DEVICE_KEYS.deterrent)?.cancelTransitions(DETERRENT_RPM_GROUP);
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

    // The animal walks into the camera's field. Its distance is physical state the
    // simulator owns, so both Wildlife automations project the same movement rather
    // than each pane animating a private copy of the same creature.
    const settleAt = selected.distanceM;
    const enterAt = Math.round((settleAt + 13) * 10) / 10;
    detection.update({
      eventId: `wild-${this.seq}`,
      ...selected,
      category,
      direction: kind === "fox" ? "west" : "east",
      ts: Date.now(),
      distanceM: enterAt,
      speedMps: 1.1,
      movement: "approaching",
    }, { forcePublish: true });

    detection.transition({
      durationMs: 2600,
      steps: 10,
      group: ANIMAL_MOVE_GROUP,
      frame: (progress) => {
        const arrived = progress >= 1;
        return {
          distanceM: Math.round((enterAt + (settleAt - enterAt) * progress) * 10) / 10,
          speedMps: arrived ? 0.3 : 1.1,
          movement: arrived ? "browsing" : "approaching",
        };
      },
      onSettled: (completed) => {
        // Nothing is ever deleted from the scene. An animal the deterrent never
        // touches loses interest and wanders off on its own; if a deterrent fires
        // first, the flight replaces this because both use the same group.
        if (completed) this.later(4200, () => this.animalDeparts(2.2, 6200));
      },
    });
  }

  /** Move the current animal away from the camera. */
  private animalDeparts(peakSpeedMps: number, durationMs: number): void {
    const detection = this.controller(WILDLIFE_DEVICE_KEYS.detection);
    if (!detection) return;
    const from = Number(detection.read().distanceM ?? 12);
    const to = Math.round((from + 24) * 10) / 10;
    detection.transition({
      durationMs,
      steps: 14,
      group: ANIMAL_MOVE_GROUP,
      frame: (progress) => {
        const gone = progress >= 1;
        return {
          distanceM: Math.round((from + (to - from) * progress) * 10) / 10,
          // It accelerates away rather than drifting off at a constant walk.
          speedMps: gone ? 0 : Math.round((0.8 + peakSpeedMps * progress) * 10) / 10,
          movement: gone ? "clear" : "fleeing",
        };
      },
    });
  }

  setDeterrent(controller: SimulatedStateController, active: boolean, target: string, pulseMs: number, commandRpm: number): void {
    if (!active) {
      const from = Number(controller.read().measuredRpm ?? 0);
      controller.update({ active: false, target: "none", pulseMs: 0, commandRpm: 0 }, { forcePublish: true });
      // Spin-down is physical too, so a stop is verified by the fan actually
      // slowing rather than by the actuator reporting its own flag.
      controller.transition({
        durationMs: 900,
        steps: 6,
        group: DETERRENT_RPM_GROUP,
        frame: (progress) => ({ measuredRpm: Math.round(from * (1 - progress)) }),
      });
      return;
    }

    const activations = Number(controller.read().activationsToday ?? 0) + 1;
    // The controller has accepted a target; the fan has not reached it yet. This is
    // the difference between "the device confirmed receipt" and "the physical thing
    // happened", which is the whole point of the evidence ladder.
    controller.update({
      active: true,
      target,
      pulseMs,
      commandRpm,
      measuredRpm: 0,
      activationsToday: activations,
    }, { forcePublish: true });

    let fanUpToSpeed = false;
    controller.transition({
      durationMs: 1100,
      steps: 8,
      group: DETERRENT_RPM_GROUP,
      frame: (progress) => {
        const measuredRpm = Math.round(commandRpm * (0.06 + 0.94 * progress));
        // The animal reacts to the fan actually being up to speed, not to the
        // command being sent. Physical cause, physical effect — and a fan that
        // never reaches DETERRENT_VERIFIED_RPM never scares anything off.
        if (!fanUpToSpeed && measuredRpm >= DETERRENT_VERIFIED_RPM) {
          fanUpToSpeed = true;
          this.predatorFlees();
        }
        return { measuredRpm };
      },
    });

    this.later(Math.max(800, Math.min(7000, pulseMs || 4200)), () => {
      this.setDeterrent(controller, false, "none", 0, 0);
    });
  }

  /** A predator that has been deterred turns and runs. */
  private predatorFlees(): void {
    const detection = this.controller(WILDLIFE_DEVICE_KEYS.detection);
    if (!detection || String(detection.read().category) !== "predator") return;
    this.animalDeparts(3.6, 4200);
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
      const commandRpm = Number(command.params.rpm) || DETERRENT_TARGET_RPM;
      // The runtime's own resulting-state patch is deliberately not used here:
      // setDeterrent publishes the commanded target immediately and then ramps the
      // tachometer, so the two facts stay separately observable.
      env.setDeterrent(ctx.state, active, target, pulseMs, commandRpm);
      return { accepted: true };
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
