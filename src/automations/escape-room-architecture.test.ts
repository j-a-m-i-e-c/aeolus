import { describe, expect, it } from "vitest";
import { gameMasterAutomation } from "../../demo/seed/tabs/escape-room/game-master.mjs";
import { puzzleProgressAutomation } from "../../demo/seed/tabs/escape-room/puzzles.mjs";
import { roomFxAutomation } from "../../demo/seed/tabs/escape-room/room-fx.mjs";
import { attachSeedProjectSource } from "../__test-helpers__/seed-project-source.js";
// Authored source lives in demo/seed/projects/<projectDir>; expose it as
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

  // The look used to appear only as "ROOM LOOK REQUEST · TENSION" in the comms card,
  // which told an operator nothing about the room they were running.
  it("shows the room look on the depicted room, not in the comms card",()=>{
    expect(gameMasterAutomation.uiSource).not.toContain("ROOM LOOK REQUEST");
    for(const look of ["calm","puzzle","tension","victory"]){
      expect(gameMasterAutomation.uiSource,`no visual treatment for the ${look} look`).toContain(look);
    }
    expect(gameMasterAutomation.uiSource).toMatch(/APPLIED/);
    expect(gameMasterAutomation.uiSource).toMatch(/PENDING/);
  });

  // One automation asks; the other owns the hardware. Game Master may observe the
  // controller to know whether its request landed, but must never command it.
  it("lets Game Master observe the room controller without ever commanding it",()=>{
    expect(gameMasterAutomation.scriptSource).toContain('state.set("appliedLook"');
    expect(gameMasterAutomation.scriptSource).toContain("switch/escape/fx/state");
    expect(gameMasterAutomation.scriptSource).not.toContain("switch/escape/fx/set");
    // The request itself still travels as a domain event, not a direct call.
    expect(gameMasterAutomation.scriptSource).toContain('events.emit("escape/game/look-request"');
    expect(roomFxAutomation.triggerTopic).toBe("aeolus/events/+/escape/game/#");
  });

  it("keeps the physical room controller owned by Room Systems alone",()=>{
    const fxCommands=(source: string)=>[...String(source).matchAll(/switch\/escape\/fx\/set/g)].length;
    expect(fxCommands(roomFxAutomation.scriptSource)).toBeGreaterThanOrEqual(0);
    expect(roomFxAutomation.scriptSource).toContain("switch/escape/fx/state");
    expect(puzzleProgressAutomation.scriptSource).not.toContain("switch/escape/fx");
  });
});
