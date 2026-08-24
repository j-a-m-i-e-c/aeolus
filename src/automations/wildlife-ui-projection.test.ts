import { describe, expect, it } from "vitest";
import { wildlifeDetectionAutomation } from "../../scripts/seed/tabs/wildlife/detection.mjs";
import { predatorResponseAutomation } from "../../scripts/seed/tabs/wildlife/predator-response.mjs";
import { nestMonitoringAutomation } from "../../scripts/seed/tabs/wildlife/nest-monitoring.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
// Authored source lives in scripts/seed/projects/<projectDir>; expose it as
// scriptSource/uiSource for the source-level assertions below.
attachSeedProjectSource(wildlifeDetectionAutomation, predatorResponseAutomation, nestMonitoringAutomation);

const rules=[wildlifeDetectionAutomation,predatorResponseAutomation,nestMonitoringAutomation];
describe("Wildlife showcase architecture",()=>{
 it("has three first-class automations and no direct device reads in UIs",()=>{expect(rules).toHaveLength(3);for(const rule of rules)expect(rule.uiSource).not.toContain("aeolus.devices");});
 it("routes classification to Predator Response over Automation Events",()=>{expect(wildlifeDetectionAutomation.scriptSource).toContain('events.emit("wildlife/detection/classified"');expect(predatorResponseAutomation.triggerTopic).toBe("aeolus/events/+/wildlife/detection/classified");});
 it("only Predator Response owns the physical deterrent",()=>{expect(predatorResponseAutomation.scriptSource).toContain("devices.action(");expect(wildlifeDetectionAutomation.scriptSource).not.toContain("devices.action(");expect(nestMonitoringAutomation.scriptSource).not.toContain("devices.action(");});
 it("labels simulator injection controls as demo scenarios",()=>{expect(wildlifeDetectionAutomation.uiSource).toContain("DEMO SCENARIO");expect(nestMonitoringAutomation.uiSource).toContain("DEMO SCENARIO");expect(predatorResponseAutomation.uiSource).not.toContain("DEMO SCENARIO");});
});
