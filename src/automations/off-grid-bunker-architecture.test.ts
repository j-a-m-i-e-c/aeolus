import {describe,expect,it} from "vitest";import {bunkerOverviewAutomation} from "../../demo/seed/tabs/off-grid-bunker/overview.mjs";import {bunkerPerimeterAutomation} from "../../demo/seed/tabs/off-grid-bunker/perimeter.mjs";import {bunkerAirAutomation} from "../../demo/seed/tabs/off-grid-bunker/air.mjs";import {bunkerPowerAutomation} from "../../demo/seed/tabs/off-grid-bunker/power.mjs";import {bunkerCommsAutomation} from "../../demo/seed/tabs/off-grid-bunker/comms.mjs";
import {attachSeedProjectSource} from "../__test-helpers__/seed-project-source.js";
// Authored source lives in demo/seed/projects/<projectDir>; expose it as
// scriptSource/uiSource for the source-level assertions below.
attachSeedProjectSource(bunkerOverviewAutomation,bunkerPerimeterAutomation,bunkerAirAutomation,bunkerPowerAutomation,bunkerCommsAutomation);
const rules=[bunkerOverviewAutomation,bunkerPerimeterAutomation,bunkerAirAutomation,bunkerPowerAutomation,bunkerCommsAutomation];describe("Bunker showcase",()=>{it("keeps the cutaway read-only",()=>{expect(bunkerOverviewAutomation.scriptSource).not.toContain("devices.action(");expect(bunkerOverviewAutomation.demoAccess).toBeUndefined()});it("uses four independent owner automations",()=>expect(rules).toHaveLength(5));it("has no direct UI device reads or raw MQTT",()=>{for(const r of rules){expect(r.uiSource).not.toContain("aeolus.devices");expect(r.scriptSource).not.toContain("mqtt.publish(")}});it("keeps world injection visibly separated",()=>{expect(bunkerPerimeterAutomation.uiSource).toContain("DEMO SCENARIO");expect(bunkerPowerAutomation.uiSource).toContain("DEMO SCENARIO");expect(bunkerCommsAutomation.uiSource).toContain("DEMO SCENARIO")});

  // "CONTINUITY SITE" was invented corporate language for a tab that already says
  // what it is.
  it("calls the site an off-grid bunker",()=>{
    expect(bunkerOverviewAutomation.name).toBe("Bunker Overview");
    expect(bunkerOverviewAutomation.uiSource).toContain("OFF-GRID BUNKER");
    for(const rule of rules){
      expect(String(rule.uiSource),`${rule.name} still uses continuity language`).not.toMatch(/CONTINUITY/i);
      expect(String(rule.scriptSource),`${rule.name} still uses continuity language`).not.toMatch(/continuity/i);
    }
  });

  // A contact count that jumps 0→3→0 means things arrive and vanish without ever
  // crossing the ground between the treeline and the fence.
  it("places perimeter contacts by measured range rather than a bare count",()=>{
    expect(bunkerPerimeterAutomation.scriptSource).toContain('state.set("rangeM"');
    expect(bunkerPerimeterAutomation.scriptSource).toContain('state.set("movement"');
    expect(bunkerPerimeterAutomation.uiSource).toContain('aeolus.read("rangeM")');
    expect(bunkerOverviewAutomation.uiSource).toContain('aeolus.read("rangeM")');
    const perimeterSource=String(bunkerPerimeterAutomation.scriptSource)+String(bunkerPerimeterAutomation.uiSource);
    for(const movement of ["approaching","at-fence","withdrawing"]){
      expect(perimeterSource,`nothing handles the ${movement} phase`).toContain(movement);
    }
  });

  // Floodlights that have accepted a command are not yet a lit approach, and light on
  // the ground is what turns anything back.
  it("distinguishes the floodlight switch from the light it produces",()=>{
    expect(bunkerPerimeterAutomation.scriptSource).toContain('state.set("floodlightPct"');
    expect(bunkerPerimeterAutomation.uiSource).toContain('aeolus.read("floodlightPct")');
  });

  it("draws the shelter as recognisable areas fed by real telemetry",()=>{
    for(const area of ["AIRLOCK","HABITAT","POWER","AIR / FILTRATION","COMMS","SUPPLIES"]){
      expect(bunkerOverviewAutomation.uiSource,`the cutaway has no ${area} area`).toContain(area);
    }
    // Occupants and inside temperature are measured, not decorative captions.
    expect(bunkerPowerAutomation.scriptSource).toContain('state.set("occupants"');
    expect(bunkerAirAutomation.scriptSource).toContain('state.set("tempC"');
    expect(bunkerOverviewAutomation.uiSource).toContain('aeolus.read("occupants")');
    expect(bunkerOverviewAutomation.uiSource).toContain('aeolus.read("tempC")');
  });
});
