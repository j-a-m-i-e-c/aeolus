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
import { waterAutomation } from "../../scripts/seed/tabs/agriculture/water.mjs";
import { livestockAutomation } from "../../scripts/seed/tabs/agriculture/livestock.mjs";
import { troughAutomation } from "../../scripts/seed/tabs/agriculture/troughs.mjs";
import { energyAutomation } from "../../scripts/seed/tabs/agriculture/energy.mjs";

interface SeedAutomation {
  key: string;
  name: string;
  scriptSource: string;
  uiSource: string;
}

/** Automations whose Logic issues a physical device command (has an actuator). */
const commandAutomations: SeedAutomation[] = [
  waterAutomation as SeedAutomation,
  livestockAutomation as SeedAutomation,
  troughAutomation as SeedAutomation,
];

/** Every Agriculture world (Site Energy observes + emits events, no actuator). */
const allAutomations: SeedAutomation[] = [...commandAutomations, energyAutomation as SeedAutomation];

/** Keys the UI reads via aeolus.read("key"). */
function readKeys(uiSource: string): string[] {
  return [...uiSource.matchAll(/aeolus\.read\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Keys the Logic writes via state.set("key", ...). */
function setKeys(scriptSource: string): Set<string> {
  return new Set([...scriptSource.matchAll(/state\.set\(\s*["']([^"']+)["']/g)].map((m) => m[1]));
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

  it.each(commandAutomations.map((a) => [a.name, a] as const))(
    "%s issues real physical commands via devices.action() (not optimistic state)",
    (_name, automation) => {
      // Commands remain verified device actions through the CommandService;
      // physical truth still comes back over MQTT and is only then mirrored.
      expect(automation.scriptSource).toContain("devices.action(");
    },
  );
});
