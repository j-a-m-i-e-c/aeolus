// Regression guard for the public-demo Research Vessel projection contract.
// The hero is read-only; the three science systems own their physical commands.

import { describe, expect, it } from "vitest";
import { missionOverviewAutomation } from "../../demo/seed/tabs/research-vessel/mission-overview.mjs";
import { ctdAutomation } from "../../demo/seed/tabs/research-vessel/ctd.mjs";
import { rovAutomation } from "../../demo/seed/tabs/research-vessel/rov.mjs";
import { underwayAutomation } from "../../demo/seed/tabs/research-vessel/underway.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
// Authored source lives in demo/seed/projects/<projectDir>; expose it as
// scriptSource/uiSource for the source-level assertions below.
attachSeedProjectSource(missionOverviewAutomation, ctdAutomation, rovAutomation, underwayAutomation);

interface SeedAutomation { key: string; name: string; scriptSource: string; uiSource: string; demoAccess?: unknown }
const commandAutomations: SeedAutomation[] = [ctdAutomation, rovAutomation, underwayAutomation] as SeedAutomation[];
const allAutomations: SeedAutomation[] = [missionOverviewAutomation, ...commandAutomations] as SeedAutomation[];
function readKeys(source: string): string[] { return [...source.matchAll(/aeolus\.read\(\s*["']([^"']+)["']/g)].map((m) => m[1]); }
function setKeys(source: string): Set<string> { return new Set([...source.matchAll(/(?:state\.set|init)\(\s*["']([^"']+)["']/g)].map((m) => m[1])); }
function actionTypes(source: string): string[] { return [...source.matchAll(/devices\.action\(\s*[^,]+,\s*["']([^"']+)["']/g)].map((m) => m[1]); }

describe("Research Vessel demo architecture", () => {
  it("keeps Mission Overview read-only and removes ship station-keeping control", () => {
    expect(missionOverviewAutomation.demoAccess).toBeUndefined();
    expect(missionOverviewAutomation.scriptSource).not.toContain("devices.action(");
    expect(missionOverviewAutomation.scriptSource).not.toContain("station");
    expect(missionOverviewAutomation.uiSource).not.toMatch(/\bDP\b|station keeping/i);
  });

  it.each(allAutomations.map((a) => [a.name, a] as const))("%s UI never reads direct devices", (_name, automation) => {
    expect(automation.uiSource).not.toContain("aeolus.devices");
    expect(automation.uiSource).toContain("aeolus.read(");
  });

  it.each(allAutomations.map((a) => [a.name, a] as const))("%s writes every UI projection key", (_name, automation) => {
    const written = setKeys(automation.scriptSource);
    for (const key of readKeys(automation.uiSource)) expect(written, `UI reads ${key} but Logic never state.set()s it`).toContain(key);
  });

  it.each(commandAutomations.map((a) => [a.name, a] as const))("%s uses verified generic-MQTT commands", (_name, automation) => {
    expect(automation.scriptSource).toContain("devices.action(");
    for (const type of actionTypes(automation.scriptSource)) expect(type).toBe("command");
    expect(automation.scriptSource).toContain("payload:");
    expect(automation.scriptSource).not.toMatch(/condition:\s*function/);
    expect(automation.scriptSource).toMatch(/\{\s*(?:field|all|any)\s*:/);
  });

  it.each(commandAutomations.map((a) => [a.name, a] as const))("%s separates operator and demo controls", (_name, automation) => {
    expect(automation.uiSource).toContain("OPERATOR CONTROLS");
    expect(automation.uiSource).toContain("DEMO SCENARIO");
  });

  // On deck and at depth are both "the winch is stopped", but the valid next action
  // differs. Collapsing them into one "holding" state is what made Hold look like a
  // mandatory step between deploying and recovering.
  it("treats the CTD wire as a phase, not a boolean", () => {
    for (const phase of ["on-deck", "deploying", "at-depth", "recovering", "holding"]) {
      expect(ctdAutomation.uiSource, `UI never distinguishes the ${phase} phase`).toContain(phase);
    }
    expect(ctdAutomation.uiSource).toContain("Resume descent");
    expect(ctdAutomation.uiSource).toContain("Pause winch");
  });

  it("never makes an operator press Hold before reversing the CTD winch", () => {
    expect(ctdAutomation.scriptSource).not.toContain("hold before changing direction");
    // A hold is proven by the package stopping, read off the sonde, rather than by
    // the winch reporting its own mode back.
    expect(ctdAutomation.scriptSource).toContain('field: "verticalSpeed"');
  });

  it("says plainly when Aeolus arrested the winch on its own", () => {
    expect(ctdAutomation.scriptSource).toContain('state.set("interlockAt"');
    expect(ctdAutomation.uiSource).toMatch(/Aeolus arrested the winch/);
  });

  it("the hero receives summaries only over Automation Events", () => {
    for (const automation of commandAutomations) expect(automation.scriptSource).toContain('events.emit("vessel/summary/');
    expect(missionOverviewAutomation.triggerTopic).toBe("aeolus/events/+/vessel/summary/#");
  });
});
