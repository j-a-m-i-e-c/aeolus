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
  denFan: "wildlife-den-fan",
  power: "wildlife-power",
} as const;

export const WILDLIFE_STATE_TOPICS = {
  camera: "sensor/wildlife/camera",
  detection: "sensor/wildlife/detection",
  deterrent: "switch/wildlife/deterrent/state",
  nest: "sensor/wildlife/nest",
  denFan: "switch/wildlife/den-fan/state",
  power: "sensor/wildlife/site-power",
} as const;

export const WILDLIFE_COMMAND_TOPICS = {
  deterrent: "switch/wildlife/deterrent/set",
  denFan: "switch/wildlife/den-fan/set",
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
/** Transition group for the den-box cooling fan spinning up and down. */
const DEN_FAN_RPM_GROUP = "den-fan-rpm";
/** Transition group for the den box's own temperature moving. */
const DEN_TEMP_GROUP = "den-temp";
/** Impeller speed the den fan is asked for, in rpm. */
const DEN_FAN_TARGET_RPM = 1800;
/** Tachometer reading at which the fan is actually moving air. */
const DEN_FAN_VERIFIED_RPM = 1500;
/** Where an unmitigated hot afternoon takes the den box, in °C. */
const DEN_HOT_TEMP = 38.4;
/** The den box's resting temperature, in °C. */
const DEN_NORMAL_TEMP = 31.8;
/** At or above this the box is a welfare problem for the joeys, in °C. */
const DEN_ALERT_TEMP = 37.5;

const INITIAL = {
  camera: { online: true, model: "TrailCam-01", accelerator: "Hailo-8L", fps: 30, inferenceMs: 17, framesToday: 18432 },
  detection: { eventId: "dawn-001", species: "ringtail-possum", label: "Ringtail Possum", category: "native", confidence: 0.91, distanceM: 7.2, speedMps: 0, movement: "clear", direction: "east", ts: 0 },
  // `commandRpm` is what the controller was told; `measuredRpm` is what the
  // tachometer reads. Keeping them apart is what lets a command distinguish
  // ACKNOWLEDGED from OBSERVED instead of trusting the actuator's own flag.
  deterrent: { active: false, mode: "light-sound", target: "none", pulseMs: 0, activationsToday: 3, commandRpm: 0, measuredRpm: 0 },
  nest: { temp: DEN_NORMAL_TEMP, humidity: 61, occupied: true, adultPresent: false, adultGliders: 2, joeys: 2, visitsToday: 7, thermalState: "normal", heatLoad: false },
  // The den fan is a second ACK-capable actuator, and the same command/measured
  // split applies: a controller that accepted 1800 rpm is not a fan moving air.
  denFan: { active: false, commandRpm: 0, measuredRpm: 0, runsToday: 4, mode: "thermostat" },
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
    this.controller(WILDLIFE_DEVICE_KEYS.nest)?.cancelTransitions(DEN_TEMP_GROUP);
    this.controller(WILDLIFE_DEVICE_KEYS.denFan)?.cancelTransitions(DEN_FAN_RPM_GROUP);
    this.controller(WILDLIFE_DEVICE_KEYS.camera)?.update({ ...INITIAL.camera }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.detection)?.update({ ...INITIAL.detection, ts: Date.now() - 16000 }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.deterrent)?.update({ ...INITIAL.deterrent }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.nest)?.update({ ...INITIAL.nest }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.denFan)?.update({ ...INITIAL.denFan }, { forcePublish: true });
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
    nest.update({ adultPresent: true, occupied: true, visitsToday: Number(nest.read().visitsToday ?? 11) + 1, temp: Math.min(34, Number(nest.read().temp ?? DEN_NORMAL_TEMP) + 0.4) }, { forcePublish: true });
    this.later(2400, () => nest.update({ adultPresent: false }, { forcePublish: true }));
  }

  /**
   * A hot afternoon on the den box. The heat load stays on until the fan has held
   * the box in range long enough for the afternoon to pass, so stopping the fan
   * early has a visible consequence instead of freezing the reading.
   */
  nestHeat(): void { this.denWarms(2600); }

  /** Drive the den box up towards its unmitigated hot-afternoon temperature. */
  private denWarms(durationMs: number): void {
    const nest = this.controller(WILDLIFE_DEVICE_KEYS.nest);
    if (!nest) return;
    const from = Number(nest.read().temp ?? DEN_NORMAL_TEMP);
    nest.update({ heatLoad: true }, { forcePublish: true });
    nest.transition({
      durationMs,
      steps: 12,
      group: DEN_TEMP_GROUP,
      frame: (progress) => {
        const temp = Math.round((from + (DEN_HOT_TEMP - from) * progress) * 10) / 10;
        return {
          temp,
          humidity: Math.round(61 - 16 * progress),
          thermalState: temp >= DEN_ALERT_TEMP ? "high" : "watch",
        };
      },
    });
  }

  /** Air is moving, so the box sheds heat back towards its resting temperature. */
  private denCools(durationMs: number): void {
    const nest = this.controller(WILDLIFE_DEVICE_KEYS.nest);
    if (!nest) return;
    const from = Number(nest.read().temp ?? DEN_HOT_TEMP);
    nest.transition({
      durationMs,
      steps: 14,
      group: DEN_TEMP_GROUP,
      frame: (progress) => {
        const temp = Math.round((from + (DEN_NORMAL_TEMP - from) * progress) * 10) / 10;
        return {
          temp,
          humidity: Math.round(45 + 16 * progress),
          thermalState: temp >= DEN_ALERT_TEMP ? "high" : temp >= 34 ? "cooling" : "normal",
        };
      },
      onSettled: (completed) => {
        // By the time the box is back in range the hot part of the afternoon has
        // passed, so a later stop does not immediately undo the recovery.
        if (completed) nest.update({ heatLoad: false }, { forcePublish: true });
      },
    });
  }

  setDenFan(controller: SimulatedStateController, active: boolean, commandRpm: number): void {
    if (!active) {
      const from = Number(controller.read().measuredRpm ?? 0);
      controller.update({ active: false, commandRpm: 0 }, { forcePublish: true });
      controller.transition({
        durationMs: 800,
        steps: 6,
        group: DEN_FAN_RPM_GROUP,
        frame: (progress) => ({ measuredRpm: Math.round(from * (1 - progress)) }),
        onSettled: (completed) => {
          const nest = this.controller(WILDLIFE_DEVICE_KEYS.nest);
          if (completed && nest && Boolean(nest.read().heatLoad)) this.denWarms(5200);
        },
      });
      return;
    }

    controller.update({
      active: true,
      commandRpm,
      measuredRpm: 0,
      runsToday: Number(controller.read().runsToday ?? 4) + 1,
    }, { forcePublish: true });

    let movingAir = false;
    controller.transition({
      durationMs: 1200,
      steps: 8,
      group: DEN_FAN_RPM_GROUP,
      frame: (progress) => {
        const measuredRpm = Math.round(commandRpm * (0.05 + 0.95 * progress));
        // The box only starts losing heat once the impeller is genuinely turning.
        // Accepting the command cools nothing.
        if (!movingAir && measuredRpm >= DEN_FAN_VERIFIED_RPM) {
          movingAir = true;
          this.denCools(9000);
        }
        return { measuredRpm };
      },
    });
  }

  nestReset(): void {
    this.controller(WILDLIFE_DEVICE_KEYS.nest)?.cancelTransitions(DEN_TEMP_GROUP);
    this.controller(WILDLIFE_DEVICE_KEYS.denFan)?.cancelTransitions(DEN_FAN_RPM_GROUP);
    this.controller(WILDLIFE_DEVICE_KEYS.nest)?.update({ ...INITIAL.nest }, { forcePublish: true });
    this.controller(WILDLIFE_DEVICE_KEYS.denFan)?.update({ ...INITIAL.denFan }, { forcePublish: true });
  }
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

  const denFan = commandDefinition(
    WILDLIFE_DEVICE_KEYS.denFan, "Den Box Cooling Fan", WILDLIFE_STATE_TOPICS.denFan, WILDLIFE_COMMAND_TOPICS.denFan, { ...INITIAL.denFan }, env,
    (ctx, command) => {
      if (typeof command.params.active !== "boolean") return { accepted: false, error: "den fan requires boolean active" };
      const active = command.params.active;
      const requested = Number(command.params.rpm);
      const commandRpm = Number.isFinite(requested) && requested > 0 ? requested : DEN_FAN_TARGET_RPM;
      // A fan is not a thermostat: it can be asked for a speed it cannot reach, and
      // refusing an impossible target is more honest than pretending to hold it.
      if (active && commandRpm > DEN_FAN_TARGET_RPM) {
        return { accepted: false, error: `den fan cannot exceed ${DEN_FAN_TARGET_RPM} rpm` };
      }
      env.setDenFan(ctx.state, active, commandRpm);
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
      denFan,
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
