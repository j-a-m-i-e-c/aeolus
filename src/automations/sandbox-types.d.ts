/**
 * Aeolus Sandbox API — Type Definitions
 *
 * These types are available as globals in your automation scripts.
 * No imports needed — just start writing.
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
 * Query and control devices in the Aeolus registry.
 *
 * All read methods (`get`, `list`, `filter`) return serialized snapshots —
 * they are safe to use and will not mutate the real device registry.
 */
declare const devices: {
  /**
   * Get a single device by its ID.
   * @param id - The unique device identifier.
   * @returns The matching device, or `undefined` if no device has that ID.
   */
  get(id: string): Device | undefined;

  /**
   * List every device currently registered in Aeolus.
   * @returns An array of all devices.
   */
  list(): Device[];

  /**
   * Filter devices using a predicate function.
   * @param predicate - A function that receives a device and returns `true` to include it.
   * @returns An array of devices that satisfy the predicate.
   */
  filter(predicate: (device: Device) => boolean): Device[];

  /**
   * Execute an action on a device through its connector.
   * @param deviceId - The target device ID.
   * @param actionType - The action to perform (e.g. "toggle", "setBrightness").
   * @param params - Optional parameters for the action.
   */
  action(deviceId: string, actionType: string, params?: Record<string, unknown>): Promise<void>;
};

/**
 * Publish messages to the Aeolus MQTT broker.
 */
declare const mqtt: {
  /**
   * Publish a message to an MQTT topic.
   * @param topic - The MQTT topic to publish to (e.g. "home/living-room/light/set").
   * @param payload - The message payload as a string.
   */
  publish(topic: string, payload: string): void;
};

/**
 * Structured logging from your automation script.
 *
 * Messages are tagged with the rule ID and appear in the Aeolus event log.
 */
declare const log: {
  /**
   * Log an informational message.
   * @param message - The message to log.
   */
  info(message: string): void;

  /**
   * Log a warning message.
   * @param message - The message to log.
   */
  warn(message: string): void;

  /**
   * Log an error message.
   * @param message - The message to log.
   */
  error(message: string): void;
};

/**
 * The event that triggered this automation.
 *
 * Contains the MQTT topic, device ID, device state snapshot,
 * and the timestamp when the event occurred.
 */
declare const context: {
  /** The MQTT topic or synthetic connector topic that fired. */
  topic: string;
  /** The device ID that triggered the event. */
  deviceId: string;
  /** The device state at the time of the event. */
  state: Record<string, unknown>;
  /** Unix timestamp (ms) when the event occurred. */
  timestamp: number;
};

/**
 * Query service state from automation scripts.
 *
 * Provides read-only access to running service instances.
 * Use `services.get()` to inspect a specific service's state,
 * or `services.list()` to enumerate all registered services.
 */
/**
 * Declare a structured automation with optional conditions and required actions.
 *
 * The trigger topic is configured separately in the pane UI — this call
 * only declares the conditions/actions logic. Conditions use AND logic —
 * all must return `true` for the actions to execute.
 *
 * Accepts arrays of named functions (preferred for visualization) or
 * single functions for backward compatibility.
 *
 * @param config - Object with optional `conditions` and required `actions`.
 */
declare function automation(config: {
  conditions?: Array<(ctx: typeof context) => boolean> | ((ctx: typeof context) => boolean);
  actions: Array<(ctx: typeof context) => void | Promise<void>> | ((ctx: typeof context) => void | Promise<void>);
}): void;

declare const services: {
  /**
   * Get a read-only snapshot of a service's current state.
   * @param serviceType - The service type identifier (e.g. "cron", "trigger", "system").
   * @returns The service state object, or `undefined` if the service is not running.
   */
  get(serviceType: string): Record<string, unknown> | undefined;

  /**
   * List all registered services with their current status.
   * @returns An array of service info objects.
   */
  list(): Array<{ type: string; displayName: string; running: boolean }>;
};
