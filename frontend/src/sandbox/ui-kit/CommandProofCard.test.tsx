// frontend/src/sandbox/ui-kit/CommandProofCard.test.tsx — the shared proof surface
//
// This component replaced eight hand-copied blocks, so the behaviour worth pinning is
// what those copies got wrong: proof that named no action, and a ladder that quietly
// omitted the stages a device could not reach. The compact view must always name the
// operation and the hardware that supplied the proof, and the expanded view must show
// all four canonical stages whatever happened.

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandProofCard } from "./CommandProofCard";
import { commandProof } from "./command-proof";

const FLOW_CONDITION = { field: "litresPerMinute", op: "gt", value: 0 };

function transition(toState: string, timestamp: number, details?: Record<string, unknown>) {
  return { toState, timestamp, ...(details ? { details } : {}) };
}

/** Pump commanded, independent flow meter proving the effect. */
function observedEvidence(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-obs",
    executionId: "exec-obs",
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

/** A benign relay: no ack capability, no observation contract. */
function dispatchOnlyEvidence(overrides: Record<string, unknown> = {}) {
  return {
    commandId: "cmd-dispatch",
    actionType: "device_action",
    lifecycleState: "DISPATCHED",
    effectiveTier: "dispatch",
    capabilityCeiling: "dispatch",
    ackAvailable: false,
    observationConfigured: false,
    targetDeviceId: "relay-1",
    targetDeviceName: "Stage Relay",
    transportKind: "mqtt",
    intentLabel: "Stop stage effects",
    success: true,
    requestedAt: 1_000,
    terminalAt: 1_050,
    transitions: [transition("REQUESTED", 1_000), transition("DISPATCHED", 1_050)],
    ...overrides,
  };
}

describe("CommandProofCard", () => {
  it("renders nothing when there is no command", () => {
    // A pane mounts this unconditionally, so an absent command must produce no
    // surface at all rather than an empty scaffold implying a command happened.
    const { container } = render(<CommandProofCard evidence={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a value that is not a command record", () => {
    const { container } = render(<CommandProofCard evidence={{ nonsense: true }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leads with the operation's own name, not the action type", () => {
    render(<CommandProofCard evidence={observedEvidence()} />);
    expect(screen.getByText("Transfer 500 L")).toBeInTheDocument();
    expect(screen.queryByText(/device_action/)).not.toBeInTheDocument();
  });

  it("shows the tier actually proven", () => {
    render(<CommandProofCard evidence={observedEvidence()} />);
    expect(screen.getByText(/OBSERVED/)).toBeInTheDocument();
  });

  it("scales the headline down for a dispatch-only command", () => {
    // The whole point of the surface: a benign relay reads DISPATCHED, never
    // OBSERVED.
    render(<CommandProofCard evidence={dispatchOnlyEvidence()} />);
    expect(screen.getByText(/DISPATCHED/)).toBeInTheDocument();
    expect(screen.queryByText(/OBSERVED/)).not.toBeInTheDocument();
  });

  it("names the actuator to sensor chain that supplied the proof", () => {
    render(<CommandProofCard evidence={observedEvidence()} />);
    expect(screen.getByText("Transfer Pump → Transfer Flow Meter")).toBeInTheDocument();
  });

  it("uses a default heading and accepts an override", () => {
    const { unmount } = render(<CommandProofCard evidence={observedEvidence()} />);
    expect(screen.getByText("LAST COMMAND")).toBeInTheDocument();
    unmount();

    render(<CommandProofCard evidence={observedEvidence()} label="Predator response" />);
    expect(screen.getByText("PREDATOR RESPONSE")).toBeInTheDocument();
  });

  it("keeps the ladder collapsed until asked", () => {
    render(<CommandProofCard evidence={observedEvidence()} />);

    const toggle = screen.getByRole("button", { name: "View proof" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("(OBSERVED)")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Hide proof" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("(OBSERVED)")).toBeInTheDocument();
  });

  it("collapses again on a second click", () => {
    render(<CommandProofCard evidence={observedEvidence()} />);

    fireEvent.click(screen.getByRole("button", { name: "View proof" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide proof" }));

    expect(screen.queryByText("(OBSERVED)")).not.toBeInTheDocument();
  });

  it("can start expanded where the proof is the pane's subject", () => {
    render(<CommandProofCard evidence={observedEvidence()} defaultExpanded />);
    expect(screen.getByText("(OBSERVED)")).toBeInTheDocument();
  });

  it("shows all four canonical stages when expanded, even the unreachable ones", async () => {
    // The regression this replaces: a dispatch-only command rendered two rungs, so
    // nothing hinted the higher tiers existed.
    render(<CommandProofCard evidence={dispatchOnlyEvidence()} defaultExpanded />);

    for (const term of ["(REQUESTED)", "(DISPATCHED)", "(ACKNOWLEDGED)", "(OBSERVED)"]) {
      expect(screen.getByText(term)).toBeInTheDocument();
    }
    expect(screen.getByText("No acknowledgement capability on this device")).toBeInTheDocument();
    expect(screen.getByText("No physical observation configured")).toBeInTheDocument();
  });

  it("renders bespoke stage wording rather than generic labels", async () => {
    render(<CommandProofCard evidence={observedEvidence()} defaultExpanded />);

    expect(screen.getByText("Dispatched via MQTT")).toBeInTheDocument();
    expect(screen.getByText("Transfer Pump acknowledged the command")).toBeInTheDocument();
    expect(screen.getByText("Transfer Flow Meter reports litresPerMinute > 0")).toBeInTheDocument();
    // The banned wording: dispatch is a fact about the transport, not the device.
    expect(screen.queryByText(/Sent to the device/)).not.toBeInTheDocument();
  });

  it("exposes the hardware chain and condition as detail, with ids secondary", () => {
    render(<CommandProofCard evidence={observedEvidence()} defaultExpanded />);

    expect(screen.getByText("Target actuator")).toBeInTheDocument();
    expect(screen.getByText("Observation")).toBeInTheDocument();
    expect(screen.getByText("Condition")).toBeInTheDocument();
    expect(screen.getByText("litresPerMinute > 0")).toBeInTheDocument();
    expect(screen.getByText("cmd-obs")).toBeInTheDocument();
    expect(screen.getByText("exec-obs")).toBeInTheDocument();
  });

  it("omits an observation row when the target observed itself", () => {
    render(
      <CommandProofCard
        evidence={observedEvidence({ observedDeviceName: "Transfer Pump", observedDeviceId: "pump-1" })}
        defaultExpanded
      />,
    );
    expect(screen.queryByText("Observation")).not.toBeInTheDocument();
  });

  it("shows the device ceiling only when it differs from the tier proven", () => {
    const { unmount } = render(<CommandProofCard evidence={observedEvidence()} defaultExpanded />);
    expect(screen.queryByText("Device ceiling")).not.toBeInTheDocument();
    unmount();

    render(
      <CommandProofCard
        evidence={dispatchOnlyEvidence({ ackAvailable: true, capabilityCeiling: "acknowledged" })}
        defaultExpanded
      />,
    );
    expect(screen.getByText("Device ceiling")).toBeInTheDocument();
  });

  it("surfaces a clamp so an overruled request is not invisible", () => {
    render(<CommandProofCard evidence={dispatchOnlyEvidence({ requestedTier: "observed" })} />);
    expect(screen.getByText(/Asked for observed/)).toBeInTheDocument();
  });

  it("reports where proof stopped on a failure", () => {
    render(
      <CommandProofCard
        evidence={observedEvidence({
          lifecycleState: "TIMED_OUT",
          success: false,
          transitions: [
            transition("REQUESTED", 2_000),
            transition("DISPATCHED", 2_050),
            transition("ACKNOWLEDGED", 2_100),
            transition("TIMED_OUT", 7_100, { condition: FLOW_CONDITION, timeoutMs: 5000 }),
          ],
        })}
        defaultExpanded
      />,
    );

    expect(screen.getByText(/TIMED OUT/)).toBeInTheDocument();
    expect(screen.getByText("Never proven")).toBeInTheDocument();
  });

  it("shows the per-stage evidence the record carried", () => {
    render(<CommandProofCard evidence={observedEvidence()} defaultExpanded />);
    expect(
      screen.getByText(/OBSERVED: Observed device state satisfied the required condition/),
    ).toBeInTheDocument();
  });

  it("accepts a prebuilt proof as well as a raw record", () => {
    // A pane that already needed the proof object should not have to rebuild it.
    const proof = commandProof(observedEvidence());
    render(<CommandProofCard evidence={proof} />);
    expect(screen.getByText("Transfer 500 L")).toBeInTheDocument();
  });
});
