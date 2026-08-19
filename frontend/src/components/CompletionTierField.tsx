// frontend/src/components/CompletionTierField.tsx — Acknowledgement level picker
//
// One control, reused by the Quick Rule form, the Script editor and (in compact form)
// the automation list, so an automation's acknowledgement level is set the same way
// everywhere. Maps to the `completionTier` field on the automation API.

import { AlertTriangle } from "lucide-react";
import {
  CONFIRMATION_TIERS,
  TIER_AUTO_DESCRIPTION,
  TIER_AUTO_LABEL,
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  exceedsCeiling,
  isConfirmationTier,
  type CompletionTierCapability,
} from "../lib/completion-tier";

interface CompletionTierFieldProps {
  /** Selected tier, or "" for "highest available (automatic)". */
  value: string;
  /** Receives the new tier, or "" when the author clears the choice. */
  onChange: (value: string) => void;
  /** DOM id, so the label and description associate correctly. */
  id: string;
  /**
   * The target device's capability ceiling. `undefined` means "not looked up",
   * `null` means "could not be determined" — both leave every tier selectable.
   */
  capability?: CompletionTierCapability | null;
  /** Extra note appended under the description (e.g. per-call override for scripts). */
  hint?: string;
  disabled?: boolean;
}

/**
 * Render the acknowledgement level select plus an explanation of the current choice.
 *
 * Every tier stays selectable even when the device cannot prove it: the authoring
 * endpoint accepts any valid tier and the command boundary clamps an over-request at
 * dispatch time. Blocking the choice here would misrepresent the contract, so the
 * field warns about the clamp instead.
 */
export function CompletionTierField({
  value,
  onChange,
  id,
  capability,
  hint,
  disabled,
}: CompletionTierFieldProps) {
  const selected = isConfirmationTier(value) ? value : null;
  const description = selected ? TIER_DESCRIPTIONS[selected] : TIER_AUTO_DESCRIPTION;
  const willClamp = selected !== null && exceedsCeiling(selected, capability);
  const unresolvedDevice = capability !== undefined && capability !== null && !capability.resolved;
  const descriptionId = `${id}-description`;

  /** True when the device is known and demonstrably cannot prove this tier. */
  const unavailable = (tier: (typeof CONFIRMATION_TIERS)[number]) =>
    !!capability && capability.resolved && !capability.availableTiers.includes(tier);

  return (
    <div>
      <label
        htmlFor={id}
        className="text-[10px] text-[#6B7785] uppercase tracking-wider block mb-1"
      >
        Acknowledgement level
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs bg-background border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary disabled:opacity-40"
      >
        <option value="">{TIER_AUTO_LABEL}</option>
        {CONFIRMATION_TIERS.map((tier) => (
          <option key={tier} value={tier}>
            {TIER_LABELS[tier]}
            {unavailable(tier) ? " — not supported by this device" : ""}
          </option>
        ))}
      </select>

      <p id={descriptionId} className="text-[10px] text-[#6B7785] mt-1">
        {description}
        {hint ? ` ${hint}` : ""}
      </p>

      {willClamp && capability?.ceiling && (
        <p className="flex items-start gap-1 text-[10px] text-[#F59E0B] mt-1">
          <AlertTriangle size={11} className="mt-[1px] shrink-0" />
          <span>
            This device can only prove &ldquo;{TIER_LABELS[capability.ceiling]}&rdquo;. Commands
            will report that level instead.
          </span>
        </p>
      )}

      {unresolvedDevice && (
        <p className="text-[10px] text-[#6B7785] mt-1">
          Target is not a registered device, so its supported levels are unknown.
        </p>
      )}
    </div>
  );
}
