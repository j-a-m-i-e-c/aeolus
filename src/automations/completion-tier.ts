// src/automations/completion-tier.ts — Pure completion-tier helpers
//
// This module supplies a value to the `requiredTier?: ConfirmationTier` input that
// CommandService.execute() already exposes. It does not build that input, define the
// lifecycle, or implement tier clamping — those are inherited from
// verified-command-execution / unified-command-boundary.

import type { ConfirmationTier } from "./command-lifecycle.js";

/** Ordinal used for ceiling comparisons: dispatch < acknowledged < observed. */
const TIER_RANK: Record<ConfirmationTier, number> = {
  dispatch: 0,
  acknowledged: 1,
  observed: 2,
};

/** Type guard: exactly one of the three tier strings (Req 3.5, 5.4). */
export function isConfirmationTier(value: unknown): value is ConfirmationTier {
  return value === "dispatch" || value === "acknowledged" || value === "observed";
}

/** Ordinal used for ceiling comparisons: dispatch < acknowledged < observed. */
export function tierRank(tier: ConfirmationTier): number {
  return TIER_RANK[tier];
}

/**
 * Compute the Capability_Ceiling as the ordered list of provable tiers plus the
 * single highest tier. `dispatch` is universal for a dispatchable device (Req 2.1);
 * `acknowledged` requires a declared ack capability (Req 2.2, 2.3); `observed`
 * requires an available observation source (Req 2.4, 2.5). A non-dispatchable
 * device has no provable tiers (Req 2.7, 2.8).
 */
export function computeCapabilityCeiling(input: {
  dispatchable: boolean; // false ⇒ device cannot dispatch (Req 2.7)
  ackSupported: boolean; // getAcknowledgementCapability()?.supported === true
  observationAvailable: boolean; // ConfirmOptions identify a present Observed_Device
}): { tiers: ConfirmationTier[]; ceiling: ConfirmationTier | null } {
  if (!input.dispatchable) return { tiers: [], ceiling: null }; // Req 2.7, 2.8
  const tiers: ConfirmationTier[] = ["dispatch"];
  if (input.ackSupported) tiers.push("acknowledged");
  if (input.observationAvailable) tiers.push("observed");
  const ceiling = tiers.reduce<ConfirmationTier>(
    (hi, t) => (tierRank(t) > tierRank(hi) ? t : hi),
    "dispatch",
  );
  return { tiers, ceiling };
}

/** Authoring-time validation outcome. */
export type TierValidation =
  | { ok: true; tier: ConfirmationTier | null }
  | { ok: false; code: "invalid" | "over_ceiling" | "ceiling_unresolvable"; message: string };

/**
 * Validate a submitted tier against a ceiling for the Authoring_Endpoint (Req 3).
 * - undefined/null submitted ⇒ accept as null (Req 7.4).
 * - not a tier string ⇒ invalid (Req 3.5).
 * - ceiling null ⇒ ceiling_unresolvable (Req 3.6).
 * - rank(submitted) > rank(ceiling) ⇒ over_ceiling (Req 3.4).
 * - rank(submitted) <= rank(ceiling) ⇒ accept (Req 3.2, 3.3).
 */
export function validateAgainstCeiling(
  submitted: unknown,
  ceiling: ConfirmationTier | null,
): TierValidation {
  if (submitted === undefined || submitted === null) return { ok: true, tier: null };
  if (!isConfirmationTier(submitted)) {
    return {
      ok: false,
      code: "invalid",
      message: "completionTier must be one of: dispatch, acknowledged, observed",
    };
  }
  if (ceiling === null) {
    return {
      ok: false,
      code: "ceiling_unresolvable",
      message: "Cannot determine the target device's capability ceiling",
    };
  }
  if (tierRank(submitted) > tierRank(ceiling)) {
    return {
      ok: false,
      code: "over_ceiling",
      message: `Requested tier '${submitted}' exceeds device capability ceiling '${ceiling}'`,
    };
  }
  return { ok: true, tier: submitted };
}

/**
 * Resolve the effective dispatch-time tier to hand CommandService.execute().
 * Precedence: an action-specified tier overrides the stored/default (Req 5.2);
 * an unrecognized value ⇒ omit (Req 4.5); a value above the ceiling ⇒ omit
 * (Req 4.6); otherwise the value itself. `undefined` return ⇒ omit requiredTier
 * so the boundary selects highest-available (Req 4.2, 5.3, 7.1, 7.5).
 */
export function resolveEffectiveTier(
  stored: unknown,
  actionSpecified: unknown,
  ceiling: ConfirmationTier | null,
): ConfirmationTier | undefined {
  const chosen = actionSpecified !== undefined ? actionSpecified : stored;
  if (chosen === undefined || chosen === null) return undefined;
  if (!isConfirmationTier(chosen)) return undefined; // Req 4.5
  if (ceiling !== null && tierRank(chosen) > tierRank(ceiling)) return undefined; // Req 4.6
  return chosen;
}
