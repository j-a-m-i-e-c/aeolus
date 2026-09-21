// src/automations/showcase-shared-state.test.ts — the showcase's information model (ADR-0016)
//
// A real Raspberry Pi run with a wildcard subscription produced this, over and over:
//
//   sensor/bunker/supplies                              {"waterLitres":7442,...}
//   aeolus/events/<rule>/bunker/summary/power           {..."waterLitres":7442,...}
//   sensor/bunker/supplies                              {"waterLitres":7441,...}
//   aeolus/events/<rule>/bunker/summary/power           {..."waterLitres":7441,...}
//
// The second line of each pair is an overview reading a number it already had. Three
// separate automations recomputed a current snapshot on every device publish and sent it
// as an Automation Event, which gave "what is true now" the semantics of "something
// happened": it could not be coalesced, and internal UI composition ended up on the
// broker.
//
// These assertions are cross-domain on purpose. The per-domain projection tests each
// covered their own subsystem, which is how the same modelling mistake managed to appear
// eleven times. Hoisting the invariant here means a fourth domain cannot quietly
// reintroduce it.
//
// The counter-examples matter as much as the rule. An alarm, a command outcome and a
// demo stimulus are occurrences, and this file asserts they were LEFT as events rather
// than swept along with the migration.

import { describe, expect, it } from "vitest";
import { readSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
import { tabModules } from "../../demo/seed/tabs/index.mjs";
import { bunkerOverviewAutomation } from "../../demo/seed/tabs/off-grid-bunker/overview.mjs";
import { mineOverviewAutomation } from "../../demo/seed/tabs/underground-mining/mine-overview.mjs";
import { missionOverviewAutomation } from "../../demo/seed/tabs/research-vessel/mission-overview.mjs";

interface OverviewManifest {
  key: string;
  triggerType?: string;
  triggerTopic?: string;
  projectDir: string;
}

interface SeedTabModule {
  automations?: OverviewManifest[];
}

/** One domain: the subsystems that report, and the overview that composes them. */
interface Domain {
  name: string;
  bucket: string;
  /** `projectDir` → the Shared State key that project owns. */
  producers: Record<string, string>;
  overview: OverviewManifest;
}

const DOMAINS: Domain[] = [
  {
    name: "off-grid bunker",
    bucket: "bunker-summary",
    producers: {
      "bunker-power": "power",
      "bunker-perimeter": "perimeter",
      "bunker-air": "air",
      "bunker-comms": "comms",
    },
    overview: bunkerOverviewAutomation as OverviewManifest,
  },
  {
    name: "underground mine",
    bucket: "mine-summary",
    producers: {
      "mine-atmosphere": "atmosphere",
      "mine-ventilation": "ventilation",
      "mine-personnel": "personnel",
      "mine-dewatering": "dewatering",
    },
    overview: mineOverviewAutomation as OverviewManifest,
  },
  {
    name: "research vessel",
    bucket: "vessel-summary",
    producers: {
      "vessel-ctd": "ctd",
      "vessel-rov": "rov",
      "vessel-underway": "underway",
    },
    overview: missionOverviewAutomation as OverviewManifest,
  },
];

const logicOf = (projectDir: string) => readSeedProjectSource(projectDir).scriptSource;

/** Every `events.emit("<topic>"` in one project's Logic. */
function emittedTopics(projectDir: string): string[] {
  return [...logicOf(projectDir).matchAll(/events\.emit\(\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("showcase information model (ADR-0016)", () => {
  // The eleven publishers named in the spec. Counted, because "all of them migrated" is
  // the claim, and a producer silently dropped from the list would satisfy every other
  // assertion here.
  it("has exactly eleven subsystem summary producers", () => {
    const total = DOMAINS.reduce((n, d) => n + Object.keys(d.producers).length, 0);
    expect(total).toBe(11);
  });

  describe.each(DOMAINS.map((d) => [d.name, d] as const))("%s", (_name, domain) => {
    const producers = Object.entries(domain.producers);

    it.each(producers)("%s writes its summary to Shared State", (projectDir, key) => {
      expect(logicOf(projectDir)).toContain(`shared.set("${domain.bucket}", "${key}"`);
    });

    it.each(producers)("%s no longer emits its summary as an Automation Event", (projectDir) => {
      // The specific regression: a current snapshot on the `aeolus/events/...`
      // namespace. Matched loosely so any `<domain>/summary/<key>` topic fails,
      // not just the four exact strings that existed when this was written.
      for (const topic of emittedTopics(projectDir)) {
        expect(topic, `${projectDir} still emits "${topic}" as an event`).not.toMatch(/\/summary\//);
      }
    });

    it("the overview is woken by Shared State, not by a broker topic", () => {
      expect(domain.overview.triggerType).toBe("shared-state");
      expect(domain.overview.triggerTopic).toBe(`${domain.bucket}/#`);
    });

    it("the overview composes every subsystem's current value", () => {
      // §18: read the durable current value of each key rather than trusting the single
      // payload that woke this run. That is what makes a restart, a missed wake-up and a
      // coalesced burst all end in the same place.
      const logic = logicOf(domain.overview.projectDir);
      expect(logic).toContain(`const BUCKET = "${domain.bucket}"`);
      for (const key of Object.values(domain.producers)) {
        expect(logic, `overview never reads "${key}"`).toContain(`"${key}"`);
      }
      expect(logic).toContain("shared?.get(BUCKET, key)");
    });

    it("the overview issues no physical command and writes no Shared State", () => {
      // It is a read-only composition. Writing back into the bucket it is triggered by
      // would be a loop that the causal-depth ceiling would have to catch.
      const logic = logicOf(domain.overview.projectDir);
      expect(logic).not.toContain("devices.action(");
      expect(logic).not.toContain("shared.set(");
    });
  });

  describe("occurrences were left as Automation Events", () => {
    // If the migration had been applied by pattern-matching on "publishes a payload",
    // these would have gone too — and each one would have been wrong to move.

    it("a ventilation demand band change stays an event", () => {
      // Atmosphere is current state; the DEMAND CHANGING is a transition, and the
      // ventilation automation must act on every one of them. Coalescing these would
      // drop a step between safe and alarm.
      expect(logicOf("mine-atmosphere")).toContain('events.emit("mine/atmosphere/vent-demand"');
      expect(logicOf("mine-atmosphere")).toContain('shared.set("mine-summary", "atmosphere"');
    });

    it("a verified command outcome stays an event", () => {
      expect(logicOf("vessel-ctd")).toContain('events.emit("vessel/ctd/command-verified"');
      expect(logicOf("vessel-rov")).toContain('events.emit("vessel/rov/command-verified"');
    });

    it("a protection interlock firing stays an event", () => {
      expect(logicOf("vessel-ctd")).toContain('events.emit("vessel/ctd/tension-protection"');
      expect(logicOf("vessel-rov")).toContain('events.emit("vessel/rov/tether-protection"');
    });

    it("crossing a hydrographic front stays an event, while the condition is Shared State", () => {
      // The clean illustration of the split: `frontDetected` is carried in the summary
      // as the current condition, and the CROSSING is emitted once as an occurrence.
      const logic = logicOf("vessel-underway");
      expect(logic).toContain('events.emit("vessel/underway/front-detected"');
      expect(logic).toContain('shared.set("vessel-summary", "underway"');
    });

    it("a demo stimulus stays an event", () => {
      // An operator pressing "inject a zombie group" is an action, not a state.
      expect(logicOf("bunker-perimeter")).toContain('events.emit("bunker/sim/shambling-contacts"');
      expect(logicOf("bunker-power")).toContain('events.emit("bunker/sim/low-power"');
    });
  });

  describe("Shared State stays internal", () => {
    it("no producer publishes its summary to MQTT itself", () => {
      // The failure mode the spec calls out: quieting `aeolus/events/...` by opening a
      // `aeolus/shared-state/...` stream instead, which fixes nothing.
      for (const domain of DOMAINS) {
        for (const projectDir of Object.keys(domain.producers)) {
          const logic = logicOf(projectDir);
          expect(logic, `${projectDir} publishes raw MQTT`).not.toContain("mqtt.publish(");
          expect(logic).not.toContain("aeolus/shared-state");
        }
      }
    });

    it("no overview subscribes to the event namespace it used to be driven by", () => {
      for (const domain of DOMAINS) {
        expect(domain.overview.triggerTopic).not.toContain("aeolus/events");
      }
    });
  });

  describe("a shared-state rule is never woken by its own write", () => {
    // The event-side version of this invariant lives in escape-room-architecture.test.ts,
    // where a trigger and an emitted topic can be compared as strings. It cannot see the
    // shared-state form of the same hazard, and skips any rule whose trigger is not an
    // `aeolus/events/...` topic — which is now every rule checked here. The loop looks
    // different too: a `<bucket>/<key>` pattern that matches a bucket the rule writes
    // itself. Nothing would break loudly; the causal-depth ceiling would absorb it
    // sixteen executions later, having run the rule sixteen times per change.
    //
    // Enumerated from the tab registry rather than from a list in this file, so a new
    // shared-state automation on any tab is covered the moment it is declared.
    const sharedStateRules = (tabModules as SeedTabModule[])
      .flatMap((module) => module.automations ?? [])
      .filter((automation) => automation.triggerType === "shared-state");

    // A floor, not an exact count: unlike the eleven producers above, the number is not
    // the claim — it only proves the enumeration still finds the rules, so a refactor
    // that empties it fails here instead of passing vacuously. The four are the three
    // domain overviews and Game Master.
    it("finds every shared-state automation the showcase declares", () => {
      expect(sharedStateRules.length).toBeGreaterThanOrEqual(4);
    });

    it.each(sharedStateRules.map((rule) => [rule.key, rule] as const))(
      "%s writes no bucket its own trigger pattern matches",
      (_key, rule) => {
        // A pattern is at most `<bucket>/<key>`, so the first segment decides which
        // buckets wake the rule: a literal name, `+` (any single bucket) or `#` (all).
        const first = String(rule.triggerTopic).split("/")[0];
        const wakesOnBucket = (bucket: string) =>
          first === "#" || first === "+" || first === bucket;

        const logic = readSeedProjectSource(rule.projectDir).scriptSource;
        // Today every one of these rules is a pure reader, so the loop below is empty by
        // design — this is a guard against a future write, not a description of one. That
        // makes it worth proving the source was actually read: a `projectDir` that
        // resolved to nothing would satisfy the loop without checking anything.
        expect(logic.length, `${rule.key} has no readable Logic source`).toBeGreaterThan(0);

        for (const match of logic.matchAll(/shared\.set\(\s*["']([^"']+)["']/g)) {
          const bucket = match[1]!;
          expect(
            wakesOnBucket(bucket),
            `${rule.key} writes "${bucket}" and is triggered by "${rule.triggerTopic}"`,
          ).toBe(false);
        }
      },
    );
  });

  describe("Shared State is not history", () => {
    it("no producer writes a Collection record in place of a summary", () => {
      // Both are legitimate together — current value in Shared State, history in a
      // Collection — but a producer using `db.write()` INSTEAD of `shared.set()` would
      // leave the overview with nothing current to read.
      for (const domain of DOMAINS) {
        for (const [projectDir, key] of Object.entries(domain.producers)) {
          expect(logicOf(projectDir)).toContain(`shared.set("${domain.bucket}", "${key}"`);
        }
      }
    });

    it("no producer reaches Shared State through the deprecated db bucket aliases", () => {
      for (const domain of DOMAINS) {
        for (const projectDir of Object.keys(domain.producers)) {
          const logic = logicOf(projectDir);
          expect(logic, `${projectDir} uses db.set() for shared state`).not.toMatch(/\bdb\.set\(/);
          expect(logic).not.toMatch(/\bdb\.get\(/);
        }
      }
    });
  });
});
