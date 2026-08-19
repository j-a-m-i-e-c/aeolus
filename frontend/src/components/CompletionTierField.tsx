// frontend/src/components/CompletionTierField.tsx — Acknowledgement level picker
//
// The single control for an automation's required acknowledgement level, used by the
// authoring panel. It maps to the `completionTier` field on the automation API.
//
// Every tier stays selectable regardless of the target device: a script dispatches to
// arbitrary devices, the authoring endpoint accepts any valid tier, and the command
// boundary clamps an over-request down to what the device can actually prove at
// dispatch time. Blocking a choice here would misrepresent that contract.

import {
  CONFIRMATION_TIERS,
  TIER_AUTO_DESCRIPTION,
  TIER_AUTO_LABEL,
  TIER_DESCRIPTIONS,
  TIER_LABELS,
  isConfirmationTier,
} from "../lib/completion-tier";

interface CompletionTierFieldProps {
  /** Selected tier, or "" for "highest available (automatic)". */
  value: string;
  /** Receives the new tier, or "" when the author clears the choice. */
  onChange: (value: string) => void;
  /** DOM id, so the label and description associate correctly. */
  id: string;
  /** Extra note appended under the description. */
  hint?: string;
  disabled?: boolean;
}

/** Render the acknowledgement level select plus an explanation of the current choice. */
export function CompletionTierField({
  value,
  onChange,
  id,
  hint,
  disabled,
}: CompletionTierFieldProps) {
  const selected = isConfirmationTier(value) ? value : null;
  const description = selected ? TIER_DESCRIPTIONS[selected] : TIER_AUTO_DESCRIPTION;
  const descriptionId = `${id}-description`;

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
        className="w-full text-xs bg-surface border border-[#2A3441] rounded px-2 py-1.5 text-[#E6EDF3] focus:outline-none focus:border-primary disabled:opacity-40"
      >
        <option value="">{TIER_AUTO_LABEL}</option>
        {CONFIRMATION_TIERS.map((tier) => (
          <option key={tier} value={tier}>
            {TIER_LABELS[tier]}
          </option>
        ))}
      </select>

      <p id={descriptionId} className="text-[10px] text-[#6B7785] mt-1">
        {description}
        {hint ? ` ${hint}` : ""}
      </p>
    </div>
  );
}
