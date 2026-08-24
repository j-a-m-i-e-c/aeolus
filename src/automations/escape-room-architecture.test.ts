import { describe, expect, it } from "vitest";
import { gameMasterAutomation } from "../../scripts/seed/tabs/escape-room/game-master.mjs";
import { puzzleProgressAutomation } from "../../scripts/seed/tabs/escape-room/puzzles.mjs";
import { roomFxAutomation } from "../../scripts/seed/tabs/escape-room/room-fx.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
// Authored source lives in scripts/seed/projects/<projectDir>; expose it as
// scriptSource/uiSource for the source-level assertions below.
attachSeedProjectSource(gameMasterAutomation, puzzleProgressAutomation, roomFxAutomation);

const rules=[gameMasterAutomation,puzzleProgressAutomation,roomFxAutomation];
describe("Escape Room showcase",()=>{
  it("separates Game Master, physical puzzle progression and room systems",()=>expect(rules).toHaveLength(3));
  it("keeps physical participant actions on the puzzle system",()=>{expect(puzzleProgressAutomation.uiSource).toContain("DEMO SCENARIO");expect(gameMasterAutomation.uiSource).not.toContain("DEMO SCENARIO")});
  it("tracks four puzzles with attempts and solve times",()=>{expect(puzzleProgressAutomation.scriptSource).toContain('"p4"');expect(puzzleProgressAutomation.uiSource).toContain("ATTEMPTS");expect(puzzleProgressAutomation.uiSource).toMatch(/SOLVE|TIME/)});
  it("gives Game Master persistent hints and a room-targeted hold-to-talk intercom",()=>{expect(gameMasterAutomation.scriptSource).toContain("switch/escape/intercom/state");expect(gameMasterAutomation.uiSource).toContain("HOLD TO TALK");expect(gameMasterAutomation.uiSource).toContain("HINT")});
  it("makes room look requests command a visible physical room system",()=>{expect(roomFxAutomation.scriptSource).toContain("devices.action(");expect(roomFxAutomation.uiSource).toContain("ROOM SYSTEMS")});
  it("keeps UIs exposure independent",()=>{for(const r of rules)expect(r.uiSource).not.toContain("aeolus.devices")});
});
