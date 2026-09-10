// Every showcase command's proof tier is a decision, and this is where it is recorded.
//
// The failure this guards against is subtle and was present across four tabs: asking
// for `tier: "observed"` and then satisfying it with the target device's own echo of
// the command. A controller that republishes `on` the instant it accepts has not
// measured anything, so observing `on` proves exactly what DISPATCHED already proved
// while dressing it up as physical verification. That is worse than claiming less.
//
// So each entry below states the tier and why it is the highest HONEST one. A
// deliberate `acknowledged` is a correct answer, not a weaker demo — some equipment
// genuinely cannot prove more, and the showcase exists partly to make that visible.
//
// Adding a command-issuing showcase project means adding an entry here and defending
// its tier.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECTS = join(process.cwd(), "demo", "seed", "projects");

function logic(project: string, file: string): string {
  return readFileSync(join(PROJECTS, project, "logic", file), "utf8");
}

/**
 * Commands proven by a measurement taken somewhere other than the thing commanded.
 *
 * The strongest tier, and the one worth pointing at in documentation: an independent
 * instrument had to agree before Aeolus called the command proven.
 */
const INDEPENDENTLY_OBSERVED = [
  {
    what: "farm water · start transfer",
    source: () => logic("farm-water", "transfer.ts"),
    // Commanded: the dam pump. Measured: a separate in-line flow meter.
    condition: '{ field: "litresPerMinute", op: "gt", value: 0 }',
    observedDevice: "flow.id",
  },
  {
    what: "farm water · stop transfer",
    source: () => logic("farm-water", "transfer.ts"),
    condition: '{ field: "litresPerMinute", op: "eq", value: 0 }',
    observedDevice: "flow.id",
  },
  {
    what: "mine dewatering · sump pump",
    source: () => logic("mine-dewatering", "dewatering-control.ts"),
    // Commanded: the pump, which republishes `on` and `flowLps` on acceptance.
    // Measured: `dischargeLps` on the deep-sump level sensor, a different device.
    condition: '{ field: "dischargeLps", op: "gt", value: 0 }',
    observedDevice: "sump.id",
  },
  {
    what: "livestock · recall strays",
    source: () => logic("farm-livestock", "recall.ts"),
    // Commanded: the recall system. Measured: the GPS collar network. The working
    // dogs are the mechanism, never the proof.
    condition: "strays",
    observedDevice: "collars.id",
  },
] as const;

/**
 * Commands proven by a real measurement on the commanded unit itself.
 *
 * Legitimate where the channel is genuinely instrumented rather than a mirrored
 * command flag: a tachometer reads the shaft, not the setpoint.
 */
const SELF_MEASURED = [
  {
    what: "wildlife · activate deterrent",
    source: () => logic("wildlife-predator-response", "predator-policy.ts"),
    condition: '{ field: "measuredRpm", op: "gte", value: 2000 }',
  },
  {
    what: "wildlife · stop deterrent",
    source: () => logic("wildlife-predator-response", "predator-policy.ts"),
    condition: '{ field: "measuredRpm", op: "lte", value: 100 }',
  },
  {
    what: "bunker perimeter · floodlights on",
    source: () => logic("bunker-perimeter", "perimeter-control.ts"),
    // `brightness` ramps over ~700 ms and is what the approaching contacts react
    // to; `on` is the switch echoing back. The threshold is the deterrence one.
    condition: '{ field: "brightness", op: "gte", value: FLOODLIGHT_DETER_PCT }',
  },
  {
    what: "bunker perimeter · floodlights off",
    source: () => logic("bunker-perimeter", "perimeter-control.ts"),
    condition: '{ field: "brightness", op: "lte", value: 5 }',
  },
] as const;

/**
 * Commands whose honest ceiling is acknowledgement.
 *
 * Every field these devices publish is derived from the command in the same tick, so
 * there is nothing to observe. Reporting ACKNOWLEDGED is the truthful answer, and the
 * proof surface shows OBSERVED as "not configured" rather than as a failure.
 */
const ACKNOWLEDGED_CEILING = [
  {
    what: "mine ventilation · set mode",
    project: "mine-ventilation",
    file: "ventilation-control.ts",
    // `mode`, `demand`, `primaryRpm` and `airflow` are all written in the same
    // update as the command. The one real effect — methane falling on the Drift 7
    // sensor — only occurs when gas was already high and boost was asked for, so it
    // cannot serve as this command's contract.
  },
  {
    what: "escape room · apply room look",
    project: "escape-room-fx",
    file: "room-systems.ts",
    // `lightPct` is a pure function of `scene`, published alongside it. Nothing in
    // the room measures the light produced.
  },
] as const;

describe("showcase proof tiers — observed by measurement, never by echo", () => {
  it.each(INDEPENDENTLY_OBSERVED.map((c) => [c.what, c] as const))(
    "%s is proven by an independent instrument",
    (_what, entry) => {
      const source = entry.source();
      expect(source).toContain('tier: "observed"');
      expect(source).toContain(entry.condition);
      // The observation is pointed at a device other than the command's target,
      // which is what makes it independent.
      expect(source).toContain(`deviceId: ${entry.observedDevice}`);
    },
  );

  it.each(SELF_MEASURED.map((c) => [c.what, c] as const))(
    "%s is proven by a measured channel on the commanded unit",
    (_what, entry) => {
      const source = entry.source();
      expect(source).toContain('tier: "observed"');
      expect(source).toContain(entry.condition);
    },
  );

  it.each(ACKNOWLEDGED_CEILING.map((c) => [c.what, c] as const))(
    "%s claims only acknowledgement, because nothing measures the effect",
    (_what, entry) => {
      const source = logic(entry.project, entry.file);
      expect(source).toContain('tier: "acknowledged"');
      // Must not quietly ask for a tier it cannot prove: the boundary would clamp it
      // and the pane would report a clamp that is really an authoring mistake.
      expect(source).not.toContain('tier: "observed"');
    },
  );

  it("no showcase command observes a bare on/off echo on its own target", () => {
    // The specific anti-pattern, kept out by name. `{ field: "on", op: "eq" }` can
    // only ever restate the command for these devices, because every one of them
    // republishes `on` the moment it accepts.
    for (const entry of [...INDEPENDENTLY_OBSERVED, ...SELF_MEASURED]) {
      expect(entry.condition).not.toContain('field: "on"');
    }
  });
});
