// Regression guard for the public-demo Underground Mining architecture.
import { describe, expect, it } from "vitest";
import { mineOverviewAutomation } from "../../scripts/seed/tabs/underground-mining/mine-overview.mjs";
import { atmosphereAutomation } from "../../scripts/seed/tabs/underground-mining/atmosphere.mjs";
import { ventilationAutomation } from "../../scripts/seed/tabs/underground-mining/ventilation.mjs";
import { personnelAutomation } from "../../scripts/seed/tabs/underground-mining/personnel.mjs";
import { dewateringAutomation } from "../../scripts/seed/tabs/underground-mining/dewatering.mjs";

interface SeedAutomation{key:string;name:string;scriptSource:string;uiSource:string;demoAccess?:unknown}
const owning:SeedAutomation[]=[atmosphereAutomation,ventilationAutomation,personnelAutomation,dewateringAutomation] as SeedAutomation[];
const all:SeedAutomation[]=[mineOverviewAutomation,...owning] as SeedAutomation[];
function readKeys(source:string):string[]{return [...source.matchAll(/aeolus\.read\(\s*["']([^"']+)["']/g)].map(m=>m[1]);}
function setKeys(source:string):Set<string>{return new Set([...source.matchAll(/state\.set\(\s*["']([^"']+)["']/g)].map(m=>m[1]).concat([...source.matchAll(/init\(\s*["']([^"']+)["']/g)].map(m=>m[1])));}

describe("Underground Mining demo architecture",()=>{
  it("keeps the mine hero read-only",()=>{expect(mineOverviewAutomation.demoAccess).toBeUndefined();expect(mineOverviewAutomation.scriptSource).not.toContain("devices.action(");expect(mineOverviewAutomation.triggerTopic).toBe("aeolus/events/+/mine/summary/#");});
  it.each(all.map(a=>[a.name,a] as const))("%s UI reads automation projection state, not direct devices",(_name,a)=>{expect(a.uiSource).not.toContain("aeolus.devices");expect(a.uiSource).toContain("aeolus.read(");});
  it.each(all.map(a=>[a.name,a] as const))("%s writes every UI projection key",(_name,a)=>{const written=setKeys(a.scriptSource);for(const key of readKeys(a.uiSource))expect(written,`UI reads ${key} but Logic never state.set()s it`).toContain(key);});
  it("Atmospheric Safety communicates ventilation demand over Automation Events",()=>{expect(atmosphereAutomation.scriptSource).toContain('events.emit("mine/atmosphere/vent-demand"');expect(ventilationAutomation.triggerTopic).toContain("mine/atmosphere/#");});
  it("only owning automations issue physical commands",()=>{expect(atmosphereAutomation.scriptSource).not.toContain("devices.action(");expect(ventilationAutomation.scriptSource).toContain("devices.action(");expect(personnelAutomation.scriptSource).toContain("devices.action(");expect(dewateringAutomation.scriptSource).toContain("devices.action(");});
  it("all simulator injection controls are explicitly labelled Demo Scenario",()=>{for(const a of [atmosphereAutomation,personnelAutomation,dewateringAutomation])expect(a.uiSource).toContain("DEMO SCENARIO");});
});
