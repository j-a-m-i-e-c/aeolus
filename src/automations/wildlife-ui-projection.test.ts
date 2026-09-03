import { describe, expect, it } from "vitest";
import { wildlifeDetectionAutomation } from "../../demo/seed/tabs/wildlife/detection.mjs";
import { predatorResponseAutomation } from "../../demo/seed/tabs/wildlife/predator-response.mjs";
import { nestMonitoringAutomation } from "../../demo/seed/tabs/wildlife/nest-monitoring.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
// Authored source lives in demo/seed/projects/<projectDir>; expose it as
// scriptSource/uiSource for the source-level assertions below.
attachSeedProjectSource(wildlifeDetectionAutomation, predatorResponseAutomation, nestMonitoringAutomation);

const rules=[wildlifeDetectionAutomation,predatorResponseAutomation,nestMonitoringAutomation];
describe("Wildlife showcase architecture",()=>{
 it("has three first-class automations and no direct device reads in UIs",()=>{expect(rules).toHaveLength(3);for(const rule of rules)expect(rule.uiSource).not.toContain("aeolus.devices");});
 it("routes classification to Predator Response over Automation Events",()=>{expect(wildlifeDetectionAutomation.scriptSource).toContain('events.emit("wildlife/detection/classified"');expect(predatorResponseAutomation.triggerTopic).toBe("aeolus/events/+/wildlife/detection/classified");});
 // Each actuator has exactly one owner. Detection observes and classifies only;
 // the deterrent belongs to Predator Response and the den fan to Sugar Glider Den,
 // so no two automations can fight over the same physical thing.
 it("gives every actuator exactly one owning automation",()=>{
   expect(wildlifeDetectionAutomation.scriptSource).not.toContain("devices.action(");
   expect(predatorResponseAutomation.scriptSource).toContain("switch/wildlife/deterrent/state");
   expect(predatorResponseAutomation.scriptSource).not.toContain("switch/wildlife/den-fan/state");
   expect(nestMonitoringAutomation.scriptSource).toContain("switch/wildlife/den-fan/state");
   expect(nestMonitoringAutomation.scriptSource).not.toContain("switch/wildlife/deterrent/state");
 });

 // The den alert used to be something an operator dismissed, which changed nothing
 // physical. It is now a cooling request Aeolus verifies against a tachometer.
 it("answers a den thermal alert with verified cooling rather than an acknowledgement",()=>{
   const script=String(nestMonitoringAutomation.scriptSource);
   expect(script).toContain("devices.action(");
   expect(script).toContain('tier: "observed"');
   expect(script).toContain('field: "measuredRpm"');
   expect(script).not.toContain("acknowledge");
   expect(nestMonitoringAutomation.uiSource).not.toContain("acknowledge");
   expect(nestMonitoringAutomation.demoAccess?.fireEvents).toContain("stop-cooling");
 });
 it("labels simulator injection controls as demo scenarios",()=>{expect(wildlifeDetectionAutomation.uiSource).toContain("DEMO SCENARIO");expect(nestMonitoringAutomation.uiSource).toContain("DEMO SCENARIO");expect(predatorResponseAutomation.uiSource).not.toContain("DEMO SCENARIO");});

 // Every value a UI renders must come from its own automation's projection, and
 // the Logic must actually write it — otherwise the pane renders a default and
 // looks dead to a demo operator who cannot see devices.
 it.each(rules.map((rule) => [rule.name, rule] as const))(
   "%s writes every projection key its UI reads",
   (_name, rule) => {
     const written = new Set([...String(rule.scriptSource).matchAll(/state\.set\(\s*"([^"]+)"/g)].map((m) => m[1]));
     const read = new Set([...String(rule.uiSource).matchAll(/aeolus\.read\(\s*"([^"]+)"/g)].map((m) => m[1]));
     expect(read.size).toBeGreaterThan(0);
     for (const key of read) {
       expect(written, `UI reads ${key} but Logic never state.set()s it`).toContain(key);
     }
   },
 );

 // Verification is against the tachometer, not the actuator's own flag: a
 // controller reporting "on" only proves it accepted the command.
 it("verifies the deterrent against a measured fan speed, not its own active flag",()=>{
   const script=String(predatorResponseAutomation.scriptSource);
   expect(script).toContain('tier: "observed"');
   expect(script).toContain('field: "measuredRpm"');
   expect(script).not.toContain('field: "active"');
 });

 // Distance/movement are physical state the simulator owns, so both Wildlife panes
 // project the same animal instead of each animating a private copy.
 it("projects the animal's ranged position rather than inferring it from event age",()=>{
   for(const rule of [wildlifeDetectionAutomation,predatorResponseAutomation]){
     expect(String(rule.scriptSource)).toContain('state.set("');
     expect(String(rule.scriptSource)).toMatch(/distanceM/);
   }
   expect(wildlifeDetectionAutomation.scriptSource).toContain('state.set("movement"');
   expect(predatorResponseAutomation.scriptSource).toContain('state.set("predatorMovement"');
 });
});
