// frontend/src/lib/completion-tier.ts — Acknowledgement (completion tier) vocabulary
//
// The backend calls this setting the "completion tier" (`completionTier` on the
// automation API, `completion_tier` in SQLite). It is the acknowledgement level an
// automation requires before it treats a dispatched command as successful.
//
// This module is the single frontend source of truth for the tier values, their
// human labels and the device capability lookup. It deliberately mirrors
// src/automations/completion-tier.ts so the UI never invents a fourth tier or a
// different ordering.

import { authFetch } from "./auth-fetch";
import { API_URL } from "./env";

/** The three acknowledgement levels, weakest to strongest. */
export type ConfirmationTier = "dispatch" | "acknowledged" | "observed";

/** Ordered weakest → strongest. Used for the picker order and ceiling comparisons. */
export const CONFIRMATION_TIERS: readonly ConfirmationTier[] = [
  "dispatch",
  "acknowledged",
  "observed",
] as const;

const TIER_RANK: Record<ConfirmationTier, number> = {
  dispatch: 0,
  acknowledged: 1,
  observed: 2,
};

/** Type guard for a value arriving from the API or from form state. */
export function isConfirmationTier(value: unknown): value is ConfirmationTier {
  return value === "dispatch" || value === "acknowledged" || value === "observed";
}

/** Ordinal for ceiling comparisons: dispatch < acknowledged < observed. */
export function tierRank(tier: ConfirmationTier): number {
  return TIER_RANK[tier];
}

/** Short label for a tier, for selects and badges. */
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

/** The device Capability_Ceiling reported by GET /api/devices/:id/completion-tiers. */
export interface CompletionTierCapability {
  deviceId: string;
  /** false when the device id does not resolve to a registered device. */
  resolved: boolean;
  /** Tiers the device can prove, weakest first. Empty when unresolved. */
  availableTiers: ConfirmationTier[];
  /** Strongest provable tier, or null when unresolved. */
  ceiling: ConfirmationTier | null;
}

/**
 * Look up a device's acknowledgement capability ceiling.
 *
 * Returns `null` when the ceiling cannot be established at all — the capability
 * accessor is not wired (501), the caller lacks device read (403), or the request
 * failed. Callers treat `null` as "unknown" and keep every tier selectable, because
 * the authoring endpoint accepts any valid tier regardless of the ceiling and the
 * command boundary clamps an over-request at dispatch time.
 *
 * A 404 is a *known* answer — the device id does not resolve — and comes back as
 * `{ resolved: false }` so the UI can say so rather than staying silent.
 */
export async function fetchCompletionTierCapability(
  deviceId: string,
): Promise<CompletionTierCapability | null> {
  try {
    const res = await authFetch(
      `${API_URL}/api/devices/${encodeURIComponent(deviceId)}/completion-tiers`,
    );
    if (res.status === 404) {
      return { deviceId, resolved: false, availableTiers: [], ceiling: null };
    }
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as Partial<CompletionTierCapability>;
    const availableTiers = Array.isArray(body.availableTiers)
      ? body.availableTiers.filter(isConfirmationTier)
      : [];
    return {
      deviceId,
      resolved: body.resolved === true,
      availableTiers,
      ceiling: isConfirmationTier(body.ceiling) ? body.ceiling : null,
    };
  } catch {
    return null;
  }
}

/**
 * True when the chosen tier is stronger than the device can prove, meaning the
 * command boundary will silently clamp it down at dispatch time. The UI warns about
 * this instead of blocking it, matching the server's accept-then-clamp behaviour.
 */
export function exceedsCeiling(
  chosen: ConfirmationTier,
  capability: CompletionTierCapability | null | undefined,
): boolean {
  if (!capability || !capability.resolved || capability.ceiling === null) return false;
  return tierRank(chosen) > tierRank(capability.ceiling);
}

/**
 * True when an automation's action can dispatch a device command, and therefore
 * when an acknowledgement level is meaningful. Script rules can dispatch device
 * actions from arbitrary Logic, so they always qualify. Raw publish, webhook, log
 * and delay actions have nothing to acknowledge.
 */
export function tierApplies(rule: { ruleType?: string; actionType?: string }): boolean {
  if (rule.ruleType === "script") return true;
  return rule.actionType === "device_action" || rule.actionType === "toggle";
}
