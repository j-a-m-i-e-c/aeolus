// showcase-cleanup §2.7 — the grouped receipt.
//
// What this component must not do is flatten. A cue whose lighting desk reached
// OBSERVED and whose effects rack reached ACKNOWLEDGED has to show both, with both
// tiers, and must not present a single group verdict that misreports either. It also
// has to name its cause from the record, since the whole point of persisting trigger
// provenance was to stop panes guessing.

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandExecutionCard } from "./CommandExecutionCard";
import { commandExecutionProof } from "./command-execution";

function transition(toState: string, timestamp: number, details?: Record<string, unknown>) {
  return { toState, timestamp, ...(details ? { details } : {}) };
}

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
    transitions: [
      transition("REQUESTED", 1_000),
      transition("DISPATCHED", 1_040),
      transition("ACKNOWLEDGED", 1_090),
      transition("OBSERVED", 2_400, { reason: "Observed device state satisfied the required condition" }),
    ],
    ...overrides,
  };
}

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
    transitions: [
      transition("REQUESTED", 2_500),
      transition("DISPATCHED", 2_540),
      transition("ACKNOWLEDGED", 3_100),
    ],
    ...overrides,
  };
}

function cue(overrides: Record<string, unknown> = {}) {
  return {
    executionId: "exec-cue",
    triggerTopic: "ui/rule-show/run-cue",
    commands: [lightingCommand(), effectCommand()],
    ...overrides,
  };
}

describe("CommandExecutionCard", () => {
  it("renders nothing when there is no execution", () => {
    // Mountable unconditionally, so a pane with no cue yet shows no scaffold.
    const { container } = render(<CommandExecutionCard evidence={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every command of the cue, not just the last one", () => {
    render(<CommandExecutionCard evidence={cue()} />);

    expect(screen.getByText("Lighting cue · chorus")).toBeTruthy();
    expect(screen.getByText("Fire stage effect · confetti")).toBeTruthy();
  });

  it("shows each command's own tier side by side", () => {
    render(<CommandExecutionCard evidence={cue()} />);

    expect(screen.getByText(/✓ OBSERVED/)).toBeTruthy();
    expect(screen.getByText(/✓ ACKNOWLEDGED/)).toBeTruthy();
  });

  it("summarises the group by count, never by tier", () => {
    render(<CommandExecutionCard evidence={cue()} />);
    expect(screen.getByText(/2 OF 2 PROVEN/)).toBeTruthy();
  });

  it("names the hardware behind each command", () => {
    render(<CommandExecutionCard evidence={cue()} />);

    expect(screen.getByText("Lighting Desk")).toBeTruthy();
    expect(screen.getByText("Stage FX Rack")).toBeTruthy();
  });

  it("names the trigger from the record", () => {
    render(<CommandExecutionCard evidence={cue()} />);
    expect(screen.getByText(/Triggered by operator "run-cue"/)).toBeTruthy();
  });

  it("shows no trigger line when the records carry none", () => {
    render(
      <CommandExecutionCard
        evidence={cue({ triggerTopic: undefined, commands: [lightingCommand()] })}
      />,
    );
    expect(screen.queryByText(/Triggered by/)).toBeNull();
  });

  it("reports the elapsed time of the whole operation", () => {
    render(<CommandExecutionCard evidence={cue()} />);
    expect(screen.getByText("2 commands · 2.1 s")).toBeTruthy();
  });

  it("explains why a member proved less, without needing expansion", () => {
    // Otherwise the group reads as an unexplained inconsistency: two commands, two
    // different tiers, no stated reason for the difference.
    render(<CommandExecutionCard evidence={cue()} />);
    expect(screen.getByText(/No physical observation configured/i)).toBeTruthy();
  });

  it("shows all four canonical stages for every command when expanded", () => {
    render(<CommandExecutionCard evidence={cue()} />);
    fireEvent.click(screen.getByRole("button", { name: "View proof" }));

    // The fixed scaffold, per member — two commands × four stages. An abbreviated
    // group would hide exactly the capability gap it exists to show.
    for (const state of ["REQUESTED", "DISPATCHED", "ACKNOWLEDGED", "OBSERVED"]) {
      expect(screen.getAllByText(`(${state})`)).toHaveLength(2);
    }
  });

  it("exposes the execution id as secondary detail", () => {
    render(<CommandExecutionCard evidence={cue()} />);
    // Not in the collapsed view: human names lead, raw ids follow.
    expect(screen.queryByText("exec-cue")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View proof" }));
    expect(screen.getByText("exec-cue")).toBeTruthy();
  });

  it("reports a partial cue as partial", () => {
    const failed = effectCommand({
      lifecycleState: "TIMED_OUT",
      success: false,
      terminalAt: 7_500,
      transitions: [
        transition("REQUESTED", 2_500),
        transition("DISPATCHED", 2_540),
        transition("TIMED_OUT", 7_500, { reason: "No acknowledgement within 5000ms" }),
      ],
    });
    render(<CommandExecutionCard evidence={cue({ commands: [lightingCommand(), failed] })} />);

    expect(screen.getByText(/1 OF 2 PROVEN/)).toBeTruthy();
    expect(screen.getByText(/✕ TIMED OUT/)).toBeTruthy();
  });

  it("accepts a prebuilt group", () => {
    const proof = commandExecutionProof(cue())!;
    render(<CommandExecutionCard evidence={proof} />);
    expect(screen.getByText(/2 OF 2 PROVEN/)).toBeTruthy();
  });

  it("uses the caller's heading", () => {
    render(<CommandExecutionCard evidence={cue()} label="Last cue" />);
    expect(screen.getByText("LAST CUE")).toBeTruthy();
  });

  it("can start expanded", () => {
    render(<CommandExecutionCard evidence={cue()} defaultExpanded />);
    expect(screen.getByRole("button", { name: "Hide proof" })).toBeTruthy();
  });
});
