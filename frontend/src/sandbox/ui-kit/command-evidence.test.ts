// Guards the command-evidence helpers in `@aeolus/ui`.
//
// These are what every showcase pane will lean on to render a command's evidence
// ladder, so the line they hold is: a rung appears only if it actually happened,
// and a verdict never claims a stronger tier than the command was held to.

import { describe, expect, it } from "vitest";
import { commandLadder, commandVerdict, describeCondition } from "./index";

/** The shape `devices.commandEvidence()` returns, projected by Logic unchanged. */
function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commandId: "cmd-1",
    actionType: "device_action",
    effectiveTier: "observed",
    lifecycleState: "OBSERVED",
    success: true,
    requestedAt: 1000,
    terminalAt: 1400,
    transitions: [
      {
        toState: "REQUESTED",
        timestamp: 1000,
        details: { tier: "observed", condition: { field: "measuredRpm", op: "gte", value: 2000 }, timeoutMs: 5000, reason: "Command accepted into the pipeline" },
      },
      { toState: "DISPATCHED", timestamp: 1100, details: { reason: "The connector accepted the dispatch" } },
      { toState: "ACKNOWLEDGED", timestamp: 1200, details: { reason: "The device acknowledged receiving the command" } },
      { toState: "OBSERVED", timestamp: 1400, details: { tier: "observed", reason: "Observed device state satisfied the required condition" } },
    ],
    ...overrides,
  };
}

describe("describeCondition", () => {
  it("reads a comparison the way it would be said aloud", () => {
    expect(describeCondition({ field: "measuredRpm", op: "gte", value: 2000 })).toBe("measuredRpm ≥ 2000");
    expect(describeCondition({ field: "litresPerMinute", op: "gt", value: 0 })).toBe("litresPerMinute > 0");
    expect(describeCondition({ field: "locked", op: "eq", value: false })).toBe("locked = false");
  });

  it("joins combinators with the word that matches them", () => {
    expect(
      describeCondition({ all: [{ field: "on", op: "eq", value: true }, { field: "rpm", op: "gte", value: 100 }] }),
    ).toBe("on = true and rpm ≥ 100");
    expect(
      describeCondition({ any: [{ field: "a", op: "lt", value: 1 }, { field: "b", op: "ne", value: 2 }] }),
    ).toBe("a < 1 or b ≠ 2");
  });

  it("returns an empty string rather than guessing at anything unrecognised", () => {
    expect(describeCondition(undefined)).toBe("");
    expect(describeCondition(null)).toBe("");
    expect(describeCondition("measuredRpm >= 2000")).toBe("");
    expect(describeCondition({ field: "x", op: "bogus", value: 1 })).toBe("");
    expect(describeCondition({ field: "x", op: "gte" })).toBe("");
    expect(describeCondition({ all: [] })).toBe("");
  });
});

describe("commandLadder", () => {
  it("renders one rung per recorded transition, in order", () => {
    const rungs = commandLadder(evidence());
    expect(rungs.map((r) => r.state)).toEqual(["REQUESTED", "DISPATCHED", "ACKNOWLEDGED", "OBSERVED"]);
    expect(rungs.map((r) => r.status)).toEqual(["reached", "reached", "reached", "reached"]);
    expect(rungs.map((r) => r.at)).toEqual([1000, 1100, 1200, 1400]);
  });

  it("puts the condition into the rung that was waiting for it", () => {
    const [requested] = commandLadder(evidence());
    expect(requested?.detail).toContain("waiting for measuredRpm ≥ 2000");
  });

  it("names the pending target while a command is still in flight", () => {
    const rungs = commandLadder(evidence({
      lifecycleState: "DISPATCHED",
      success: undefined,
      terminalAt: undefined,
      transitions: [
        { toState: "REQUESTED", timestamp: 1000 },
        { toState: "DISPATCHED", timestamp: 1100 },
      ],
    }));
    expect(rungs.map((r) => r.state)).toEqual(["REQUESTED", "DISPATCHED", "OBSERVED"]);
    const pending = rungs.at(-1);
    expect(pending?.status).toBe("pending");
    // Nothing is claimed about a rung that has not happened.
    expect(pending?.at).toBeNull();
    expect(pending?.detail).toBe("");
  });

  it("adds no pending rung once the command has settled", () => {
    const rungs = commandLadder(evidence({
      lifecycleState: "TIMED_OUT",
      success: false,
      terminalAt: 6100,
      transitions: [
        { toState: "REQUESTED", timestamp: 1000 },
        { toState: "DISPATCHED", timestamp: 1100 },
        { toState: "TIMED_OUT", timestamp: 6100, details: { reason: "No satisfying reply arrived within the confirmation window" } },
      ],
    }));
    expect(rungs.map((r) => r.status)).toEqual(["reached", "reached", "failed"]);
    expect(rungs.some((r) => r.status === "pending")).toBe(false);
  });

  it("marks every failure state as failed rather than reached", () => {
    for (const state of ["FAILED", "TIMED_OUT", "STATE_MISMATCH"]) {
      const rungs = commandLadder(evidence({
        terminalAt: 2000,
        transitions: [{ toState: state, timestamp: 2000 }],
      }));
      expect(rungs[0]?.status).toBe("failed");
    }
  });

  it("keeps a dispatch-only ladder honestly short", () => {
    const rungs = commandLadder(evidence({
      effectiveTier: "dispatch",
      lifecycleState: "DISPATCHED",
      terminalAt: 1100,
      transitions: [
        { toState: "REQUESTED", timestamp: 1000, details: { tier: "dispatch" } },
        { toState: "DISPATCHED", timestamp: 1100 },
      ],
    }));
    // Two rungs, and no implication that an observation is missing.
    expect(rungs).toHaveLength(2);
    expect(rungs.some((r) => r.state === "OBSERVED")).toBe(false);
  });

  it("returns nothing for anything that is not a command", () => {
    expect(commandLadder(undefined)).toEqual([]);
    expect(commandLadder(null)).toEqual([]);
    expect(commandLadder("cmd-1")).toEqual([]);
    expect(commandLadder({})).toEqual([]);
  });

  it("skips malformed transitions instead of rendering blank rungs", () => {
    const rungs = commandLadder(evidence({
      transitions: [{ toState: "REQUESTED", timestamp: 1000 }, null, { timestamp: 1100 }, "DISPATCHED"],
    }));
    expect(rungs.map((r) => r.state)).toEqual(["REQUESTED"]);
  });
});

describe("commandVerdict", () => {
  it("scales the headline to the tier the command was held to", () => {
    expect(commandVerdict(evidence())?.headline).toBe("OBSERVED");
    expect(commandVerdict(evidence({ effectiveTier: "acknowledged", lifecycleState: "ACKNOWLEDGED" }))?.headline)
      .toBe("ACKNOWLEDGED");
    // A dispatch-only command that succeeded was sent. Calling that OBSERVED is
    // exactly the overstatement this surface exists to prevent.
    expect(commandVerdict(evidence({ effectiveTier: "dispatch", lifecycleState: "DISPATCHED" }))?.headline)
      .toBe("SENT");
  });

  it("reports a command still in flight as unproven and unsettled", () => {
    const verdict = commandVerdict(evidence({ success: undefined, terminalAt: undefined, lifecycleState: "DISPATCHED" }));
    expect(verdict).toMatchObject({ settled: false, proven: false, headline: "IN FLIGHT" });
    expect(verdict?.detail).toContain("Waiting");
  });

  it("prefers the device's own account when a command failed", () => {
    const verdict = commandVerdict(evidence({
      lifecycleState: "FAILED",
      success: false,
      error: "pump reported overcurrent",
    }));
    expect(verdict).toMatchObject({ settled: true, proven: false, headline: "NOT PROVEN" });
    expect(verdict?.detail).toBe("pump reported overcurrent");
  });

  it("says so when the author asked for a tier the device could not prove", () => {
    const verdict = commandVerdict(evidence({
      requestedTier: "observed",
      effectiveTier: "dispatch",
      lifecycleState: "DISPATCHED",
    }));
    expect(verdict?.clamped).toBe(true);
    expect(verdict?.clampNote).toContain("observed");
    expect(verdict?.clampNote).toContain("dispatch");
  });

  it("reports no clamp when the requested tier was honoured", () => {
    const verdict = commandVerdict(evidence({ requestedTier: "observed" }));
    expect(verdict?.clamped).toBe(false);
    expect(verdict?.clampNote).toBe("");
  });

  it("treats a success flag with no terminal timestamp as still unproven", () => {
    // terminal_at is the completion marker; success alone must not be enough, or an
    // in-flight command could read as already succeeded.
    const verdict = commandVerdict(evidence({ success: true, terminalAt: undefined }));
    expect(verdict?.proven).toBe(false);
  });

  it("returns null when there is no command to describe", () => {
    expect(commandVerdict(undefined)).toBeNull();
    expect(commandVerdict({})).toBeNull();
    expect(commandVerdict({ lifecycleState: "" })).toBeNull();
  });
});
