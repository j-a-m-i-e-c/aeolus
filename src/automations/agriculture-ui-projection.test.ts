// src/automations/agriculture-ui-projection.test.ts
//
// Regression guard for the public-demo UI projection contract.
//
// A non-admin public-demo user is NOT granted direct device visibility: device
// state only reaches the browser for devices a tab exposes through a purposeful
// device pane (sensor-panel/hue-control/kasa-control), and the Agriculture tab
// exposes none. So a custom automation UI must NOT read `aeolus.devices`; it
// must read the automation's own state, which the Logic populates as a
// PROJECTION of OBSERVED physical device state (never a fabricated value).
//
// This test is deliberately structural (source-level) so it stays portable —
// isolated-vm and a live broker are not needed. It locks the contract for the
// four Agriculture worlds and, by example, for the Mine/Spacecraft/Bunker
// migrations that will follow the same pattern.

import { describe, it, expect } from "vitest";
import { waterAutomation } from "../../demo/seed/tabs/agriculture/water.mjs";
import { livestockAutomation } from "../../demo/seed/tabs/agriculture/livestock.mjs";
import { troughAutomation } from "../../demo/seed/tabs/agriculture/troughs.mjs";
import { energyAutomation } from "../../demo/seed/tabs/agriculture/energy.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
// Authored source lives in demo/seed/projects/<projectDir>; expose it as
// scriptSource/uiSource for the source-level assertions below.
attachSeedProjectSource(waterAutomation, livestockAutomation, troughAutomation, energyAutomation);

interface SeedAutomation {
  key: string;
  name: string;
  scriptSource: string;
  uiSource: string;
}

/** Every Agriculture world now owns at least one real actuator command path. */
const commandAutomations: SeedAutomation[] = [
  waterAutomation as SeedAutomation,
  livestockAutomation as SeedAutomation,
  troughAutomation as SeedAutomation,
  energyAutomation as SeedAutomation,
];

const allAutomations: SeedAutomation[] = [...commandAutomations];

/** Keys the UI reads via aeolus.read("key"). */
function readKeys(uiSource: string): string[] {
  return [...uiSource.matchAll(/aeolus\.read\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Keys the Logic writes via state.set("key", ...). */
function setKeys(scriptSource: string): Set<string> {
  return new Set([...scriptSource.matchAll(/state\.set\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

/**
 * Action types the Logic passes as the 2nd argument of devices.action(id, "type", ...).
 * The 1st arg is a device-id expression (e.g. `pump.id`) with no comma, so a
 * non-greedy `[^,]+` reaches the quoted action type reliably.
 */
function actionTypes(scriptSource: string): string[] {
  return [...scriptSource.matchAll(/devices\.action\(\s*[^,]+,\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("Agriculture demo UI projection contract", () => {
  it.each(allAutomations.map((a) => [a.name, a] as const))(
    "%s UI never reads aeolus.devices directly",
    (_name, automation) => {
      // The demo user cannot see devices; a UI that reads them would render
      // static defaults and appear dead (the bug this guards against).
      expect(automation.uiSource).not.toContain("aeolus.devices");
    },
  );

  it.each(allAutomations.map((a) => [a.name, a] as const))(
    "%s UI reads its projection via aeolus.read()",
    (_name, automation) => {
      expect(automation.uiSource).toContain("aeolus.read(");
    },
  );

  it.each(allAutomations.map((a) => [a.name, a] as const))(
    "%s Logic mirrors observed state into the projection via state.set()",
    (_name, automation) => {
      expect(automation.scriptSource).toContain("state.set(");
    },
  );

  it.each(allAutomations.map((a) => [a.name, a] as const))(
    "%s: every projection key the UI reads is written by the Logic",
    (_name, automation) => {
      const written = setKeys(automation.scriptSource);
      for (const key of readKeys(automation.uiSource)) {
        expect(written, `UI reads "${key}" but the Logic never state.set()s it`).toContain(key);
      }
    },
  );


  it.each(allAutomations.map((a) => [a.name, a] as const))(
    "%s visually separates real operator controls from demo-world injection",
    (_name, automation) => {
      expect(automation.uiSource).toContain("OPERATOR CONTROL");
      expect(automation.uiSource).toContain("DEMO SCENARIO");
    },
  );

  it("Water Management stops bounded batches from observed totalizer progress", () => {
    expect(waterAutomation.scriptSource).toContain("flowTotalLitres");
    expect(waterAutomation.scriptSource).toContain("transferStartTotalLitres");
    expect(waterAutomation.scriptSource).toContain("batch volume reached");
  });

  it("Water Management keeps a transfer active until the observed stop verifies", () => {
    // stopPump() owns transferActive=false after zero flow is observed. Clearing it
    // before awaiting stopPump() would suppress retry semantics after a failed stop.
    expect(waterAutomation.scriptSource).not.toMatch(
      /state\.set\(\s*["']transferActive["']\s*,\s*false\s*\);[\s\S]{0,180}?await\s+stopPump\(/,
    );
  });

  it("Trough Watering never auto-refills while the herd is at the troughs", () => {
    // Guards on `herdPresent`, not `drinkingActive`. That is deliberately stronger:
    // cattle walking in or still moving off are physically at the water even though
    // they are not drinking, and the manifold must not open around them.
    // The guard may be read off a snapshot object or straight from state, so match
    // the negation of the flag rather than one spelling of the receiver.
    expect(troughAutomation.scriptSource).toMatch(/!\s*(?:\w+\.)*herdPresent/);
    expect(troughAutomation.scriptSource).toContain('Automatic refill enabled · acts after cattle leave');
  });

  it("Trough Watering names the troughs the herd is actually at, never a fixed set", () => {
    // The demo button used to announce "herd arriving at T4, T5, T12 and T17", which
    // stopped being true once visits rotated around the paddock's cluster. Which
    // troughs empty is decided by the simulated world and arrives as telemetry, so
    // the automation cannot know it at the moment the button is pressed.
    // No operator-facing string may carry a hardcoded list of trough ids.
    expect(troughAutomation.scriptSource).not.toMatch(/(["'])[^"'\n]*\bT\d+\b[^"'\n]*,\s*T\d+/);
    expect(troughAutomation.scriptSource).not.toContain("herd arriving at");
    // The narration is derived from the reported visit instead.
    expect(troughAutomation.scriptSource).toMatch(/drinkingIds/);
    expect(troughAutomation.scriptSource).toMatch(/visitPaddock/);
  });

  it("Trough Watering draws one herd rather than a beast beside every trough", () => {
    // Four 6px glyphs, one per drinking trough, read as specks rather than cattle —
    // and showed nothing at all while the herd was walking in or moving off, because
    // the network only reports `drinkingIds` while cattle are drinking. The mob is
    // drawn once, from `herdPresent`, on the paddock row the troughs report.
    expect(troughAutomation.uiSource).toMatch(/herdPresent\s*&&/);
    expect(troughAutomation.uiSource).toContain("visitPaddock");
  });

  it("Site Energy explicitly gives water transfer priority over opportunity charging", () => {
    expect(energyAutomation.scriptSource).toContain("water transfer given priority");
    expect(energyAutomation.uiSource).toContain("essential loads → water transfer → opportunity charging");
  });

  it.each(commandAutomations.map((a) => [a.name, a] as const))(
    "%s issues real physical commands via devices.action() (not optimistic state)",
    (_name, automation) => {
      // Commands remain verified device actions through the CommandService;
      // physical truth still comes back over MQTT and is only then mirrored.
      expect(automation.scriptSource).toContain("devices.action(");
    },
  );

  it.each(commandAutomations.map((a) => [a.name, a] as const))(
    "%s dispatches only the MQTT-valid \"command\" action type",
    (_name, automation) => {
      // A generic MQTT (simulated-hardware) device's Action_Catalog is its
      // capability descriptors plus the MQTT_COMMAND_DESCRIPTOR ("command").
      // Any other action type (e.g. "set"/"recall"/"refill") is rejected by
      // ActionRouter as unsupported BEFORE the command is published to MQTT, so
      // the simulator never actuates and the UI animation never fires. This
      // locks the action type for the four worlds and the migrations to follow.
      const types = actionTypes(automation.scriptSource);
      expect(types.length, "expected at least one devices.action() call").toBeGreaterThan(0);
      for (const type of types) {
        expect(type, `devices.action() used unsupported action type "${type}"`).toBe("command");
      }
    },
  );

  it.each(commandAutomations.map((a) => [a.name, a] as const))(
    "%s wraps command fields in a payload object",
    (_name, automation) => {
      // executeMqttAction publishes action.params.payload (when an object) as the
      // command body; the real command fields (on/litres/active) must live inside
      // { payload: { ... } } so the simulator receives them under command.params.
      expect(automation.scriptSource).toContain("payload:");
    },
  );

  it.each(commandAutomations.map((a) => [a.name, a] as const))(
    "%s expresses its observed-tier condition as a data spec, never a function",
    (_name, automation) => {
      // isolated-vm cannot transfer a live predicate FUNCTION as a call argument
      // (it throws "A non-transferable value was passed"), which silently blocked
      // every command before dispatch. The confirm condition must therefore be a
      // declarative data spec ({ field, op, value } / { all: [...] }) that the
      // host evaluates natively. Guard against a regression to a function literal.
      expect(automation.scriptSource).not.toMatch(/condition:\s*function/);

      // Not every command carries a condition: where nothing measures the effect, the
      // honest tier is `acknowledged` and there is no observation to express. See
      // showcase-proof-tier.test.ts for which commands are held to which tier and why.
      // This assertion is about the SHAPE of a condition that does exist.
      if (!/condition:/.test(automation.scriptSource)) return;

      // The condition is supplied either directly as a spec object or chosen via
      // a ternary of specs (e.g. `condition: on ? {...} : {...}`).
      expect(automation.scriptSource).toMatch(/condition:\s*(?:\{|[\w$]+\s*\?)/);
      // ...and a declarative comparison/combinator spec shape is actually present.
      expect(automation.scriptSource).toMatch(/\{\s*(?:field|all|any)\s*:/);
    },
  );
});
