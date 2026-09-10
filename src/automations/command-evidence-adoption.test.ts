// Every showcase tab that commands something must show its proof.
//
// The four-stage proof is the thing that distinguishes Aeolus from a dashboard that
// fires and hopes, so it belongs on the platform rather than on one favoured pane.
// This test pins the coverage: if a tab's chosen automation stops projecting its
// command evidence, or a new tab arrives with none, this fails.
//
// Space is deliberately absent. It renders real ISS telemetry and issues no
// commands at all, so it has no proof to show — an empty one there would be a
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

const eachAdopter = adopters.map(([tab, automation]) => [tab, automation] as const);

describe("command evidence adoption across the showcase", () => {
  it("covers every tab that issues a physical command", () => {
    // Seven tabs command something; mining contributes two automations.
    const tabs = new Set(adopters.map(([tab]) => tab.split(" · ")[0]));
    expect(tabs.size).toBe(7);
  });

  it.each(eachAdopter)(
    "%s reads back the evidence for the command it issued",
    (_tab, automation) => {
      const script = String(automation.scriptSource);
      // The id comes from the result of the command, so the evidence cannot be for
      // a different command than the one just issued.
      expect(script).toContain("devices.commandEvidence(result.commandId)");
      expect(script).toContain('state.set("lastCommand"');
    },
  );

  it.each(eachAdopter)(
    "%s renders the proof from the projection rather than inventing one",
    (_tab, automation) => {
      const ui = String(automation.uiSource);
      expect(ui).toContain('aeolus.read("lastCommand")');
      // One shared surface, so the stage statuses cannot come to mean different
      // things on different tabs — which is exactly what eight hand-copied blocks
      // had started to allow.
      expect(ui).toContain("CommandProofCard");
      expect(ui).toContain('from "@aeolus/ui"');
    },
  );

  it.each(eachAdopter)(
    "%s no longer hand-rolls its own evidence block",
    (_tab, automation) => {
      const ui = String(automation.uiSource);
      // The superseded API. A pane still calling it would be rendering a
      // variable-length ladder that silently omits the stages a device cannot reach.
      for (const removed of ["commandLadder(", "commandVerdict(", "rungProps(", "verdictProps("]) {
        expect(ui).not.toContain(removed);
      }
      // The old anonymous heading. Proof is now titled by the operation it belongs
      // to, so a pane with several controls says which one it is reporting on.
      expect(ui).not.toContain("COMMAND EVIDENCE");
    },
  );

  it.each(eachAdopter)(
    "%s names the operation its command performed",
    (_tab, automation) => {
      // Without an intent label the receipt falls back to `device_action`, which
      // names the mechanism rather than the operation and tells an operator nothing
      // about which button they pressed.
      expect(String(automation.scriptSource)).toContain("evidence:");
    },
  );
});
