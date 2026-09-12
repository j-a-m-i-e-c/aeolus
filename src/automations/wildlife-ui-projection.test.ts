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

 // showcase-cleanup §6.1 — the hero pane must show the consequence of a
 // classification, not stop at the domain event. It ends camera → inference → event →
 // physical response, so the deterrent has to be visible in the top scene.
 it("shows the deterrent in the hero scene, driven by the tachometer",()=>{
   const script=String(wildlifeDetectionAutomation.scriptSource);
   const ui=String(wildlifeDetectionAutomation.uiSource);
   // Read-only projection of an actuator this automation does not own.
   expect(script).toContain("switch/wildlife/deterrent/state");
   expect(script).toContain('state.set("deterrentMeasuredRpm"');
   expect(script).toContain('state.set("deterrentCommandRpm"');
   // Output is drawn from measured speed, so a controller that has accepted a target
   // but is not yet turning emits nothing — the same distinction the deterrent command
   // is verified against (§1.3).
   expect(ui).toContain("deterrentMeasuredRpm");
   expect(ui).toMatch(/measuredRpm\s*\/\s*commandRpm/);
 });

 // §6.2 — showing the outcome must not turn the hero pane into a second owner of the
 // deterrent. Reading a device is fine; commanding one is not.
 it("keeps the deterrent's only owner as Predator Response even though Detection draws it",()=>{
   expect(wildlifeDetectionAutomation.scriptSource).not.toContain("devices.action(");
   expect(wildlifeDetectionAutomation.scriptSource).not.toContain("switch/wildlife/deterrent/set");
   // Widened so a deterrent publish refreshes the pane; still scoped to this station.
   expect(wildlifeDetectionAutomation.triggerTopic).toBe("+/wildlife/#");
   expect(predatorResponseAutomation.scriptSource).toContain("devices.action(");
 });

 // §6.3 — a stop is evidenced just as well as an activation, and used to leave the
 // previous activation's proof on screen.
 it("leaves a receipt for every deterrent command, including the stop",()=>{
   const script=String(predatorResponseAutomation.scriptSource);
   const commands=[...script.matchAll(/devices\.action\(/g)].length;
   const receipts=[...script.matchAll(/devices\.commandEvidence\(/g)].length;
   expect(commands).toBeGreaterThan(1);
   expect(receipts,"every deterrent command must project its evidence").toBe(commands);
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
