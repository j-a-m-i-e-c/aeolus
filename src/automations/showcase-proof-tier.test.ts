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

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
 * Fields that are only ever a command read back.
 *
 * Every one of these is written by its fixture in the same update that accepts the
 * command — often returned verbatim as the acknowledgement's resulting-state patch —
 * so waiting for it can never establish a physical outcome. `transitioning` is
 * deliberately absent: the lighting desk clears it on a timer once the fade has
 * actually finished, which is a real wait.
 */
const ECHO_FIELDS = ["on", "sealed", "tx", "locked", "mode", "scene", "smoke", "active"] as const;

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
    observed: 0,
    acknowledged: 1,
    why: "outputW would be the right proof but the fixture writes it in the same update as `on`; raising this belongs with ramping generator output and integrating battery SOC",
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

  it("never proves a command with a field that only echoes it", () => {
    // The heart of the audit, and the assertion with real teeth. Each banned field is
    // written by its fixture in the same update that accepts the command — several are
    // returned verbatim as the acknowledgement's resulting-state patch — so waiting on
    // one establishes nothing that DISPATCHED had not already established.
    for (const entry of LOGIC) {
      for (const condition of entry.conditions) {
        for (const field of ECHO_FIELDS) {
          expect(
            condition,
            `${entry.project}/${entry.file} proves a command with the echoed field "${field}"`,
          ).not.toContain(`field: "${field}"`);
        }
      }
    }
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
