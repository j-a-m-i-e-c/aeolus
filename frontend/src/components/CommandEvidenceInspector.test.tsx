// frontend/src/components/CommandEvidenceInspector.test.tsx
//
// The inspector is the platform's own audit surface, and almost all of its logic is
// about reconciling two sources that deliberately disagree in richness: a durable
// REST snapshot that carries intent, device names and capability context, and a live
// WebSocket feed that carries only lifecycle movement. Getting that merge wrong does
// not crash anything — it quietly replaces recorded provenance with a partial view,
// which is the one failure this component exists to prevent.
//
// The proof renderers are stubbed. They have their own suites, and standing in for
// them is what makes the grouping decisions assertable here: which card was chosen,
// with which label, over which commands.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const { mockAuthFetch } = vi.hoisted(() => ({ mockAuthFetch: vi.fn() }));
vi.mock("../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));

// Stubs that surface their props, so the grouping choice is what gets asserted
// rather than the internals of a card with its own tests.
vi.mock("../sandbox/ui-kit", () => ({
  CommandProofCard: ({ label, evidence }: { label: string; evidence: Record<string, unknown> }) => (
    <div
      data-testid="proof-card"
      data-label={label}
      data-command={String(evidence?.commandId ?? "")}
      data-lifecycle={String(evidence?.lifecycleState ?? "")}
      data-intent={String(evidence?.intent ?? "")}
      data-terminal={String(evidence?.terminalAt ?? "")}
      data-success={String(evidence?.success ?? "")}
      data-error={String(evidence?.error ?? "")}
      data-failure-kind={String(evidence?.failureKind ?? "")}
      data-execution={String(evidence?.executionId ?? "")}
      data-transitions={JSON.stringify(evidence?.transitions ?? [])}
    />
  ),
  CommandExecutionCard: ({
    label,
    evidence,
  }: {
    label: string;
    evidence: { executionId: string; commands: Array<Record<string, unknown>> };
  }) => (
    <div
      data-testid="execution-card"
      data-label={label}
      data-execution={evidence.executionId}
      data-commands={evidence.commands.map((c) => String(c.commandId)).join(",")}
    />
  ),
}));

import { CommandEvidenceInspector } from "./CommandEvidenceInspector";
import { useCommandActivityStore, type CommandActivity } from "../store/command-activity-store";

/** A durable REST record, rich in the context the live feed does not carry. */
function durable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commandId: "cmd-1",
    executionId: "exec-1",
    requestedAt: 1_000,
    lifecycleState: "REQUESTED",
    intent: "Open the header valve",
    targetDeviceId: "valve-1",
    transitions: [{ toState: "REQUESTED", timestamp: 1_000, detail: "durable detail" }],
    ...overrides,
  };
}

/** A live WebSocket-assembled record, deliberately thinner. */
function live(overrides: Partial<CommandActivity> = {}): CommandActivity {
  return {
    commandId: "cmd-1",
    targetDeviceId: "valve-1",
    actionType: "device_action",
    effectiveTier: "observed",
    lifecycleState: "OBSERVED",
    requestedAt: 9_999,
    transitions: [{ toState: "OBSERVED", timestamp: 2_000 }],
    ...overrides,
  } as CommandActivity;
}

function respondWith(commands: unknown, init: { ok?: boolean; status?: number } = {}) {
  mockAuthFetch.mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => ({ commands }),
  });
}

function setLive(activity: CommandActivity[], ruleId = "rule-1") {
  act(() => {
    useCommandActivityStore.setState({ activityByRule: activity.length ? { [ruleId]: activity } : {} });
  });
}

function renderInspector(props: Partial<React.ComponentProps<typeof CommandEvidenceInspector>> = {}) {
  const onClose = vi.fn();
  const result = render(
    <CommandEvidenceInspector
      open
      ruleId="rule-1"
      ruleName="Water Management"
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose, ...result };
}

/** Attributes of the rendered proof cards, in render order. */
const proofCards = () => screen.queryAllByTestId("proof-card");

describe("CommandEvidenceInspector", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    useCommandActivityStore.setState({ activityByRule: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when closed", () => {
    it("renders nothing and asks the server for nothing", () => {
      respondWith([durable()]);
      const { container } = render(
        <CommandEvidenceInspector open={false} ruleId="rule-1" ruleName="Water" onClose={vi.fn()} />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(mockAuthFetch).not.toHaveBeenCalled();
    });
  });

  describe("loading the durable history", () => {
    it("requests the bounded evidence endpoint for the automation", async () => {
      respondWith([durable()]);
      renderInspector();
      await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
      expect(String(mockAuthFetch.mock.calls[0]![0])).toContain(
        "/api/automations/rule-1/command-evidence?limit=100",
      );
    });

    it("encodes an automation id that is not URL-safe", async () => {
      respondWith([]);
      renderInspector({ ruleId: "rule/one" });
      await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
      expect(String(mockAuthFetch.mock.calls[0]![0])).toContain("rule%2Fone");
    });

    it("asks for nothing when there is no automation to ask about", () => {
      respondWith([]);
      renderInspector({ ruleId: "" });
      expect(mockAuthFetch).not.toHaveBeenCalled();
    });

    it("shows a loading state until the first response arrives", async () => {
      mockAuthFetch.mockReturnValue(new Promise(() => { /* never resolves */ }));
      renderInspector();
      expect(screen.getByText(/Loading command history/)).toBeInTheDocument();
    });

    it("reports the status when the request is refused", async () => {
      respondWith([], { ok: false, status: 403 });
      renderInspector();
      expect(await screen.findByText(/Command evidence request failed \(403\)/)).toBeInTheDocument();
    });

    it("reports a generic failure when the request throws something that is not an Error", async () => {
      mockAuthFetch.mockRejectedValue("network down");
      renderInspector();
      expect(await screen.findByText("Failed to load command evidence")).toBeInTheDocument();
    });

    it("keeps showing evidence it already has when a later refresh fails", async () => {
      respondWith([durable()]);
      renderInspector();
      await waitFor(() => expect(proofCards()).toHaveLength(1));

      mockAuthFetch.mockRejectedValue(new Error("bridge down"));
      fireEvent.click(screen.getByLabelText("Refresh command evidence"));

      // The error banner is for when there is nothing to show; existing evidence
      // is still true and stays on screen.
      await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(2));
      expect(proofCards()).toHaveLength(1);
      expect(screen.queryByText("bridge down")).not.toBeInTheDocument();
    });

    it("re-fetches when the refresh control is used", async () => {
      respondWith([durable()]);
      renderInspector();
      await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByLabelText("Refresh command evidence"));
      await waitFor(() => expect(mockAuthFetch).toHaveBeenCalledTimes(2));
    });

    it("disables the refresh control while a request is in flight", async () => {
      mockAuthFetch.mockReturnValue(new Promise(() => { /* never resolves */ }));
      renderInspector();
      await waitFor(() =>
        expect(screen.getByLabelText("Refresh command evidence")).toBeDisabled(),
      );
    });
  });

  describe("reading the response", () => {
    it("ignores entries that carry no command id", async () => {
      respondWith([durable(), { requestedAt: 5 }, null, "nonsense", { commandId: 42 }]);
      renderInspector();
      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(proofCards()[0]!.dataset.command).toBe("cmd-1");
    });

    it("treats a response whose commands field is not a list as empty", async () => {
      respondWith({ nope: true });
      renderInspector();
      expect(await screen.findByText("No command evidence yet")).toBeInTheDocument();
    });

    it("explains that non-physical actions do not manufacture evidence", async () => {
      respondWith([]);
      renderInspector();
      expect(await screen.findByText(/do not manufacture evidence/)).toBeInTheDocument();
      expect(screen.getByText("No physical commands")).toBeInTheDocument();
    });

    it("counts one command in the singular", async () => {
      respondWith([durable()]);
      renderInspector();
      expect(await screen.findByText("1 recent physical command")).toBeInTheDocument();
    });

    it("counts several commands in the plural", async () => {
      respondWith([durable(), durable({ commandId: "cmd-2", executionId: "exec-2" })]);
      renderInspector();
      expect(await screen.findByText("2 recent physical commands")).toBeInTheDocument();
    });

    it("says when it is showing only the most recent page", async () => {
      const many = Array.from({ length: 100 }, (_, i) =>
        durable({ commandId: `cmd-${i}`, executionId: `exec-${i}`, requestedAt: i }),
      );
      respondWith(many);
      renderInspector();
      expect(await screen.findByText(/Showing the most recent 100 commands/)).toBeInTheDocument();
    });
  });

  describe("merging the live feed over the durable snapshot", () => {
    it("advances lifecycle fields without discarding recorded intent", async () => {
      respondWith([durable()]);
      setLive([
        live({
          lifecycleState: "OBSERVED",
          terminalAt: 2_500,
          success: true,
        }),
      ]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      const card = proofCards()[0]!;
      expect(card.dataset.lifecycle).toBe("OBSERVED");
      expect(card.dataset.terminal).toBe("2500");
      expect(card.dataset.success).toBe("true");
      // The fact the live feed does not carry is still there.
      expect(card.dataset.intent).toBe("Open the header valve");
    });

    it("carries a live failure onto the durable record", async () => {
      respondWith([durable()]);
      setLive([
        live({
          lifecycleState: "FAILED",
          terminalAt: 3_000,
          success: false,
          failureKind: "not-observed",
          error: "tachometer never reached speed",
        }),
      ]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      const card = proofCards()[0]!;
      expect(card.dataset.failureKind).toBe("not-observed");
      expect(card.dataset.error).toBe("tachometer never reached speed");
      expect(card.dataset.success).toBe("false");
    });

    it("does not let the live feed overwrite the durable request time", async () => {
      // The live record's requestedAt is when the UI first heard about the command,
      // which is not when it was issued. Ordering must use the durable value.
      respondWith([
        durable({ commandId: "old", executionId: "exec-old", requestedAt: 1_000 }),
        durable({ commandId: "new", executionId: "exec-new", requestedAt: 5_000 }),
      ]);
      setLive([live({ commandId: "old", requestedAt: 9_999_999 })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(2));
      // Newest first, by durable requestedAt.
      expect(proofCards().map((c) => c.dataset.command)).toEqual(["new", "old"]);
    });

    it("adds a live-only command the durable snapshot has not caught up with", async () => {
      respondWith([]);
      setLive([live({ commandId: "cmd-live", requestedAt: 4_000 })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(proofCards()[0]!.dataset.command).toBe("cmd-live");
    });

    it("takes an execution id from the live feed only when the durable record lacks one", async () => {
      respondWith([durable({ executionId: undefined })]);
      setLive([live({ executionId: "exec-live" })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(proofCards()[0]!.dataset.execution).toBe("exec-live");
    });

    it("keeps the durable execution id when both have one", async () => {
      respondWith([durable({ executionId: "exec-durable" })]);
      setLive([live({ executionId: "exec-live" })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(proofCards()[0]!.dataset.execution).toBe("exec-durable");
    });

    it("refreshes shortly after live activity arrives, to pick up the durable context", async () => {
      vi.useFakeTimers();
      respondWith([durable()]);
      setLive([live()]);
      renderInspector();

      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const initial = mockAuthFetch.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(150); });
      expect(mockAuthFetch.mock.calls.length).toBeGreaterThan(initial);
    });
  });

  describe("merging transitions", () => {
    it("keeps the durable detail when the live feed repeats the same transition", async () => {
      respondWith([durable()]);
      setLive([
        live({
          transitions: [
            { toState: "REQUESTED", timestamp: 1_000 },
            { toState: "OBSERVED", timestamp: 2_000 },
          ],
        }),
      ]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      const transitions = JSON.parse(proofCards()[0]!.dataset.transitions!);
      expect(transitions).toHaveLength(2);
      // The repeat did not erase the richer durable copy.
      expect(transitions[0].detail).toBe("durable detail");
      expect(transitions[1].toState).toBe("OBSERVED");
    });

    it("orders transitions by time regardless of which source supplied them", async () => {
      respondWith([
        durable({ transitions: [{ toState: "OBSERVED", timestamp: 3_000 }] }),
      ]);
      setLive([live({ transitions: [{ toState: "ACKNOWLEDGED", timestamp: 2_000 }] })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      const transitions = JSON.parse(proofCards()[0]!.dataset.transitions!);
      expect(transitions.map((t: { toState: string }) => t.toState)).toEqual([
        "ACKNOWLEDGED",
        "OBSERVED",
      ]);
    });

    it("drops transition entries that name no state", async () => {
      respondWith([
        durable({
          transitions: [
            { toState: "REQUESTED", timestamp: 1_000 },
            { timestamp: 1_500 },
            null,
            "nonsense",
            { toState: 7, timestamp: 1_600 },
          ],
        }),
      ]);
      setLive([live({ transitions: [] })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      const transitions = JSON.parse(proofCards()[0]!.dataset.transitions!);
      expect(transitions).toHaveLength(1);
    });

    it("tolerates a durable record whose transitions are not a list", async () => {
      respondWith([durable({ transitions: "unexpected" })]);
      setLive([live({ transitions: [{ toState: "OBSERVED", timestamp: 2_000 }] })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      const transitions = JSON.parse(proofCards()[0]!.dataset.transitions!);
      expect(transitions).toEqual([{ toState: "OBSERVED", timestamp: 2_000 }]);
    });

    it("treats a transition with no timestamp as the earliest", async () => {
      respondWith([
        durable({
          transitions: [
            { toState: "OBSERVED", timestamp: 2_000 },
            { toState: "REQUESTED" },
          ],
        }),
      ]);
      // Live activity is what brings the two transition lists together; without a
      // matching live record the durable array is passed through as authored.
      setLive([live({ transitions: [] })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      const transitions = JSON.parse(proofCards()[0]!.dataset.transitions!);
      expect(transitions[0].toState).toBe("REQUESTED");
    });
  });

  describe("grouping by execution", () => {
    it("shows one execution that issued several commands as a single execution card", async () => {
      respondWith([
        durable({ commandId: "cmd-a", executionId: "exec-1", requestedAt: 1_000 }),
        durable({ commandId: "cmd-b", executionId: "exec-1", requestedAt: 2_000 }),
      ]);
      renderInspector();

      const card = await screen.findByTestId("execution-card");
      expect(card.dataset.execution).toBe("exec-1");
      // Within an execution, the issue order is the story.
      expect(card.dataset.commands).toBe("cmd-a,cmd-b");
      expect(proofCards()).toHaveLength(0);
    });

    it("shows a lone command as a proof card even when it has an execution id", async () => {
      respondWith([durable({ commandId: "cmd-a", executionId: "exec-1" })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(screen.queryByTestId("execution-card")).not.toBeInTheDocument();
    });

    it("keeps commands with no execution id separate from each other", async () => {
      respondWith([
        durable({ commandId: "cmd-a", executionId: undefined, requestedAt: 1_000 }),
        durable({ commandId: "cmd-b", executionId: undefined, requestedAt: 2_000 }),
      ]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(2));
      expect(proofCards().map((c) => c.dataset.command)).toEqual(["cmd-b", "cmd-a"]);
    });

    it("orders groups newest first by their latest command", async () => {
      respondWith([
        durable({ commandId: "old-a", executionId: "exec-old", requestedAt: 1_000 }),
        durable({ commandId: "old-b", executionId: "exec-old", requestedAt: 1_100 }),
        durable({ commandId: "new-a", executionId: "exec-new", requestedAt: 8_000 }),
        durable({ commandId: "new-b", executionId: "exec-new", requestedAt: 8_100 }),
      ]);
      renderInspector();

      const cards = await screen.findAllByTestId("execution-card");
      expect(cards.map((c) => c.dataset.execution)).toEqual(["exec-new", "exec-old"]);
    });

    it("labels a command with no usable request time rather than showing an epoch date", async () => {
      respondWith([durable({ requestedAt: undefined })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(proofCards()[0]!.dataset.label).toBe("Command");
    });

    it("labels a command that has a request time with that time", async () => {
      respondWith([durable({ requestedAt: Date.UTC(2026, 8, 21, 10, 30, 0) })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(proofCards()[0]!.dataset.label).not.toBe("Command");
      expect(proofCards()[0]!.dataset.label).toMatch(/\d/);
    });

    it("ignores a non-numeric request time when ordering and labelling", async () => {
      respondWith([durable({ requestedAt: "yesterday" })]);
      renderInspector();

      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(proofCards()[0]!.dataset.label).toBe("Command");
    });
  });

  describe("live progress indicator", () => {
    it("flags a live command that has not reached a terminal state", async () => {
      respondWith([durable()]);
      setLive([live({ terminalAt: undefined })]);
      renderInspector();
      expect(await screen.findByText("Live command in progress")).toBeInTheDocument();
    });

    it("does not flag progress once every live command has settled", async () => {
      respondWith([durable()]);
      setLive([live({ terminalAt: 2_000 })]);
      renderInspector();
      await waitFor(() => expect(proofCards()).toHaveLength(1));
      expect(screen.queryByText("Live command in progress")).not.toBeInTheDocument();
    });
  });

  describe("dismissal", () => {
    /** Render and wait for the first fetch to settle, so nothing lands mid-assertion. */
    async function renderSettled() {
      respondWith([]);
      const rendered = renderInspector();
      await screen.findByText("No command evidence yet");
      return rendered;
    }

    it("closes on the close control", async () => {
      const { onClose } = await renderSettled();
      fireEvent.click(screen.getAllByLabelText("Close command evidence")[1]!);
      expect(onClose).toHaveBeenCalled();
    });

    it("closes when the backdrop is used", async () => {
      const { onClose } = await renderSettled();
      fireEvent.click(screen.getAllByLabelText("Close command evidence")[0]!);
      expect(onClose).toHaveBeenCalled();
    });

    it("closes on Escape", async () => {
      const { onClose } = await renderSettled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });

    it("ignores other keys", async () => {
      const { onClose } = await renderSettled();
      fireEvent.keyDown(window, { key: "Enter" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("stops listening for Escape once closed", async () => {
      const { onClose, unmount } = await renderSettled();
      unmount();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("names the automation it is showing evidence for", async () => {
      respondWith([]);
      renderInspector({ ruleName: "Water Management" });
      expect(
        await screen.findByRole("dialog", { name: "Command evidence for Water Management" }),
      ).toBeInTheDocument();
    });
  });
});
