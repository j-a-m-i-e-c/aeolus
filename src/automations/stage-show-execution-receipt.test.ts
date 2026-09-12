// Show Control groups the commands of one cue under their execution, so the pane shows
// one receipt covering the lighting transition and the effect together (§2.7).
//
// The gap this covers is what happens when an execution issues NO command.
// `devices.executionEvidence()` returns undefined for an execution with no commands, and
// the publish helper only wrote state when it got a group — so a cue the safety loop
// refused left the PREVIOUS cue's receipt on screen, directly beside an action line
// saying the effect was blocked. The pane appeared to hold proof for something that had
// just been prevented.
//
// Driven against the authored Logic rather than its source: whether a receipt is cleared
// is a question about what the functions do, and the source says nothing useful about it.

import { describe, expect, it, beforeEach } from "vitest";
import {
  executeCue,
  fireOperatorEffect,
  projectStageState,
  stopPhysicalEffects,
} from "../../demo/seed/projects/stage-show-sequencer/logic/show-control";

const DMX_TOPIC = "switch/stage/dmx/state";
const FX_TOPIC = "switch/stage/fx/state";
const SAFETY_TOPIC = "sensor/stage/safety";

/** Every permissive closed, which is the rig's normal state. */
const SAFE = {
  estop: false,
  fxLoopHealthy: true,
  doorClosed: true,
  pyroArmed: true,
  exclusionZoneClear: true,
  waterFxReady: true,
};

const store = new Map<string, unknown>();
const commands: Array<{ id: string; payload: Record<string, unknown> }> = [];
/** Command ids attributed to the execution currently being simulated. */
let executionCommands: string[] = [];
const pendingFxHistory: boolean[] = [];

/**
 * Install the sandbox globals.
 *
 * `executionEvidence` mirrors the real host callback, which returns undefined when the
 * execution issued no commands. That behaviour is the whole subject here, so it is
 * reproduced rather than stubbed away.
 */
function installSandbox(safety: Record<string, unknown> = SAFE): void {
  const globals = globalThis as Record<string, unknown>;
  globals.state = {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
      if (key === "pendingFx") pendingFxHistory.push(Boolean(value));
    },
  };
  globals.devices = {
    list: () => [
      { id: "dmx-1", topic: DMX_TOPIC, state: { scene: "wash", master: 72, transitioning: false, fixturesOnline: 12, cueNumber: 4 } },
      { id: "fx-1", topic: FX_TOPIC, state: { active: false, effect: "none", haze: 28 } },
      { id: "safety-1", topic: SAFETY_TOPIC, state: safety },
    ],
    action: async (id: string, _type: string, params: { payload: Record<string, unknown> }) => {
      commands.push({ id, payload: params.payload });
      const commandId = "cmd-" + commands.length;
      executionCommands.push(commandId);
      return { success: true, commandId, lifecycleState: "OBSERVED" };
    },
    commandEvidence: (commandId: string) => ({ commandId }),
    executionEvidence: () => {
      if (executionCommands.length === 0) return undefined;
      return {
        executionId: "exec-1",
        triggerTopic: "ui/stage/cue",
        commands: executionCommands.map((commandId) => ({ commandId })),
      };
    },
  };
  globals.events = { emit: () => {} };
  globals.db = { write: () => {} };
}

/** Begin a fresh automation execution, which is what resets the evidence group. */
function newExecution(): void {
  executionCommands = [];
}

describe("Show Control execution receipts", () => {
  beforeEach(() => {
    store.clear();
    commands.length = 0;
    pendingFxHistory.length = 0;
    newExecution();
    installSandbox();
    projectStageState();
  });

  it("groups the commands of one cue under a single receipt", async () => {
    await executeCue({ scene: "chorus", effect: "confetti", master: 88, label: "Chorus hit" });

    // Two physical commands, one operator action, one receipt covering both.
    expect(commands).toHaveLength(2);
    const group = store.get("lastExecution") as { commands: unknown[] } | null;
    expect(group).not.toBeNull();
    expect(group!.commands).toHaveLength(2);
  });

  it("clears the receipt when the safety loop refuses the effect outright", async () => {
    // A cue that ran, then a pyro cue the exclusion zone blocks. The second execution
    // dispatches the lighting change but never reaches the rack, and previously the pane
    // kept whatever receipt the first cue had left.
    await executeCue({ scene: "chorus", effect: "confetti", master: 88, label: "Chorus hit" });
    const firstReceipt = store.get("lastExecution");
    expect(firstReceipt).not.toBeNull();

    newExecution();
    installSandbox({ ...SAFE, exclusionZoneClear: false });
    await executeCue({ scene: "red", effect: "pyro", master: 95, label: "Pyro hit" });

    // The lighting command did go out, so this execution does have a receipt — but it
    // covers one command, not the previous cue's two.
    const second = store.get("lastExecution") as { commands: unknown[] } | null;
    expect(second).not.toBeNull();
    expect(second!.commands).toHaveLength(1);
    expect(second).not.toBe(firstReceipt);
    // And the operator is told the effect was refused.
    expect(String((store.get("lastAction") as { label?: string } | undefined)?.label)).toMatch(/blocked/i);
  });

  it("shows no receipt at all for an operator effect that never left the rig", async () => {
    // The exact case that prompted this. A manual PYRO press with the zone open issues
    // nothing whatsoever, so there is no proof to show — and the previous cue's proof is
    // not it.
    await executeCue({ scene: "chorus", effect: "confetti", master: 88, label: "Chorus hit" });
    expect(store.get("lastExecution")).not.toBeNull();
    const before = commands.length;

    newExecution();
    installSandbox({ ...SAFE, exclusionZoneClear: false });
    await fireOperatorEffect({ effect: "pyro" });

    expect(commands.length, "nothing should be dispatched").toBe(before);
    expect(store.get("lastExecution"), "a blocked effect must not inherit a receipt").toBeNull();
    expect(String((store.get("lastAction") as { label?: string } | undefined)?.label)).toMatch(/blocked/i);
  });

  it("marks the stop control pending while the rack is being told to stop", async () => {
    // STOP FX shares `pendingFx` with the effect buttons. The stop path never set it, so
    // the one control an operator reaches for when something is wrong was the only one
    // that gave no sign it had been pressed.
    installSandbox();
    store.set("fxActive", true);
    pendingFxHistory.length = 0;

    await stopPhysicalEffects();

    expect(pendingFxHistory, "stop must raise and then clear the pending flag").toEqual([true, false]);
    expect(store.get("fxActive")).toBe(false);
    expect(store.get("effect")).toBe("none");
  });
});
