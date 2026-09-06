import type {
  AnyDeviceDefinition,
  DeviceModelFactoryContext,
  SimulatedInboundCommand,
  SimulatedCommandOutcome,
  SimulatedState,
  SimulatedStateController,
  SimulatorScenario,
} from "../types.js";

export const BUNKER_SCENARIO_KEY = "off-grid-bunker";

export const BUNKER_DEVICE_KEYS = {
  perimeter: "bunker-perimeter",
  lights: "bunker-lights",
  filter: "bunker-filter",
  power: "bunker-power",
  generator: "bunker-generator",
  supplies: "bunker-supplies",
  radioRx: "bunker-radio-rx",
  radio: "bunker-radio",
} as const;

export const BUNKER_STATE_TOPICS = {
  perimeter: "sensor/bunker/perimeter",
  lights: "switch/bunker/floodlights/state",
  filter: "switch/bunker/filter/state",
  power: "sensor/bunker/power",
  generator: "switch/bunker/generator/state",
  supplies: "sensor/bunker/supplies",
  radioRx: "sensor/bunker/radio/rx",
  radio: "switch/bunker/radio/state",
} as const;

export const BUNKER_COMMAND_TOPICS = {
  lights: "switch/bunker/floodlights/set",
  filter: "switch/bunker/filter/set",
  generator: "switch/bunker/generator/set",
  radio: "switch/bunker/radio/set",
} as const;

export const BUNKER_STIMULUS = {
  shuffle: "bunker/sim/shambling-contacts",
  clear: "bunker/sim/perimeter-clear",
  lowPower: "bunker/sim/low-power",
  powerReset: "bunker/sim/power-reset",
  radioRx: "bunker/sim/radio-contact",
  reset: "bunker/sim/reset",
} as const;

/** Transition group for contacts moving across the approach. */
const PERIMETER_GROUP = "perimeter-approach";
/** Transition group for the floodlights coming up to brightness. */
const FLOODLIGHT_GROUP = "floodlight-brightness";
/** How far out the perimeter classifier can track movement, in metres. */
const PERIMETER_TRACK_M = 140;
/** Inside this range a tracked object is raised as a contact, in metres. */
const PERIMETER_DETECT_M = 60;
/** The fence line, in metres from the cabin. */
const PERIMETER_FENCE_M = 18;
/** Objects the classifier is always tracking out past the treeline. */
const PERIMETER_AMBIENT = 2;
/** A shambling pace, in metres per second. */
const CONTACT_PACE_MPS = 0.6;
/** How much faster than reality the approach runs. */
const PERIMETER_TIME_SCALE = 12;
/** Floodlight brightness at which contacts turn away, in percent. */
const FLOODLIGHT_DETER_PCT = 70;

/**
 * What the perimeter is doing, as a phase.
 *
 * The classifier reported a bare contact count that jumped from 0 to 3 and back
 * again, so things arrived and vanished without ever crossing the ground between
 * the treeline and the fence. Movement is the missing fact.
 */
type PerimeterMovement = "clear" | "approaching" | "at-fence" | "withdrawing";

/** Everything currently drawing off the bunker's DC bus, in watts. */
function siteLoadW(lightsOn: boolean, sealed: boolean, transmitting: boolean): number {
  return 820 + (lightsOn ? 300 : 0) + (sealed ? 180 : 70) + (transmitting ? 75 : 0);
}

const I = {
  perimeter: {
    sector: "east",
    contacts: 0,
    // Tracked but not raised: the horizon is never empty out here, and that is a
    // measurement rather than set dressing.
    ambientContacts: PERIMETER_AMBIENT,
    rangeM: PERIMETER_TRACK_M,
    closingMps: 0,
    movement: "clear" as PerimeterMovement,
    classification: "distant-movement",
    trackRangeM: PERIMETER_TRACK_M,
    detectRangeM: PERIMETER_DETECT_M,
    fenceRangeM: PERIMETER_FENCE_M,
  },
  lights: { on: false, brightness: 0, mode: "auto" },
  // The air system is what knows the inside temperature, because it is the thing
  // moving the air. Sealing the bunker warms it slightly.
  filter: { on: true, sealed: false, overpressure: 8, filterLife: 78, tempC: 19.4 },
  // Load is not authored: it is what the site's own draws add up to, so the opening
  // reading agrees with the model that maintains it from then on.
  power: { solarW: 1800, battery: 74, loadW: siteLoadW(false, false, false), netW: 1800 - siteLoadW(false, false, false) },
  generator: { on: false, fuel: 62, outputW: 0 },
  supplies: { foodDays: 64, waterDays: 80, meds: 45, beans: 312, occupants: 4, bunks: 6 },
  radioRx: { frequency: 146.52, signal: "quiet", message: "", contactsToday: 3, ts: 0 },
  radio: { on: true, tx: false, frequency: 146.52, lastTx: "none" },
};

/**
 * Everything the perimeter reports at one nearest-contact range.
 *
 * Range is the only input: whether anything counts as a contact, and how it is
 * classified, both follow from how close it is. That is why the count can no longer
 * disagree with the picture.
 */
function perimeterAt(rangeM: number, group: number, movement: PerimeterMovement, closingMps: number): SimulatedState {
  const published = Math.round(Math.max(PERIMETER_FENCE_M, Math.min(PERIMETER_TRACK_M, rangeM)) * 10) / 10;
  const raised = published <= PERIMETER_DETECT_M;
  return {
    rangeM: published,
    contacts: raised ? group : 0,
    ambientContacts: raised ? PERIMETER_AMBIENT : PERIMETER_AMBIENT + group,
    movement,
    closingMps: Math.round(closingMps * 10) / 10,
    classification: raised ? "shambling-biped" : "distant-movement",
  };
}

class Env {
  private c = new Map<string, SimulatedStateController>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private seq = 0;
  /** How many are in the group currently working its way in. */
  private group = 0;

  register(k: string, s: SimulatedStateController): void { this.c.set(k, s); }
  get(k: string): SimulatedStateController | undefined { return this.c.get(k); }
  later(ms: number, f: () => void): void {
    const t = setTimeout(() => { this.timers.delete(t); f(); }, ms);
    this.timers.add(t);
  }
  clearTimers(): void { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  recalc(): void {
    const l = this.get(BUNKER_DEVICE_KEYS.lights)?.read();
    const f = this.get(BUNKER_DEVICE_KEYS.filter)?.read();
    const g = this.get(BUNKER_DEVICE_KEYS.generator)?.read();
    const p = this.get(BUNKER_DEVICE_KEYS.power);
    if (!p) return;
    const load = siteLoadW(Boolean(l?.on), Boolean(f?.sealed), Boolean(this.get(BUNKER_DEVICE_KEYS.radio)?.read().tx));
    const solar = Number(p.read().solarW ?? 1800);
    const gen = Number(g?.outputW ?? 0);
    p.update({ loadW: load, netW: solar + gen - load }, { forcePublish: true });
  }

  reset(): void {
    this.clearTimers();
    this.get(BUNKER_DEVICE_KEYS.perimeter)?.cancelTransitions(PERIMETER_GROUP);
    this.get(BUNKER_DEVICE_KEYS.lights)?.cancelTransitions(FLOODLIGHT_GROUP);
    this.group = 0;
    for (const [k, v] of Object.entries(I)) {
      this.get(BUNKER_DEVICE_KEYS[k as keyof typeof BUNKER_DEVICE_KEYS])?.update({ ...v }, { forcePublish: true });
    }
    this.recalc();
  }

  /** A group works its way in from the treeline. */
  shuffle(): void {
    const perimeter = this.get(BUNKER_DEVICE_KEYS.perimeter);
    if (!perimeter) return;
    this.seq += 1;
    const sectors = ["east", "north", "west", "south"];
    this.group = 1 + (this.seq % 4);
    const from = PERIMETER_TRACK_M;
    perimeter.update({
      sector: sectors[this.seq % 4],
      ...perimeterAt(from, this.group, "approaching", CONTACT_PACE_MPS),
    }, { forcePublish: true });
    this.walkPerimeter(from, PERIMETER_FENCE_M, "approaching", "at-fence");
  }

  /**
   * Move the nearest contact between two ranges.
   *
   * Approach and withdrawal share one transition group, so floodlights turning a
   * group back replaces the approach instead of racing it — and nothing is ever
   * deleted from the scene to make it stop.
   */
  private walkPerimeter(from: number, to: number, movement: PerimeterMovement, settled: PerimeterMovement): void {
    const perimeter = this.get(BUNKER_DEVICE_KEYS.perimeter);
    if (!perimeter) return;
    const group = this.group;
    const direction = to >= from ? 1 : -1;
    const durationMs = Math.max(700, Math.round(Math.abs(to - from) / CONTACT_PACE_MPS * 1000 / PERIMETER_TIME_SCALE));
    perimeter.transition({
      durationMs,
      steps: 14,
      group: PERIMETER_GROUP,
      frame: (progress) => {
        const rangeM = from + (to - from) * progress;
        const done = progress >= 1;
        return perimeterAt(
          rangeM,
          group,
          done ? settled : movement,
          done ? 0 : direction * CONTACT_PACE_MPS,
        );
      },
      onSettled: (completed) => {
        // Reaching the fence is not the end of the story: without a response they
        // mill about and then lose interest, so the scene resolves either way.
        if (completed && settled === "at-fence") this.later(6000, () => this.withdraw());
      },
    });
  }

  /** Contacts turn around and shamble back out past the treeline. */
  private withdraw(): void {
    const perimeter = this.get(BUNKER_DEVICE_KEYS.perimeter);
    if (!perimeter) return;
    const from = Number(perimeter.read().rangeM ?? PERIMETER_TRACK_M);
    if (from >= PERIMETER_TRACK_M) return;
    this.walkPerimeter(from, PERIMETER_TRACK_M, "withdrawing", "clear");
  }

  /**
   * The `perimeter-clear` stimulus.
   *
   * It withdraws the group rather than setting the count to zero: things that were
   * there a moment ago have to go somewhere.
   */
  clear(): void { this.withdraw(); }

  setLights(s: SimulatedStateController, on: boolean): void {
    const from = Number(s.read().brightness ?? 0);
    s.update({ on, mode: "auto" }, { forcePublish: true });
    let deterred = false;
    s.transition({
      durationMs: 700,
      steps: 7,
      group: FLOODLIGHT_GROUP,
      frame: (progress) => {
        const brightness = Math.round(from + ((on ? 100 : 0) - from) * progress);
        // Light is what turns them: the group withdraws when the floods are
        // genuinely bright, not when the command was accepted.
        if (on && !deterred && brightness >= FLOODLIGHT_DETER_PCT) {
          deterred = true;
          this.withdraw();
        }
        return { brightness };
      },
      onSettled: () => this.recalc(),
    });
    this.recalc();
  }

  setFilter(s: SimulatedStateController, sealed: boolean): void {
    // Sealed means less air exchange, so the space warms. A number that never moved
    // would be a label, not a reading.
    s.update({ on: true, sealed, overpressure: sealed ? 15 : 8, tempC: sealed ? 21.8 : 19.4 });
    this.recalc();
  }

  lowPower(): void {
    this.get(BUNKER_DEVICE_KEYS.power)?.update({ solarW: 160, battery: 27 }, { forcePublish: true });
    this.recalc();
  }

  powerReset(): void {
    this.get(BUNKER_DEVICE_KEYS.power)?.update({ ...I.power }, { forcePublish: true });
    this.get(BUNKER_DEVICE_KEYS.generator)?.update({ ...I.generator }, { forcePublish: true });
    this.recalc();
  }

  setGenerator(s: SimulatedStateController, on: boolean): void {
    s.update({ on, outputW: on ? 2200 : 0 });
    this.recalc();
    if (!on) return;
    this.later(1800, () => {
      this.get(BUNKER_DEVICE_KEYS.power)?.update({ battery: 31, solarW: 220 }, { forcePublish: true });
      this.recalc();
    });
  }

  radioContact(): void {
    const rx = this.get(BUNKER_DEVICE_KEYS.radioRx);
    if (!rx) return;
    rx.update({
      signal: "weak",
      message: "...any station north of the range, respond...",
      contactsToday: Number(rx.read().contactsToday ?? 3) + 1,
      ts: Date.now(),
    }, { forcePublish: true });
    this.later(3500, () => rx.update({ signal: "quiet" }, { forcePublish: true }));
  }

  setRadio(s: SimulatedStateController, tx: boolean): void {
    s.update({ tx, lastTx: tx ? "Bunker node online. Situation stable." : String(s.read().lastTx || "none") });
    this.recalc();
    if (!tx) return;
    this.later(1200, () => { s.update({ tx: false }, { forcePublish: true }); this.recalc(); });
  }

  dispose(): void { this.clearTimers(); }
}

function sensor(k: string, n: string, t: string, i: SimulatedState, e: Env): AnyDeviceDefinition {
  return { key: k, name: n, stateTopic: t, initialState: i, createModel: (c) => { e.register(c.key, c.state); return { getState: () => c.state.read() }; } };
}

function act(
  k: string, n: string, st: string, ct: string, i: SimulatedState, e: Env,
  h: (ctx: DeviceModelFactoryContext, c: SimulatedInboundCommand) => SimulatedCommandOutcome,
): AnyDeviceDefinition {
  return {
    key: k, name: n, stateTopic: st, commandTopic: ct, initialState: i,
    commandProfile: { acknowledgement: { supported: true }, qos: 1 },
    createModel: (c) => { e.register(c.key, c.state); return { getState: () => c.state.read(), onCommand: (x) => h(c, x) }; },
  };
}

export function createOffGridBunkerScenario(): SimulatorScenario {
  const e = new Env();

  const lights = act(BUNKER_DEVICE_KEYS.lights, "Perimeter Floodlights", BUNKER_STATE_TOPICS.lights, BUNKER_COMMAND_TOPICS.lights, { ...I.lights }, e, (ctx, c) => {
    if (typeof c.params.on !== "boolean") return { accepted: false, error: "lights require boolean on" };
    // No resulting-state patch: brightness is ramped by the fixture, so `on` is
    // published straight away while the light itself takes a moment to arrive.
    e.setLights(ctx.state, c.params.on);
    return { accepted: true };
  });

  const filter = act(BUNKER_DEVICE_KEYS.filter, "Positive Pressure Filter", BUNKER_STATE_TOPICS.filter, BUNKER_COMMAND_TOPICS.filter, { ...I.filter }, e, (ctx, c) => {
    if (typeof c.params.sealed !== "boolean") return { accepted: false, error: "filter requires boolean sealed" };
    e.setFilter(ctx.state, c.params.sealed);
    return { accepted: true, state: { patch: { on: true, sealed: c.params.sealed, overpressure: c.params.sealed ? 15 : 8 } } };
  });

  const gen = act(BUNKER_DEVICE_KEYS.generator, "Backup Generator", BUNKER_STATE_TOPICS.generator, BUNKER_COMMAND_TOPICS.generator, { ...I.generator }, e, (ctx, c) => {
    if (typeof c.params.on !== "boolean") return { accepted: false, error: "generator requires boolean on" };
    e.setGenerator(ctx.state, c.params.on);
    return { accepted: true, state: { patch: { on: c.params.on, outputW: c.params.on ? 2200 : 0 } } };
  });

  const radio = act(BUNKER_DEVICE_KEYS.radio, "VHF Radio", BUNKER_STATE_TOPICS.radio, BUNKER_COMMAND_TOPICS.radio, { ...I.radio }, e, (ctx, c) => {
    if (typeof c.params.tx !== "boolean") return { accepted: false, error: "radio requires boolean tx" };
    e.setRadio(ctx.state, c.params.tx);
    return { accepted: true, state: { patch: { tx: c.params.tx } } };
  });

  return {
    key: BUNKER_SCENARIO_KEY,
    devices: [
      sensor(BUNKER_DEVICE_KEYS.perimeter, "Perimeter Classifier", BUNKER_STATE_TOPICS.perimeter, { ...I.perimeter }, e),
      lights,
      filter,
      sensor(BUNKER_DEVICE_KEYS.power, "Bunker Power Bus", BUNKER_STATE_TOPICS.power, { ...I.power }, e),
      gen,
      sensor(BUNKER_DEVICE_KEYS.supplies, "Bunker Supplies", BUNKER_STATE_TOPICS.supplies, { ...I.supplies }, e),
      sensor(BUNKER_DEVICE_KEYS.radioRx, "VHF Receiver", BUNKER_STATE_TOPICS.radioRx, { ...I.radioRx }, e),
      radio,
    ],
    stimuli: {
      [BUNKER_STIMULUS.shuffle]: () => e.shuffle(),
      [BUNKER_STIMULUS.clear]: () => e.clear(),
      [BUNKER_STIMULUS.lowPower]: () => e.lowPower(),
      [BUNKER_STIMULUS.powerReset]: () => e.powerReset(),
      [BUNKER_STIMULUS.radioRx]: () => e.radioContact(),
      [BUNKER_STIMULUS.reset]: () => e.reset(),
    },
    dispose: () => e.dispose(),
  };
}
