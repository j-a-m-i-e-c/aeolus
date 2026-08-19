import { describe, expect, it } from "vitest";
import { showSequencerAutomation } from "../../scripts/seed/tabs/stage-show/sequencer.mjs";

describe("Stage & Show showcase", () => {
  it("uses one coherent Show Control automation instead of splitting one console into artificial silos", () => {
    expect(showSequencerAutomation.name).toBe("Show Control");
    expect(showSequencerAutomation.uiSource).toContain("CUE STACK");
    expect(showSequencerAutomation.uiSource).toContain("SHOW CONTROL");
  });
  it("owns lighting and physical effects through verified commands", () => {
    expect(showSequencerAutomation.scriptSource).toContain("devices.action(");
    expect(showSequencerAutomation.scriptSource).toContain("switch/stage/dmx/state");
    expect(showSequencerAutomation.scriptSource).toContain("switch/stage/fx/state");
    expect(showSequencerAutomation.scriptSource).not.toContain("mqtt.publish(");
  });
  it("offers an editable browser-local cue stack and richer FX", () => {
    for (const label of ["CONFETTI", "PYRO", "WATER", "SMOKE", "STROBE"]) expect(showSequencerAutomation.uiSource.toUpperCase()).toContain(label);
    expect(showSequencerAutomation.uiSource).toContain("this browser only");
  });
  it("keeps safety visible inside the real control board and demo injection separate", () => {
    expect(showSequencerAutomation.uiSource).toContain("SAFETY");
    expect(showSequencerAutomation.uiSource).toContain("DEMO SCENARIO");
  });
});
