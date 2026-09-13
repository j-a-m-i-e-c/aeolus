// A muster is proven by everyone who was underground reaching the refuge, so the number
// it waits for has to be however many that is.
//
// It was a hard-coded 14, which matched the fixture and nothing else. Change the crew and
// the observation waits for a refuge occupancy that can never arrive: every muster times
// out and reports unverified while the mine behaves perfectly.
//
// The opposite end matters more. Deriving the count without guarding zero would mean a
// mine with nobody underground waits for `refuge >= 0` — satisfied the instant it is
// asked. That is a proof that cannot fail, which is worse than no proof at all, so the
// command is refused instead.

import { describe, expect, it, beforeEach } from "vitest";
import {
  commandMuster,
  projectPersonnelState,
} from "../../demo/seed/projects/mine-personnel/logic/personnel-muster";

const PERSONNEL_TOPIC = "sensor/mine/personnel";
const MUSTER_TOPIC = "switch/mine/muster/state";

const store = new Map<string, unknown>();
const emitted: Array<{ topic: string; payload: Record<string, unknown> }> = [];
const conditions: unknown[] = [];
let commandsIssued = 0;

/** Install the sandbox globals over a personnel snapshot the caller controls. */
function installSandbox(personnel: Record<string, unknown>): void {
  const globals = globalThis as Record<string, unknown>;
  globals.state = {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => { store.set(key, value); },
    delete: (key: string) => { store.delete(key); },
  };
  globals.devices = {
    list: () => [
      { id: "muster-1", topic: MUSTER_TOPIC, state: { active: false, alarm: false, state: "normal" } },
      { id: "personnel-1", topic: PERSONNEL_TOPIC, state: personnel },
    ],
    action: async (
      _id: string,
      _type: string,
      _params: unknown,
      options: { condition?: unknown },
    ) => {
      commandsIssued += 1;
      conditions.push(options?.condition);
      return { success: true, commandId: "cmd-" + commandsIssued, lifecycleState: "OBSERVED" };
    },
    commandEvidence: (commandId: string) => ({ commandId }),
  };
  globals.events = {
    emit: (topic: string, payload: Record<string, unknown>) => { emitted.push({ topic, payload }); },
  };
}

/** The refuge occupancy the muster's observation waited for. */
const refugeTarget = (): unknown =>
  (conditions.at(-1) as { field?: string; op?: string; value?: unknown } | undefined)?.value;

describe("mine personnel muster", () => {
  beforeEach(() => {
    store.clear();
    emitted.length = 0;
    conditions.length = 0;
    commandsIssued = 0;
  });

  it("waits for as many people as the tracking network says are underground", async () => {
    installSandbox({ underground: 14, l1: 3, l2: 6, l3: 5, refuge: 0, unaccounted: 0 });
    projectPersonnelState();

    await commandMuster(true);

    expect(conditions.at(-1)).toMatchObject({ field: "refuge", op: "gte" });
    expect(refugeTarget()).toBe(14);
  });

  it("follows the crew count rather than a number written into the source", async () => {
    // The same mine with a different shift. A hard-coded threshold makes this muster
    // permanently unverifiable; the derived one simply waits for nine.
    installSandbox({ underground: 9, l1: 2, l2: 4, l3: 3, refuge: 0, unaccounted: 0 });
    projectPersonnelState();

    await commandMuster(true);

    expect(refugeTarget()).toBe(9);
  });

  it("refuses a muster with nobody underground rather than proving it instantly", async () => {
    installSandbox({ underground: 0, l1: 0, l2: 0, l3: 0, refuge: 0, unaccounted: 0 });
    projectPersonnelState();

    await commandMuster(true);

    // No command at all: waiting for `refuge >= 0` would report a verified evacuation of
    // an empty mine.
    expect(commandsIssued).toBe(0);
    expect(String((store.get("lastAction") as { label?: string } | undefined)?.label))
      .toMatch(/nobody underground/i);
    // And the pane is not left waiting on it.
    expect(store.get("commandPending")).not.toBe(true);
  });

  it("still clears a muster when the refuge is the thing that must empty", async () => {
    // Clearing is the mirror image and has no headcount: it waits for zero, which is a
    // real transition rather than a tautology.
    installSandbox({ underground: 14, l1: 0, l2: 0, l3: 0, refuge: 14, unaccounted: 0 });
    projectPersonnelState();

    await commandMuster(false);

    expect(commandsIssued).toBe(1);
    expect(conditions.at(-1)).toMatchObject({ field: "refuge", op: "eq", value: 0 });
  });
});
