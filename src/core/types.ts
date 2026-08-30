// src/core/types.ts — Shared TypeScript interfaces for Aeolus


/** Device type — open string, not restricted to a fixed set */
export type DeviceType = string;

/**
 * Per-device generic MQTT command behaviour that is not derivable from topic
 * discovery alone (phase-1-runtime-foundations Req 2).
 *
 * Only meaningful for devices whose `integration === "mqtt"`. Persisted as
 * validated JSON on the device row so it survives restart. The canonical
 * command topic remains {@link Device.commandTopic}; this profile never
 * duplicates it.
 */
export interface MqttCommandProfile {
  /** MQTT QoS applied to device-command publishes. Omitted ⇒ current default. */
  qos?: 0 | 1 | 2;
  /** Acknowledgement configuration; absent/`supported:false` ⇒ dispatch-only. */
  acknowledgement?: {
    /** True when the device publishes an ack Aeolus can correlate. */
    supported: boolean;
    /** Response-topic override the device replies on. Concrete topic, never a wildcard. */
    responseTopic?: string;
    /** Ack-message field whose value confirms receipt (default "status"). */
    ackIndicatorField?: string;
    /** Values of the indicator field that count as acknowledgement. */
    ackIndicatorValues?: string[];
  };
}

/** Core domain entity representing any IoT device */
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  capabilities: string[];
  state: Record<string, unknown>;
  /** Connector type identifier (e.g. "hue", "kasa", "mqtt"). Not instance-specific. */
  integration: string;
  /**
   * The connector instance that owns this device. Absent for MQTT devices and
   * for connector devices discovered before instance ownership existed (they
   * reacquire it on the next discovery poll). Distinct from {@link integration},
   * which identifies only the connector type.
   */
  connectorInstanceId?: string;
  lastSeen: number;
  /** MQTT state topic, present for MQTT-sourced devices. */
  topic?: string;
  /** MQTT command topic used to send commands to the device. */
  commandTopic?: string;
  /**
   * Generic MQTT command profile (acknowledgement capability, QoS). Present
   * only for configured MQTT devices; absent ⇒ dispatch-only default behaviour.
   */
  mqttCommandProfile?: MqttCommandProfile;
}

/**
 * Origin kind of an event or command, used for provenance/causation metadata
 * (phase-1-runtime-foundations Req 5). Additive and descriptive only — a source
 * value received over an untrusted transport never grants authorization.
 */
export type EventSourceKind =
  | "mqtt-device"
  | "connector"
  | "automation"
  | "ui"
  | "cron"
  | "rest"
  | "system";

/**
 * Additive event identity and causation envelope shared by device events and
 * Automation Events (phase-1-runtime-foundations Req 5). Attached optionally so
 * existing `NormalizedEvent` / `EventContext` consumers remain source-compatible.
 */
export interface EventMetadata {
  /** Globally unique id for this specific event occurrence. */
  eventId: string;
  /** Event creation time (epoch ms). */
  timestamp: number;
  /** Where the event originated. */
  source: {
    kind: EventSourceKind;
    id?: string;
  };
  /** Id of the event/command that caused this one, when known. */
  causationId?: string;
  /** Transport/confirmation correlation id, when applicable. */
  correlationId?: string;
  /** Authoring automation rule id, when the source is an automation. */
  ruleId?: string;
  /** Automation execution id, when produced inside an execution. */
  executionId?: string;
  /** Root-of-chain id shared by all descendants of the first event in a chain. */
  traceId?: string;
  /** Causal hop count from the chain root; incremented per descendant. */
  depth?: number;
}

/** Internal event emitted after MQTT message normalization */
export interface NormalizedEvent {
  deviceId: string;
  deviceType: DeviceType;
  state: Record<string, unknown>;
  topic: string;
  timestamp: number;
  /** Source integration identifier. Defaults to "mqtt" if not provided. */
  integration?: string;
  /** Owning connector instance id, carried from discovery to the registry. */
  connectorInstanceId?: string;
  /** Human-readable device name populated from ParsedTopic.name */
  name?: string;
  /** Explicit capabilities from connectors (overrides inferCapabilities when provided) */
  capabilities?: string[];
  /** Explicit MQTT command topic when an integration provides one. */
  commandTopic?: string;
  /** Optional additive provenance/causation envelope (phase-1 Req 5). */
  meta?: EventMetadata;
}

/** Automation rule registered in the Rule Registry */
export interface Rule {
  id: string;
  topic: string;
  condition?: (context: EventContext) => boolean;
  action: (context: EventContext) => void | ActionResult | Promise<void | ActionResult>;
  name?: string;
  triggerType?: "mqtt" | "cron" | "none";
  cronExpression?: string;
  /** Compiled JavaScript for script rules; when present the engine dispatches through the sandbox. */
  compiled_js?: string;
}

/** Context passed to rule condition and action functions */
export interface EventContext {
  topic: string;
  deviceId: string;
  state: Record<string, unknown>;
  timestamp: number;
  /**
   * Optional additive provenance/causation envelope (phase-1 Req 5). Present
   * when the triggering event carried metadata (Automation Events always do;
   * device events do once event-metadata generation is wired in).
   */
  meta?: EventMetadata;
}

/** Command sent to an integration to control a device */
export interface Action {
  type: string;
  deviceId: string;
  params: Record<string, unknown>;
}

/** Request body for POST /api/devices/:id/action */
export interface ActionRequest {
  type: string;
  params?: Record<string, unknown>;
}

/**
 * Ordered lifecycle states a device command passes through.
 *
 * The reachable states depend on the target device's declared capabilities and
 * whether Confirmation_Options are supplied:
 *   REQUESTED    -> DISPATCHED | FAILED
 *   DISPATCHED   -> ACKNOWLEDGED | OBSERVED | TIMED_OUT | STATE_MISMATCH
 *   ACKNOWLEDGED -> OBSERVED | TIMED_OUT | STATE_MISMATCH
 * Completion success may be satisfied at DISPATCHED, ACKNOWLEDGED, or OBSERVED
 * depending on the requested tier. Only OBSERVED and failure outcomes are
 * lifecycle-final; DISPATCHED/ACKNOWLEDGED may advance if later evidence is tracked.
 */
export type CommandLifecycleState =
  | "REQUESTED"
  | "DISPATCHED"
  | "ACKNOWLEDGED"
  | "OBSERVED"
  | "FAILED"
  | "TIMED_OUT"
  | "STATE_MISMATCH";

/**
 * Optional confirmation of a command's physical effect.
 *
 * When supplied on a device action, the CommandService observes a device's
 * state (the target device by default, or `deviceId` when given) and only
 * reports success once `condition` evaluates truthy — advancing the command to
 * the OBSERVED state — or fails with TIMED_OUT / STATE_MISMATCH otherwise.
 */
export interface ConfirmOptions {
  /** Device to observe; defaults to the command's target device when omitted. */
  deviceId?: string;
  /** Predicate evaluated against the Observed_Device state. */
  condition: (state: Record<string, unknown>) => boolean;
  /** Timeout in ms before TIMED_OUT. Defaults to DEFAULT_CONFIRM_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Default confirmation timeout applied when ConfirmOptions omit timeoutMs (Req 5.7). */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 5000;

/**
 * Coarse cause of a failed command, set at the failure's source so the REST
 * layer can choose a truthful HTTP status without parsing error strings.
 */
export type CommandFailureKind =
  | "not_found"      // target (or observed) device does not exist
  | "unsupported"    // no handler, or action not in the device's catalog
  | "invalid_params" // action parameters failed validation
  | "transport"      // broker/connector unavailable (not connected, disabled, none)
  | "execution"      // connector handler threw while executing a valid command
  | "unauthorized";  // command is outside the authoring automation's authorization scope

/** Result returned by ConnectorManager.executeAction() and devices.action(). */
export interface ActionResult {
  /** Whether the action completed without error. Always a boolean, never undefined. */
  success: boolean;
  /** Connector-supplied data payload (e.g. energy readings). Present on success when the connector returns data. */
  data?: Record<string, unknown>;
  /** Human-readable error message. Present when success is false. */
  error?: string;
  /**
   * Command lifecycle state reached when this completion result was returned.
   * DISPATCHED/ACKNOWLEDGED may satisfy the selected completion tier without
   * being lifecycle-final; later evidence can advance a command that remains
   * under observation. Optional for backward compatibility.
   */
  lifecycleState?: CommandLifecycleState;
  /** Correlation id assigned at dispatch. Present for MQTT commands that correlate. */
  correlationId?: string;
  /**
   * Stable Aeolus identity for a Verified Command (phase-1 Req 1). Present on
   * every physical-command result produced by `CommandService` once the command
   * has been accepted into the pipeline. Distinct from {@link correlationId}:
   * `commandId` identifies the command, `correlationId` a confirmation exchange.
   * Optional at this shared boundary for compatibility with connector-local
   * results that exist below the command boundary.
   */
  commandId?: string;
  /** Coarse cause when success is false; drives the REST action route's HTTP status. */
  failureKind?: CommandFailureKind;
}

/** Result returned by devices.actionAll(). */
export interface BulkActionResult {
  /** Total number of devices the filter matched. */
  total: number;
  /** Number of individual actions that returned success: true. */
  succeeded: number;
  /** Number of individual actions that returned success: false. */
  failed: number;
  /** Per-device results. succeeded + failed === total always holds. */
  results: Array<{ deviceId: string } & ActionResult>;
  /** Whole-call validation/boundary failure before any device was dispatched. */
  error?: string;
}

/** Response shape for GET /api/health */
export interface HealthStatus {
  mqtt: "connected" | "disconnected";
  deviceCount: number;
  ruleCount: number;
  executionGate: { activeCount: number; queueDepths: Record<string, number> };
  uptime: number;
  timestamp: string;
}

/** Standard API error response */
export interface ApiError {
  error: string;
  statusCode: number;
}

/** WebSocket message types (server → client) */
export type WsMessage =
  | { type: "snapshot"; data: Record<string, Device> }
  | {
      type: "state-change";
      data: { deviceId: string; state: Record<string, unknown>; timestamp: number };
    };
