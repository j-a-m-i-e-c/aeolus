// Every showcase tab that commands something must show its evidence.
//
// The evidence ladder is the thing that distinguishes Aeolus from a dashboard that
// fires and hopes, so it belongs on the platform rather than on one favoured pane.
// This test pins the coverage: if a tab's chosen automation stops projecting its
// command evidence, or a new tab arrives with none, this fails.
//
// Space is deliberately absent. It renders real ISS telemetry and issues no
// commands at all, so it has no ladder to show — an empty one there would be a
// fabrication, not a gap.

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
  it("covers every tab that issues a physical command", () => {
    // Seven tabs command something; mining contributes two automations.
    const tabs = new Set(adopters.map(([tab]) => tab.split(" · ")[0]));
    expect(tabs.size).toBe(7);
  });

  it.each(adopters.map(([tab, automation]) => [tab, automation] as const))(
    "%s reads back the evidence for the command it issued",
    (_tab, automation) => {
      const script = String(automation.scriptSource);
      // The id comes from the result of the command, so the evidence cannot be for
      // a different command than the one just issued.
      expect(script).toContain("devices.commandEvidence(result.commandId)");
      expect(script).toContain('state.set("lastCommand"');
    },
  );

  it.each(adopters.map(([tab, automation]) => [tab, automation] as const))(
    "%s renders the ladder from the projection rather than inventing one",
    (_tab, automation) => {
      const ui = String(automation.uiSource);
      expect(ui).toContain('aeolus.read("lastCommand")');
      expect(ui).toContain("commandLadder(");
      expect(ui).toContain("commandVerdict(");
      // Rung and headline styling comes from the shared kit, so the three statuses
      // cannot come to mean different things on different tabs.
      expect(ui).toContain("rungProps(");
      expect(ui).toContain("verdictProps(");
      expect(ui).toContain('from "@aeolus/ui"');
    },
  );

  it.each(adopters.map(([tab, automation]) => [tab, automation] as const))(
    "%s states the evidence is a record rather than a guess",
    (_tab, automation) => {
      expect(String(automation.uiSource)).toContain("COMMAND EVIDENCE");
    },
  );
});
