// frontend/src/sandbox/ui-kit/command-proof.edges.test.ts — the malformed and the
// unlabelled.
//
// command-proof.test.ts defends the four-stage scaffold and the distinct reasons a
// stage went unreached, using well-formed records. This file covers what the same
// function does with a record it cannot trust or cannot describe: transitions that
// are not a list, a state it does not recognise, a tier it has no vocabulary for, a
// command with no intent and no device name.
//
// That matters because this renderer consumes two sources with different guarantees —
// a durable REST snapshot and a live WebSocket feed — plus records written by older
// builds. Every fallback here is a case where saying something vague is correct and
// asserting something specific would be a lie.

import { describe, expect, it } from "vitest";
import { commandProof, PROOF_STAGES, type CommandProof, type ProofStage } from "./command-proof";

/** A transition as the durable record carries it. */
function transition(toState: string, timestamp: number, details?: Record<string, unknown>) {
  return { toState, timestamp, ...(details ? { details } : {}) };
}

/** A settled, successful observed-tier command, for mutating one field at a time. */
function observedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commandId: "cmd-1",
    lifecycleState: "OBSERVED",
    effectiveTier: "observed",
    terminalAt: 4_000,
    success: true,
    ackAvailable: true,
    observationConfigured: true,
    transitions: [
      transition("REQUESTED", 1_000),
      transition("DISPATCHED", 2_000),
      transition("ACKNOWLEDGED", 3_000),
      transition("OBSERVED", 4_000),
    ],
    ...overrides,
  };
}

const stageOf = (proof: CommandProof, stage: ProofStage) =>
  proof.stages.find((s) => s.state === stage)!;

describe("commandProof — records it cannot trust", () => {
  it("treats transitions that are not a list as no transitions at all", () => {
    const proof = commandProof(observedRecord({ transitions: "OBSERVED" }))!;
    // Nothing was reached, and the command is settled, so nothing claims to be proven
    // on the strength of a malformed field.
    expect(proof.stages.every((s) => s.status !== "reached")).toBe(true);
  });

  it("ignores a transition entry that is not a record", () => {
    const proof = commandProof(
      observedRecord({ transitions: [null, "REQUESTED", 42, transition("REQUESTED", 1_000)] }),
    )!;
    expect(stageOf(proof, "REQUESTED").status).toBe("reached");
    expect(stageOf(proof, "DISPATCHED").status).not.toBe("reached");
  });

  it("ignores a transition that names no state", () => {
    const proof = commandProof(
      observedRecord({ transitions: [{ timestamp: 1_000 }, transition("REQUESTED", 1_000)] }),
    )!;
    expect(stageOf(proof, "REQUESTED").status).toBe("reached");
  });

  it("ignores a recorded state that is not part of the proof ladder", () => {
    // A future build could add a lifecycle state this one has no row for. Dropping it
    // is right; inventing a stage for it would change what the ladder means.
    const proof = commandProof(
      observedRecord({
        transitions: [transition("REQUESTED", 1_000), transition("QUEUED", 1_500)],
      }),
    )!;
    expect(proof.stages).toHaveLength(PROOF_STAGES.length);
    expect(stageOf(proof, "REQUESTED").status).toBe("reached");
  });

  it("is nothing at all for a value that is not a record", () => {
    expect(commandProof("cmd-1")).toBeNull();
    expect(commandProof(null)).toBeNull();
    expect(commandProof(undefined)).toBeNull();
  });

  it("is nothing at all for a record with no lifecycle state", () => {
    // Better an empty space than a scaffold implying a command that may not exist.
    expect(commandProof({ commandId: "cmd-1" })).toBeNull();
  });
});

describe("commandProof — vocabulary it does not have", () => {
  it("falls back to dispatch when no effective tier was recorded", () => {
    const proof = commandProof(observedRecord({ effectiveTier: "" }))!;
    expect(proof.tier).toBe("dispatch");
  });

  it("treats a tier it does not know as requiring dispatch only", () => {
    const proof = commandProof(
      observedRecord({
        effectiveTier: "telepathic",
        transitions: [transition("REQUESTED", 1_000), transition("DISPATCHED", 2_000)],
      }),
    )!;
    // Unknown tier ranks as dispatch, so the higher stages are not treated as
    // requirements this command failed.
    expect(stageOf(proof, "ACKNOWLEDGED").status).not.toBe("not-reached");
    expect(proof.proven).toBe(true);
  });

  it("headlines a proven command with an unknown tier generically", () => {
    const proof = commandProof(observedRecord({ effectiveTier: "telepathic" }))!;
    expect(proof.headline).toBe("PROVEN");
  });

  it("headlines a failed command with an unknown lifecycle state generically", () => {
    const proof = commandProof(
      observedRecord({
        lifecycleState: "EXPLODED",
        success: false,
        transitions: [transition("REQUESTED", 1_000)],
      }),
    )!;
    expect(proof.headline).toBe("NOT PROVEN");
    expect(proof.mark).toBe("✕");
  });
});

describe("commandProof — naming a command with little to go on", () => {
  it("prefers the author's intent", () => {
    const proof = commandProof(
      observedRecord({ intentLabel: "Transfer 500 L", targetDeviceName: "Pump", actionType: "device_action" }),
    )!;
    expect(proof.intent).toBe("Transfer 500 L");
  });

  it("names the device and the action when there is no intent", () => {
    const proof = commandProof(
      observedRecord({ targetDeviceName: "Header Pump", actionType: "toggle" }),
    )!;
    expect(proof.intent).toBe("Header Pump · toggle");
  });

  it("names the device alone when the action type is missing too", () => {
    const proof = commandProof(observedRecord({ targetDeviceName: "Header Pump" }))!;
    expect(proof.intent).toBe("Header Pump");
  });

  it("names the action alone when there is no device name", () => {
    const proof = commandProof(observedRecord({ actionType: "toggle" }))!;
    expect(proof.intent).toBe("toggle");
  });

  it("calls it a physical command when it has nothing to name it with", () => {
    const proof = commandProof(observedRecord())!;
    expect(proof.intent).toBe("Physical command");
  });
});

describe("commandProof — describing what was observed", () => {
  it("uses the author's account alone when no observing device is named", () => {
    const proof = commandProof(
      observedRecord({ observedLabel: "tachometer reached the requested speed" }),
    )!;
    expect(stageOf(proof, "OBSERVED").label).toBe("tachometer reached the requested speed");
  });

  it("attributes the author's account to the observing device when there is one", () => {
    const proof = commandProof(
      observedRecord({
        observedLabel: "tachometer reached the requested speed",
        observedDeviceName: "Fan tachometer",
      }),
    )!;
    expect(stageOf(proof, "OBSERVED").label).toBe(
      "Fan tachometer: tachometer reached the requested speed",
    );
  });

  it("credits the observing device when there is no label or contract to quote", () => {
    const proof = commandProof(observedRecord({ observedDeviceName: "Flow meter" }))!;
    expect(stageOf(proof, "OBSERVED").label).toBe("Flow meter confirmed the effect");
  });

  it("quotes the measurement when there is a contract but no observing device", () => {
    const proof = commandProof(
      observedRecord({ conditionSpec: { field: "litresPerMinute", op: "gt", value: 0 } }),
    )!;
    expect(stageOf(proof, "OBSERVED").label).toMatch(/^Measured /);
  });

  it("states the bare fact when it has neither a device, a label nor a contract", () => {
    const proof = commandProof(observedRecord())!;
    expect(stageOf(proof, "OBSERVED").label).toBe("Physical effect observed");
  });
});

describe("commandProof — stages it cannot speak for", () => {
  it("says an unrecorded observation capability is unrecorded, not absent", () => {
    // A command written before the capability snapshot existed. Claiming "no
    // observation configured" would assert something the record never said.
    const proof = commandProof({
      commandId: "cmd-old",
      lifecycleState: "ACKNOWLEDGED",
      effectiveTier: "acknowledged",
      terminalAt: 3_000,
      success: true,
      transitions: [
        transition("REQUESTED", 1_000),
        transition("DISPATCHED", 2_000),
        transition("ACKNOWLEDGED", 3_000),
      ],
    })!;
    expect(stageOf(proof, "OBSERVED").status).toBe("not-recorded");
    expect(stageOf(proof, "OBSERVED").label).toBe("Not recorded for this command");
  });

  it("says so plainly when no physical observation was configured", () => {
    const proof = commandProof({
      commandId: "cmd-ack",
      lifecycleState: "ACKNOWLEDGED",
      effectiveTier: "acknowledged",
      terminalAt: 3_000,
      success: true,
      ackAvailable: true,
      observationConfigured: false,
      transitions: [
        transition("REQUESTED", 1_000),
        transition("DISPATCHED", 2_000),
        transition("ACKNOWLEDGED", 3_000),
      ],
    })!;
    expect(stageOf(proof, "OBSERVED").status).toBe("not-configured");
    expect(stageOf(proof, "OBSERVED").label).toBe("No physical observation configured");
  });

  it("waits without elaborating on a stage that has no bespoke pending line", () => {
    // An in-flight command that has not even been accepted yet: REQUESTED is
    // pending, and there is nothing more specific to say than that.
    const proof = commandProof({
      commandId: "cmd-flight",
      lifecycleState: "REQUESTED",
      effectiveTier: "observed",
      ackAvailable: true,
      observationConfigured: true,
      transitions: [],
    })!;
    expect(proof.settled).toBe(false);
    expect(proof.headline).toBe("IN FLIGHT");
    expect(proof.mark).toBe("○");
    expect(stageOf(proof, "REQUESTED").status).toBe("pending");
    expect(stageOf(proof, "REQUESTED").label).toBe("Waiting");
  });

  it("waits on the named measurement when one was contracted", () => {
    const proof = commandProof({
      commandId: "cmd-flight",
      lifecycleState: "DISPATCHED",
      effectiveTier: "observed",
      ackAvailable: true,
      observationConfigured: true,
      conditionSpec: { field: "litresPerMinute", op: "gt", value: 0 },
      transitions: [transition("REQUESTED", 1_000), transition("DISPATCHED", 2_000)],
    })!;
    expect(stageOf(proof, "OBSERVED").status).toBe("pending");
    expect(stageOf(proof, "OBSERVED").label).toMatch(/^Waiting for /);
  });

  it("keeps a failure on the lowest required stage that never happened", () => {
    const proof = commandProof({
      commandId: "cmd-fail",
      lifecycleState: "FAILED",
      effectiveTier: "observed",
      terminalAt: 5_000,
      success: false,
      ackAvailable: false,
      observationConfigured: true,
      transitions: [
        transition("REQUESTED", 1_000),
        transition("DISPATCHED", 2_000),
        transition("FAILED", 5_000, { reason: "no flow detected" }),
      ],
    })!;
    // ACKNOWLEDGED was never required — the device cannot do it — so blaming it for
    // an observation timeout would be wrong.
    expect(stageOf(proof, "ACKNOWLEDGED").status).toBe("unavailable");
    expect(stageOf(proof, "OBSERVED").status).toBe("failed");
  });

  it("attaches no failure to any stage when every required stage was reached", () => {
    // A failure recorded after the ladder completed has no unreached stage to land
    // on, and inventing one would contradict the transitions.
    const proof = commandProof(
      observedRecord({
        lifecycleState: "FAILED",
        success: false,
        transitions: [
          transition("REQUESTED", 1_000),
          transition("DISPATCHED", 2_000),
          transition("ACKNOWLEDGED", 3_000),
          transition("OBSERVED", 4_000),
          transition("FAILED", 5_000),
        ],
      }),
    )!;
    expect(proof.stages.every((s) => s.status === "reached")).toBe(true);
    expect(proof.proven).toBe(false);
  });
});

describe("commandProof — capability clamps", () => {
  it("notes when the ask exceeded what the device can prove", () => {
    const proof = commandProof(
      observedRecord({
        requestedTier: "observed",
        capabilityCeiling: "acknowledged",
        effectiveTier: "acknowledged",
      }),
    )!;
    expect(proof.clamped).toBe(true);
    expect(proof.clampNote).toContain("can prove at most acknowledged");
  });

  it("does not call a deliberately modest ask a clamp", () => {
    const proof = commandProof(
      observedRecord({ requestedTier: "dispatch", capabilityCeiling: "observed" }),
    )!;
    expect(proof.clamped).toBe(false);
    expect(proof.clampNote).toBe("");
  });

  it("claims no clamp when the ceiling was never recorded", () => {
    const proof = commandProof(observedRecord({ requestedTier: "observed" }))!;
    expect(proof.clamped).toBe(false);
  });

  it("describes the chain as one device when the observer is the target", () => {
    const proof = commandProof(
      observedRecord({ targetDeviceName: "Pump", observedDeviceName: "Pump" }),
    )!;
    expect(proof.chain).toBe("Pump");
  });

  it("describes the chain as target to observer when they differ", () => {
    const proof = commandProof(
      observedRecord({ targetDeviceName: "Pump", observedDeviceName: "Flow meter" }),
    )!;
    expect(proof.chain).toBe("Pump → Flow meter");
  });
});
