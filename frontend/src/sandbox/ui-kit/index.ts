// frontend/src/sandbox/ui-kit/index.ts — the `@aeolus/ui` module available to custom UIs
//
// Authored Automation Project UIs run inside the opaque-origin sandbox iframe and
// cannot import anything but React (see `virtualProjectPlugin` in
// src/automations/automation-project.ts). They also cannot use Tailwind classes:
// `frontend/tailwind.config.js` only scans `frontend/src`, so a class authored in
// a project is purged and silently renders as nothing. Custom UIs were therefore
// forced to hand-roll inline styles and literal hex colours, which is why the
// showcase drifted into inconsistent control styling and raw float output.
//
// This module closes that gap. It is exposed to the frame as the external
// specifier `@aeolus/ui` and deliberately contains NOTHING privileged: only pure
// functions, constants and style objects. It performs no I/O, holds no token, and
// reaches neither the host page nor the SDK, so making it importable widens what
// a custom UI can *express*, never what it can *do*.

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

// ── Control state ────────────────────────────────────────────────────────────

/**
 * How an operator control should present itself.
 *
 * - `available` — a real action the operator may take now.
 * - `current`   — the operating state the system is already in. Not an action;
 *                 it is rendered as the current mode rather than a second button
 *                 competing with the action next to it.
 * - `disabled`  — inappropriate for the current state. Must *look* unavailable,
 *                 not merely carry the HTML `disabled` attribute.
 * - `pending`   — requested and awaiting a physical outcome.
 * - `danger`    — available, but consequential.
 */
export type ControlState = "available" | "current" | "disabled" | "pending" | "danger";

/** Props to spread onto a `<button>`; carries styling and the matching semantics. */
export interface ControlVisual {
  style: Record<string, string | number>;
  disabled: boolean;
  "aria-pressed"?: boolean;
  "aria-busy"?: boolean;
}

const CONTROL_BASE: Record<string, string | number> = {
  fontFamily: tokens.font.sans,
  fontSize: 12,
  fontWeight: 600,
  padding: "7px 12px",
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: "solid",
  transition: "background-color 120ms, border-color 120ms, color 120ms",
};

/**
 * Resolve the presentation for one operator control.
 *
 * A disabled control is desaturated and loses its action border entirely, so the
 * current process state is readable from the controls alone without consulting a
 * telemetry header — an unavailable action must never look equally actionable
 * next to an available one.
 */
export function controlProps(state: ControlState): ControlVisual {
  switch (state) {
    case "available":
      return {
        style: {
          ...CONTROL_BASE,
          color: tokens.color.text,
          backgroundColor: "rgba(59, 164, 255, 0.12)",
          borderColor: "rgba(59, 164, 255, 0.55)",
          cursor: "pointer",
        },
        disabled: false,
      };

    case "current":
      // The state the system is in, not something to press. Filled so it reads as
      // a status chip, and marked pressed so assistive technology agrees.
      return {
        style: {
          ...CONTROL_BASE,
          color: tokens.color.background,
          backgroundColor: tokens.color.accent,
          borderColor: tokens.color.accent,
          cursor: "default",
        },
        disabled: true,
        "aria-pressed": true,
      };

    case "disabled":
      return {
        style: {
          ...CONTROL_BASE,
          color: tokens.color.textMuted,
          backgroundColor: "rgba(42, 52, 65, 0.35)",
          borderColor: "rgba(42, 52, 65, 0.9)",
          cursor: "not-allowed",
          opacity: 0.55,
        },
        disabled: true,
      };

    case "pending":
      return {
        style: {
          ...CONTROL_BASE,
          color: tokens.color.warning,
          backgroundColor: "rgba(245, 158, 11, 0.12)",
          borderColor: "rgba(245, 158, 11, 0.45)",
          cursor: "progress",
        },
        disabled: true,
        "aria-busy": true,
      };

    case "danger":
      return {
        style: {
          ...CONTROL_BASE,
          color: tokens.color.error,
          backgroundColor: "rgba(239, 68, 68, 0.12)",
          borderColor: "rgba(239, 68, 68, 0.55)",
          cursor: "pointer",
        },
        disabled: false,
      };
  }
}

/** Conditions a call site knows about, resolved into a single {@link ControlState}. */
export interface ControlConditions {
  /** A request is in flight and awaiting its physical outcome. */
  pending?: boolean;
  /** The action is inappropriate for the current state. */
  disabled?: boolean;
  /** The system is already in the state this control represents. */
  current?: boolean;
  /** The action is available but consequential. */
  danger?: boolean;
}

/**
 * Derive a control's state from what the call site knows, so a UI expresses
 * conditions rather than nesting ternaries over class strings.
 *
 * Precedence, strongest first: `pending`, `disabled`, `current`, `danger`. A
 * pending request outranks everything because the outcome is not yet known; an
 * inappropriate action outranks `current` so a control can never be presented as
 * the live mode and as unavailable at the same time.
 */
export function controlState(conditions: ControlConditions = {}): ControlState {
  if (conditions.pending) return "pending";
  if (conditions.disabled) return "disabled";
  if (conditions.current) return "current";
  if (conditions.danger) return "danger";
  return "available";
}

/** Shorthand for `controlProps(controlState(conditions))`. */
export function control(conditions: ControlConditions = {}): ControlVisual {
  return controlProps(controlState(conditions));
}

/**
 * Presentation for a control that switches a mode on and off.
 *
 * A toggle is not one of the {@link ControlState} values: `current` would mark it
 * disabled, but a switch that is on must stay pressable to turn it off. So it
 * stays actionable, carries `aria-pressed` to report the mode, and reads as
 * engaged when on — while a request in flight still presents as pending, so the
 * operator is never left pressing a switch whose outcome is unknown.
 */
export function toggleProps(on: boolean, conditions: { pending?: boolean; disabled?: boolean } = {}): ControlVisual {
  if (conditions.pending) return { ...controlProps("pending"), "aria-pressed": on };
  if (conditions.disabled) return { ...controlProps("disabled"), "aria-pressed": on };
  return {
    style: {
      ...CONTROL_BASE,
      color: on ? tokens.color.success : tokens.color.textSecondary,
      backgroundColor: on ? "rgba(34, 197, 94, 0.14)" : "rgba(42, 52, 65, 0.5)",
      borderColor: on ? "rgba(34, 197, 94, 0.55)" : tokens.color.border,
      cursor: "pointer",
    },
    disabled: false,
    "aria-pressed": on,
  };
}

// ── Number formatting ────────────────────────────────────────────────────────

/**
 * Coerce an automation state value to a finite number, or `null` when it is not
 * a reading at all.
 *
 * Deliberately stricter than `Number()`, which maps `null`, `""` and `[]` to `0`
 * and `true` to `1`. Rendering a missing reading as `0%` is a worse failure than
 * rendering a placeholder: it looks like a measurement. A numeric string is
 * accepted because state values cross a JSON boundary.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Format a value read from automation state as a fixed-precision number.
 *
 * Custom UIs read state with `aeolus.read()`, which is `unknown` and is
 * `undefined` until the first telemetry arrives, so every formatter here accepts
 * `unknown` and returns {@link NO_VALUE} rather than rendering `undefined` or a
 * raw float artefact such as `73.89999999999999`.
 */
export function formatNumber(value: unknown, decimals = 0): string {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return NO_VALUE;
  return numeric.toFixed(decimals);
}

/**
 * A quantity: whole, with thousands separators.
 *
 * Use for counts and volumes that can grow large. Instrument readings such as a
 * tachometer use {@link rpm}, which omits separators — `2378 rpm` is how the
 * gauge reads, whereas `12,500 L` is how a total is read.
 */
export function integer(value: unknown): string {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return NO_VALUE;
  return Math.round(numeric).toLocaleString();
}

/** A measurement to a fixed number of decimal places. */
export function decimal(value: unknown, decimals = 1): string {
  return formatNumber(value, decimals);
}

/** A percentage. Whole numbers by default — battery and level readings are never sub-percent. */
export function percent(value: unknown, decimals = 0): string {
  const formatted = formatNumber(value, decimals);
  return formatted === NO_VALUE ? formatted : `${formatted}%`;
}

/** A temperature in degrees Celsius, to one decimal place. */
export function temperature(value: unknown, decimals = 1): string {
  const formatted = formatNumber(value, decimals);
  return formatted === NO_VALUE ? formatted : `${formatted} °C`;
}

/**
 * A rotational speed. Always whole — a tachometer reading of 2378.4 is noise —
 * and without thousands separators, since it is an instrument reading.
 */
export function rpm(value: unknown): string {
  const formatted = formatNumber(value, 0);
  return formatted === NO_VALUE ? formatted : `${formatted} rpm`;
}

/** A depth or altitude in metres, whole by default. */
export function metres(value: unknown, decimals = 0): string {
  const formatted = formatNumber(value, decimals);
  return formatted === NO_VALUE ? formatted : `${formatted} m`;
}

/** A volumetric flow rate in litres per minute. */
export function flow(value: unknown, decimals = 1): string {
  const formatted = formatNumber(value, decimals);
  return formatted === NO_VALUE ? formatted : `${formatted} L/min`;
}

/** A volume in litres, whole. */
export function litres(value: unknown): string {
  const formatted = integer(value);
  return formatted === NO_VALUE ? formatted : `${formatted} L`;
}

/** A practical salinity reading, to two decimals. */
export function salinity(value: unknown, decimals = 2): string {
  const formatted = formatNumber(value, decimals);
  return formatted === NO_VALUE ? formatted : `${formatted} PSU`;
}

/** An electrical power reading in watts, whole and unseparated like the meter. */
export function watts(value: unknown): string {
  const formatted = formatNumber(value, 0);
  return formatted === NO_VALUE ? formatted : `${formatted} W`;
}

/** An electrical power reading in kilowatts, to two decimals. */
export function kilowatts(value: unknown, decimals = 2): string {
  const formatted = formatNumber(value, decimals);
  return formatted === NO_VALUE ? formatted : `${formatted} kW`;
}
