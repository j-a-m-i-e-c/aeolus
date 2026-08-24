import { describe, expect, it } from "vitest";
import { automationProjectModelUri } from "../lib/automation-project-model";

describe("AutomationProjectEditor Monaco model identity", () => {
  it("namespaces identical file paths by automation identity", () => {
    const water = automationProjectModelUri("farm-water", "logic/index.ts");
    const energy = automationProjectModelUri("farm-energy", "logic/index.ts");

    expect(water).not.toBe(energy);
    expect(water).toContain("farm-water");
    expect(energy).toContain("farm-energy");
  });

  it("keeps files inside the same project namespace", () => {
    expect(automationProjectModelUri("space", "logic/index.ts")).toBe(
      "file:///aeolus-project/space/logic/index.ts",
    );
    expect(automationProjectModelUri("space", "ui/index.tsx")).toBe(
      "file:///aeolus-project/space/ui/index.tsx",
    );
  });
});
