// src/automations/completion-tier.ts — Pure completion-tier helpers
//
// Two concerns only: the tier vocabulary (the `ConfirmationTier` type guard and its
// ordering), and computing a DEVICE's Capability_Ceiling — which tiers that one
// device can actually prove. It does not choose a tier, define the lifecycle, or
// clamp anything: a tier is chosen per call by the automation author, and clamping
// against live device capability belongs to CommandService.

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

// Two helpers were removed from this module and are deliberately not coming back:
//
// - `resolveEffectiveTier` merged a stored per-automation default with a per-call
//   tier. The per-automation default is gone, because one automation may command
//   many devices with different acknowledgement capabilities and a single tier
//   spanning the rule could only ever be an aspiration the boundary clamped per
//   device. A tier is now stated per call in Logic, or omitted so each device
//   resolves to its own provable maximum. (`CommandService` has a private method of
//   the same name — a different thing, and still the live clamping path.)
// - `validateAgainstCeiling` validated an authoring-time submission against a
//   device ceiling. No production path ever called it; the authoring routes checked
//   the tier's shape instead, and there is no longer a tier to author.
