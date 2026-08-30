// src/automations/command-lifecycle.ts — Central command lifecycle transition table and tier selection

import type { CommandLifecycleState } from "../core/types.js";

/**
 * Allowed forward transitions for the command lifecycle. Any transition not
 * listed here is rejected as a no-op by {@link canTransition}, which centrally
 * enforces the monotonic-advance property.
 *
 *   REQUESTED    -> DISPATCHED | FAILED
 *   DISPATCHED   -> ACKNOWLEDGED | OBSERVED | FAILED | TIMED_OUT | STATE_MISMATCH
 *   ACKNOWLEDGED -> OBSERVED | FAILED | TIMED_OUT | STATE_MISMATCH
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

/** Lifecycle-final states — no later evidence can advance them. */
const TERMINAL_STATES: ReadonlySet<CommandLifecycleState> = new Set([
  "OBSERVED",
  "FAILED",
  "TIMED_OUT",
  "STATE_MISMATCH",
]);

/**
 * States that can satisfy a configured completion tier. `DISPATCHED` and
 * `ACKNOWLEDGED` are completion states, not lifecycle-final states: later
 * evidence may still advance the lifecycle when the command is being tracked.
 * Callers combine this with the command's required tier to decide success.
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

/** Return true only when no lifecycle transition can follow `state`. */
export function isTerminal(state: CommandLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Return true when `state` can satisfy some success/completion tier
 * (DISPATCHED, ACKNOWLEDGED, OBSERVED). This does not imply lifecycle finality.
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
