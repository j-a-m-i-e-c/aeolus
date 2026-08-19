// Regression guard for the public-demo Research Vessel projection contract.
// The hero is read-only; the three science systems own their physical commands.

import { describe, expect, it } from "vitest";
import { missionOverviewAutomation } from "../../scripts/seed/tabs/research-vessel/mission-overview.mjs";
import { ctdAutomation } from "../../scripts/seed/tabs/research-vessel/ctd.mjs";
import { rovAutomation } from "../../scripts/seed/tabs/research-vessel/rov.mjs";
import { underwayAutomation } from "../../scripts/seed/tabs/research-vessel/underway.mjs";

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

  it("the hero receives summaries only over Automation Events", () => {
    for (const automation of commandAutomations) expect(automation.scriptSource).toContain('events.emit("vessel/summary/');
    expect(missionOverviewAutomation.triggerTopic).toBe("aeolus/events/+/vessel/summary/#");
  });
});
