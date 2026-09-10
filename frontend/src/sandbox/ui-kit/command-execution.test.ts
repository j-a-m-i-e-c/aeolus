// showcase-cleanup §2.7 — grouping several commands under the execution that caused them.
//
// The behaviour worth pinning is what the single-command treatment got wrong: a cue
// that issued two commands reported one of them and looked complete doing it. Beyond
// that, the group must refuse to invent a tier for itself, and must take its trigger
// from the record rather than from anything a pane knows.

import { describe, it, expect } from "vitest";
import { commandExecutionProof, describeTrigger } from "./command-execution";

function transition(toState: string, timestamp: number, details?: Record<string, unknown>) {
  return { toState, timestamp, ...(details ? { details } : {}) };
}

/** The lighting desk: proves its transition completed via measured telemetry. */
function lightingCommand(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-dmx",
    executionId: "exec-cue",
    actionType: "device_action",
    lifecycleState: "OBSERVED",
    effectiveTier: "observed",
    capabilityCeiling: "observed",
    ackAvailable: true,
    observationConfigured: true,
    conditionSpec: { field: "transitioning", op: "eq", value: false },
    targetDeviceId: "dmx-1",
    targetDeviceName: "Lighting Desk",
    observedDeviceName: "Lighting Desk",
    transportKind: "mqtt",
    intentLabel: "Lighting cue · chorus",
    success: true,
    requestedAt: 1_000,
    terminalAt: 2_400,
    triggerTopic: "ui/rule-show/run-cue",
    transitions: [
      transition("REQUESTED", 1_000),
      transition("DISPATCHED", 1_040),
      transition("ACKNOWLEDGED", 1_090),
      transition("OBSERVED", 2_400, { reason: "Observed device state satisfied the required condition" }),
    ],
    ...overrides,
  };
}

/** The effects rack: acknowledgement is its honest ceiling, nothing measures a burst. */
function effectCommand(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-fx",
    executionId: "exec-cue",
    actionType: "device_action",
    lifecycleState: "ACKNOWLEDGED",
    effectiveTier: "acknowledged",
    capabilityCeiling: "acknowledged",
    ackAvailable: true,
    observationConfigured: false,
    targetDeviceId: "fx-1",
    targetDeviceName: "Stage FX Rack",
    transportKind: "mqtt",
    intentLabel: "Fire stage effect · confetti",
    success: true,
    requestedAt: 2_500,
    terminalAt: 3_100,
    triggerTopic: "ui/rule-show/run-cue",
    transitions: [
      transition("REQUESTED", 2_500),
      transition("DISPATCHED", 2_540),
      transition("ACKNOWLEDGED", 3_100),
    ],
    ...overrides,
  };
}

function group(commands: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    executionId: "exec-cue",
    triggerTopic: "ui/rule-show/run-cue",
    commands,
    ...overrides,
  };
}

describe("commandExecutionProof", () => {
  it("returns null when there is no execution to describe", () => {
    // A pane must render nothing rather than a group header asserting an operation
    // that may not have happened.
    expect(commandExecutionProof(undefined)).toBeNull();
    expect(commandExecutionProof(null)).toBeNull();
    expect(commandExecutionProof({})).toBeNull();
    expect(commandExecutionProof(group([]))).toBeNull();
  });

  it("returns null when no member is readable", () => {
    expect(commandExecutionProof(group([{ commandId: "x" }, "nonsense"]))).toBeNull();
  });

  it("keeps every command of the execution, in order", () => {
    // The regression this exists for: the single-command key reported whichever
    // settled last and dropped the rest while still looking complete.
    const proof = commandExecutionProof(group([lightingCommand(), effectCommand()]))!;

    expect(proof.count).toBe(2);
    expect(proof.commands.map((entry) => entry.intent)).toEqual([
      "Lighting cue · chorus",
      "Fire stage effect · confetti",
    ]);
  });

  it("lets each command keep its own tier", () => {
    const proof = commandExecutionProof(group([lightingCommand(), effectCommand()]))!;

    expect(proof.commands[0]!.headline).toBe("OBSERVED");
    expect(proof.commands[1]!.headline).toBe("ACKNOWLEDGED");
  });

  it("gives the group a count rather than a tier of its own", () => {
    // A group whose members reached different tiers has no single tier. Reporting the
    // highest would overstate the effects rack; reporting the lowest would understate
    // the lighting desk. So the group reports how many proved what was asked.
    const proof = commandExecutionProof(group([lightingCommand(), effectCommand()]))!;

    expect(proof.headline).toBe("2 OF 2 PROVEN");
    expect(proof.headline).not.toMatch(/OBSERVED|ACKNOWLEDGED|DISPATCH/);
    expect(proof.proven).toBe(true);
    expect(proof.mark).toBe("✓");
  });

  it("reports a partial group honestly", () => {
    const failed = effectCommand({
      lifecycleState: "TIMED_OUT",
      success: false,
      transitions: [
        transition("REQUESTED", 2_500),
        transition("DISPATCHED", 2_540),
        transition("TIMED_OUT", 7_500, { reason: "No acknowledgement within 5000ms" }),
      ],
      terminalAt: 7_500,
    });
    const proof = commandExecutionProof(group([lightingCommand(), failed]))!;

    expect(proof.headline).toBe("1 OF 2 PROVEN");
    expect(proof.provenCount).toBe(1);
    expect(proof.proven).toBe(false);
    expect(proof.mark).toBe("✕");
  });

  it("stays in flight until every command has settled", () => {
    // One unsettled member means the operation is not over, whatever the others did.
    const inFlight = effectCommand({
      lifecycleState: "DISPATCHED",
      success: undefined,
      terminalAt: undefined,
      transitions: [transition("REQUESTED", 2_500), transition("DISPATCHED", 2_540)],
    });
    const proof = commandExecutionProof(group([lightingCommand(), inFlight]))!;

    expect(proof.settled).toBe(false);
    expect(proof.headline).toBe("IN FLIGHT");
    expect(proof.mark).toBe("○");
    // No duration claimed: a partial span would understate a group still running.
    expect(proof.durationMs).toBeNull();
    expect(proof.summary).toBe("2 commands");
  });

  it("spans the whole operation when timing it", () => {
    // First request to last settlement — the elapsed time of the operation, not of
    // any one command within it.
    const proof = commandExecutionProof(group([lightingCommand(), effectCommand()]))!;

    expect(proof.durationMs).toBe(2_100);
    expect(proof.summary).toBe("2 commands · 2.1 s");
  });

  it("says 'command' rather than 'commands' for a group of one", () => {
    const proof = commandExecutionProof(group([lightingCommand()]))!;
    expect(proof.summary).toBe("1 command · 1.4 s");
  });

  it("skips an unreadable member rather than losing the whole group", () => {
    // A receipt for two of three commands is worth more than none, and the count
    // reports what was actually read.
    const proof = commandExecutionProof(group([lightingCommand(), { commandId: "junk" }, effectCommand()]))!;
    expect(proof.count).toBe(2);
  });

  it("accepts a bare array of records", () => {
    const proof = commandExecutionProof([lightingCommand(), effectCommand()])!;
    expect(proof.count).toBe(2);
    // Falls back to the id every member agrees on.
    expect(proof.executionId).toBe("exec-cue");
    expect(proof.trigger).toBe('operator "run-cue"');
  });
});

describe("describeTrigger", () => {
  it("names the operator event behind a UI fire", () => {
    // The rule id is noise to someone already looking at that automation's pane.
    expect(describeTrigger({ triggerTopic: "ui/rule-show/run-cue" })).toBe('operator "run-cue"');
  });

  it("keeps the event name verbatim rather than prettifying it", () => {
    // The event name is what the automation actually handled. Rewriting it would put
    // a caption between the operator and the record.
    expect(describeTrigger({ triggerTopic: "ui/rule-A/transfer-500" })).toBe('operator "transfer-500"');
  });

  it("reads a device trigger as its topic", () => {
    expect(describeTrigger({ triggerTopic: "sensor/mine/gas", triggerKind: "mqtt-device" })).toBe(
      "sensor/mine/gas",
    );
  });

  it("falls back to the originator when no topic was recorded", () => {
    expect(describeTrigger({ triggerKind: "mqtt-device", triggerId: "gas-3" })).toBe(
      "mqtt-device gas-3",
    );
    expect(describeTrigger({ triggerKind: "connector" })).toBe("connector");
  });

  it("returns nothing when nothing was recorded", () => {
    // A pre-018 command had a cause the schema never captured. Empty is how that is
    // said; the card then shows no trigger line rather than a fabricated one.
    expect(describeTrigger({})).toBe("");
    expect(describeTrigger(undefined)).toBe("");
  });

  it("prefers the group's own trigger over a member's", () => {
    const proof = commandExecutionProof(
      group([lightingCommand({ triggerTopic: "sensor/other" })], { triggerTopic: "sensor/mine/gas" }),
    )!;
    expect(proof.trigger).toBe("sensor/mine/gas");
  });

  it("reads the trigger off the first member when the group carries none", () => {
    const proof = commandExecutionProof(
      group([lightingCommand({ triggerTopic: "sensor/mine/gas" })], { triggerTopic: undefined }),
    )!;
    expect(proof.trigger).toBe("sensor/mine/gas");
  });
});
