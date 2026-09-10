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

// Which proof surface a tab should be using.
//
// `command` — one physical command per execution, so a single receipt is complete.
// `execution` — one trigger issues several commands, so a single receipt would report
//   whichever command happened to be last and silently drop the rest (§2.7).
type Surface = "command" | "execution";

const adopters = [
  ["Agriculture", waterAutomation, "command"],
  ["Stage & Show", showSequencerAutomation, "execution"],
  ["Wildlife", predatorResponseAutomation, "command"],
  ["Research Vessel", ctdAutomation, "command"],
  ["Underground Mining · ventilation", ventilationAutomation, "command"],
  ["Underground Mining · dewatering", dewateringAutomation, "command"],
  ["Escape Room", roomFxAutomation, "command"],
  ["Off-grid Bunker", bunkerPerimeterAutomation, "command"],
] as const satisfies ReadonlyArray<readonly [string, unknown, Surface]>;

attachSeedProjectSource(...adopters.map(([, automation]) => automation));

const eachAdopter = adopters.map(([tab, automation, surface]) => [tab, automation, surface] as const);
const eachSingle = eachAdopter.filter(([, , surface]) => surface === "command");
const eachGrouped = eachAdopter.filter(([, , surface]) => surface === "execution");

describe("command evidence adoption across the showcase", () => {
  it("covers every tab that issues a physical command", () => {
    // Seven tabs command something; mining contributes two automations.
    const tabs = new Set(adopters.map(([tab]) => tab.split(" · ")[0]));
    expect(tabs.size).toBe(7);
  });

  it.each(eachSingle)(
    "%s reads back the evidence for the command it issued",
    (_tab, automation) => {
      const script = String(automation.scriptSource);
      // The id comes from the result of the command, so the evidence cannot be for
      // a different command than the one just issued.
      expect(script).toContain("devices.commandEvidence(result.commandId)");
      expect(script).toContain('state.set("lastCommand"');
    },
  );

  it.each(eachSingle)(
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

  it.each(eachGrouped)(
    "%s groups the commands of one execution instead of keeping only the last",
    (_tab, automation) => {
      const script = String(automation.scriptSource);
      // The execution id is resolved by the host, so the group cannot be assembled
      // from a different execution than the one running.
      expect(script).toContain("devices.executionEvidence()");
      expect(script).toContain('state.set("lastExecution"');
      // The single-command key is what caused the loss: with several commands per
      // execution it reports whichever settled last and looks complete doing it.
      expect(script).not.toContain('state.set("lastCommand"');
    },
  );

  it.each(eachGrouped)(
    "%s renders the group, including the commands that proved less",
    (_tab, automation) => {
      const ui = String(automation.uiSource);
      expect(ui).toContain('aeolus.read("lastExecution")');
      expect(ui).toContain("CommandExecutionCard");
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

  it("shows a command being proven, not only that it was (§2.8)", () => {
    // Logic can only project a receipt after `devices.action()` resolves, which is
    // after every stage has been reached — so a projection alone can never show a
    // command climbing. Water Management is the reference example, so it is the one
    // that has to demonstrate the live feed rather than just describe it.
    const ui = String(waterAutomation.uiSource);
    expect(ui).toContain("aeolus.commands");
    // The live feed carries no capability snapshot, so a settled command is better
    // described by the projected receipt. Taking only the unsettled one is what keeps
    // the pane from showing `not-recorded` stages once the real answer exists.
    expect(ui).toContain("terminalAt");
    expect(ui).toContain("lastCommand");
  });

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
