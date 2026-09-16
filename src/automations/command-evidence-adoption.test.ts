// Command Evidence is platform chrome, not authored showcase UI.
//
// Build 44 proved the lifecycle model inside each custom pane. This regression pins
// the presentation correction: authored applications stay about their physical
// system, while AutomationPane owns the common Evidence inspector. The command
// intents still live in Logic because the runtime record needs to say what operation
// a physical command represented.

import { describe, expect, it } from "vitest";
import { waterAutomation } from "../../demo/seed/tabs/agriculture/water.mjs";
import { showSequencerAutomation } from "../../demo/seed/tabs/stage-show/sequencer.mjs";
import { predatorResponseAutomation } from "../../demo/seed/tabs/wildlife/predator-response.mjs";
import { ctdAutomation } from "../../demo/seed/tabs/research-vessel/ctd.mjs";
import { ventilationAutomation } from "../../demo/seed/tabs/underground-mining/ventilation.mjs";
import { dewateringAutomation } from "../../demo/seed/tabs/underground-mining/dewatering.mjs";
import { roomFxAutomation } from "../../demo/seed/tabs/escape-room/room-fx.mjs";
import { bunkerPerimeterAutomation } from "../../demo/seed/tabs/off-grid-bunker/perimeter.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";

const adopters = [
  ["Agriculture", waterAutomation],
  ["Stage & Show", showSequencerAutomation],
  ["Wildlife", predatorResponseAutomation],
  ["Research Vessel", ctdAutomation],
  ["Underground Mining · ventilation", ventilationAutomation],
  ["Underground Mining · dewatering", dewateringAutomation],
  ["Escape Room", roomFxAutomation],
  ["Off-grid Bunker", bunkerPerimeterAutomation],
] as const;

attachSeedProjectSource(...adopters.map(([, automation]) => automation));

describe("command evidence adoption across the showcase", () => {
  it("covers every showcase tab that issues a physical command", () => {
    const tabs = new Set(adopters.map(([tab]) => tab.split(" · ")[0]));
    expect(tabs.size).toBe(7);
  });

  it.each(adopters)(
    "%s keeps command proof out of the authored custom UI",
    (_tab, automation) => {
      const ui = String(automation.uiSource);
      expect(ui).not.toContain("CommandProofCard");
      expect(ui).not.toContain("CommandExecutionCard");
      expect(ui).not.toContain('aeolus.read("lastCommand")');
      expect(ui).not.toContain('aeolus.read("lastExecution")');
      expect(ui).not.toContain("COMMAND EVIDENCE");
    },
  );

  it.each(adopters)(
    "%s still names the operation each physical command performs",
    (_tab, automation) => {
      const script = String(automation.scriptSource);
      const commands = [...script.matchAll(/devices\.action\(/g)].length;
      const intents = [...script.matchAll(/intent:/g)].length;
      expect(commands).toBeGreaterThan(0);
      expect(intents, `${commands} commands but ${intents} intents`).toBeGreaterThanOrEqual(commands);
    },
  );

  it("does not reintroduce the superseded variable-length evidence helpers", () => {
    for (const [tab, automation] of adopters) {
      const ui = String(automation.uiSource);
      for (const removed of ["commandLadder(", "commandVerdict(", "rungProps(", "verdictProps("]) {
        expect(ui, `${tab} should leave lifecycle rendering to platform chrome`).not.toContain(removed);
      }
    }
  });
});
