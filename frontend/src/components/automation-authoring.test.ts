import { describe, expect, it } from "vitest";
import {
  createDefaultAutomationProject,
  describeAutomationTrigger,
  triggerIsConfigured,
} from "./automation-authoring";

describe("automation authoring contract", () => {
  it("uses one Project scaffold with the public EventContext type", () => {
    const project = createDefaultAutomationProject();
    expect(project.logicEntry).toBe("logic/index.ts");
    expect(project.uiEntry).toBeNull();
    expect(project.files).toHaveLength(1);
    expect(project.files[0]?.content).toContain("run(context: EventContext)");
    expect(project.files[0]?.content).toContain("export default async function run");
  });

  it("treats None as configured and validates MQTT/Schedule explicitly", () => {
    expect(triggerIsConfigured("none", "", "", false)).toBe(true);
    expect(triggerIsConfigured("mqtt", "", "", true)).toBe(false);
    expect(triggerIsConfigured("mqtt", "sensor/a", "", true)).toBe(true);
    expect(triggerIsConfigured("cron", "", "* * * * *", false)).toBe(false);
    expect(triggerIsConfigured("cron", "", "* * * * *", true)).toBe(true);
  });

  it("describes manual, scheduled and MQTT triggers without MQTT-only wording", () => {
    expect(describeAutomationTrigger({ triggerType: "none" })).toBe("Manual only");
    expect(describeAutomationTrigger({ triggerType: "cron", cronExpression: "0 6 * * *" })).toBe("Schedule · 0 6 * * *");
    expect(describeAutomationTrigger({ triggerType: "mqtt", topic: "sensor/#" })).toBe("MQTT · sensor/#");
  });
});
