/**
 * Aeolus Custom UI Component — Type Definitions
 *
 * These types are available in the UI editor for writing custom automation components.
 * No imports needed — just start writing your component.
 */

/** An IoT device in the Aeolus device registry. */
interface Device {
  /** Unique device identifier. */
  id: string;
  /** Human-readable device name. */
  name: string;
  /** Device category. */
  type: "light" | "sensor" | "switch" | "climate";
  /** List of device capabilities (e.g. "on/off", "brightness"). */
  capabilities: string[];
  /** Current device state as key-value pairs. */
  state: Record<string, unknown>;
  /** Source integration identifier (e.g. "mqtt", "hue", "kasa"). */
  integration: string;
  /** Unix timestamp of last state update. */
  lastSeen: number;
  /** MQTT state topic, present for MQTT-sourced devices. */
  topic?: string;
  /** MQTT command topic, when explicitly known. */
  commandTopic?: string;
}

/**
 * The outcome of a command issued from a UI via {@link CustomComponentProps.control}.
 *
 * `lifecycleState` is the rung the command actually reached, not the one it was
 * aiming for. A `success` of true means the command satisfied its required tier —
 * which for a device that can only be dispatched to means "it was sent", and for
 * one with an observable effect means the effect was observed.
 */
interface UiCommandResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  lifecycleState?:
    | "REQUESTED"
    | "DISPATCHED"
    | "ACKNOWLEDGED"
    | "OBSERVED"
    | "FAILED"
    | "TIMED_OUT"
    | "STATE_MISMATCH";
  correlationId?: string;
  /** Stable Aeolus id for a verified physical command. */
  commandId?: string;
  /** Coarse failure classification when `success` is false. */
  failureKind?: string;
}

/** A single execution log entry for an automation rule. */
interface ExecutionEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  triggerTopic: string;
  actions: Array<{ type: string; target: string; success: boolean; error?: string }>;
  duration: number;
  timestamp: number;
}

/**
 * Props passed to every custom automation UI component.
 *
 * These are provided automatically by the Aeolus runtime — just use them in your component.
 */
interface CustomComponentProps {
  /** All devices from the Aeolus device registry. */
  devices: Device[];
  /** The automation rule's unique identifier. */
  ruleId: string;
  /** The automation rule's display name. */
  ruleName: string;
  /** Unix timestamp of the most recent execution, or null if never fired. */
  lastFired: number | null;
  /** Whether the automation rule is currently enabled. */
  enabled: boolean;
  /**
   * Read a value from the shared state store.
   * Values are written by the Logic tab via `state.set()` and pushed in real-time via WebSocket.
   * @param key - The state key to read.
   * @returns The stored value, or undefined if the key does not exist.
   */
  read: (key: string) => unknown;
  /**
   * Persist a key-value pair to the Automation State Store.
   * The value is saved to SQLite and broadcast to all connected clients.
   * The Logic tab can read it on its next trigger via `state.get(key)`.
   * @param key - The state key.
   * @param value - A JSON-serializable value.
   */
  save: (key: string, value: unknown) => void;
  /**
   * Persist value to state store AND immediately fire the Logic tab with
   * topic "ui/{ruleId}/state-set" and state { key, value }.
   * @param key - The state key to persist.
   * @param value - A JSON-serializable value.
   */
  saveAndFire: (key: string, value: unknown) => void;
  /**
   * Fire the Logic tab script with a named UI event.
   *
   * Use this when the UI needs to delegate a decision to the Logic tab
   * rather than issuing a direct device command. The Logic tab receives
   * the event as `context.topic = "ui/{ruleId}/{eventName}"` with
   * `context.state` containing the payload.
   *
   * @param eventName - A short name for the event (e.g. "target-changed", "mode-selected").
   * @param payload - Optional data to pass to the Logic tab in `context.state`.
   */
  fire: (eventName: string, payload?: Record<string, unknown>) => void;
  /**
   * Control a device from the component, resolving with the command's outcome.
   *
   * Prefer `fire()` and let Logic own the command when the decision belongs to the
   * automation. Use this for a direct operator action, and read the result: a
   * command that was accepted is not a command that was proven.
   *
   * @param deviceId - The target device ID.
   * @param actionType - The action to perform (e.g. "toggle", "setBrightness").
   * @param params - Optional parameters for the action.
   */
  control: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<UiCommandResult>;
  /**
   * Send an MQTT message from the component.
   * @param topic - The MQTT topic to publish to.
   * @param payload - The message payload as a string.
   */
  publish: (topic: string, payload: string) => void;
  /** The most recent execution log entries for this rule. */
  history: ExecutionEntry[];
}

/**
 * Aeolus design tokens, control styling and number formatting.
 *
 * Provided by the UI sandbox, so it is the one module besides React a custom UI
 * may import. Tailwind classes are not available to custom UIs, so use these
 * tokens and style objects instead of literal colours.
 *
 * ```tsx
 * import { tokens, control, percent } from "@aeolus/ui";
 *
 * <button {...control({ disabled: pumpOn })} onClick={start}>Start pump</button>
 * <span style={{ color: tokens.color.textSecondary }}>{percent(level)}</span>
 * ```
 *
 * Mirrors frontend/src/sandbox/ui-kit/index.ts, which is the implementation.
 */
declare module "@aeolus/ui" {
  /** Aeolus theme colours and font stacks. */
  export const tokens: {
    color: {
      background: string;
      surface: string;
      elevated: string;
      primary: string;
      accent: string;
      success: string;
      warning: string;
      error: string;
      border: string;
      text: string;
      textSecondary: string;
      textMuted: string;
    };
    font: { sans: string; mono: string };
  };

  /** Rendered in place of a measurement that has not arrived or is not a number. */
  export const NO_VALUE: string;

  /**
   * How an operator control should present itself.
   *
   * - `available` — a real action the operator may take now.
   * - `current`   — the operating state the system is already in, not an action.
   * - `disabled`  — inappropriate for the current state, and visibly so.
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

  /** Conditions a call site knows about, resolved into a single ControlState. */
  export interface ControlConditions {
    pending?: boolean;
    disabled?: boolean;
    current?: boolean;
    danger?: boolean;
  }

  /** Resolve the presentation for one operator control. */
  export function controlProps(state: ControlState): ControlVisual;
  /** Derive a control's state from conditions. Precedence: pending, disabled, current, danger. */
  export function controlState(conditions?: ControlConditions): ControlState;
  /** Shorthand for `controlProps(controlState(conditions))`. */
  export function control(conditions?: ControlConditions): ControlVisual;
  /**
   * Presentation for a control that switches a mode on and off. Stays pressable
   * when on (unlike `current`) and reports the mode with `aria-pressed`.
   */
  export function toggleProps(
    on: boolean,
    conditions?: { pending?: boolean; disabled?: boolean },
  ): ControlVisual;

  /** Fixed-precision number. Returns NO_VALUE for anything non-numeric. */
  export function formatNumber(value: unknown, decimals?: number): string;
  /** Whole number with thousands separators. */
  export function integer(value: unknown): string;
  /** Fixed decimal places, one by default. */
  export function decimal(value: unknown, decimals?: number): string;
  /** Percentage, whole by default (`"73%"`). */
  export function percent(value: unknown, decimals?: number): string;
  /** Degrees Celsius, one decimal (`"12.4 °C"`). */
  export function temperature(value: unknown, decimals?: number): string;
  /** Rotational speed, always whole (`"2378 rpm"`). */
  export function rpm(value: unknown): string;
  /** Depth or altitude in metres, whole by default (`"420 m"`). */
  export function metres(value: unknown, decimals?: number): string;
  /** Volumetric flow (`"72.0 L/min"`). */
  export function flow(value: unknown, decimals?: number): string;
  /** Volume in litres, whole (`"1,000 L"`). */
  export function litres(value: unknown): string;
  /** Practical salinity, two decimals (`"35.12 PSU"`). */
  export function salinity(value: unknown, decimals?: number): string;
  /** Power in watts, whole (`"42 W"`). */
  export function watts(value: unknown): string;
  /** Power in kilowatts, two decimals (`"2.10 kW"`). */
  export function kilowatts(value: unknown, decimals?: number): string;

  // ── Command evidence ──

  /** What a single rung of a command's evidence ladder is saying. */
  export type CommandRungStatus = "reached" | "failed" | "pending";

  /** One step of a command's evidence ladder, ready to render. */
  export interface CommandRung {
    /** The lifecycle state, e.g. `OBSERVED`. */
    state: string;
    /** That state in operator language, e.g. "Effect observed". */
    label: string;
    status: CommandRungStatus;
    /** When the rung was reached, or `null` for one still expected. */
    at: number | null;
    /** The evidence recorded for this rung; empty when none was. */
    detail: string;
  }

  /** The one-line verdict for a command, honest about the tier it was held to. */
  export interface CommandVerdict {
    tier: string;
    settled: boolean;
    proven: boolean;
    /** Scaled to the tier: a dispatch-only success reads SENT, never OBSERVED. */
    headline: string;
    detail: string;
    clamped: boolean;
    clampNote: string;
  }

  /**
   * Build the evidence ladder for a command, from the value
   * `devices.commandEvidence()` produced and Logic projected.
   *
   * Every rung is one that actually happened. A single trailing `pending` rung
   * names the tier still being worked towards, which is recorded on the command
   * rather than guessed.
   */
  export function commandLadder(evidence: unknown): CommandRung[];

  /**
   * Summarise a command's evidence, or `null` when there is no command to
   * describe so a pane can render nothing rather than an empty verdict.
   */
  export function commandVerdict(evidence: unknown): CommandVerdict | null;

  /**
   * Render an observed-state condition as it would be read aloud, e.g.
   * `"measuredRpm ≥ 2000"`. Returns an empty string for anything unrecognised.
   */
  export function describeCondition(condition: unknown): string;
}

// ── Minimal React type declarations for IntelliSense ──

declare namespace React {
  type ReactNode = string | number | boolean | null | undefined | ReactElement | ReactNode[];
  interface ReactElement {
    type: string | FC<any>;
    props: Record<string, unknown>;
    key: string | number | null;
  }
  type FC<P = Record<string, unknown>> = (props: P) => ReactElement | null;
  function useState<T>(initialState: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  function useCallback<T extends (...args: any[]) => any>(callback: T, deps: unknown[]): T;
  function useMemo<T>(factory: () => T, deps: unknown[]): T;
  function useRef<T>(initialValue: T): { current: T };
}

declare namespace JSX {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Element extends React.ReactElement {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

/**
 * Your component should be the default export:
 *
 * ```tsx
 * export default function MyComponent(aeolus: CustomComponentProps) {
 *   const value = aeolus.read("myKey");
 *   return <div>{aeolus.ruleName} — {String(value)}</div>;
 * }
 * ```
 */
