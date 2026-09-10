// frontend/src/sandbox/ui-kit/primitives.ts — the pieces every ui-kit module shares
//
// Split out so `command-proof.ts` can style and format without importing `index.ts`,
// which re-exports it: that cycle would resolve, but a module graph that only works
// because of hoisting order is not one to rely on for the platform's design tokens.
//
// Same constraint as the rest of the kit: pure values and pure functions only. No
// I/O, no host or SDK reference.

/** Aeolus theme colours, mirroring the Tailwind theme in `frontend/tailwind.config.js`. */
export const tokens = {
  color: {
    background: "#0B0F14",
    surface: "#121821",
    elevated: "#1A2330",
    primary: "#3BA4FF",
    accent: "#5CE1E6",
    success: "#22C55E",
    warning: "#F59E0B",
    error: "#EF4444",
    border: "#2A3441",
    text: "#E6EDF3",
    textSecondary: "#9AA6B2",
    textMuted: "#6B7785",
  },
  font: {
    sans: "Inter, system-ui, sans-serif",
    mono: "JetBrains Mono, monospace",
  },
} as const;

/** Rendered in place of a measurement that has not arrived yet or is not a number. */
export const NO_VALUE = "—";

/**
 * Coerce an automation state value to a finite number, or `null` when it is not
 * a reading at all.
 *
 * Deliberately stricter than `Number()`, which maps `null`, `""` and `[]` to `0`
 * and `true` to `1`. Rendering a missing reading as `0%` is a worse failure than
 * rendering a placeholder: it looks like a measurement. A numeric string is
 * accepted because state values cross a JSON boundary.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Narrow an unknown to a plain object, rejecting arrays and null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a string field, or `""` when it is absent or not a string. */
export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
