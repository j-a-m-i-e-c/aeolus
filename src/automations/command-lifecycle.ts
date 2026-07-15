// src/automations/command-lifecycle.ts — Central command lifecycle transition table and tier selection

import type { CommandLifecycleState } from "../core/types.js";

/**
 * Allowed forward transitions for the command lifecycle. Any transition not
 * listed here is rejected as a no-op by {@link canTransition}, which centrally
 * enforces the monotonic-advance property.
 *
 *   REQUESTED    -> DISPATCHED | FAILED
 *   DISPATCHED   -> ACKNOWLEDGED | OBSERVED | TIMED_OUT | STATE_MISMATCH
 *   ACKNOWLEDGED -> OBSERVED | TIMED_OUT | STATE_MISMATCH
 *   FAILED, OBSERVED, TIMED_OUT, STATE_MISMATCH are terminal.
 */
const ALLOWED_TRANSITIONS: Record<CommandLifecycleState, readonly CommandLifecycleState[]> = {
  REQUESTED: ["DISPATCHED", "FAILED"],
  DISPATCHED: ["ACKNOWLEDGED", "OBSERVED", "FAILED", "TIMED_OUT", "STATE_MISMATCH"],
  ACKNOWLEDGED: ["OBSERVED", "FAILED", "TIMED_OUT", "STATE_MISMATCH"],
  OBSERVED: [],
  FAILED: [],
  TIMED_OUT: [],
  STATE_MISMATCH: [],
};

/** Terminal states — no further transition is possible once reached. */
const TERMINAL_STATES: ReadonlySet<CommandLifecycleState> = new Set([
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
]);

/**
 * States that represent a successful terminal outcome.
 *
 * `DISPATCHED` is a success only for dispatch-only commands, `ACKNOWLEDGED`
 * only for commands whose required tier is acknowledgement, and `OBSERVED`
 * always. This helper reports whether the state *can* be a success terminal;
 * callers combine it with the command's required tier to decide the final
 * `success` boolean.
 */
const SUCCESS_STATES: ReadonlySet<CommandLifecycleState> = new Set([
  "DISPATCHED",
  "ACKNOWLEDGED",
  "OBSERVED",
]);

/** The confirmation tier a command must reach to resolve as success. */
export type ConfirmationTier = "dispatch" | "acknowledged" | "observed";

/**
 * Return true when a command may advance from `from` to `to`.
 *
 * Rejecting a disallowed transition (returning false) lets the caller treat it
 * as a no-op, preserving the monotonic-advance invariant even under duplicate
 * or late messages.
 */
export function canTransition(from: CommandLifecycleState, to: CommandLifecycleState): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Return true when `state` is terminal (no further transition possible). */
export function isTerminal(state: CommandLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Return true when `state` is one of the states that can represent success
 * (DISPATCHED, ACKNOWLEDGED, OBSERVED). Whether it *is* a success for a given
 * command still depends on that command's required tier.
 */
export function isSuccessState(state: CommandLifecycleState): boolean {
  return SUCCESS_STATES.has(state);
}

/**
 * Select the highest confirmation tier available for a command, following the
 * ordering Observed > Acknowledged > Dispatch (Req 9.6):
 *   - `observed`     when Confirmation_Options are supplied
 *   - `acknowledged` when no confirm but the connector declares an ack capability
 *   - `dispatch`     otherwise
 */
export function selectRequiredTier(hasConfirm: boolean, hasAckCapability: boolean): ConfirmationTier {
  if (hasConfirm) return "observed";
  if (hasAckCapability) return "acknowledged";
  return "dispatch";
}
