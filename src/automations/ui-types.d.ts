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
   * Trigger a device action from the component.
   * @param deviceId - The target device ID.
   * @param actionType - The action to perform (e.g. "toggle", "setBrightness").
   * @param params - Optional parameters for the action.
   */
  deviceAction: (deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  /**
   * Publish an MQTT message from the component.
   * @param topic - The MQTT topic to publish to.
   * @param payload - The message payload as a string.
   */
  mqttPublish: (topic: string, payload: string) => void;
  /** The most recent execution log entries for this rule. */
  executionHistory: ExecutionEntry[];
  /** Live key-value state from the Automation State Store, updated via WebSocket. */
  state: Map<string, unknown>;
  /**
   * Write a key-value pair back to the Automation State Store.
   * The value is persisted to SQLite and broadcast to all connected clients.
   * @param key - The state key.
   * @param value - A JSON-serializable value.
   */
  stateSet: (key: string, value: unknown) => void;
}

// ── Minimal React type declarations for IntelliSense ──

declare namespace React {
  type ReactNode = string | number | boolean | null | undefined | ReactElement | ReactNode[];
  interface ReactElement {
    type: string | FC<any>;
    props: Record<string, unknown>;
    key: string | number | null;
  }
  type FC<P = {}> = (props: P) => ReactElement | null;
  function useState<T>(initialState: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  function useCallback<T extends (...args: any[]) => any>(callback: T, deps: unknown[]): T;
  function useMemo<T>(factory: () => T, deps: unknown[]): T;
  function useRef<T>(initialValue: T): { current: T };
}

declare namespace JSX {
  interface Element extends React.ReactElement {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

/**
 * Your component should be the default export:
 *
 * ```tsx
 * export default function MyComponent(props: CustomComponentProps) {
 *   return <div>{props.ruleName}</div>;
 * }
 * ```
 */
