// showcase-cleanup §8 — the escape-room session is a state machine, not a running clock.
//
// The timer used to start on the automation's first invocation: initialiseGameSession()
// set `timerStartedAt` to now, so a session was already counting down before anyone had
// asked for a game. Opening the pane consumed time, and there was no way to express "no
// game has started yet" because the only session flag was a `paused` boolean.
//
// These tests exercise the authored Logic directly rather than asserting on its source.
// The module is a set of plain functions over the sandbox globals (`state`, `devices`,
// `events`), so stubbing those and driving a fake clock tests the actual derivation the
// pane renders — which for a timer is the only thing worth testing.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  handleGameMasterAction,
  initialiseGameSession,
  liveRemaining,
  reconcileExitForCompletion,
  reconcileExpiry,
  startGame,
} from "../../demo/seed/projects/escape-game-master/logic/game-master";

/** A full session, mirroring SESSION_SECONDS in the Logic. */
const FULL = 2700;
const START = new Date("2026-03-01T09:00:00.000Z").getTime();

const store = new Map<string, unknown>();
const emitted: Array<{ topic: string; payload: Record<string, unknown> }> = [];
const commands: Array<{ id: string; payload: Record<string, unknown> }> = [];

/**
 * Device ids whose commands must fail verification, by device id.
 *
 * Empty by default, so the happy path reads exactly as it did before. A test that needs
 * a failure names the device rather than swapping the whole stub, which keeps the
 * failure local to the one command under examination.
 */
const failingDevices = new Set<string>();

function installSandboxGlobals(): void {
  const globals = globalThis as Record<string, unknown>;
  globals.state = {
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => { store.set(key, value); },
  };
  globals.devices = {
    list: () => [
      { id: "exit-1", topic: "switch/escape/exit/state", state: { locked: true } },
      { id: "hint-1", topic: "switch/escape/hint-screen/state", state: { message: "" } },
      { id: "fx-1", topic: "switch/escape/fx/state", state: { scene: "puzzle", smoke: false } },
      { id: "intercom-1", topic: "switch/escape/intercom/state", state: { tx: false } },
    ],
    action: async (id: string, _type: string, params: { payload: Record<string, unknown> }) => {
      commands.push({ id, payload: params.payload });
      const success = !failingDevices.has(id);
      return {
        success,
        commandId: "cmd-" + commands.length,
        lifecycleState: success ? "ACKNOWLEDGED" : "TIMED_OUT",
      };
    },
    commandEvidence: (commandId: string) => ({ commandId }),
  };
  globals.events = {
    emit: (topic: string, payload: Record<string, unknown>) => { emitted.push({ topic, payload }); },
  };
}

/** Advance both the fake clock and Date.now(), which is what the derivation reads. */
function elapse(seconds: number): void {
  vi.setSystemTime(new Date(Date.now() + seconds * 1000));
}

const emittedTopics = (): string[] => emitted.map((entry) => entry.topic);
const status = (): string => String(store.get("status"));

describe("escape room session lifecycle", () => {
  beforeEach(() => {
    store.clear();
    emitted.length = 0;
    commands.length = 0;
    failingDevices.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
    installSandboxGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts READY with a full clock and no start instant", () => {
    initialiseGameSession();

    expect(status()).toBe("ready");
    expect(store.get("remaining")).toBe(FULL);
    // The bug in one assertion: a start instant here is a session already running.
    expect(store.get("timerStartedAt")).toBe(0);
  });

  it("does not consume the session while nobody has started a game", () => {
    initialiseGameSession();

    elapse(600);

    expect(liveRemaining()).toBe(FULL);
    reconcileExpiry();
    expect(status()).toBe("ready");
  });

  it("begins timing only when the game is started", async () => {
    initialiseGameSession();
    elapse(120);
    expect(liveRemaining()).toBe(FULL);

    await startGame();
    expect(status()).toBe("running");
    expect(store.get("timerStartedAt")).toBe(Date.now());

    elapse(60);
    expect(liveRemaining()).toBe(FULL - 60);
  });

  it("freezes on pause and continues from where it stopped", async () => {
    initialiseGameSession();
    await startGame();

    elapse(60);
    await handleGameMasterAction("pause");
    expect(status()).toBe("paused");
    expect(store.get("remaining")).toBe(FULL - 60);

    // A paused clock does not tick, however long it is left.
    elapse(900);
    expect(liveRemaining()).toBe(FULL - 60);

    await handleGameMasterAction("pause");
    expect(status()).toBe("running");
    elapse(30);
    expect(liveRemaining()).toBe(FULL - 90);
  });

  it("refuses to pause a game that has not started", async () => {
    initialiseGameSession();

    await handleGameMasterAction("pause");

    expect(status()).toBe("ready");
    expect(store.get("timerStartedAt")).toBe(0);
  });

  it("returns to exactly a full clock on a new game", async () => {
    initialiseGameSession();
    await startGame();
    elapse(1500);
    await handleGameMasterAction("pause");

    await startGame();

    expect(store.get("remaining")).toBe(FULL);
    expect(status()).toBe("running");
    expect(liveRemaining()).toBe(FULL);
  });

  it("establishes a known room on start, through each owner's own path", async () => {
    initialiseGameSession();
    store.set("exitUnlocked", true);
    store.set("hintsSent", 4);
    store.set("lastHintId", 4);

    await startGame();

    // The props are reset through the room's own reset, not by writing into the puzzle
    // automation's state — the puzzle network republishes and reports back from there.
    expect(emittedTopics()).toContain("escape/sim/reset");
    // The room look is requested, so Room Systems commands its own controller.
    expect(emittedTopics()).toContain("escape/game/look-request");
    // The exit is secured by a verified command rather than assumed shut.
    expect(commands.some((command) => command.payload.locked === true)).toBe(true);
    expect(store.get("exitUnlocked")).toBe(false);
    // Session-specific state is cleared.
    expect(store.get("hintsSent")).toBe(0);
    expect(store.get("lastHintId")).toBe(0);
  });

  it("never commands the room controller it only observes", async () => {
    initialiseGameSession();
    await startGame();

    // Game Master owns the exit, hint screen and intercom. The FX controller belongs to
    // Room Systems and is reached by request, never by command.
    expect(commands.every((command) => command.id !== "fx-1")).toBe(true);
  });

  it("does not start a session when the exit maglock will not confirm it is secured", async () => {
    // §8.2 says a session must not begin on the assumption that the door is shut. The
    // code asked the question and threw the answer away: it awaited the secure command
    // and then set RUNNING with a full clock regardless, so an unconfirmed maglock
    // produced a running game carrying the PREVIOUS session's exit state.
    //
    // The setup is the worst case: a team has just escaped, so the door is open and
    // `exitUnlocked` is true going in.
    initialiseGameSession();
    store.set("exitUnlocked", true);
    failingDevices.add("exit-1");

    await startGame();

    // Still READY, so the clock has not been consumed and pressing start again is the
    // whole recovery.
    expect(status()).toBe("ready");
    expect(store.get("timerStartedAt")).toBe(0);
    expect(store.get("remaining")).toBe(FULL);
    // And the door is not reported as shut, because nothing confirmed it.
    expect(store.get("exitUnlocked")).toBe(true);
    // The command really was attempted — this is a refusal to proceed, not a skipped step.
    expect(commands.some((command) => command.id === "exit-1" && command.payload.locked === true)).toBe(true);
    // The operator is told why, on the pane's own action line.
    expect(String((store.get("lastAction") as { label?: string } | undefined)?.label)).toMatch(/not started/i);
  });

  it("still starts when the maglock confirms, so the guard is not simply refusing", async () => {
    // The other half of the guard: with a working maglock the session begins exactly as
    // before. Without this, the test above would pass on a startGame that never starts.
    initialiseGameSession();
    store.set("exitUnlocked", true);

    await startGame();

    expect(status()).toBe("running");
    expect(store.get("exitUnlocked")).toBe(false);
    expect(store.get("remaining")).toBe(FULL);
  });

  it("expires a session whose clock runs out", async () => {
    initialiseGameSession();
    await startGame();

    elapse(FULL + 30);
    expect(liveRemaining()).toBe(0);

    reconcileExpiry();
    expect(status()).toBe("expired");
    expect(store.get("remaining")).toBe(0);
    expect(store.get("timerStartedAt")).toBe(0);
  });

  it("stops the clock at the moment the team escaped", async () => {
    initialiseGameSession();
    await startGame();
    elapse(900);

    await reconcileExitForCompletion(true);

    expect(status()).toBe("completed");
    expect(store.get("remaining")).toBe(FULL - 900);
    expect(store.get("exitUnlocked")).toBe(true);

    // And it stays stopped, so the time the team escaped in is the time reported.
    elapse(600);
    expect(liveRemaining()).toBe(FULL - 900);
  });

  it("derives a time adjustment from the recorded clock rather than the pane", async () => {
    initialiseGameSession();
    await startGame();
    elapse(60);

    await handleGameMasterAction("add-time");

    // 2640 observed + 60 granted. The remaining seconds used to arrive in the event
    // payload, which made a visitor-supplied number authoritative over the session.
    expect(store.get("remaining")).toBe(FULL);
    expect(liveRemaining()).toBe(FULL);

    await handleGameMasterAction("sub-time");
    expect(store.get("remaining")).toBe(FULL - 60);
  });

  it("adjusts time without restarting a paused clock", async () => {
    initialiseGameSession();
    await startGame();
    elapse(60);
    await handleGameMasterAction("pause");

    await handleGameMasterAction("add-time");

    expect(status()).toBe("paused");
    expect(store.get("timerStartedAt")).toBe(0);
    elapse(300);
    expect(liveRemaining()).toBe(FULL);
  });
});
