// src/core/types.ts — Shared TypeScript interfaces for Aeolus

import type { ConfirmationTier } from "../automations/command-lifecycle.js";

/** Device type — open string, not restricted to a fixed set */
export type DeviceType = string;

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
  /** Author-chosen completion tier, when stored and valid. Absent ⇒ highest-available. */
  completionTier?: ConfirmationTier;
}

/** Context passed to rule condition and action functions */
export interface EventContext {
  topic: string;
  deviceId: string;
  state: Record<string, unknown>;
  timestamp: number;
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
 * Terminal success: DISPATCHED (dispatch-only), ACKNOWLEDGED (ack-only tier), OBSERVED.
 * Terminal failure: FAILED, TIMED_OUT, STATE_MISMATCH.
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
 * When supplied on a device action, the ActionExecutor observes a device's
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
  | "execution";     // connector handler threw while executing a valid command

/** Result returned by ConnectorManager.executeAction() and devices.action(). */
export interface ActionResult {
  /** Whether the action completed without error. Always a boolean, never undefined. */
  success: boolean;
  /** Connector-supplied data payload (e.g. energy readings). Present on success when the connector returns data. */
  data?: Record<string, unknown>;
  /** Human-readable error message. Present when success is false. */
  error?: string;
  /**
   * Final Command_Lifecycle state for this command.
   * Optional for backward compatibility — existing readers of success/data/error
   * are unaffected. Always populated by the verified-command-execution code path.
   */
  lifecycleState?: CommandLifecycleState;
  /** Correlation id assigned at dispatch. Present for MQTT commands that correlate. */
  correlationId?: string;
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
