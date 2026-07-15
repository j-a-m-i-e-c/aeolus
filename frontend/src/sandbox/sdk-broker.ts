// frontend/src/sandbox/sdk-broker.ts — Host-side SDK broker for sandboxed custom UI components
//
// The broker owns one MessagePort per sandboxed frame. It validates every inbound
// message, scopes every privileged operation to the frame's immutable grant, and
// forwards state/props updates into the frame. It exposes NO token, NO authFetch,
// and NO generic-request function — the BrokerDeps functions are the entire
// privileged surface.

import {
  isRpcRequest,
  validateParams,
  RPC_CHANNEL,
  type EntityType,
  type SdkOp,
  type RpcRequest,
  type RpcResponse,
  type RpcEvent,
  type RpcErrorCode,
} from "./rpc-types";

// ─── Public interfaces ───────────────────────────────────────────────────────

/** Immutable capability grant for a single sandboxed frame. */
export interface FrameGrant {
  frameId: string;
  entityType: EntityType;
  /** The ONLY rule/panel id this frame may act on. Frame-supplied ids are ignored. */
  entityId: string;
  port: MessagePort;
}

/**
 * Dependencies injected into the broker — each pre-bound on the host side.
 * These functions perform the actual privileged effects (authFetch calls,
 * store mutations, MQTT publish). The broker never holds a token or fetch ref.
 */
export interface BrokerDeps {
  /** Execute a device action. */
  control: (entityId: string, deviceId: string, actionType: string, params?: Record<string, unknown>) => Promise<void>;
  /** Persist a state key-value pair for the entity. */
  save: (entityType: EntityType, entityId: string, key: string, value: unknown) => void;
  /** Persist state AND fire the logic tab. */
  saveAndFire: (entityType: EntityType, entityId: string, key: string, value: unknown) => void;
  /** Fire a named UI event with optional payload. */
  fire: (entityType: EntityType, entityId: string, eventName: string, payload?: Record<string, unknown>) => void;
  /** Publish an MQTT message. */
  publish: (topic: string, payload: string) => void;
  /** Read the latest cached state value for a key. */
  readState: (entityType: EntityType, entityId: string, key: string) => unknown;
  /** Subscribe to state changes for an entity; returns an unsubscribe function. */
  subscribeState: (entityType: EntityType, entityId: string, callback: (key: string, value: unknown) => void) => () => void;
}

// ─── Internal registration record ───────────────────────────────────────────

interface FrameRegistration {
  grant: FrameGrant;
  unsubscribeState: () => void;
  /** Handler reference for port.onmessage (needed for cleanup). */
  messageHandler: (event: MessageEvent) => void;
}

// ─── SdkBroker ───────────────────────────────────────────────────────────────

export class SdkBroker {
  private readonly deps: BrokerDeps;
  private readonly registrations = new Map<string, FrameRegistration>();

  constructor(deps: BrokerDeps) {
    this.deps = deps;
  }

  /** Register a frame with its immutable grant; wires the port's onmessage. */
  register(grant: FrameGrant): void {
    // If already registered (shouldn't happen), clean up first
    if (this.registrations.has(grant.frameId)) {
      this.unregister(grant.frameId);
    }

    const messageHandler = (event: MessageEvent) => {
      void this.handleMessage(grant, event.data);
    };

    grant.port.onmessage = messageHandler;

    // Subscribe to state changes for the granted entity and forward them
    const unsubscribeState = this.deps.subscribeState(
      grant.entityType,
      grant.entityId,
      (key: string, value: unknown) => {
        this.emitState(grant.frameId, key, value);
      },
    );

    this.registrations.set(grant.frameId, {
      grant,
      unsubscribeState,
      messageHandler,
    });
  }

  /** Tear down a frame: unsubscribe, reject pending, close port. */
  unregister(frameId: string): void {
    const registration = this.registrations.get(frameId);
    if (!registration) return;

    // Unsubscribe state listener
    registration.unsubscribeState();

    // Close the port (detaches onmessage and releases resources)
    registration.grant.port.onmessage = null;
    registration.grant.port.close();

    // Remove from registry
    this.registrations.delete(frameId);
  }

  /** Push a state change into a frame (called by the store subscription). */
  private emitState(frameId: string, key: string, value: unknown): void {
    const registration = this.registrations.get(frameId);
    if (!registration) return;

    const event: RpcEvent = {
      channel: RPC_CHANNEL,
      kind: "event",
      event: "state",
      data: { key, value },
    };

    registration.grant.port.postMessage(event);
  }

  /** Push a props patch into a frame (called when devices/history/enabled change). */
  emitProps(frameId: string, patch: Record<string, unknown>): void {
    const registration = this.registrations.get(frameId);
    if (!registration) return;

    const event: RpcEvent = {
      channel: RPC_CHANNEL,
      kind: "event",
      event: "props",
      data: patch,
    };

    registration.grant.port.postMessage(event);
  }

  /** Get the count of currently registered frames. */
  get size(): number {
    return this.registrations.size;
  }

  /** Check if a frame is registered. */
  has(frameId: string): boolean {
    return this.registrations.has(frameId);
  }

  // ─── Message handling ────────────────────────────────────────────────────

  /**
   * Validate and dispatch a single inbound message.
   * Pure enough to unit/property test with a fake port + spy deps.
   *
   * Algorithm:
   * 1. Structural validate (discard if invalid — no response sent).
   * 2. Validate params per-op schema → BAD_SCHEMA error if invalid.
   * 3. Execute the op via deps, ALWAYS using grant.entityId (never frame-supplied).
   * 4. Post exactly one RpcResponse echoing the request id.
   */
  async handleMessage(grant: FrameGrant, raw: unknown): Promise<void> {
    // Step 1: Structural validation — discard if not a valid request envelope
    if (!isRpcRequest(raw)) {
      return; // Silently discard (Req 4.4)
    }

    const request = raw as RpcRequest;

    // Step 2: Validate params against per-op schema
    const validation = validateParams(request.op, request.params);
    if (!validation.valid) {
      this.respond(grant.port, request.id, false, undefined, {
        code: "BAD_SCHEMA",
        message: validation.message || "Invalid params",
      });
      return;
    }

    // Step 3: Execute the op — ALWAYS scoped to grant.entityId
    try {
      const result = await this.executeOp(grant, request.op, request.params);
      // Step 4: Success response
      this.respond(grant.port, request.id, true, result);
    } catch (error) {
      // Step 4: Failure response
      const message = error instanceof Error ? error.message : "Operation failed";
      this.respond(grant.port, request.id, false, undefined, {
        code: "OP_FAILED",
        message,
      });
    }
  }

  /** Execute a validated op using deps, always scoped to the grant. */
  private async executeOp(
    grant: FrameGrant,
    op: SdkOp,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const { entityType, entityId } = grant;

    switch (op) {
      case "read":
        return this.deps.readState(entityType, entityId, params.key as string);

      case "save":
        this.deps.save(entityType, entityId, params.key as string, params.value);
        return undefined;

      case "saveAndFire":
        this.deps.saveAndFire(entityType, entityId, params.key as string, params.value);
        return undefined;

      case "fire":
        this.deps.fire(
          entityType,
          entityId,
          params.eventName as string,
          params.payload as Record<string, unknown> | undefined,
        );
        return undefined;

      case "control":
        await this.deps.control(
          entityId,
          params.deviceId as string,
          params.actionType as string,
          params.params as Record<string, unknown> | undefined,
        );
        return undefined;

      case "publish":
        this.deps.publish(params.topic as string, params.payload as string);
        return undefined;

      case "subscribe":
        // Idempotent — subscription is already active from register()
        return undefined;

      default:
        // Should never reach here due to isRpcRequest validation, but defend
        throw new Error(`Unhandled op: ${op as string}`);
    }
  }

  /** Post a response to a frame's port. */
  private respond(
    port: MessagePort,
    id: string,
    ok: boolean,
    result?: unknown,
    error?: { code: RpcErrorCode; message: string },
  ): void {
    const response: RpcResponse = {
      channel: RPC_CHANNEL,
      kind: "response",
      id,
      ok,
      ...(ok ? { result } : { error }),
    };
    port.postMessage(response);
  }
}
