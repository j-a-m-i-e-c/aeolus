// showcase-cleanup §2.8 — folding live lifecycle transitions into renderable commands.
//
// The store's whole job is to turn a stream of transitions into the record shape the
// proof model already reads, so the highest-value assertion here is that a folded
// command renders through `commandProof()` untouched. If that ever stops holding, a
// pane would need a second rendering path and the live and settled views would drift.

import { describe, it, expect, beforeEach } from "vitest";
import {
  useCommandActivityStore,
  MAX_ACTIVITY_PER_RULE,
  type CommandLifecycleMessage,
} from "./command-activity-store";
import { commandProof } from "../sandbox/ui-kit/command-proof";

function transition(overrides: Partial<CommandLifecycleMessage> = {}): CommandLifecycleMessage {
  return {
    commandId: "cmd-1",
    targetDeviceId: "pump-1",
    actionType: "device_action",
    effectiveTier: "observed",
    state: "REQUESTED",
    timestamp: 1_000,
    terminal: false,
    ruleId: "rule-water",
    executionId: "exec-1",
    ...overrides,
  };
}

function record(message: CommandLifecycleMessage): void {
  useCommandActivityStore.getState().recordTransition(message);
}

function activity(ruleId = "rule-water") {
  return useCommandActivityStore.getState().activityByRule[ruleId] ?? [];
}

beforeEach(() => {
  useCommandActivityStore.setState({ activityByRule: {} });
});

describe("command activity store — folding transitions", () => {
  it("starts a command from its first transition", () => {
    record(transition());

    const [entry] = activity();
    expect(entry!.commandId).toBe("cmd-1");
    expect(entry!.lifecycleState).toBe("REQUESTED");
    expect(entry!.requestedAt).toBe(1_000);
    expect(entry!.transitions).toEqual([{ toState: "REQUESTED", timestamp: 1_000 }]);
  });

  it("accumulates stages onto the same command", () => {
    record(transition({ state: "REQUESTED", timestamp: 1_000 }));
    record(transition({ state: "DISPATCHED", timestamp: 1_050, fromState: "REQUESTED" }));
    record(transition({ state: "ACKNOWLEDGED", timestamp: 1_100, fromState: "DISPATCHED" }));

    // One command, three stages — not three commands. This is the point of the store.
    expect(activity()).toHaveLength(1);
    expect(activity()[0]!.transitions.map((t) => t.toState)).toEqual([
      "REQUESTED",
      "DISPATCHED",
      "ACKNOWLEDGED",
    ]);
    expect(activity()[0]!.lifecycleState).toBe("ACKNOWLEDGED");
  });

  it("stamps terminalAt only from a transition that says it is terminal", () => {
    // Never inferred from the state name: a DISPATCHED that satisfied a dispatch-only
    // command is terminal, and one still climbing is not, and only the flag knows.
    record(transition({ state: "DISPATCHED", timestamp: 1_050 }));
    expect(activity()[0]!.terminalAt).toBeUndefined();

    record(transition({ state: "OBSERVED", timestamp: 2_400, terminal: true, success: true }));
    expect(activity()[0]!.terminalAt).toBe(2_400);
    expect(activity()[0]!.success).toBe(true);
  });

  it("ignores a repeated transition for a stage already recorded", () => {
    // A reconnect can replay a message; two ticks for one stage would be a lie about
    // the hardware.
    record(transition({ state: "DISPATCHED", timestamp: 1_050 }));
    record(transition({ state: "DISPATCHED", timestamp: 1_050 }));

    expect(activity()[0]!.transitions).toHaveLength(1);
  });

  it("keeps the failure account when a command fails", () => {
    record(transition({ state: "REQUESTED", timestamp: 1_000 }));
    record(
      transition({
        state: "TIMED_OUT",
        timestamp: 6_000,
        terminal: true,
        success: false,
        failureKind: "timeout",
        error: "No observation within 5000ms",
      }),
    );

    const [entry] = activity();
    expect(entry!.success).toBe(false);
    expect(entry!.failureKind).toBe("timeout");
    expect(entry!.error).toBe("No observation within 5000ms");
  });

  it("separates commands within the same execution", () => {
    record(transition({ commandId: "cmd-dmx", state: "OBSERVED", timestamp: 1_000 }));
    record(transition({ commandId: "cmd-fx", state: "ACKNOWLEDGED", timestamp: 2_000 }));

    expect(activity().map((entry) => entry.commandId)).toEqual(["cmd-fx", "cmd-dmx"]);
    // Both carry the execution, so a pane can still group them.
    expect(activity().every((entry) => entry.executionId === "exec-1")).toBe(true);
  });

  it("keeps rules apart", () => {
    record(transition({ ruleId: "rule-water" }));
    record(transition({ ruleId: "rule-bunker", commandId: "cmd-2" }));

    expect(activity("rule-water").map((e) => e.commandId)).toEqual(["cmd-1"]);
    expect(activity("rule-bunker").map((e) => e.commandId)).toEqual(["cmd-2"]);
  });

  it("drops a command that belongs to no automation", () => {
    // A REST or system command has no owning pane. The backend already withholds it
    // from non-admins; not storing it keeps the store to what a pane could render.
    record(transition({ ruleId: undefined }));
    expect(useCommandActivityStore.getState().activityByRule).toEqual({});
  });

  it("bounds retention per rule", () => {
    // Unsolicited push into a long-lived page: an automation firing on a sensor topic
    // would otherwise grow this for as long as the tab stays open.
    for (let i = 0; i < MAX_ACTIVITY_PER_RULE + 5; i += 1) {
      record(transition({ commandId: `cmd-${i}`, timestamp: 1_000 + i }));
    }

    expect(activity()).toHaveLength(MAX_ACTIVITY_PER_RULE);
    // The newest survive; the oldest are dropped.
    expect(activity()[0]!.commandId).toBe(`cmd-${MAX_ACTIVITY_PER_RULE + 4}`);
  });

  it("moves an advancing command to the front", () => {
    record(transition({ commandId: "cmd-old", timestamp: 1_000 }));
    record(transition({ commandId: "cmd-new", timestamp: 2_000 }));
    record(transition({ commandId: "cmd-old", state: "DISPATCHED", timestamp: 3_000 }));

    // A command still climbing is the one a pane most wants to show.
    expect(activity().map((e) => e.commandId)).toEqual(["cmd-old", "cmd-new"]);
  });

  it("replaces the per-rule array so a reference diff sees the change", () => {
    // The contract the broker's subscription depends on, same as automation state.
    record(transition());
    const first = activity();
    record(transition({ state: "DISPATCHED", timestamp: 1_050 }));

    expect(activity()).not.toBe(first);
  });

  it("clears a rule's activity", () => {
    record(transition());
    useCommandActivityStore.getState().clearRuleActivity("rule-water");
    expect(useCommandActivityStore.getState().activityByRule).toEqual({});
  });
});

describe("command activity store — feeding the proof model", () => {
  it("renders through commandProof with no reshaping", () => {
    record(transition({ state: "REQUESTED", timestamp: 1_000 }));
    record(transition({ state: "DISPATCHED", timestamp: 1_050 }));
    record(transition({ state: "ACKNOWLEDGED", timestamp: 1_100 }));
    record(transition({ state: "OBSERVED", timestamp: 2_400, terminal: true, success: true }));

    const proof = commandProof(activity()[0])!;
    expect(proof).not.toBeNull();
    expect(proof.proven).toBe(true);
    expect(proof.headline).toBe("OBSERVED");
    expect(proof.executionId).toBe("exec-1");
    // All four stages reached, in order, from the live feed alone.
    expect(proof.stages.map((stage) => stage.status)).toEqual([
      "reached",
      "reached",
      "reached",
      "reached",
    ]);
  });

  it("shows a command still in flight as in flight", () => {
    record(transition({ state: "REQUESTED", timestamp: 1_000 }));
    record(transition({ state: "DISPATCHED", timestamp: 1_050 }));

    const proof = commandProof(activity()[0])!;
    expect(proof.settled).toBe(false);
    expect(proof.headline).toBe("IN FLIGHT");
    expect(proof.mark).toBe("○");
    // The stages this command is still aiming for read as pending, not as absent.
    expect(proof.stages[0]!.status).toBe("reached");
    expect(proof.stages[1]!.status).toBe("reached");
    expect(proof.stages[3]!.status).toBe("pending");
  });

  it("says not-recorded rather than inventing a capability the feed never carried", () => {
    // A transition reports no capability snapshot. An unreached stage on a live
    // command therefore has to admit it does not know, rather than claim the device
    // cannot acknowledge — which is exactly the fabrication the fixed scaffold exists
    // to prevent. The projected receipt explains it properly once it settles.
    record(transition({ effectiveTier: "dispatch", state: "REQUESTED", timestamp: 1_000 }));
    record(transition({ effectiveTier: "dispatch", state: "DISPATCHED", timestamp: 1_050, terminal: true, success: true }));

    const proof = commandProof(activity()[0])!;
    expect(proof.stages[2]!.status).toBe("not-recorded");
    expect(proof.stages[3]!.status).toBe("not-recorded");
  });

  it("renders a failure at the stage where proof stopped", () => {
    record(transition({ state: "REQUESTED", timestamp: 1_000 }));
    record(transition({ state: "DISPATCHED", timestamp: 1_050 }));
    record(
      transition({
        state: "TIMED_OUT",
        timestamp: 6_000,
        terminal: true,
        success: false,
        failureKind: "timeout",
      }),
    );

    const proof = commandProof(activity()[0])!;
    expect(proof.proven).toBe(false);
    expect(proof.headline).toBe("TIMED OUT");
    expect(proof.stages.some((stage) => stage.status === "failed")).toBe(true);
  });
});
