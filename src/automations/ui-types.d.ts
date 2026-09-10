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
  /**
   * This automation's live command activity, newest first.
   *
   * Each entry grows as the command's lifecycle transitions are durably recorded, so
   * a pane can show a command climbing the evidence stages instead of only the
   * finished receipt Logic projects afterwards. Entries appear as the runtime records
   * them; nothing here is a client-side estimate of when a stage was reached.
   *
   * Shaped like the record `devices.commandEvidence()` returns, so it goes straight
   * into `commandProof()` or `<CommandProofCard>`:
   *
   * ```tsx
   * {aeolus.commands.map((command) => (
   *   <CommandProofCard key={String(commandProof(command)?.commandId)} evidence={command} />
   * ))}
   * ```
   *
   * It carries no capability snapshot, because a transition does not report one. A
   * command still in flight therefore shows its unreached stages as `not-recorded`
   * rather than claiming a ceiling nobody stated; the projected receipt explains them
   * once it settles. Prefer the projected receipt for the durable record of what was
   * proven, and this for showing that it is happening.
   */
  commands: unknown[];
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

  // ── Command Proof ──
  //
  // The scaffold is FIXED at four stages, whatever the command proved. An unreached
  // stage is still rendered and still says why, because a variable-length ladder
  // hides the capability gap that makes the model worth showing: a visitor can only
  // learn that OBSERVED exists, and that this device cannot reach it, if the stage
  // appears.

  /** The four canonical stages, in lifecycle order. */
  export const PROOF_STAGES: readonly ["REQUESTED", "DISPATCHED", "ACKNOWLEDGED", "OBSERVED"];

  export type ProofStage = "REQUESTED" | "DISPATCHED" | "ACKNOWLEDGED" | "OBSERVED";

  /**
   * What a stage is saying. The distinctions are load-bearing:
   *
   * - `reached`        — a transition recorded it.
   * - `pending`        — still expected; the command has not settled.
   * - `failed`         — this is where proof stopped.
   * - `unavailable`    — the hardware cannot do this (no ack capability).
   * - `not-required`   — it could have, but this command did not ask.
   * - `not-configured` — no observation contract was attached to this command.
   * - `not-reached`    — an earlier stage failed, so this never came up.
   * - `not-recorded`   — the command predates the capability snapshot.
   */
  export type ProofStageStatus =
    | "reached"
    | "pending"
    | "failed"
    | "unavailable"
    | "not-required"
    | "not-configured"
    | "not-reached"
    | "not-recorded";

  /** One stage of the fixed scaffold, ready to render. */
  export interface CommandProofStage {
    /** Canonical Aeolus term. Render verbatim, in brackets, to teach the model. */
    state: ProofStage;
    /** Bespoke line, e.g. "Flow meter reports litresPerMinute > 0". */
    label: string;
    status: ProofStageStatus;
    /** When the stage was reached, or `null`. */
    at: number | null;
    /** Supporting evidence, or `""`. */
    detail: string;
  }

  /** A command's proof, as one object a pane can render compactly or in full. */
  export interface CommandProof {
    /** What the operation was: the author's `evidence.intent`, else a fallback. */
    intent: string;
    /** The tier actually proven, or the failure. Never a bare "verified". */
    headline: string;
    /** Single-character status glyph. */
    mark: string;
    settled: boolean;
    proven: boolean;
    /** "Transfer Pump → Transfer Flow Meter", or just the actuator. */
    chain: string;
    /** Exactly four stages, REQUESTED first. */
    stages: CommandProofStage[];
    tier: string;
    /** The highest tier the command could have proven, or `""` when not recorded. */
    ceiling: string;
    clamped: boolean;
    clampNote: string;
    targetDeviceName: string;
    observedDeviceName: string;
    /** The observation contract read aloud, e.g. "litresPerMinute > 0", or `""`. */
    conditionText: string;
    commandId: string;
    executionId: string;
  }

  /**
   * Build the fixed four-stage proof from the value `devices.commandEvidence()`
   * produced and Logic projected. `null` when there is no command to describe, so a
   * pane renders nothing rather than a scaffold asserting a command that may not
   * exist.
   */
  export function commandProof(evidence: unknown): CommandProof | null;

  /**
   * Render an observed-state condition as it would be read aloud, e.g.
   * `"measuredRpm ≥ 2000"`. Returns an empty string for anything unrecognised.
   */
  export function describeCondition(condition: unknown): string;

  /** Presentation for one stage: a glyph plus the styles matching its status. */
  export interface ProofStageVisual {
    mark: string;
    style: Record<string, string | number>;
    /** Style for the canonical `(REQUESTED)` term rendered alongside the label. */
    termStyle: Record<string, string | number>;
  }

  /**
   * Resolve how a stage should look, so the statuses cannot come to mean different
   * things on different tabs. An inapplicable stage is muted, never an error cross:
   * a capability gap is information, not a fault.
   */
  export function proofStageProps(stage: CommandProofStage): ProofStageVisual;

  /** Style for a proof headline, matching the stage colours. */
  export function proofHeadlineProps(proof: CommandProof): Record<string, string | number>;

  export interface CommandProofCardProps {
    /**
     * The projected evidence record, straight from `aeolus.read(...)`. Passed raw so
     * a pane needs one line and cannot forget the null case. A prebuilt
     * {@link CommandProof} is accepted too.
     */
    evidence: unknown;
    /** Section heading. "Last command" suits a pane with several controls. */
    label?: string;
    /** Start expanded. Useful where the proof IS the pane's subject. */
    defaultExpanded?: boolean;
  }

  /**
   * Render what a command actually proved: the operation's name, the tier it
   * reached, the actuator → sensor chain, and the four-stage ladder behind a
   * toggle.
   *
   * The one component in the kit. It exists because eight panes were each carrying
   * a copy of the same proof block under a heading that named no action, which is
   * how the presentation drifted per tab. Renders `null` when there is no command,
   * so it can be mounted unconditionally.
   *
   * ```tsx
   * <CommandProofCard evidence={aeolus.read("lastCommand")} />
   * ```
   */
  export function CommandProofCard(props: CommandProofCardProps): JSX.Element | null;

  // ── Command Proof, grouped by execution ──
  //
  // The unit of proof for an operation that took more than one physical command.
  // Grouped on the executionId the platform already stamps, so the relationship is
  // projected rather than invented.

  /** Everything one automation execution proved. */
  export interface CommandExecutionProof {
    executionId: string;
    /**
     * What caused the execution, in human terms — `operator "start-cue"`,
     * `sensor/mine/gas` — or `""` when the records carry no trigger.
     */
    trigger: string;
    /** One proof per command, in the order they were issued. */
    commands: CommandProof[];
    count: number;
    /** True once every command in the group has stopped waiting. */
    settled: boolean;
    /** True only when every command settled AND proved the tier asked of it. */
    proven: boolean;
    /** How many proved their tier. */
    provenCount: number;
    /**
     * The group's standing, e.g. `"3 OF 3 PROVEN"`. Never a tier: commands that
     * reached different tiers have no single tier between them, and picking one
     * would misreport the others.
     */
    headline: string;
    mark: string;
    /** First request to last settlement, or `null` while unsettled. */
    durationMs: number | null;
    /** `"3 commands · 2.1 s"`, or `"3 commands"` when it has not settled. */
    summary: string;
  }

  /**
   * Build the grouped proof from the value `devices.executionEvidence()` produced.
   * A bare array of evidence records is accepted too. `null` when there is no
   * execution to describe.
   */
  export function commandExecutionProof(evidence: unknown): CommandExecutionProof | null;

  /**
   * Read the trigger off a command record or execution group, e.g.
   * `operator "start-cue"` or `sensor/mine/gas`. Empty string when nothing was
   * recorded — which is a real answer for commands predating trigger provenance.
   */
  export function describeTrigger(evidence: unknown): string;

  export interface CommandExecutionCardProps {
    /**
     * The projected group, straight from `aeolus.read(...)` of a
     * `devices.executionEvidence()` value. A prebuilt {@link CommandExecutionProof}
     * is accepted too.
     */
    evidence: unknown;
    /** Section heading. Defaults to "Execution". */
    label?: string;
    /** Expand every command's stages on mount. */
    defaultExpanded?: boolean;
  }

  /**
   * Render everything one operator action or one trigger actually proved: the cause,
   * the elapsed time, and each command with its own tier and hardware chain.
   *
   * Use this in place of {@link CommandProofCard} wherever one execution issues more
   * than one physical command. Keeping a single `lastCommand` in that case means the
   * last command overwrites the others and the pane reports half the operation while
   * looking complete.
   *
   * ```tsx
   * <CommandExecutionCard evidence={aeolus.read("lastExecution")} />
   * ```
   */
  export function CommandExecutionCard(props: CommandExecutionCardProps): JSX.Element | null;
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
