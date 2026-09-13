// frontend/src/sandbox/ui-kit/command-proof.test.ts — the fixed four-stage proof
//
// Two things are being defended here.
//
// First, that the scaffold is always four stages. A dispatch-only command must still
// render ACKNOWLEDGED and OBSERVED, because a visitor can only learn that those tiers
// exist — and that this device cannot reach them — if the model refuses to quietly
// omit them.
//
// Second, that the reasons for an unreached stage stay distinct. "This device cannot
// acknowledge", "it could, but this command did not ask", "no observation was
// configured" and "it was required and never arrived" are four different statements,
// and collapsing any pair of them is the dishonesty the whole surface exists to
// prevent.

import { describe, expect, it } from "vitest";
import {
  PROOF_STAGES,
  commandProof,
  describeCondition,
  proofHeadlineProps,
  proofStageProps,
  type CommandProof,
  type ProofStage,
} from "./command-proof";
import { tokens } from "./primitives";

// ── Builders ─────────────────────────────────────────────────────────────────

const FLOW_CONDITION = { field: "litresPerMinute", op: "gt", value: 0 };

/** A transition as the durable record carries it. */
function transition(toState: string, timestamp: number, details?: Record<string, unknown>) {
  return { toState, timestamp, ...(details ? { details } : {}) };
}

/**
 * A dispatch-only command on a device with no ack capability: the honest floor of
 * the ladder, and the case the old variable-length model rendered as two tidy lines.
 */
function dispatchOnly(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-1",
    actionType: "device_action",
    lifecycleState: "DISPATCHED",
    effectiveTier: "dispatch",
    capabilityCeiling: "dispatch",
    ackAvailable: false,
    observationConfigured: false,
    targetDeviceId: "relay-1",
    targetDeviceName: "Stage Relay",
    transportKind: "mqtt",
    success: true,
    requestedAt: 1_000,
    terminalAt: 1_050,
    transitions: [transition("REQUESTED", 1_000), transition("DISPATCHED", 1_050)],
    ...overrides,
  };
}

/** A fully observed command: pump commanded, independent flow meter proves the effect. */
function fullyObserved(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-2",
    executionId: "exec-2",
    actionType: "device_action",
    lifecycleState: "OBSERVED",
    effectiveTier: "observed",
    capabilityCeiling: "observed",
    ackAvailable: true,
    observationConfigured: true,
    observedDeviceId: "flow-1",
    conditionSpec: FLOW_CONDITION,
    targetDeviceId: "pump-1",
    targetDeviceName: "Transfer Pump",
    observedDeviceName: "Transfer Flow Meter",
    transportKind: "mqtt",
    intentLabel: "Transfer 500 L",
    success: true,
    requestedAt: 2_000,
    terminalAt: 2_400,
    transitions: [
      transition("REQUESTED", 2_000),
      transition("DISPATCHED", 2_050),
      transition("ACKNOWLEDGED", 2_100),
      transition("OBSERVED", 2_400, { condition: FLOW_CONDITION, reason: "Observed device state satisfied the required condition" }),
    ],
    ...overrides,
  };
}

function stageOf(proof: CommandProof | null, state: ProofStage) {
  const stage = proof?.stages.find((candidate) => candidate.state === state);
  if (!stage) throw new Error(`no ${state} stage`);
  return stage;
}

// ── The fixed scaffold ───────────────────────────────────────────────────────

describe("commandProof — the fixed scaffold", () => {
  it("returns nothing for a value that is not a command", () => {
    expect(commandProof(undefined)).toBeNull();
    expect(commandProof(null)).toBeNull();
    expect(commandProof("OBSERVED")).toBeNull();
    expect(commandProof([])).toBeNull();
    expect(commandProof({})).toBeNull();
  });

  it("always renders all four stages in lifecycle order", () => {
    for (const evidence of [dispatchOnly(), fullyObserved()]) {
      const proof = commandProof(evidence);
      expect(proof?.stages.map((stage) => stage.state)).toEqual([...PROOF_STAGES]);
    }
  });

  it("keeps a dispatch-only command's higher stages visible rather than omitting them", () => {
    // The regression this replaces: the old ladder returned two rungs here, so
    // nothing on screen hinted that acknowledgement or observation exist at all.
    const proof = commandProof(dispatchOnly());

    expect(proof?.stages).toHaveLength(4);
    expect(stageOf(proof, "ACKNOWLEDGED").status).toBe("unavailable");
    expect(stageOf(proof, "OBSERVED").status).toBe("not-configured");
  });

  it("carries the canonical lifecycle term on every stage, so the model stays teachable", () => {
    const proof = commandProof(dispatchOnly());
    expect(proof?.stages.map((stage) => stage.state)).toEqual([
      "REQUESTED",
      "DISPATCHED",
      "ACKNOWLEDGED",
      "OBSERVED",
    ]);
  });
});

// ── DISPATCHED must never claim device receipt ───────────────────────────────

describe("commandProof — DISPATCHED wording", () => {
  it("never claims the device received the command", () => {
    // The specific wording being banned is "Sent to the device", which asserted
    // receipt that dispatch cannot establish.
    const label = stageOf(commandProof(dispatchOnly()), "DISPATCHED").label;
    expect(label.toLowerCase()).not.toContain("sent to the device");
    expect(label.toLowerCase()).not.toContain("received");
  });

  it("names the transport it was handed to when one is recorded", () => {
    expect(stageOf(commandProof(dispatchOnly()), "DISPATCHED").label).toBe("Dispatched via MQTT");
  });

  it("names a connector transport in its own terms", () => {
    const proof = commandProof(dispatchOnly({ transportKind: "hue" }));
    expect(stageOf(proof, "DISPATCHED").label).toBe("Dispatched via the Hue bridge");
  });

  it("falls back to a transport-agnostic line when none was recorded", () => {
    const proof = commandProof(dispatchOnly({ transportKind: undefined }));
    expect(stageOf(proof, "DISPATCHED").label).toBe("Command dispatched");
  });

  it("passes an unrecognised integration through rather than inventing one", () => {
    const proof = commandProof(dispatchOnly({ transportKind: "modbus" }));
    expect(stageOf(proof, "DISPATCHED").label).toBe("Dispatched via modbus");
  });
});

// ── Distinguishing the reasons a stage was not reached ───────────────────────

describe("commandProof — why a stage was not reached", () => {
  it("says a device cannot acknowledge when it has no ack capability", () => {
    const stage = stageOf(commandProof(dispatchOnly()), "ACKNOWLEDGED");
    expect(stage.status).toBe("unavailable");
    expect(stage.label).toBe("No acknowledgement capability on this device");
  });

  it("distinguishes 'not required' from 'unavailable' when the device is capable", () => {
    // Capable of acknowledging, but this command deliberately asked only for
    // dispatch. Per the spec that is a correct command, not a weak one.
    const proof = commandProof(
      dispatchOnly({ ackAvailable: true, capabilityCeiling: "acknowledged", requestedTier: "dispatch" }),
    );
    const stage = stageOf(proof, "ACKNOWLEDGED");
    expect(stage.status).toBe("not-required");
    expect(stage.label).toBe("Acknowledgement not required for this command");
  });

  it("says no observation was configured rather than implying a failure", () => {
    const stage = stageOf(commandProof(dispatchOnly()), "OBSERVED");
    expect(stage.status).toBe("not-configured");
    expect(stage.label).toBe("No physical observation configured");
    // Crucially not a failure: nothing went wrong.
    expect(stage.status).not.toBe("failed");
    expect(proofStageProps(stage).mark).not.toBe("✕");
  });

  it("reports an observed command whose device cannot acknowledge", () => {
    // The legitimate REQUESTED → DISPATCHED → OBSERVED shape: no ACK capability, but
    // an independent sensor still proves the effect.
    const proof = commandProof(
      fullyObserved({
        ackAvailable: false,
        transitions: [
          transition("REQUESTED", 2_000),
          transition("DISPATCHED", 2_050),
          transition("OBSERVED", 2_400, { condition: FLOW_CONDITION }),
        ],
      }),
    );

    expect(stageOf(proof, "ACKNOWLEDGED").status).toBe("unavailable");
    expect(stageOf(proof, "OBSERVED").status).toBe("reached");
    expect(proof?.proven).toBe(true);
    expect(proof?.headline).toBe("OBSERVED");
  });

  it("says 'not recorded' for a command older than the capability snapshot", () => {
    // Absence of a snapshot is not evidence of incapability, so it must not render
    // as "unavailable".
    const proof = commandProof(
      dispatchOnly({ ackAvailable: undefined, observationConfigured: undefined, capabilityCeiling: undefined }),
    );

    expect(stageOf(proof, "ACKNOWLEDGED").status).toBe("not-recorded");
    expect(stageOf(proof, "OBSERVED").status).toBe("not-recorded");
    expect(stageOf(proof, "ACKNOWLEDGED").label).toBe("Not recorded for this command");
  });
});

// ── Failure ──────────────────────────────────────────────────────────────────

describe("commandProof — failure", () => {
  it("marks the stage where proof stopped and leaves later stages not reached", () => {
    const proof = commandProof(
      fullyObserved({
        lifecycleState: "FAILED",
        success: false,
        error: "MQTT client not connected",
        transitions: [
          transition("REQUESTED", 2_000),
          transition("FAILED", 2_010, { reason: "MQTT client not connected" }),
        ],
      }),
    );

    expect(stageOf(proof, "REQUESTED").status).toBe("reached");
    expect(stageOf(proof, "DISPATCHED").status).toBe("failed");
    expect(stageOf(proof, "DISPATCHED").label).toBe("Dispatch failed");
    expect(stageOf(proof, "DISPATCHED").detail).toBe("MQTT client not connected");
    expect(stageOf(proof, "ACKNOWLEDGED").status).toBe("not-reached");
    expect(stageOf(proof, "OBSERVED").status).toBe("not-reached");
    expect(proof?.headline).toBe("FAILED");
  });

  it("blames the observation, not the ack, when a non-acknowledging device times out", () => {
    // The ordering bug this pins: attaching the failure to the next stage
    // NUMERICALLY would fault ACKNOWLEDGED on a device that never had an ack
    // capability to fault.
    const proof = commandProof(
      fullyObserved({
        lifecycleState: "TIMED_OUT",
        ackAvailable: false,
        success: false,
        transitions: [
          transition("REQUESTED", 2_000),
          transition("DISPATCHED", 2_050),
          transition("TIMED_OUT", 7_050, { condition: FLOW_CONDITION, timeoutMs: 5000 }),
        ],
      }),
    );

    expect(stageOf(proof, "ACKNOWLEDGED").status).toBe("unavailable");
    expect(stageOf(proof, "OBSERVED").status).toBe("failed");
    expect(proof?.headline).toBe("TIMED OUT");
  });

  it("reports a contradiction distinctly from a timeout", () => {
    const proof = commandProof(
      fullyObserved({
        lifecycleState: "STATE_MISMATCH",
        success: false,
        transitions: [
          transition("REQUESTED", 2_000),
          transition("DISPATCHED", 2_050),
          transition("ACKNOWLEDGED", 2_100),
          transition("STATE_MISMATCH", 2_500),
        ],
      }),
    );

    expect(proof?.headline).toBe("STATE MISMATCH");
    expect(stageOf(proof, "OBSERVED").status).toBe("failed");
    expect(proofStageProps(stageOf(proof, "OBSERVED")).mark).toBe("✕");
  });
});

// ── In flight ────────────────────────────────────────────────────────────────

describe("commandProof — in flight", () => {
  it("marks the stages still expected as pending and says what is awaited", () => {
    const proof = commandProof(
      fullyObserved({
        lifecycleState: "DISPATCHED",
        success: undefined,
        terminalAt: undefined,
        transitions: [transition("REQUESTED", 2_000), transition("DISPATCHED", 2_050)],
      }),
    );

    expect(proof?.settled).toBe(false);
    expect(proof?.proven).toBe(false);
    expect(proof?.headline).toBe("IN FLIGHT");
    expect(stageOf(proof, "ACKNOWLEDGED").status).toBe("pending");
    expect(stageOf(proof, "OBSERVED").status).toBe("pending");
    // A pending observation names the contract, so the wait is legible.
    expect(stageOf(proof, "OBSERVED").label).toBe("Waiting for litresPerMinute > 0");
  });

  it("does not treat success as proven while the command is still in flight", () => {
    const proof = commandProof(
      fullyObserved({ success: true, terminalAt: undefined, lifecycleState: "DISPATCHED" }),
    );
    expect(proof?.proven).toBe(false);
  });
});

// ── Bespoke labels, the hardware chain and intent ────────────────────────────

describe("commandProof — identity and bespoke wording", () => {
  it("names the sensor and its contract on the observed stage", () => {
    const stage = stageOf(commandProof(fullyObserved()), "OBSERVED");
    expect(stage.label).toBe("Transfer Flow Meter reports litresPerMinute > 0");
  });

  it("prefers the author's account of what the reading means", () => {
    const proof = commandProof(fullyObserved({ observedLabel: "Flow detected" }));
    expect(stageOf(proof, "OBSERVED").label).toBe("Transfer Flow Meter: Flow detected");
  });

  it("names the acknowledging device rather than a generic 'device'", () => {
    expect(stageOf(commandProof(fullyObserved()), "ACKNOWLEDGED").label).toBe(
      "Transfer Pump acknowledged the command",
    );
  });

  it("exposes the actuator → sensor chain", () => {
    expect(commandProof(fullyObserved())?.chain).toBe("Transfer Pump → Transfer Flow Meter");
  });

  it("shows only the actuator when the observation came from the target itself", () => {
    const proof = commandProof(
      fullyObserved({ observedDeviceName: "Transfer Pump", observedDeviceId: "pump-1" }),
    );
    expect(proof?.chain).toBe("Transfer Pump");
  });

  it("uses the author's intent as the command's name", () => {
    expect(commandProof(fullyObserved())?.intent).toBe("Transfer 500 L");
  });

  it("falls back to device and action when no intent was supplied", () => {
    // `device_action` names the mechanism, not the operation — which is exactly why
    // intent exists. The fallback is last resort, not the norm.
    const proof = commandProof(fullyObserved({ intentLabel: undefined }));
    expect(proof?.intent).toBe("Transfer Pump · device_action");
  });

  it("carries the ids through for the detail view", () => {
    const proof = commandProof(fullyObserved());
    expect(proof?.commandId).toBe("cmd-2");
    expect(proof?.executionId).toBe("exec-2");
    expect(proof?.conditionText).toBe("litresPerMinute > 0");
  });
});

// ── Tier and clamping ────────────────────────────────────────────────────────

describe("commandProof — tier honesty", () => {
  it("scales the headline to the tier actually proven", () => {
    expect(commandProof(dispatchOnly())?.headline).toBe("DISPATCHED");
    expect(commandProof(fullyObserved())?.headline).toBe("OBSERVED");
    expect(
      commandProof(fullyObserved({ lifecycleState: "ACKNOWLEDGED", effectiveTier: "acknowledged" }))
        ?.headline,
    ).toBe("ACKNOWLEDGED");
  });

  it("reports a clamp when the ask exceeded what the command could prove", () => {
    const proof = commandProof(dispatchOnly({ requestedTier: "observed" }));
    expect(proof?.clamped).toBe(true);
    expect(proof?.clampNote).toContain("Asked for observed");
    // The note names the DEVICE's limit, because that is what a clamp is. What this
    // particular command then reached is the stages' job.
    expect(proof?.clampNote).toContain("at most dispatch");
  });

  it("reports a clamp even when the command fell short of the ceiling too", () => {
    // The case the old rule dropped, and the one the requested/ceiling/actual triple
    // exists to explain: asked for observed, the device tops out at acknowledged, and
    // this command only reached dispatch. Requiring the ceiling to equal the effective
    // tier meant the ceiling row appeared with no clamp note beside it, so the single
    // command that was both overruled AND short of its ceiling explained neither.
    const proof = commandProof(
      dispatchOnly({
        requestedTier: "observed",
        ackAvailable: true,
        capabilityCeiling: "acknowledged",
      }),
    );

    expect(proof?.clamped).toBe(true);
    expect(proof?.clampNote).toContain("Asked for observed");
    expect(proof?.clampNote).toContain("at most acknowledged");
    // And the tier actually proven is still reported as dispatch, not lifted to the
    // ceiling the clamp mentions.
    expect(proof?.tier).toBe("dispatch");
    expect(proof?.ceiling).toBe("acknowledged");
  });

  it("does not call a deliberate lower tier a clamp", () => {
    // Asking for less than the ceiling is a legitimate authoring choice, so it must
    // not be reported as the platform having overruled the author.
    const proof = commandProof(
      dispatchOnly({ requestedTier: "dispatch", ackAvailable: true, capabilityCeiling: "acknowledged" }),
    );
    expect(proof?.clamped).toBe(false);
    expect(proof?.clampNote).toBe("");
  });

  it("does not claim a clamp when no ceiling was recorded to clamp against", () => {
    const proof = commandProof(
      dispatchOnly({ requestedTier: "observed", capabilityCeiling: undefined }),
    );
    expect(proof?.clamped).toBe(false);
  });
});

// ── Presentation ─────────────────────────────────────────────────────────────

describe("proofStageProps", () => {
  it("gives a reached stage the success colour and a tick", () => {
    const visual = proofStageProps(stageOf(commandProof(fullyObserved()), "OBSERVED"));
    expect(visual.mark).toBe("✓");
    expect(visual.style.color).toBe(tokens.color.success);
  });

  it("gives an inapplicable stage a muted dash, never an error cross", () => {
    // A capability gap is information, not a fault, and must not read as one.
    for (const state of ["ACKNOWLEDGED", "OBSERVED"] as const) {
      const visual = proofStageProps(stageOf(commandProof(dispatchOnly()), state));
      expect(visual.mark).toBe("—");
      expect(visual.style.color).toBe(tokens.color.textMuted);
      expect(visual.style.color).not.toBe(tokens.color.error);
    }
  });

  it("separates pending from both reached and failed", () => {
    const proof = commandProof(
      fullyObserved({ terminalAt: undefined, success: undefined, transitions: [transition("REQUESTED", 1)] }),
    );
    const visual = proofStageProps(stageOf(proof, "OBSERVED"));
    expect(visual.mark).toBe("○");
    expect(visual.style.color).toBe(tokens.color.warning);
  });

  it("puts the canonical term in its own style so it reads as vocabulary", () => {
    const visual = proofStageProps(stageOf(commandProof(fullyObserved()), "OBSERVED"));
    expect(visual.termStyle.fontFamily).toBe(tokens.font.mono);
  });
});

describe("proofHeadlineProps", () => {
  it("colours by outcome", () => {
    expect(proofHeadlineProps(commandProof(fullyObserved())!).color).toBe(tokens.color.success);

    const inFlight = commandProof(fullyObserved({ terminalAt: undefined, success: undefined }))!;
    expect(proofHeadlineProps(inFlight).color).toBe(tokens.color.warning);

    const failed = commandProof(
      fullyObserved({ lifecycleState: "TIMED_OUT", success: false }),
    )!;
    expect(proofHeadlineProps(failed).color).toBe(tokens.color.error);
  });
});

// ── Condition rendering ──────────────────────────────────────────────────────

describe("describeCondition", () => {
  it("reads a comparison aloud", () => {
    expect(describeCondition({ field: "measuredRpm", op: "gte", value: 2000 })).toBe(
      "measuredRpm ≥ 2000",
    );
  });

  it("joins combinators", () => {
    expect(
      describeCondition({
        all: [
          { field: "on", op: "eq", value: true },
          { field: "brightness", op: "gte", value: 70 },
        ],
      }),
    ).toBe("on = true and brightness ≥ 70");
  });

  it("returns an empty string for anything unrecognised", () => {
    expect(describeCondition(undefined)).toBe("");
    expect(describeCondition({ field: "x" })).toBe("");
    expect(describeCondition({ all: [] })).toBe("");
  });
});
