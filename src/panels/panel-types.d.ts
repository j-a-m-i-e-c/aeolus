/**
 * Aeolus Custom Panel — Type Definitions
 *
 * These types are available in the panel editor for writing custom dashboard components.
 * No imports needed — just start writing your component.
 */

/** An IoT device in the Aeolus device registry. */
interface Device {
  /** Unique device identifier. */
  id: string;
  /** Human-readable device name. */
  name: string;
  /** Device category. */
  type: "light" | "sensor" | "switch" | "climate" | "plug";
  /** List of device capabilities (e.g. "on/off", "brightness"). */
  capabilities: string[];
  /** Current device state as key-value pairs. */
  state: Record<string, unknown>;
  /** Source integration identifier (e.g. "mqtt", "hue", "kasa"). */
  integration: string;
  /** Unix timestamp of last state update. */
  lastSeen: number;
}

/**
 * Props passed to every Custom Panel component.
 *
 * These are provided automatically by the Aeolus runtime — just use them in your component.
 */
interface CustomPanelProps {
  /** All devices from the Aeolus device registry. */
  devices: Device[];
  /** This panel's unique identifier. */
  panelId: string;
  /** This panel's display name. */
  panelName: string;
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
  /** Live key-value state for this panel, updated via WebSocket. */
  state: Map<string, unknown>;
  /**
   * Write a key-value pair to this panel's state store.
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
 * export default function MyPanel(props: CustomPanelProps) {
 *   return <div>{props.panelName}</div>;
 * }
 * ```
 */
