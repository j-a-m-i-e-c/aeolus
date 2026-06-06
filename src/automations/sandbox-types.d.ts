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

/**
 * Make HTTP requests to external APIs from your automation scripts.
 *
 * Both methods return a promise that resolves to a simplified response object.
 * Requests have a 10-second timeout. Both HTTP and HTTPS URLs are allowed.
 *
 * **Security note:** Use HTTPS for external/internet APIs. Plain HTTP is fine
 * for local LAN services (localhost, 192.168.x, 10.x, etc.) but a warning
 * will be logged if plain HTTP is used for non-local URLs.
 *
 * @example
 * ```typescript
 * // GET a weather forecast (use HTTPS for external APIs)
 * const weather = await http.get("https://api.weather.com/current?city=London");
 * log.info(`Temperature: ${weather.body}`);
 *
 * // POST to a webhook
 * const result = await http.post("https://hooks.slack.com/services/...", {
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ text: "Automation fired!" }),
 * });
 * log.info(`Webhook responded: ${result.status}`);
 *
 * // HTTP is fine for local LAN services
 * const local = await http.get("http://192.168.1.50:8080/api/status");
 * ```
 */
declare const http: {
  /**
   * Send an HTTP GET request.
   * @param url - The URL to request.
   * @param options - Optional headers.
   * @returns A promise resolving to `{ status, body }`.
   */
  get(url: string, options?: { headers?: Record<string, string> }): Promise<{ status: number; body: string }>;

  /**
   * Send an HTTP POST request.
   * @param url - The URL to request.
   * @param options - Optional headers and body.
   * @returns A promise resolving to `{ status, body }`.
   */
  post(url: string, options?: { headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }>;
};

/**
 * Per-rule key-value state store for communicating between automation scripts
 * and custom UI components.
 *
 * Values are JSON-serializable (strings, numbers, booleans, arrays, plain objects).
 * State is persisted to SQLite and broadcast to the frontend via WebSocket on each `set()`.
 *
 * @example
 * ```typescript
 * // Store a computed average temperature
 * state.set("avgTemp", 22.5);
 *
 * // Read it back later
 * const avg = state.get("avgTemp"); // 22.5
 *
 * // Get all state for this rule
 * const all = state.getAll(); // { avgTemp: 22.5 }
 *
 * // Remove a key
 * state.delete("avgTemp");
 * ```
 */
declare const state: {
  /**
   * Retrieve a stored value for the current rule.
   * @param key - The state key to look up.
   * @returns The stored value, or `undefined` if the key does not exist.
   */
  get(key: string): unknown;

  /**
   * Store a key-value pair scoped to the current rule.
   * The value is persisted to SQLite and broadcast to connected frontends via WebSocket.
   * @param key - The state key.
   * @param value - A JSON-serializable value (string, number, boolean, array, or plain object).
   */
  set(key: string, value: unknown): void;

  /**
   * Retrieve all key-value pairs for the current rule.
   * @returns A plain object with all stored keys and values.
   */
  getAll(): Record<string, unknown>;

  /**
   * Delete a key-value pair for the current rule.
   * @param key - The state key to remove.
   */
  delete(key: string): void;
};

// ─── Data Store API ──────────────────────────────────────────────────────────

/** A timestamped record from a Data Store collection. */
interface DataStoreRecord {
  /** Auto-incremented record ID. */
  id: number;
  /** The collection this record belongs to. */
  collection: string;
  /** The JSON payload stored in this record. */
  payload: Record<string, unknown>;
  /** Key-value tags for filtering. */
  tags: Record<string, string>;
  /** Unix timestamp (ms) when the record was written. */
  timestamp: number;
}

/** Metadata about a Data Store collection. */
interface DataStoreCollectionMetadata {
  /** Collection name. */
  name: string;
  /** Optional description. */
  description: string | null;
  /** Retention policy in days, or null for keep forever. */
  retentionDays: number | null;
  /** Number of records in this collection. */
  recordCount: number;
  /** Timestamp of the oldest record, or null if empty. */
  oldestRecord: number | null;
  /** Timestamp of the newest record, or null if empty. */
  newestRecord: number | null;
  /** When the collection was created (epoch ms). */
  createdAt: number;
  /** When the collection was last updated (epoch ms). */
  updatedAt: number;
}

/** Options for writing a record to a Data Store collection. */
interface DataStoreWriteOptions {
  /** Key-value tags to attach to the record for filtering. */
  tags?: Record<string, string>;
  /** Explicit timestamp (epoch ms). Defaults to Date.now(). */
  timestamp?: number;
}

/** Options for querying records from a Data Store collection. */
interface DataStoreQueryOptions {
  /** Start of time range — duration string (e.g. "7d", "24h") or epoch ms. */
  from?: string | number;
  /** End of time range — epoch ms. Defaults to now. */
  to?: number;
  /** Maximum number of records to return. */
  limit?: number;
  /** Number of records to skip (for pagination). */
  offset?: number;
  /** Filter by tag key-value pairs (AND logic). */
  tags?: Record<string, string>;
  /** Aggregation function to apply. */
  aggregate?: "sum" | "avg" | "min" | "max" | "count";
  /** Payload field to aggregate over (required when aggregate is specified). */
  field?: string;
}

/** Result of a normal (non-aggregation) query. */
interface DataStoreQueryResult {
  /** Matching records ordered by timestamp descending. */
  records: DataStoreRecord[];
  /** Total matching records (before limit/offset). */
  total: number;
}

/** Result of an aggregation query. */
interface DataStoreAggregateResult {
  /** The computed aggregate value. */
  value: number;
}

/**
 * Persistent time-series and key-value storage for automation scripts.
 *
 * The `db` global provides access to the Aeolus Data Store — a SQLite-backed
 * storage system for accumulating structured data over time, sharing computed
 * values across automations, and querying historical records with aggregation.
 *
 * **Note:** The `db` global is only available when the Data Store is enabled.
 * If the Data Store has not been set up yet, `db` will be `undefined`.
 *
 * @example
 * ```typescript
 * // Write energy readings to a time-series collection
 * db.write("energy-daily", { kwh: 12.5, source: "solar" }, {
 *   tags: { zone: "roof" }
 * });
 *
 * // Query the last 7 days of readings
 * const result = db.query("energy-daily", { from: "7d" });
 * log.info(`Got ${result.total} records`);
 *
 * // Compute average energy over the last 30 days
 * const avg = db.query("energy-daily", {
 *   from: "30d",
 *   aggregate: "avg",
 *   field: "kwh"
 * });
 * log.info(`Average: ${avg.value} kWh`);
 *
 * // Use key-value buckets for cross-automation shared state
 * db.set("computed", "dailyAvgKwh", avg.value);
 * const stored = db.get("computed", "dailyAvgKwh"); // avg.value
 *
 * // List all collections
 * const collections = db.collections();
 * ```
 */
declare const db: {
  /**
   * Write a timestamped record to a collection.
   * If the collection doesn't exist, it will be auto-created.
   * @param collection - The collection name.
   * @param payload - A JSON object to store as the record payload.
   * @param options - Optional tags and explicit timestamp.
   */
  write(collection: string, payload: Record<string, unknown>, options?: DataStoreWriteOptions): void;

  /**
   * Query records from a collection with optional time range, filtering, pagination, and aggregation.
   * @param collection - The collection name.
   * @param options - Query options (from, to, limit, offset, tags, aggregate, field).
   * @returns An array of records with total count, or a single aggregate value.
   */
  query(collection: string, options?: DataStoreQueryOptions): DataStoreQueryResult | DataStoreAggregateResult;

  /**
   * Get a value from a key-value bucket.
   * @param bucket - The bucket name.
   * @param key - The key to look up.
   * @returns The stored value, or `undefined` if the key does not exist.
   */
  get(bucket: string, key: string): unknown;

  /**
   * Set a value in a key-value bucket. Creates the bucket implicitly if needed.
   * @param bucket - The bucket name.
   * @param key - The key to store under.
   * @param value - A JSON-serializable value.
   */
  set(bucket: string, key: string, value: unknown): void;

  /**
   * Delete a key from a key-value bucket.
   * @param bucket - The bucket name.
   * @param key - The key to remove.
   */
  delete(bucket: string, key: string): void;

  /**
   * List all existing collections with their metadata.
   * @returns An array of collection metadata objects.
   */
  collections(): DataStoreCollectionMetadata[];
} | undefined;
