import { describe, expect, it } from "vitest";
import {
  AUTOMATION_TRIGGER_TYPES,
  createDefaultAutomationProject,
  describeAutomationTrigger,
  describeSharedStatePatternProblem,
  isAutomationTriggerType,
  triggerCarriesPattern,
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

  describe("shared-state trigger (ADR-0016)", () => {
    it("describes a Shared State trigger as Shared State, never as MQTT", () => {
      // The path never reaches the broker, so calling it MQTT would be a lie the
      // UI tells about where the data came from.
      expect(describeAutomationTrigger({ triggerType: "shared-state", topic: "bunker-summary/#" }))
        .toBe("Shared State · bunker-summary/#");
      expect(describeAutomationTrigger({ triggerType: "shared-state" }))
        .toBe("Shared State · path not configured");
    });

    it("validates the pattern rather than accepting any non-empty string", () => {
      // The old MQTT fallthrough would have accepted all of these.
      expect(triggerIsConfigured("shared-state", "", "", true)).toBe(false);
      expect(triggerIsConfigured("shared-state", "bunker-summary/power", "", true)).toBe(true);
      expect(triggerIsConfigured("shared-state", "bunker-summary/#", "", true)).toBe(true);
      expect(triggerIsConfigured("shared-state", "a/b/c", "", true)).toBe(false);
      expect(triggerIsConfigured("shared-state", "bunker+/power", "", true)).toBe(false);
    });

    it("explains what is wrong with a pattern", () => {
      expect(describeSharedStatePatternProblem("bunker-summary/power")).toBeNull();
      expect(describeSharedStatePatternProblem("bunker-summary/+")).toBeNull();
      expect(describeSharedStatePatternProblem("+/power")).toBeNull();
      expect(describeSharedStatePatternProblem("#")).toBeNull();
      expect(describeSharedStatePatternProblem("")).toMatch(/bunker-summary\/power/);
      expect(describeSharedStatePatternProblem("a/b/c")).toMatch(/two parts/);
      expect(describeSharedStatePatternProblem("bunker-summary/")).toMatch(/empty part/);
      expect(describeSharedStatePatternProblem("#/power")).toMatch(/last part/);
      expect(describeSharedStatePatternProblem("po#wer")).toMatch(/whole part/);
    });

    it("knows which trigger types carry a pattern", () => {
      // Both mqtt and shared-state store their pattern in the same field, so both
      // must be sent on save; forgetting shared-state here would silently create a
      // rule that can never fire.
      expect(triggerCarriesPattern("mqtt")).toBe(true);
      expect(triggerCarriesPattern("shared-state")).toBe(true);
      expect(triggerCarriesPattern("cron")).toBe(false);
      expect(triggerCarriesPattern("none")).toBe(false);
    });

    it("narrows an untrusted trigger type, rejecting anything unrecognised", () => {
      for (const type of AUTOMATION_TRIGGER_TYPES) {
        expect(isAutomationTriggerType(type), type).toBe(true);
      }
      expect(isAutomationTriggerType("shared-state")).toBe(true);
      expect(isAutomationTriggerType("projection")).toBe(false);
      expect(isAutomationTriggerType(undefined)).toBe(false);
      expect(isAutomationTriggerType(null)).toBe(false);
    });

    it("lists exactly the trigger types the backend accepts", () => {
      expect([...AUTOMATION_TRIGGER_TYPES].sort()).toEqual(["cron", "mqtt", "none", "shared-state"]);
    });
  });
});
