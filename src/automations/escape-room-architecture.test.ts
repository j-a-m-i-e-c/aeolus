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

  // Game Master published its request and read the controller in the same execution,
  // which could only see the room as it was before Room Systems commanded it — and
  // nothing triggered Game Master again afterwards. A requested look therefore sat at
  // PENDING until an unrelated puzzle event happened to re-run the automation.
  it("re-runs Game Master when the room reports the look it actually applied",()=>{
    expect(roomFxAutomation.scriptSource).toContain('events.emit("escape/observed/room-look"');
    expect(gameMasterAutomation.triggerTopic).toBe("aeolus/events/+/escape/observed/#");
    expect(gameMasterAutomation.scriptSource).toContain("/escape/observed/room-look");
  });

  // Observed physical facts and operator requests travel in separate namespaces, so
  // widening Game Master's subscription to hear Room Systems does not also subscribe
  // it to its own look requests.
  it("never triggers an automation on the events it emits itself",()=>{
    const emitted=(source: string)=>[...String(source).matchAll(/events\.emit\("([^"]+)"/g)].map((m)=>m[1]);
    // An MQTT `+` matches one level and `#` the rest, so a trigger claims an event
    // exactly when it shares the trigger's fixed prefix.
    const prefixOf=(trigger: string)=>trigger.replace(/^aeolus\/events\/\+\//,"").replace(/\/?#$/,"");
    for(const rule of rules){
      if(!String(rule.triggerTopic).startsWith("aeolus/events/"))continue;
      const prefix=prefixOf(String(rule.triggerTopic));
      for(const name of emitted(rule.scriptSource)){
        expect(name.startsWith(prefix+"/"),`${rule.name} is triggered by its own ${name}`).toBe(false);
      }
    }
  });

  // showcase-cleanup §8.1 — the game waits in READY. Behaviour is covered in
  // escape-room-session.test.ts; this pins the wiring the pane and the seed depend on.
  it("waits in READY until an operator starts the game",()=>{
    const script=String(gameMasterAutomation.scriptSource);
    for(const state of ["ready","running","paused","completed","expired"]){
      expect(script,`no ${state} session state`).toContain(`"${state}"`);
    }
    // The clock cannot be started by initialising, only by the action.
    expect(script).toContain('state.set("timerStartedAt", 0)');
    expect(gameMasterAutomation.demoAccess?.fireEvents).toContain("start-game");
    expect(gameMasterAutomation.uiSource).toContain("START GAME");
    expect(gameMasterAutomation.uiSource).toContain("START NEW GAME");
  });

  // §8.2 — a start establishes a known room, and does it through each owner's own path
  // rather than by reaching into another automation's state.
  it("resets the room on start without touching another automation's state",()=>{
    const script=String(gameMasterAutomation.scriptSource);
    expect(script).toContain('events.emit("escape/sim/reset"');
    expect(script).toContain('events.emit("escape/game/look-request"');
    // The puzzle network is still owned by Puzzle Progress: Game Master neither reads
    // its sensor nor writes its projection.
    expect(script).not.toContain("sensor/escape/puzzles");
  });

  // §8.3 — the browser no longer decides how much time is left. It used to pass the
  // remaining seconds back with every session action, which on the public demo made a
  // visitor-supplied number authoritative over the session clock.
  it("keeps the session clock out of the browser's hands",()=>{
    expect(gameMasterAutomation.scriptSource).not.toContain("payload.remaining");
    expect(gameMasterAutomation.uiSource).not.toMatch(/fire\(\s*event\s*,\s*\{\s*remaining/);
  });

  it("keeps the physical room controller owned by Room Systems alone",()=>{
    const fxCommands=(source: string)=>[...String(source).matchAll(/switch\/escape\/fx\/set/g)].length;
    expect(fxCommands(roomFxAutomation.scriptSource)).toBeGreaterThanOrEqual(0);
    expect(roomFxAutomation.scriptSource).toContain("switch/escape/fx/state");
    expect(puzzleProgressAutomation.scriptSource).not.toContain("switch/escape/fx");
  });
});
