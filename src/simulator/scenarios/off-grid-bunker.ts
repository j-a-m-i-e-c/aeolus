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
/** Transition group for the generator's output spinning up and down. */
const GENERATOR_GROUP = "generator-output";

/**
 * The power model (showcase-cleanup §9.5).
 *
 * Battery charge used to be a pair of constants: starting the generator waited 1.8s and
 * then asserted `battery: 31`, which also rewrote `solarW` — so a generator start
 * changed the weather. Nothing integrated anything, `outputW` appeared at full value
 * instantly, and `fuel` was a number no code ever touched.
 *
 * Now there is one balance, `netW = solarW + generatorOutputW - loadW`, integrated into
 * a real state of charge. That makes the controls legible: the operator can see the
 * generator cover the deficit, the battery climb, and the fuel pay for it.
 */
/**
 * What the generator produces at full output, in watts.
 *
 * Power & Supplies verifies a start against 1500 W of measured output, so the ramp has
 * to pass that comfortably. No threshold is needed here: unlike the floodlights, nothing
 * in the simulated world reacts to a particular output level, so the number belongs to
 * the automation that makes the claim and the scenario test is what holds the ramp to it.
 */
const GENERATOR_OUTPUT_W = 2200;
/** How long the generator takes to come up to output, in ms. */
const GENERATOR_RAMP_MS = 1400;
/** Usable capacity of the battery bank, in watt-hours. */
const BATTERY_CAPACITY_WH = 9600;
/** Run time from a full tank at full output, in hours. */
const GENERATOR_RUN_HOURS = 9;
/** How often the power balance is integrated, in ms of wall time. */
const POWER_TICK_MS = 2_000;
/**
 * Simulated seconds per real second for the POWER model only.
 *
 * The battery and the fuel tank are the things a short demo needs to see move, so
 * their integration runs faster than real time. This scale deliberately does NOT
 * reach the cistern: accelerating drinking water made an ~80 day supply fall by a
 * litre every few seconds, which published `sensor/bunker/supplies` continuously and
 * taught the visitor that Aeolus is noisy rather than that the bunker is well
 * provisioned. See {@link waterDrawnLitres}.
 *
 * It was 300x, which was chosen to make the WRONG thing visible. The passive balance
 * is a ~20 W deficit against a 9.6 kWh bank — around 480 real hours to empty — so
 * showing that drift required a multiplier that then applied to everything else. At
 * 300x a full fuel tank lasted 108 seconds of wall time, which made
 * {@link GENERATOR_RUN_HOURS} decoration: the gauge read nine hours and behaved like
 * one minute.
 *
 * The demo does not need the passive drift to carry it. The interesting states are
 * injected — `lowPower()` puts the bank at 27% directly — and the generator ramp runs
 * on its own wall clock ({@link GENERATOR_RAMP_MS}), independent of this scale. So
 * this is sized for the two things that genuinely have to be watchable:
 *
 *   recharge from a low-power scenario   ~10 minutes
 *   a full tank at full output           18 minutes, against 9 simulated hours
 *
 * The passive drift is then background texture at roughly 1% per 10 minutes, rather
 * than a battery reading published every minute for nothing.
 */
const POWER_TIME_SCALE = 30;
/** What one occupant drinks, washes and cooks with per day, in litres. */
const WATER_LITRES_PER_PERSON_DAY = 26;

/**
 * Litres drawn from the cistern by `occupants` people over `wallSeconds` of REAL time.
 *
 * Pure, and exported, so the consumption rate can be asserted directly instead of by
 * advancing thousands of timer ticks and inferring it. This is the function that must
 * not see {@link POWER_TIME_SCALE}: water is consumed by people living at normal speed,
 * whatever rate the power model is being integrated at.
 */
export function waterDrawnLitres(occupants: number, wallSeconds: number): number {
  return (occupants * WATER_LITRES_PER_PERSON_DAY * wallSeconds) / 86400;
}
/** How far out the perimeter classifier can track movement, in metres. */
const PERIMETER_TRACK_M = 140;
/** Inside this range a tracked object is raised as a contact, in metres. */
const PERIMETER_DETECT_M = 60;
/**
 * Where the explicit demo stimulus places a new group. The classifier itself still
 * tracks to 140 m, but spawning a demo interaction at that outer limit made a visitor
 * wait ~11 seconds before anything crossed the alert ring. Starting just outside the
 * ring keeps the important sequence visible: approach first, then detection ~2–3s later.
 */
const PERIMETER_DEMO_SPAWN_M = 78;
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
  // reading agrees with the model that maintains it from then on. Solar is sized so a
  // fair day roughly covers the site and trickles the bank upward, which is what an
  // off-grid install is actually designed for — and it leaves the demo's own scenarios
  // as the things that move the battery rather than the sun overwhelming them.
  power: { solarW: 980, battery: 74, loadW: siteLoadW(false, false, false), netW: 980 - siteLoadW(false, false, false) },
  generator: { on: false, fuel: 62, outputW: 0 },
  // Supplies are deliberately two different kinds of fact (showcase-cleanup §9.6).
  //
  // A sensor that magically knows there are 312 tins of beans is not credible, and it
  // taught the wrong lesson: Aeolus does not need every operational fact to come from
  // hardware. So the cistern has a level sensor, and everything a person had to count is
  // published as what it is — an inventory somebody maintains.
  supplies: {
    // Measured. A level sensor in the cistern, and the tank it is sitting in.
    waterLitres: 8_420,
    cisternCapacityL: 10_500,
    // Human-maintained. Nothing measures these; someone opened the store and counted.
    foodDays: 64,
    beans: 312,
    medicalCheckedDaysAgo: 12,
    occupants: 4,
    bunks: 6,
  },
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
    // How big the group being tracked in is, whether or not it is close enough to raise.
    // This used to be folded into `ambientContacts` while outside the ring, which left a
    // consumer no way to draw an approaching group at the range it had actually reached —
    // so it appeared at the treeline and then teleported inside the ring. Tracked size
    // and alert-worthy count are different facts (showcase-cleanup §9.3).
    approachGroupSize: group,
    contacts: raised ? group : 0,
    ambientContacts: PERIMETER_AMBIENT,
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
  /**
   * Charge in the bank, in watt-hours.
   *
   * Held in energy rather than percent so the published integer is a rounding of a real
   * quantity. A percent alone cannot be integrated without the rounding error becoming
   * the model.
   */
  private socWh = BATTERY_CAPACITY_WH * (I.power.battery / 100);
  /** Fuel remaining, as a percent of a full tank. */
  private fuelPct = I.generator.fuel;
  /** What is actually in the cistern, in litres, ahead of the sensor's rounding. */
  private waterL = I.supplies.waterLitres;

  register(k: string, s: SimulatedStateController): void { this.c.set(k, s); }
  get(k: string): SimulatedStateController | undefined { return this.c.get(k); }
  later(ms: number, f: () => void): void {
    const t = setTimeout(() => { this.timers.delete(t); f(); }, ms);
    this.timers.add(t);
  }
  clearTimers(): void { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  /** The instantaneous balance on the bus, in watts. */
  private balance(): { load: number; solar: number; gen: number; net: number } {
    const l = this.get(BUNKER_DEVICE_KEYS.lights)?.read();
    const f = this.get(BUNKER_DEVICE_KEYS.filter)?.read();
    const g = this.get(BUNKER_DEVICE_KEYS.generator)?.read();
    const p = this.get(BUNKER_DEVICE_KEYS.power);
    const load = siteLoadW(Boolean(l?.on), Boolean(f?.sealed), Boolean(this.get(BUNKER_DEVICE_KEYS.radio)?.read().tx));
    const solar = Number(p?.read().solarW ?? I.power.solarW);
    const gen = Number(g?.outputW ?? 0);
    return { load, solar, gen, net: solar + gen - load };
  }

  recalc(): void {
    const p = this.get(BUNKER_DEVICE_KEYS.power);
    if (!p) return;
    const { load, net } = this.balance();
    p.update({ loadW: load, netW: net }, { forcePublish: true });
  }

  /**
   * Integrate the power balance, and the fuel that is paying for part of it.
   *
   * Self-rescheduling through `later`, so it is tracked in the same timer set everything
   * else is and a reset or dispose stops it. The battery is only republished when its
   * rounded percent actually moves, which keeps a bus that is merely sitting near
   * equilibrium from publishing every couple of seconds.
   */
  private powerTick(): void {
    const p = this.get(BUNKER_DEVICE_KEYS.power);
    const g = this.get(BUNKER_DEVICE_KEYS.generator);
    if (p) {
      // Two clocks, deliberately. `powerSimSeconds` is accelerated so a visitor can
      // watch the bank charge and the tank empty inside a short demo; `wallSeconds` is
      // real time, and is what the people in the bunker drink on. The scale is modest
      // on purpose — see POWER_TIME_SCALE for why a large one flattered nothing.
      const wallSeconds = POWER_TICK_MS / 1000;
      const powerSimSeconds = wallSeconds * POWER_TIME_SCALE;
      const { load, net } = this.balance();
      const before = Math.round((this.socWh / BATTERY_CAPACITY_WH) * 100);
      this.socWh = Math.max(0, Math.min(BATTERY_CAPACITY_WH, this.socWh + net * (powerSimSeconds / 3600)));
      const battery = Math.round((this.socWh / BATTERY_CAPACITY_WH) * 100);

      // Fuel is spent in proportion to how hard the generator is working, so a ramping
      // machine does not bill for output it is not producing yet. It burns on the same
      // accelerated clock as the battery it is charging — the two have to agree or the
      // demo would show a tank that outlasts the run it is paying for.
      if (g && Boolean(g.read().on)) {
        const output = Number(g.read().outputW ?? 0);
        const burnPctPerSimSecond = 100 / (GENERATOR_RUN_HOURS * 3600);
        this.fuelPct = Math.max(0, this.fuelPct - burnPctPerSimSecond * powerSimSeconds * (output / GENERATOR_OUTPUT_W));
        const fuel = Math.round(this.fuelPct);
        if (Number(g.read().fuel) !== fuel) g.update({ fuel });
        // An empty tank stops the machine. Running on nothing would make the fuel
        // gauge decoration.
        if (this.fuelPct <= 0) this.setGenerator(g, false);
      }

      if (battery !== before) p.update({ battery, loadW: load, netW: net });

      // The cistern is genuinely being drawn down, by the people living here — at their
      // pace, not the power model's. Four occupants at 26 L/day is 104 L/day, about one
      // litre every fourteen minutes of real time, so the level sensor publishes when a
      // whole litre has actually gone rather than every couple of seconds. The useful
      // number was always the runway derived from it, not the litres ticking over.
      const s = this.get(BUNKER_DEVICE_KEYS.supplies);
      if (s) {
        const occupants = Number(s.read().occupants ?? I.supplies.occupants);
        this.waterL = Math.max(0, this.waterL - waterDrawnLitres(occupants, wallSeconds));
        const waterLitres = Math.round(this.waterL);
        if (Number(s.read().waterLitres) !== waterLitres) s.update({ waterLitres });
      }
    }
    this.later(POWER_TICK_MS, () => this.powerTick());
  }

  /** Begin integrating. Called once the devices are registered. */
  startPowerModel(): void { this.later(POWER_TICK_MS, () => this.powerTick()); }

  reset(): void {
    this.clearTimers();
    this.get(BUNKER_DEVICE_KEYS.perimeter)?.cancelTransitions(PERIMETER_GROUP);
    this.get(BUNKER_DEVICE_KEYS.lights)?.cancelTransitions(FLOODLIGHT_GROUP);
    this.get(BUNKER_DEVICE_KEYS.generator)?.cancelTransitions(GENERATOR_GROUP);
    this.group = 0;
    this.socWh = BATTERY_CAPACITY_WH * (I.power.battery / 100);
    this.fuelPct = I.generator.fuel;
    this.waterL = I.supplies.waterLitres;
    for (const [k, v] of Object.entries(I)) {
      this.get(BUNKER_DEVICE_KEYS[k as keyof typeof BUNKER_DEVICE_KEYS])?.update({ ...v }, { forcePublish: true });
    }
    this.recalc();
    // clearTimers() above stopped the integrator along with everything else, so it has
    // to be armed again or the bus would freeze after a reset.
    this.startPowerModel();
  }

  /** A group works its way in from the treeline. */
  shuffle(): void {
    const perimeter = this.get(BUNKER_DEVICE_KEYS.perimeter);
    if (!perimeter) return;
    this.seq += 1;
    const sectors = ["east", "north", "west", "south"];
    this.group = 1 + (this.seq % 4);
    const from = PERIMETER_DEMO_SPAWN_M;
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
        // Once a withdrawing group crosses the outer tracking boundary it is no
        // longer part of the tracked approach group. Keeping its old group size at
        // `movement=clear` left three invisible-but-still-tracked zombies in the
        // overview after "Force retreat" completed.
        const visibleGroup = done && settled === "clear" ? 0 : group;
        return perimeterAt(
          rangeM,
          visibleGroup,
          done ? settled : movement,
          done ? 0 : direction * CONTACT_PACE_MPS,
        );
      },
      onSettled: (completed) => {
        if (completed && settled === "clear") this.group = 0;
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
    if (from >= PERIMETER_DETECT_M) {
      // Outside the alert ring nothing was ever raised as a contact — `perimeterAt`
      // only reports one at or inside PERIMETER_DETECT_M — so there is no withdrawal
      // for anyone to watch, just an approach to abandon. Walking it out anyway left
      // `movement` reading `withdrawing` for several seconds while the count it refers
      // to stayed zero.
      //
      // This is also the path taken when `clear` arrives in the same tick as the
      // approach that started it, before that approach has rendered a single frame.
      // The transition is cancelled explicitly rather than left running underneath a
      // state that says the perimeter is clear.
      perimeter.cancelTransitions(PERIMETER_GROUP);
      this.group = 0;
      perimeter.update(perimeterAt(PERIMETER_TRACK_M, 0, "clear", 0), { forcePublish: true });
      return;
    }
    // Inside the ring the group is a reported contact, so it has to be seen leaving
    // rather than deleted from under the operator.
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
    // Cloud cover and a drawn-down bank. The battery is set through the integrator's own
    // store, so the model continues from this reading rather than fighting it.
    this.socWh = BATTERY_CAPACITY_WH * 0.27;
    this.get(BUNKER_DEVICE_KEYS.power)?.update({ solarW: 160, battery: 27 }, { forcePublish: true });
    this.recalc();
  }

  powerReset(): void {
    this.get(BUNKER_DEVICE_KEYS.generator)?.cancelTransitions(GENERATOR_GROUP);
    this.socWh = BATTERY_CAPACITY_WH * (I.power.battery / 100);
    this.fuelPct = I.generator.fuel;
    this.get(BUNKER_DEVICE_KEYS.power)?.update({ ...I.power }, { forcePublish: true });
    this.get(BUNKER_DEVICE_KEYS.generator)?.update({ ...I.generator }, { forcePublish: true });
    this.recalc();
  }

  /**
   * Start or stop the generator.
   *
   * Output ramps rather than appearing: a contactor that has closed is not yet a machine
   * making power, and the gap between those two facts is what the generator command is
   * verified against. `on` publishes immediately; `outputW` arrives as the engine comes
   * up. The balance is recomputed on every frame, so the operator watches the deficit
   * close rather than being told afterwards that it did.
   */
  setGenerator(s: SimulatedStateController, on: boolean): void {
    const from = Number(s.read().outputW ?? 0);
    const to = on ? GENERATOR_OUTPUT_W : 0;
    s.update({ on }, { forcePublish: true });
    s.transition({
      durationMs: on ? GENERATOR_RAMP_MS : 900,
      steps: on ? 7 : 5,
      group: GENERATOR_GROUP,
      frame: (progress) => {
        const outputW = Math.round(from + (to - from) * progress);
        // The bus follows the machine on every frame, so the deficit visibly closes as
        // the engine comes up. Computed from this frame's output rather than read back
        // off the device, because the patch below has not been applied yet.
        const p = this.get(BUNKER_DEVICE_KEYS.power);
        if (p) {
          const { load, solar } = this.balance();
          p.update({ loadW: load, netW: solar + outputW - load });
        }
        return { outputW };
      },
      onSettled: () => this.recalc(),
    });
    this.recalc();
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
    // No `outputW` in the resulting-state patch. It used to be asserted here at full
    // value in the same breath as `on`, which made the two indistinguishable and left
    // nothing for a command to prove beyond the contactor closing. Output is ramped by
    // the machine, so `on` publishes now and power arrives as the engine comes up.
    e.setGenerator(ctx.state, c.params.on);
    return { accepted: true, state: { patch: { on: c.params.on } } };
  });

  const radio = act(BUNKER_DEVICE_KEYS.radio, "VHF Radio", BUNKER_STATE_TOPICS.radio, BUNKER_COMMAND_TOPICS.radio, { ...I.radio }, e, (ctx, c) => {
    if (typeof c.params.tx !== "boolean") return { accepted: false, error: "radio requires boolean tx" };
    e.setRadio(ctx.state, c.params.tx);
    return { accepted: true, state: { patch: { tx: c.params.tx } } };
  });

  // The bus is always doing something, so the integrator runs from the start rather than
  // being switched on by an interaction. It publishes only when the rounded battery
  // percent actually moves, so a site sitting near equilibrium stays quiet.
  e.startPowerModel();

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
