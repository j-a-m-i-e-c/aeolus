// frontend/src/sandbox/rpc-types.ts — Shared RPC envelope, op schemas, and validation
// Used by both host (SdkBroker) and frame (sdk-client) to validate messages.

import type { Device } from "../store/device-store";

// ─── Entity and operation types ──────────────────────────────────────────────

/** Entities that can host a sandboxed component. */
export type EntityType = "automation" | "panel";

/**
 * Capability operations the SDK may request.
 * This list IS the allowlist — anything not listed is rejected.
 */
export type SdkOp =
  | "read"
  | "save"
  | "saveAndFire"
  | "fire"
  | "control"
  | "publish"
  | "subscribe";

/** The complete set of valid SDK operations for allowlist checking. */
export const SDK_OPS: ReadonlySet<string> = new Set<SdkOp>([
  "read",
  "save",
  "saveAndFire",
  "fire",
  "control",
  "publish",
  "subscribe",
]);

// ─── RPC message envelope types ──────────────────────────────────────────────

/** Fixed channel discriminator for all Aeolus SDK messages. */
export const RPC_CHANNEL = "aeolus-sdk" as const;

/** Direction: frame → host request. */
export interface RpcRequest {
  channel: typeof RPC_CHANNEL;
  kind: "request";
  /** Unique per frame; correlates the response. */
  id: string;
  op: SdkOp;
  /** Operation payload; shape validated per-op by the broker. */
  params: Record<string, unknown>;
}

/** Direction: host → frame response to a specific request. */
export interface RpcResponse {
  channel: typeof RPC_CHANNEL;
  kind: "response";
  /** Echoes RpcRequest.id. */
  id: string;
  ok: boolean;
  /** Present when ok === true. */
  result?: unknown;
  /** Present when ok === false. */
  error?: RpcError;
}

/** Direction: host → frame unsolicited event (state updates, prop updates). */
export interface RpcEvent {
  channel: typeof RPC_CHANNEL;
  kind: "event";
  event: "state" | "props";
  /** For "state": { key, value }. For "props": a partial PropsPayload patch. */
  data: Record<string, unknown>;
}

/** Direction: host → frame one-time bootstrap after handshake. */
export interface RpcInit {
  channel: typeof RPC_CHANNEL;
  kind: "init";
  entityType: EntityType;
  /** Compiled module source text fetched by the host via authFetch. */
  moduleSource: string;
  /** Initial props payload (devices, ids, history, etc.). */
  props: PropsPayload;
}

/** Direction: frame → host handshake (only message sent via window.postMessage). */
export interface RpcHandshake {
  channel: typeof RPC_CHANNEL;
  kind: "handshake";
}

/** Direction: host → frame acknowledgment (carries the MessagePort). */
export interface RpcAck {
  channel: typeof RPC_CHANNEL;
  kind: "ack";
}

/**
 * Direction: frame → host fatal error notification, sent via window.parent
 * (like the handshake) because a fatal load/render failure may occur before or
 * independently of the MessagePort. The host uses this to set an error status
 * and render the CustomComponentBoundary fallback.
 */
export interface RpcFatal {
  channel: typeof RPC_CHANNEL;
  kind: "fatal";
  message: string;
}

export type RpcMessage =
  | RpcRequest
  | RpcResponse
  | RpcEvent
  | RpcInit
  | RpcHandshake
  | RpcAck
  | RpcFatal;

// ─── Error codes ─────────────────────────────────────────────────────────────

export interface RpcError {
  code: RpcErrorCode;
  message: string;
}

export type RpcErrorCode =
  | "UNKNOWN_OP"
  | "BAD_SCHEMA"
  | "OP_FAILED"
  | "TIMEOUT"
  | "SANDBOX_DESTROYED";

// ─── Props payload ───────────────────────────────────────────────────────────

export interface ExecutionEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  triggerTopic: string;
  actions: Array<{ type: string; target: string; success: boolean; error?: string }>;
  duration: number;
  timestamp: number;
}

/** Full props payload sent at init, then partial patches via RpcEvent. */
export interface PropsPayload {
  entityType: EntityType;
  /** The rule or panel ID. */
  ruleId: string;
  /** The rule or panel display name. */
  ruleName: string;
  lastFired: number | null;
  enabled: boolean;
  devices: Device[];
  history: ExecutionEntry[];
  /** Initial state snapshot (key-value pairs from the automation state store). */
  state: Record<string, unknown>;
}

// ─── Validation helpers ──────────────────────────────────────────────────────

/**
 * Structural guard: checks that `raw` is a well-formed RpcRequest.
 * Returns true only if channel, kind, id (non-empty string), and op (in allowlist) are correct.
 * Does NOT validate params — use `validateParams` for that.
 */
export function isRpcRequest(raw: unknown): raw is RpcRequest {
  if (raw === null || typeof raw !== "object") return false;
  const message = raw as Record<string, unknown>;
  if (message.channel !== RPC_CHANNEL) return false;
  if (message.kind !== "request") return false;
  if (typeof message.id !== "string" || message.id.length === 0) return false;
  if (typeof message.op !== "string" || !SDK_OPS.has(message.op)) return false;
  if (message.params === null || typeof message.params !== "object" || Array.isArray(message.params)) return false;
  return true;
}

/**
 * Structural guard: checks that `raw` is a well-formed RpcHandshake.
 */
export function isRpcHandshake(raw: unknown): raw is RpcHandshake {
  if (raw === null || typeof raw !== "object") return false;
  const message = raw as Record<string, unknown>;
  return message.channel === RPC_CHANNEL && message.kind === "handshake";
}

/**
 * Structural guard: checks that `raw` is a well-formed RpcFatal.
 */
export function isRpcFatal(raw: unknown): raw is RpcFatal {
  if (raw === null || typeof raw !== "object") return false;
  const message = raw as Record<string, unknown>;
  return (
    message.channel === RPC_CHANNEL &&
    message.kind === "fatal" &&
    typeof message.message === "string"
  );
}

/** Validation result for per-op params checking. */
export interface ParamsValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validate `params` against the per-op schema.
 *
 * Rules:
 * - Required string fields must be non-empty strings.
 * - `value` must not be `undefined` (JSON-serializable check).
 * - Unknown extra keys are ignored.
 * - Returns `{ valid: true }` or `{ valid: false, message }`.
 */
export function validateParams(op: SdkOp, params: Record<string, unknown>): ParamsValidationResult {
  switch (op) {
    case "read":
      return requireNonEmptyString(params, "key");

    case "save":
    case "saveAndFire":
      return combineValidations([
        requireNonEmptyString(params, "key"),
        requireDefined(params, "value"),
      ]);

    case "fire":
      return combineValidations([
        requireNonEmptyString(params, "eventName"),
        optionalObject(params, "payload"),
      ]);

    case "control":
      return combineValidations([
        requireNonEmptyString(params, "deviceId"),
        requireNonEmptyString(params, "actionType"),
        optionalObject(params, "params"),
      ]);

    case "publish":
      return combineValidations([
        requireNonEmptyString(params, "topic"),
        requireString(params, "payload"),
      ]);

    case "subscribe":
      // No required params — idempotent subscription
      return { valid: true };

    default:
      return { valid: false, message: `Unknown op: ${op as string}` };
  }
}

// ─── Internal validation helpers ─────────────────────────────────────────────

function requireNonEmptyString(params: Record<string, unknown>, field: string): ParamsValidationResult {
  const value = params[field];
  if (typeof value !== "string" || value.length === 0) {
    return { valid: false, message: `'${field}' must be a non-empty string` };
  }
  return { valid: true };
}

function requireString(params: Record<string, unknown>, field: string): ParamsValidationResult {
  const value = params[field];
  if (typeof value !== "string") {
    return { valid: false, message: `'${field}' must be a string` };
  }
  return { valid: true };
}

function requireDefined(params: Record<string, unknown>, field: string): ParamsValidationResult {
  if (!(field in params) || params[field] === undefined) {
    return { valid: false, message: `'${field}' is required` };
  }
  return { valid: true };
}

function optionalObject(params: Record<string, unknown>, field: string): ParamsValidationResult {
  if (!(field in params) || params[field] === undefined) {
    return { valid: true }; // Optional field absent is fine
  }
  const value = params[field];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, message: `'${field}' must be an object if provided` };
  }
  return { valid: true };
}

function combineValidations(results: ParamsValidationResult[]): ParamsValidationResult {
  for (const result of results) {
    if (!result.valid) return result;
  }
  return { valid: true };
}
