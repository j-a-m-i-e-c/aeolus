// Every showcase command's proof tier is a decision, and this is where it is defended.
//
// The failure this guards against was present on eight tabs: asking for
// `tier: "observed"` and then satisfying it with the target device's own echo of the
// command. A controller that republishes `on` the instant it accepts has measured
// nothing, so observing `on` proves exactly what DISPATCHED already proved while
// dressing it up as physical verification. That is worse than claiming less.
//
// Two rules are enforced mechanically, so a future author cannot drift back:
//
//   1. Every `devices.action` call site in the seeded projects is accounted for here.
//      Adding a command means adding an entry and defending its tier.
//   2. No `observed` command may key its condition off a field that is a command
//      echo. The banned list below is not style — each of those fields is written by
//      a fixture in the same update that accepts the command.
//
// A deliberate `acknowledged` is a correct answer, not a weaker demo. Some equipment
// genuinely cannot prove more, and the showcase exists partly to make that visible.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SimulatorDeviceRegistry } from "../simulator/device-registry.js";
import { createScenario, SHOWCASE_SCENARIO_KEYS } from "../simulator/scenarios/index.js";
import type { SimulatedInboundCommand } from "../simulator/types.js";

const PROJECTS = join(process.cwd(), "demo", "seed", "projects");

interface ProjectLogic {
  project: string;
  file: string;
  source: string;
  /** Count of `devices.action(` calls, however their options are constructed. */
  commands: number;
  /** Every `tier: "..."` value declared in the file. */
  tiers: string[];
  /** Every `condition:` value declared in the file. */
  conditions: string[];
}

/**
 * The authored showcase logic, read from source rather than from a hand-kept list, so
 * the list cannot fall behind the code.
 *
 * Deliberately file-level rather than call-site-level. Some projects build their
 * options in a variable before the call — the CTD winch picks a different condition
 * per phase — so a regex anchored on the call parentheses silently undercounts. Every
 * assertion below works over the whole file instead, which is both simpler and
 * immune to how the author happened to lay the call out.
 */
function readLogic(): ProjectLogic[] {
  const out: ProjectLogic[] = [];
  for (const project of readdirSync(PROJECTS)) {
    const logicDir = join(PROJECTS, project, "logic");
    let files: string[];
    try {
      if (!statSync(logicDir).isDirectory()) continue;
      files = readdirSync(logicDir).filter((f) => f.endsWith(".ts"));
    } catch {
      continue;
    }
    for (const file of files) {
      const source = readFileSync(join(logicDir, file), "utf8");
      const commands = [...source.matchAll(/devices\.action\(/g)].length;
      if (commands === 0) continue;
      out.push({
        project,
        file,
        source,
        commands,
        tiers: [...source.matchAll(/tier:\s*"(\w+)"/g)].map((m) => m[1]),
        // Up to the next key or the end of the object literal.
        conditions: [...source.matchAll(/condition:([\s\S]*?)(?:timeoutMs|evidence|\n\s*\})/g)].map(
          (m) => m[1],
        ),
      });
    }
  }
  return out;
}

const LOGIC = readLogic();

/**
 * The command each fixture is asked to accept, so its echo can be measured.
 *
 * This table is INPUTS only, and that distinction is the point. Which fields a device
 * echoes used to be a hand-written list of eight names checked against every project —
 * but echo-ness is a property of a fixture, not of a field name. `mode` is an echo on the
 * ventilation fan and a measurement nowhere; `brightness` is a measurement on the
 * floodlights and would be an echo if that fixture published it on acceptance. A global
 * name list cannot express that, and the old one was demonstrably incomplete: the tier
 * register's own justifications named `demand`, `rpm`, `airflow`, `lightPct` and `watts`
 * as echoes for their devices, none of which were banned.
 *
 * So the outcomes are measured instead of asserted. Each payload below is replayed
 * through the real fixture, and whatever it changes at acceptance is that device's echo
 * set. A fixture that starts echoing a new field is caught without anyone updating a
 * list, and one that stops — as the generator did when `outputW` was taken out of its
 * acceptance patch so the output could be genuinely observed — is released the same way.
 */
const COMMAND_PAYLOADS: Record<string, Record<string, unknown>> = {
  "switch/farm/dam-pump/set": { on: true, litres: 500 },
  "switch/farm/shed-fill/set": { on: true, target: 80 },
  "switch/farm/house-fill/set": { on: true, target: 75 },
  "switch/fence/recall/set": { active: true },
  "switch/farm/trough-refill/set": { active: true, targets: ["T1"] },
  "switch/farm/charger-bank/set": { on: true },
  "switch/vessel/ctd-winch/set": { mode: "deploy", targetDepth: 420 },
  "switch/rov/vehicle/set": { mode: "dive", targetDepth: 355 },
  "switch/vessel/tsg-pump/set": { on: true },
  "switch/mine/ventilation/set": { mode: "boost" },
  "switch/mine/muster/set": { active: true },
  "switch/mine/sump-pump/set": { on: true },
  "switch/wildlife/deterrent/set": { active: true, target: "Fox", pulseMs: 6200, rpm: 2400 },
  "switch/wildlife/den-fan/set": { active: true, rpm: 1800 },
  "switch/stage/dmx/set": { scene: "chorus", master: 88, transitionMs: 900 },
  "switch/stage/fx/set": { active: true, effect: "confetti", pulseMs: 1100, haze: 62 },
  "switch/escape/exit/set": { locked: false },
  "switch/escape/hint-screen/set": { message: "hint", room: "Library", hintId: 1 },
  "switch/escape/fx/set": { scene: "tension" },
  "switch/escape/intercom/set": { tx: true, room: "Library" },
  "switch/bunker/floodlights/set": { on: true },
  "switch/bunker/filter/set": { sealed: true },
  "switch/bunker/generator/set": { on: true },
  "switch/bunker/radio/set": { tx: true },
};

/**
 * A field a project observes on a device that echoes it, allowed for a stated reason.
 *
 * The one legitimate shape: the fixture sets the field on acceptance, but to a value the
 * condition is not waiting for, so satisfying the condition still requires physical
 * progress. Each entry records the accepted value it relies on, and the test checks that
 * the fixture really does behave that way — otherwise the exemption would quietly become
 * a hole the moment the fixture changed.
 */
const ECHO_EXEMPTIONS: Array<{
  topic: string;
  field: string;
  acceptedValue: unknown;
  why: string;
}> = [
  {
    topic: "switch/stage/dmx/state",
    field: "transitioning",
    acceptedValue: true,
    why: "the desk sets transitioning TRUE on acceptance and clears it on a timer once the fade has actually finished, so waiting for false is a real wait rather than a read-back",
  },
];

const SITES = readObservationSites();

/** Every field a fixture writes at acceptance, and the value it writes, by state topic. */
type EchoMap = Map<string, Map<string, unknown>>;

/**
 * Replay each showcase command against its real fixture and record what moves.
 *
 * "At acceptance" means synchronously: the fixture's own delayed updates and transitions
 * are what make a field a measurement rather than an echo, so the fake clock is never
 * advanced. That is precisely the distinction being measured — the floodlights publish
 * `on` immediately and ramp `brightness` afterwards, and only the first of those is a
 * read-back of the command.
 */
async function measureEchoFields(): Promise<EchoMap> {
  const echo: EchoMap = new Map();
  const silent = (): never => ({
    debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    child: () => silent(),
  }) as never;

  for (const scenarioKey of SHOWCASE_SCENARIO_KEYS) {
    const scenario = createScenario(scenarioKey);
    expect(scenario, `scenario ${scenarioKey} should build`).toBeDefined();
    const registry = new SimulatorDeviceRegistry({
      publish: () => {},
      logger: silent(),
      // Deliberately NOT 0. Clamping delays to zero would collapse the very gap this
      // measurement depends on, turning every ramped measurement into an apparent echo.
      maxDelayMs: 60_000,
    });
    for (const definition of scenario!.devices) registry.register(definition);

    for (const definition of scenario!.devices) {
      const entry = registry.get(definition.key);
      if (!entry?.model.onCommand) continue;
      const commandTopic = definition.commandTopic;
      expect(commandTopic, `${definition.key} accepts commands but declares no command topic`).toBeDefined();
      const payload = COMMAND_PAYLOADS[commandTopic!];
      expect(payload, `no payload recorded for ${commandTopic}, so its echo cannot be measured`).toBeDefined();

      const before = JSON.parse(JSON.stringify(entry.model.getState())) as Record<string, unknown>;
      const command: SimulatedInboundCommand = {
        topic: commandTopic!,
        params: payload!,
        rawPayload: payload!,
        receivedAt: 1,
      };
      const outcome = await entry.model.onCommand(command);
      expect(outcome, `${commandTopic} rejected the recorded payload: ${JSON.stringify(outcome)}`)
        .toMatchObject({ accepted: true });

      const after = JSON.parse(JSON.stringify(entry.model.getState())) as Record<string, unknown>;
      const fields = new Map<string, unknown>();
      // Two routes to the same thing: the acceptance patch the fixture returns, and any
      // state it changed synchronously through the environment. Several fixtures use only
      // the second — the floodlights, the deterrent and the den fan return a bare
      // `{ accepted: true }` — so checking the patch alone would miss them entirely.
      for (const [field, value] of Object.entries(
        (outcome as { state?: { patch?: Record<string, unknown> } }).state?.patch ?? {},
      )) {
        fields.set(field, value);
      }
      for (const field of Object.keys(after)) {
        if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) {
          fields.set(field, after[field]);
        }
      }
      echo.set(definition.stateTopic, fields);
    }
  }
  return echo;
}

/** One observation contract as authored: what is watched, on what, at what tier. */
interface ObservationSite {
  project: string;
  file: string;
  /**
   * State topics the observed device could be.
   *
   * Usually exactly one. `"any"` means the binding could not be pinned to a literal —
   * farm-water's distribution helper takes the tank topic as a parameter — and the field
   * is then checked against every commanding fixture in the showcase. Being unable to
   * resolve the device makes the check STRICTER rather than skipping it, so an
   * unresolvable site can never be a silent hole.
   */
  candidates: string[] | "any";
  field: string;
  tier: string | undefined;
}

/**
 * Every `field:` an authored condition watches, resolved back to a real device topic.
 *
 * The resolution is why this is worth doing at all: a condition naming `mode` says
 * nothing until you know which fixture is being watched. Topics come from the project's
 * own `byTopic("...")` bindings, and the observing device from the nearest preceding
 * `deviceId:` — falling back to the commanded device, which is what the runtime does.
 */
function readObservationSites(): ObservationSite[] {
  const sites: ObservationSite[] = [];
  for (const entry of LOGIC) {
    const topicOf = new Map<string, string>();
    for (const bind of entry.source.matchAll(
      /(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*byTopic\(\s*["']([^"']+)["']\s*\)/g,
    )) {
      topicOf.set(bind[1], bind[2]);
    }
    for (const match of entry.source.matchAll(/field:\s*["']([^"']+)["']/g)) {
      const before = entry.source.slice(0, match.index);
      // Nearest preceding binding wins; both are searched in the same window so a
      // per-phase options object cannot pick up a neighbour's observer.
      const observerVar = [...before.matchAll(/deviceId:\s*([A-Za-z0-9_$]+)\.id/g)].at(-1)?.[1];
      const targetVar = [...before.matchAll(/devices\.action\(\s*([A-Za-z0-9_$]+)\.id/g)].at(-1)?.[1];
      const tier = [...before.matchAll(/tier:\s*["'](\w+)["']/g)].at(-1)?.[1];
      const chosen = observerVar ?? targetVar;
      const topic = chosen ? topicOf.get(chosen) : undefined;
      sites.push({
        project: entry.project,
        file: entry.file,
        candidates: topic ? [topic] : "any",
        field: match[1],
        tier,
      });
    }
  }
  return sites;
}

/**
 * The tier every showcase command is held to, and why that is the highest honest one.
 *
 * `observed` entries name the measurement. `acknowledged` entries name what is
 * missing, so the gap is a recorded decision rather than an oversight.
 */
const EXPECTED: Record<string, { observed: number; acknowledged: number; why: string }> = {
  // ── Proven by an independent instrument ──
  "farm-water": {
    observed: 3,
    acknowledged: 0,
    why: "transfer start/stop watch a separate in-line flow meter; distribution watches the receiving tank's level while commanding the valve",
  },
  "farm-troughs": {
    observed: 1,
    acknowledged: 0,
    why: "commands the refill manifold, waits for the trough level sensors to report no trough still low",
  },
  "farm-livestock": {
    observed: 1,
    acknowledged: 0,
    why: "commands the recall system, waits for the GPS collar network to report no strays; the working dogs are the mechanism, never the proof",
  },
  "mine-dewatering": {
    observed: 1,
    acknowledged: 0,
    why: "the pump republishes on/flowLps on acceptance, so proof comes from dischargeLps on the deep-sump level sensor",
  },
  "mine-personnel": {
    observed: 1,
    acknowledged: 0,
    why: "the muster controller only echoes `active`; proof is refuge occupancy on the personnel tracking network, which climbs over ~3s",
  },
  "vessel-ctd": {
    // Four declarations: one per winch phase (deploy, recover, hold) plus the
    // automatic tension interlock.
    observed: 4,
    acknowledged: 0,
    why: "the winch is commanded, the CTD sonde's depth and vertical speed are measured by a separate instrument",
  },
  "vessel-rov": {
    observed: 4,
    // The survey transect: proving it means waiting for transectLegs to increment
    // once the box has been flown, which is a duration question rather than a
    // condition question. Acknowledged until that is modelled.
    acknowledged: 1,
    why: "tether tension and depth read from the vehicle's telemetry package, not from the thruster mode it was told to adopt",
  },
  "vessel-underway": {
    observed: 1,
    acknowledged: 0,
    why: "the intake pump is commanded, the thermosalinograph measures whether seawater is actually flowing",
  },

  // ── Proven by a genuinely instrumented channel on the commanded unit ──
  "wildlife-predator-response": {
    observed: 2,
    acknowledged: 0,
    why: "a tachometer reads the shaft; measuredRpm is a measurement, not the actuator's own `active` flag",
  },
  "wildlife-nest-monitoring": {
    observed: 2,
    acknowledged: 0,
    why: "same tachometer argument for the den-box cooling fan",
  },
  "bunker-perimeter": {
    observed: 1,
    acknowledged: 0,
    why: "brightness ramps over ~700ms and 70% is the threshold the approaching contacts react to; `on` is only the switch",
  },
  "stage-show-sequencer": {
    observed: 1,
    acknowledged: 2,
    why: "the lighting desk clears `transitioning` on a timer once the fade completes, so that one is a real wait; the FX rack fires transient bursts nothing measures",
  },

  // ── Acknowledgement is the honest ceiling ──
  "mine-ventilation": {
    observed: 0,
    acknowledged: 1,
    why: "mode, demand, rpm and airflow are all written in one update with the command; the only real effect (methane falling) needs gas already high and boost requested",
  },
  "escape-room-fx": {
    observed: 0,
    acknowledged: 1,
    why: "lightPct is a pure function of scene, published alongside it; nothing measures the light produced",
  },
  "escape-game-master": {
    observed: 0,
    acknowledged: 3,
    why: "maglock, hint screen and intercom all echo their command; a door sensor would be needed to prove the exit actually released",
  },
  "bunker-power": {
    observed: 1,
    acknowledged: 0,
    why: "the generator now ramps to output and the bus integrates it, so `outputW >= 1500` is a measurement of the machine rather than an echo of `on` — which is what raising this from acknowledged was waiting on",
  },
  "bunker-air": {
    observed: 0,
    acknowledged: 1,
    why: "a sealed shelter is a pressure claim, and overpressure is published in the same update as `sealed`; equating a requested flag with an airtight bunker is the overstatement to avoid",
  },
  "bunker-comms": {
    observed: 0,
    acknowledged: 1,
    why: "nothing on site hears the transmission; proving it would need a remote station confirming receipt",
  },
  "farm-energy": {
    observed: 0,
    acknowledged: 1,
    why: "`watts` is the command scaled to a number (`on ? 450 : 0`) in the acceptance patch, not a meter reading",
  },
};

describe("showcase proof tiers", () => {
  it("accounts for every project that issues a command", () => {
    // If this fails, a project started or stopped commanding hardware without its
    // tier decision being recorded above.
    const projects = [...new Set(LOGIC.map((l) => l.project))].sort();
    expect(projects).toEqual(Object.keys(EXPECTED).sort());
  });

  it("holds each project to the tiers it was signed off for", () => {
    for (const project of Object.keys(EXPECTED)) {
      const tiers = LOGIC.filter((l) => l.project === project).flatMap((l) => l.tiers);
      const expected = EXPECTED[project];
      expect({
        project,
        observed: tiers.filter((t) => t === "observed").length,
        acknowledged: tiers.filter((t) => t === "acknowledged").length,
      }).toEqual({ project, observed: expected.observed, acknowledged: expected.acknowledged });
    }
  });

  it("gives every tier decision a stated reason", () => {
    for (const [project, entry] of Object.entries(EXPECTED)) {
      expect(entry.why.length, `${project} needs a reason`).toBeGreaterThan(40);
    }
  });

  describe("echo detection, measured against the fixtures", () => {
    let echo: EchoMap;

    beforeEach(async () => {
      vi.useFakeTimers();
      echo = await measureEchoFields();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("measures an echo set for every device the showcase can command", () => {
      // If this fails, a fixture was added or renamed and its echo is unmeasured — which
      // would let every assertion below pass by simply having nothing to say.
      expect(echo.size).toBeGreaterThan(0);
      for (const [topic, fields] of echo) {
        expect(fields.size, `${topic} echoes nothing at all, which is implausible`).toBeGreaterThan(0);
      }
    });

    it("finds an observation contract to check in every commanding project", () => {
      // Guards against the extraction quietly matching nothing, which would make every
      // assertion below vacuously true.
      const observed = SITES.filter((s) => s.tier === "observed");
      expect(observed.length).toBeGreaterThan(10);
      const projects = new Set(observed.map((s) => s.project));
      for (const [project, entry] of Object.entries(EXPECTED)) {
        if (entry.observed === 0) continue;
        expect(projects, `no observation contract was extracted for ${project}`).toContain(project);
      }
    });

    it("never proves a command with a field its fixture writes on acceptance", () => {
      // The heart of the audit. A field the fixture sets as it accepts has measured
      // nothing, so waiting on it establishes exactly what DISPATCHED already did while
      // presenting it as physical verification.
      const violations: string[] = [];
      for (const site of SITES) {
        if (site.tier !== "observed") continue;
        // Sensors have no command handler and therefore no echo set, so observing one is
        // always a genuine measurement — which is the whole reason to prefer them.
        const topics = site.candidates === "any" ? [...echo.keys()] : site.candidates;
        for (const topic of topics) {
          const fields = echo.get(topic);
          if (!fields?.has(site.field)) continue;

          const exemption = ECHO_EXEMPTIONS.find((e) => e.topic === topic && e.field === site.field);
          if (exemption) {
            // The exemption is only as good as the fixture behaviour it rests on.
            expect(
              fields.get(site.field),
              `${topic}.${site.field} no longer accepts as ${JSON.stringify(exemption.acceptedValue)}, so its exemption no longer holds`,
            ).toEqual(exemption.acceptedValue);
            expect(exemption.why.length).toBeGreaterThan(40);
            continue;
          }
          violations.push(
            `${site.project}/${site.file} observes "${site.field}" on ${topic}, which that fixture writes on acceptance`,
          );
        }
      }
      expect([...new Set(violations)]).toEqual([]);
    });

    it("keeps the flagship measurements out of their fixtures' echo sets", () => {
      // Named explicitly because these are the examples the documentation points at, and
      // because each was a real echo until this pass corrected it. If a fixture ever
      // starts publishing one of these on acceptance, the proof it underwrites collapses.
      const measurements: Array<[string, string]> = [
        ["switch/bunker/floodlights/state", "brightness"],
        ["switch/bunker/generator/state", "outputW"],
        ["switch/wildlife/deterrent/state", "measuredRpm"],
        ["switch/wildlife/den-fan/state", "measuredRpm"],
      ];
      for (const [topic, field] of measurements) {
        const fields = echo.get(topic);
        expect(fields, `${topic} has no measured echo set`).toBeDefined();
        expect(
          fields!.has(field),
          `${topic} now writes "${field}" on acceptance, so observing it proves nothing`,
        ).toBe(false);
      }
    });
  });

  it("declares a condition wherever it asks for an observed tier", () => {
    // An `observed` request with nothing to observe is silently clamped by the command
    // boundary, so the pane would report a clamp that is really an authoring slip.
    for (const entry of LOGIC) {
      if (!entry.tiers.includes("observed")) continue;
      expect(
        entry.conditions.length,
        `${entry.project}/${entry.file} asks for observed but observes nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("still proves the flagship commands by an independent instrument", () => {
    // Guards the strongest examples specifically, since the generic rules above would
    // be satisfied by any non-echo field. These are the ones documentation points at.
    const independent: Array<[string, string, string]> = [
      ["farm-water", "transfer.ts", "deviceId: flow.id"],
      ["farm-livestock", "recall.ts", "deviceId: collars.id"],
      ["mine-dewatering", "dewatering-control.ts", "deviceId: sump.id"],
      ["mine-personnel", "personnel-muster.ts", "deviceId: tracking.id"],
      ["vessel-underway", "underway-science.ts", "deviceId: tsg.id"],
    ];
    for (const [project, file, expected] of independent) {
      const entry = LOGIC.find((l) => l.project === project && l.file === file);
      expect(entry, `${project}/${file} missing`).toBeDefined();
      expect(entry!.source).toContain(expected);
    }
  });
});
