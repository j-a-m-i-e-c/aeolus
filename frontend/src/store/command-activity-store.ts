// frontend/src/store/command-activity-store.ts
// showcase-cleanup §2.8 — live command activity, per automation.
//
// Assembles the durable lifecycle transitions arriving over the WebSocket into one
// growing record per command, so a pane can watch the evidence stages be reached
// instead of receiving the whole ladder in a single write.
//
// The assembled shape is deliberately the same shape `devices.commandEvidence()`
// returns, so `commandProof()` and `CommandProofCard` consume it with no reshaping and
// a pane uses one rendering path for live and settled commands alike.
//
// What it does NOT do is fill in the parts the transition event does not carry. There
// is no capability snapshot here, so a live command's ACKNOWLEDGED and OBSERVED stages
// read as `not-recorded` rather than claiming a capability nobody reported. Once Logic
// projects the settled receipt, the snapshot arrives with it and the stages explain
// themselves properly. A live view that guessed the ceiling in the meantime would be
// inventing the one fact the whole model exists to record honestly.
//
// Every update replaces the per-rule array rather than mutating it, so the broker's
// reference-equality diff sees the change — the same contract
// `automation-state-store` relies on.

import { create } from "zustand";

/**
 * One lifecycle transition as broadcast by the backend.
 *
 * Mirrors `CommandLifecycleTransitionEvent`, which is documented as carrying only
 * fields safe for an authenticated observer.
 */
export interface CommandLifecycleMessage {
  commandId: string;
  targetDeviceId: string;
  actionType: string;
  effectiveTier: string;
  state: string;
  timestamp: number;
  terminal: boolean;
  ruleId?: string;
  executionId?: string;
  correlationId?: string;
  fromState?: string;
  success?: boolean;
  failureKind?: string;
  error?: string;
}

/** One live transition, in the shape `commandProof()` reads from `transitions`. */
export interface CommandActivityTransition {
  toState: string;
  timestamp: number;
  fromState?: string;
}

/**
 * A command in flight, or just settled, as far as the live feed can tell.
 *
 * Field names match `CommandEvidenceRecord` so this is interchangeable with a
 * projected receipt at the rendering boundary. Absent fields are absent because the
 * broadcast does not carry them, never because they are known to be false.
 */
export interface CommandActivity {
  commandId: string;
  targetDeviceId: string;
  actionType: string;
  effectiveTier: string;
  lifecycleState: string;
  requestedAt: number;
  transitions: CommandActivityTransition[];
  executionId?: string;
  correlationId?: string;
  terminalAt?: number;
  success?: boolean;
  failureKind?: string;
  error?: string;
}

/**
 * How many commands are retained per automation.
 *
 * Bounded because this is an unsolicited push into a long-lived page: an automation
 * firing on a sensor topic would otherwise grow this array for as long as the tab
 * stays open. Ten covers the recent activity a pane can meaningfully show.
 */
export const MAX_ACTIVITY_PER_RULE = 10;

interface CommandActivityState {
  /** Newest first, per rule. Bounded to {@link MAX_ACTIVITY_PER_RULE}. */
  activityByRule: Record<string, CommandActivity[]>;
  /** Fold one broadcast transition into the owning rule's activity. */
  recordTransition: (message: CommandLifecycleMessage) => void;
  /** Drop a rule's activity (pane unmounted, automation deleted). */
  clearRuleActivity: (ruleId: string) => void;
}

/**
 * Fold a transition into an existing command, or start a new one.
 *
 * `terminalAt` is stamped only from a transition that says it is terminal, matching
 * the durable column: it is what tells a renderer the command stopped waiting, and
 * inferring it from a state name would misread a `DISPATCHED` that satisfied a
 * dispatch-only command as one still climbing.
 *
 * A duplicate transition for a state already recorded is ignored, so a reconnect that
 * replays a message cannot produce two ticks for one stage.
 */
function fold(existing: CommandActivity | undefined, message: CommandLifecycleMessage): CommandActivity {
  const transition: CommandActivityTransition = {
    toState: message.state,
    timestamp: message.timestamp,
    ...(message.fromState !== undefined ? { fromState: message.fromState } : {}),
  };

  const base: CommandActivity =
    existing ??
    {
      commandId: message.commandId,
      targetDeviceId: message.targetDeviceId,
      actionType: message.actionType,
      effectiveTier: message.effectiveTier,
      lifecycleState: message.state,
      requestedAt: message.timestamp,
      transitions: [],
      ...(message.executionId !== undefined ? { executionId: message.executionId } : {}),
      ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
    };

  const alreadyRecorded = base.transitions.some((entry) => entry.toState === message.state);
  const transitions = alreadyRecorded ? base.transitions : [...base.transitions, transition];

  return {
    ...base,
    // The latest state wins: the durable record advances the same way.
    lifecycleState: message.state,
    transitions,
    ...(message.terminal ? { terminalAt: message.timestamp } : {}),
    ...(message.success !== undefined ? { success: message.success } : {}),
    ...(message.failureKind !== undefined ? { failureKind: message.failureKind } : {}),
    ...(message.error !== undefined ? { error: message.error } : {}),
  };
}

export const useCommandActivityStore = create<CommandActivityState>((set) => ({
  activityByRule: {},

  recordTransition: (message) =>
    set((prev) => {
      // No rule means no pane owns it — a REST or system command. The backend
      // already withholds these from non-admins; dropping them here keeps the
      // store's contents to what a pane could legitimately render.
      const ruleId = message.ruleId;
      if (!ruleId || !message.commandId) return prev;

      const current = prev.activityByRule[ruleId] ?? [];
      const index = current.findIndex((entry) => entry.commandId === message.commandId);
      const updated = fold(index >= 0 ? current[index] : undefined, message);

      // Newest first, and an updated command moves to the front: a command still
      // climbing is the one a pane most wants to show.
      const rest = index >= 0 ? current.filter((_, i) => i !== index) : current;
      const next = [updated, ...rest].slice(0, MAX_ACTIVITY_PER_RULE);

      return { activityByRule: { ...prev.activityByRule, [ruleId]: next } };
    }),

  clearRuleActivity: (ruleId) =>
    set((prev) => {
      const { [ruleId]: _removed, ...rest } = prev.activityByRule;
      return { activityByRule: rest };
    }),
}));
