/**
 * Aeolus Sandbox API — Type Definitions
 *
 * These types are available as globals in your automation scripts.
 * No imports needed — just start writing.
 */

type CommandLifecycleState =
  | "REQUESTED"
  | "DISPATCHED"
  | "ACKNOWLEDGED"
  | "OBSERVED"
  | "FAILED"
  | "TIMED_OUT"
  | "STATE_MISMATCH";

type CommandFailureKind =
  | "not_found"
  | "unsupported"
  | "invalid_params"
  | "transport"
  | "execution"
  | "unauthorized";

/** Result returned by device action calls. */
interface ActionResult {
  /** Whether the action completed without error. */
  success: boolean;
  /** Connector-supplied data payload. Present on success when the connector returns data. */
  data?: Record<string, unknown>;
  /** Human-readable error message. Present when success is false. */
  error?: string;
  /** Lifecycle state reached when this completion result was returned. */
  lifecycleState?: CommandLifecycleState;
  /** Stable Aeolus id for a verified physical command. */
  commandId?: string;
  /** Confirmation-exchange id when an MQTT acknowledgement/observation is correlated. */
  correlationId?: string;
  /** Coarse failure classification when success is false. */
  failureKind?: CommandFailureKind;
}

/** An IoT device in the Aeolus device registry. */
interface Device {
  /** Unique device identifier. */
  id: string;
  /** Human-readable device name. */
  name: string;
  /** Connector-defined device category. */
  type: string;
  /** List of device capabilities (e.g. "on/off", "brightness"). */
  capabilities: string[];
  /** Current device state as key-value pairs. */
  state: Record<string, unknown>;
  /** Source integration identifier (e.g. "mqtt", "hue", "kasa"). */
  integration: string;
  /** Connector instance that owns the device, when connector-backed. */
  connectorInstanceId?: string;
  /** Unix timestamp of last state update. */
  lastSeen: number;
  /** MQTT state topic, present for MQTT-sourced devices. */
  topic?: string;
  /** MQTT command topic, when explicitly known. */
  commandTopic?: string;
  /** Generic MQTT command/acknowledgement profile, when configured. */
  mqttCommandProfile?: {
    qos?: 0 | 1 | 2;
    acknowledgement?: {
      supported: boolean;
      responseTopic?: string;
      ackIndicatorField?: string;
      ackIndicatorValues?: string[];
    };
  };
}


/** Plain-data observed-state condition. Functions never cross the V8 boundary. */
type DeviceCondition =
  | { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; value: number | boolean }
  | { all: DeviceCondition[] }
  | { any: DeviceCondition[] };

/**
 * The evidence recorded for one rung of a command's lifecycle.
 *
 * Every field is optional because the rungs genuinely differ: the opening rung
 * states the contract the command must satisfy, a timeout restates it because that
 * is exactly what went unmet, and a dispatch has little to add beyond having
 * happened.
 */
interface CommandRungEvidence {
  /** The completion tier this command must reach to count as proven. */
  tier?: "dispatch" | "acknowledged" | "observed";
  /** Device whose observed state settles the question, when not the target. */
  observedDeviceId?: string;
  /** The condition that was waited for, as plain data. */
  condition?: Record<string, unknown>;
  /** Bound on the confirmation wait, in ms. */
  timeoutMs?: number;
  /** Short operator-facing account of why this rung was reached. */
  reason?: string;
}

/** One recorded lifecycle transition of a command. */
interface CommandRungRecord {
  fromState?: CommandLifecycleState;
  toState: CommandLifecycleState;
  /** Epoch ms the rung was reached. */
  timestamp: number;
  details?: CommandRungEvidence;
}

/**
 * A command and every rung it reached, as returned by
 * {@link devices.commandEvidence}.
 *
 * `terminalAt` marks that the command stopped waiting — either way. Do not read
 * `success` without it: an in-flight command has no verdict yet.
 */
interface CommandEvidenceRecord {
  commandId: string;
  /**
   * The automation execution that issued this command. Several commands sharing one
   * value are one operation; see {@link devices.executionEvidence}.
   */
  executionId?: string;
  /** What was asked of the device. */
  actionType: string;
  /** The tier the command was actually held to. */
  effectiveTier: "dispatch" | "acknowledged" | "observed";
  /** The tier the author asked for, when one was requested explicitly. */
  requestedTier?: "dispatch" | "acknowledged" | "observed";
  lifecycleState: CommandLifecycleState;
  success?: boolean;
  failureKind?: CommandFailureKind;
  error?: string;
  targetDeviceId: string;
  correlationId?: string;
  requestedAt: number;
  /** Set once the command stopped waiting. Absent while still in flight. */
  terminalAt?: number;
  /** The rungs, oldest first. */
  transitions: CommandRungRecord[];

  // ── Capability snapshot, frozen when the command was accepted ──
  //
  // What makes an unreached stage explainable. Without these, ACKNOWLEDGED simply
  // being absent could mean the device cannot acknowledge, that this command did not
  // require it, or that it was required and never came — three different stories.
  // Snapshotted rather than looked up, so editing a device profile later cannot
  // rewrite what an old command could have proven.
  //
  // All optional: a command recorded before this existed does not know, and absent
  // means "not recorded" — never `false`.

  /** The highest tier this command could have proven. */
  capabilityCeiling?: "dispatch" | "acknowledged" | "observed";
  /** Whether the target declared a correlated-acknowledgement capability. */
  ackAvailable?: boolean;
  /**
   * Whether THIS command carried an observation contract.
   *
   * `false` says this command had no observation to satisfy. It does NOT say the
   * effect is unobservable, nor that the site lacks a suitable sensor.
   */
  observationConfigured?: boolean;
  /** Device whose telemetry settles the question. May be the target itself. */
  observedDeviceId?: string;
  /** The observation contract as accepted. */
  conditionSpec?: Record<string, unknown>;
  /** Integration the command was handed to, e.g. "mqtt". Names the transport, not the device. */
  transportKind?: string;
  /** Target device's display name at acceptance, so old evidence still reads in human terms. */
  targetDeviceName?: string;
  /** Observing device's display name at acceptance. */
  observedDeviceName?: string;
  /** The author's `evidence.intent` for this command, sanitised. */
  intentLabel?: string;
  /** The author's `evidence.observedLabel` for this command, sanitised. */
  observedLabel?: string;

  // ── Trigger provenance, snapshotted when the command was accepted ──

  /**
   * Class of whatever triggered the execution, e.g. `"mqtt-device"`.
   *
   * Absent when the trigger carried no event metadata, which includes an operator
   * fire — so absence says nothing about whether there was a cause.
   */
  triggerKind?: string;
  /** The specific originator within that class, e.g. the triggering device's id. */
  triggerId?: string;
  /**
   * The subject the execution fired on. Recorded for every execution, so this is
   * the trigger field to rely on. An operator fire reads as `ui/<ruleId>/<eventName>`.
   */
  triggerTopic?: string;
}

/**
 * Every command one execution issued, as returned by
 * {@link devices.executionEvidence}.
 *
 * The unit of proof for an operation that took more than one physical command. A
 * cue that drives a lighting desk and then an effects rack is one thing the operator
 * did, and the commands reached different tiers for good reasons — render them as a
 * group so that reads as one operation rather than as unrelated activity.
 */
interface CommandExecutionEvidence {
  executionId: string;
  /** Trigger provenance for the execution, copied from its commands. */
  triggerKind?: string;
  triggerId?: string;
  triggerTopic?: string;
  /** The commands, oldest first. The order they were issued in is part of the story. */
  commands: CommandEvidenceRecord[];
}

/**
 * Author-supplied semantic context for a command.
 *
 * The narrow slice of a command record you get to write. Everything that decides
 * whether the command was *proven* — the lifecycle state, the tier, the devices, the
 * condition — is platform-owned and cannot be influenced from here, so a caption can
 * never dress a dispatch up as an observation.
 *
 * Both labels are trimmed, stripped of control characters and capped at 120
 * characters. They are captions, not narration.
 */
interface CommandEvidenceLabels {
  /** What this operation was, e.g. "Transfer 500 L" or "Recall stray livestock". */
  intent?: string;
  /** What a satisfied observation means, e.g. "Flow detected". */
  observedLabel?: string;
}

interface DeviceActionOptions {
  /** Device to observe (defaults to target device). */
  deviceId?: string;
  /** Declarative condition evaluated against observed state by the host. */
  condition?: DeviceCondition;
  /** Timeout in ms before TIMED_OUT (default 5000). */
  timeoutMs?: number;
  /** Per-call completion tier; omit to use the highest tier the device can prove. */
  tier?: "dispatch" | "acknowledged" | "observed";
  /**
   * Human labels recorded alongside the command so a receipt can say WHICH
   * operation it belongs to. Without this a pane with several buttons shows
   * evidence that names no action.
   */
  evidence?: CommandEvidenceLabels;
}

interface BulkActionResult {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<ActionResult & { deviceId: string }>;
  /** Whole-call validation/boundary failure before meaningful per-device dispatch. */
  error?: string;
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
   * @param confirm - Optional confirmation options to verify the physical effect.
   */
  action(
    deviceId: string,
    actionType: string,
    params?: Record<string, unknown>,
    confirm?: DeviceActionOptions,
  ): Promise<ActionResult>;

  /**
   * Read back what physically happened to a command THIS automation issued.
   *
   * Pass the `commandId` from an {@link ActionResult}. Returns the durable record
   * plus every lifecycle rung it reached, each with the evidence recorded for it —
   * the tier being aimed for, the condition waited on, the timeout applied, the
   * reason it ended.
   *
   * Synchronous: the rungs are already durable by the time `devices.action()`
   * resolves, so there is nothing to wait for.
   *
   * Returns `undefined` for a command this automation did not issue, an unknown
   * id, or an action that was never a verified physical command. Aeolus exposes
   * the standard history automatically from the Automation Pane's Evidence
   * inspector; call this lower-level API only when Logic itself needs to retain or
   * reason about a particular command's evidence.
   *
   * ```ts
   * const result = await devices.action(pump.id, "command", { on: true }, {
   *   tier: "observed",
   *   condition: { field: "litresPerMinute", op: "gt", value: 0 },
   * });
   * const proof = devices.commandEvidence(result.commandId);
   * if (proof?.lifecycleState === "OBSERVED") state.set("lastVerifiedAt", Date.now());
   * ```
   */
  commandEvidence(commandId?: string): CommandEvidenceRecord | undefined;

  /**
   * Read back every physical command THIS execution issued, with what triggered it.
   *
   * Use this instead of {@link commandEvidence} when one trigger causes more than one
   * physical action. Keeping a single `lastCommand` means the last command overwrites
   * the others, so a cue that moved a lighting desk AND fired an effects rack reports
   * only half of what it did.
   *
   * Takes no argument in the normal case: the running execution is resolved by the
   * host. Pass an `executionId` to read back an earlier one. Either way you see only
   * executions of your own automation.
   *
   * Synchronous, and like `commandEvidence` it reads what is already durable — so
   * call it after the actions you want it to include have resolved.
   *
   * Returns `undefined` outside an execution, or when the execution issued no
   * physical commands. The Automation Pane Evidence inspector groups durable
   * command history by execution automatically; use this lower-level read when
   * Logic has a domain-specific reason to inspect the group itself.
   *
   * ```ts
   * await runLightingCue(scene, master, transitionMs, label);
   * await runPhysicalEffect(effect, pulseMs, label);
   * const proof = devices.executionEvidence();
   * state.set("physicalCommandCount", proof?.commands.length ?? 0);
   * ```
   */
  executionEvidence(executionId?: string): CommandExecutionEvidence | undefined;

  /**
   * Execute an action against every scoped device matching `predicate`. The
   * predicate runs inside the isolate; only matched IDs and plain JSON cross
   * the host boundary.
   */
  actionAll(
    predicate: (device: Device) => boolean,
    actionType: string,
    params?: Record<string, unknown>,
    confirm?: DeviceActionOptions,
  ): Promise<BulkActionResult>;
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
 * Emit a constrained automation-to-automation domain event over Aeolus's
 * reserved MQTT event namespace. The source rule id and causal metadata are
 * derived by the host and cannot be spoofed by the script.
 */
declare const events: {
  emit(name: string, payload?: unknown): {
    published: boolean;
    eventId?: string;
    topic?: string;
    error?: string;
  };
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
 * Automation Project entry functions may use this type directly:
 * `export default async function run(context: EventContext) { ... }`.
 */
type EventSourceKind =
  | "mqtt-device"
  | "connector"
  | "automation"
  | "ui"
  | "cron"
  | "rest"
  | "system";

interface EventMetadata {
  eventId: string;
  timestamp: number;
  source: { kind: EventSourceKind; id?: string };
  causationId?: string;
  correlationId?: string;
  ruleId?: string;
  executionId?: string;
  traceId?: string;
  depth?: number;
  /**
   * Present only when a `shared-state` trigger fired, naming the durable value
   * that changed.
   *
   * A Shared State trigger deliberately does not impersonate device state:
   * `context.deviceId` is empty and `context.topic` is the `<bucket>/<key>` path,
   * so this is where the bucket and key are stated plainly.
   *
   * Check `deleted` rather than testing `context.state` for emptiness — `null` is a
   * perfectly legitimate Shared State value, so a removed key and a key holding
   * `null` are different facts.
   *
   * ```typescript
   * const changed = context.meta?.sharedState;
   * if (changed?.deleted) {
   *   log.info(`${changed.bucket}/${changed.key} was removed`);
   * }
   * ```
   */
  sharedState?: {
    /** The bucket (namespace) the changed value lives in. */
    bucket: string;
    /** The key within that bucket. */
    key: string;
    /** `true` when the value was removed rather than written. */
    deleted: boolean;
    /** Who wrote it: an automation, the admin API, or Aeolus itself. */
    source:
      | { kind: "automation"; id: string; executionId?: string }
      | { kind: "api"; userId?: string }
      | { kind: "system"; id: string };
  };
}

interface EventContext {
  /** The MQTT topic or synthetic connector topic that fired. */
  topic: string;
  /** The device ID that triggered the event. */
  deviceId: string;
  /** The device state at the time of the event. */
  state: Record<string, unknown>;
  /** Unix timestamp (ms) when the event occurred. */
  timestamp: number;
  /** Optional provenance/causation envelope for this event. */
  meta?: EventMetadata;
}

/** The event that triggered this automation. */
declare const context: EventContext;

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
  /** Continue invoking later actions after a logical device-command failure. */
  continueOnFailure?: boolean;
}): Promise<void>;

/**
 * Make HTTP requests to external APIs from your automation scripts.
 *
 * Both methods return a promise that resolves to a simplified response object.
 * Requests are limited to public HTTP/HTTPS destinations, have a 10-second
 * timeout, do not follow redirects, and have bounded request/response bodies.
 * Localhost, private/LAN, link-local, metadata and reserved destinations are
 * rejected by the host policy.
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
  /** Maximum number of records to return, newest first. */
  limit?: number;
  /** Number of records to skip (for pagination). */
  offset?: number;
  /**
   * Return up to this many records spread across the whole matching range,
   * instead of the newest `limit`.
   *
   * `limit` answers "the most recent N observations", so on a dense collection a
   * 30-day range comes back holding only its most recent few days. `maxPoints`
   * divides the range into equal buckets and returns one stored record from each,
   * which is what a series over an interval needs. Takes precedence over `limit`
   * and `offset`.
   */
  maxPoints?: number;
  /** Filter by tag key-value pairs (AND logic). */
  tags?: Record<string, string>;
  /** Aggregation function to apply. */
  aggregate?: "sum" | "avg" | "min" | "max" | "count";
  /** Payload field to aggregate over (required when aggregate is specified). */
  field?: string;
}

/** How a `maxPoints` query divided the range. */
interface DataStoreRangeSampling {
  /** Width of each bucket, in ms. */
  bucketMs: number;
  /** Inclusive start of the bucketed range. */
  from: number;
  /** Inclusive end of the bucketed range. */
  to: number;
}

/** Result of a normal (non-aggregation) query. */
interface DataStoreQueryResult {
  /** Matching records ordered by timestamp descending. */
  records: DataStoreRecord[];
  /** Total matching records (before limit/offset). */
  total: number;
  /**
   * Present only when a `maxPoints` query had to sample the range. Absent means
   * every matching record was returned, which is the difference between "one point
   * per 43 minutes" and "every observation".
   */
  sampling?: DataStoreRangeSampling;
}

/** Result of an aggregation query. */
interface DataStoreAggregateResult {
  /** The computed aggregate value. */
  value: number;
}

/**
 * Durable current values intentionally shared between automations.
 *
 * Shared State is how one automation tells the others what is true *now*. A
 * subsystem writes its current summary; whoever composes an overview reads it, or
 * is triggered by it. Values survive a backend restart.
 *
 * Use Shared State when the newest value is what matters:
 *
 * ```text
 * shared.set("bunker-summary", "power", { battery, solar, load, net })
 * ```
 *
 * Do NOT use `events.emit()` for that. An Automation Event means "this happened" —
 * every occurrence matters, it cannot be safely collapsed, and it is visible on
 * MQTT. A current snapshot sent as an event gives it occurrence semantics it does
 * not have and puts internal composition traffic on the broker.
 *
 * Three properties worth knowing:
 *
 * - **Identical writes are free.** Setting the value a key already holds performs
 *   no write and triggers nothing. `set()` returns whether anything changed, so a
 *   projection can recompute on every tick without cost.
 * - **A change can trigger automations.** Pick the `shared-state` trigger type and
 *   a path pattern such as `bunker-summary/#`. Pending work for one key is
 *   coalesced keep-latest, because the durable value already holds the newest
 *   truth.
 * - **It is not history.** Writing 72, 73, 74 leaves 74. If you need the series,
 *   write a Data Store Collection record alongside.
 *
 * Bucket and key names address a value reactively as `<bucket>/<key>`, so they may
 * not contain `/`, `+` or `#`.
 *
 * **Note:** `shared` is available to unrestricted (admin-authored) automations.
 * A tab-scoped automation cannot reach global Shared State — there is no
 * bucket-to-tab ownership model yet — and `shared` is `undefined` if no Shared
 * State store is wired.
 *
 * @example
 * ```typescript
 * // A subsystem publishes its current summary.
 * shared.set("bunker-summary", "power", {
 *   battery, solar, load, net, generatorOn,
 * });
 *
 * // An overview reads every subsystem's current value, whichever one woke it.
 * const power = shared.get("bunker-summary", "power");
 * const air = shared.get("bunker-summary", "air");
 *
 * // Keep the history separately, when you actually want it.
 * db?.write("bunker-power-history", { battery, solar });
 * ```
 */
declare const shared: {
  /**
   * Read the current shared value.
   * @param bucket - The bucket (namespace) name.
   * @param key - The key within that bucket.
   * @returns The stored value, or `undefined` when the key is not set. A stored
   * `null` is returned as `null`, which is distinct from not being set.
   */
  get(bucket: string, key: string): unknown;

  /**
   * Write the current shared value. Creates the bucket implicitly.
   *
   * @param bucket - The bucket (namespace) name. No `/`, `+` or `#`.
   * @param key - The key within that bucket. No `/`, `+` or `#`.
   * @param value - A JSON-serializable value, up to 64 KiB serialized.
   * @returns `true` when the stored value actually changed — and therefore when
   * interested `shared-state` automations were triggered. `false` means the value
   * was already exactly this, so nothing was written and nothing ran.
   */
  set(bucket: string, key: string, value: unknown): boolean;

  /**
   * Remove a shared value.
   * @returns `true` when an entry was actually removed.
   */
  delete(bucket: string, key: string): boolean;
} | undefined;

/**
 * Persistent historical time-series storage for automation scripts.
 *
 * The `db` global provides access to the Aeolus Data Store — a SQLite-backed
 * store for accumulating structured observations over time and querying them with
 * ranges and aggregation.
 *
 * **Note:** The `db` global is only available when the Data Store is enabled.
 * If the Data Store has not been set up yet, `db` will be `undefined`. Historical
 * accumulation is optional because it grows without bound; use `shared` for
 * durable current values, which is always available.
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
 * // Cross-automation shared state belongs in `shared`, not here.
 * shared.set("computed", "dailyAvgKwh", avg.value);
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
   * Read a Shared State value.
   *
   * @deprecated Use `shared.get(bucket, key)`. This alias reads the same durable
   * Shared State, but it is only present while the historical Data Store is
   * enabled — which has nothing to do with whether a shared current value exists.
   * @param bucket - The bucket name.
   * @param key - The key to look up.
   * @returns The stored value, or `undefined` if the key does not exist.
   */
  get(bucket: string, key: string): unknown;

  /**
   * Write a Shared State value.
   *
   * @deprecated Use `shared.set(bucket, key, value)`.
   * @param bucket - The bucket name.
   * @param key - The key to store under.
   * @param value - A JSON-serializable value.
   * @returns `true` when the stored value actually changed.
   */
  set(bucket: string, key: string, value: unknown): boolean;

  /**
   * Remove a Shared State value.
   *
   * @deprecated Use `shared.delete(bucket, key)`.
   * @param bucket - The bucket name.
   * @param key - The key to remove.
   * @returns `true` when an entry was actually removed.
   */
  delete(bucket: string, key: string): boolean;

  /**
   * List all existing collections with their metadata.
   * @returns An array of collection metadata objects.
   */
  collections(): DataStoreCollectionMetadata[];
} | undefined;
