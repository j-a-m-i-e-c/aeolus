// frontend/src/lib/completion-tier.ts — Acknowledgement (completion tier) vocabulary
//
// The backend calls this setting the "completion tier" (`completionTier` on the
// automation API, `completion_tier` in SQLite). It is the acknowledgement level an
// automation requires before it treats a dispatched command as successful.
//
// This module is the single frontend source of truth for the tier values and their
// human labels. It deliberately mirrors src/automations/completion-tier.ts so the UI
// never invents a fourth tier or a different ordering.

/** The three acknowledgement levels, weakest to strongest. */
export type ConfirmationTier = "dispatch" | "acknowledged" | "observed";

/** Ordered weakest → strongest, which is the order the picker offers them in. */
export const CONFIRMATION_TIERS: readonly ConfirmationTier[] = [
  "dispatch",
  "acknowledged",
  "observed",
] as const;

/** Type guard for a value arriving from the API or from form state. */
export function isConfirmationTier(value: unknown): value is ConfirmationTier {
  return value === "dispatch" || value === "acknowledged" || value === "observed";
}

/** Short label for a tier, for the picker and the list badge. */
export const TIER_LABELS: Record<ConfirmationTier, string> = {
  dispatch: "Dispatch only",
  acknowledged: "Acknowledged",
  observed: "Observed",
};

/** What each level actually proves, in the operator's terms. */
export const TIER_DESCRIPTIONS: Record<ConfirmationTier, string> = {
  dispatch: "Succeeds as soon as the command is handed to the device. Nothing is confirmed.",
  acknowledged: "The device must reply confirming it received the command.",
  observed: "The device's reported state must match the expected outcome.",
};

/** Copy for the "no explicit choice" option. */
export const TIER_AUTO_LABEL = "Highest available (automatic)";
export const TIER_AUTO_DESCRIPTION =
  "Aeolus uses the strongest level the target device can actually prove.";

/** Label a tier for display, falling back to the raw value for unknown input. */
export function tierLabel(value: unknown): string {
  return isConfirmationTier(value) ? TIER_LABELS[value] : String(value);
}

/**
 * True when an automation can dispatch a device command, and therefore when an
 * acknowledgement level is meaningful. Script rules can dispatch device actions from
 * arbitrary Logic, so they always qualify. Among legacy form rules, only the
 * device-directed actions do — raw publish, webhook, log and delay have nothing to
 * acknowledge.
 */
export function tierApplies(rule: { ruleType?: string; actionType?: string }): boolean {
  if (rule.ruleType === "script") return true;
  return rule.actionType === "device_action" || rule.actionType === "toggle";
}
