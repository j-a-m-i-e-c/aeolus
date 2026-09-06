// frontend/src/sandbox/runtime/sdk-client.ts — Aeolus UI SDK client (runs INSIDE the frame)
//
// The ONLY interface custom code (through the compatibility shim) uses to reach
// Aeolus. It owns the frame's dedicated MessagePort, correlates request/response
// pairs by id, applies a per-request timeout, mirrors state/props locally so
// `read`/`getProps` are synchronous, and dispatches inbound events to listeners.
//
// It exposes NO raw token, NO authFetch, and NO generic-request function.

import {
  RPC_CHANNEL,
  type SdkOp,
  type RpcRequest,
  type RpcResponse,
  type RpcEvent,
  type PropsPayload,
  type CommandResult,
} from "../rpc-types";

/** Default per-request timeout (ms). Requirement 7.2 bound on RPC overhead. */
const DEFAULT_TIMEOUT_MS = 8000;

/** The capability-scoped SDK surface exposed to the compatibility shim. */
export interface AeolusUiSdk {
  /** Read the latest known value for a state key (from the local mirror). */
  read(key: string): unknown;
  /** Persist a key/value for this entity. */
  save(key: string, value: unknown): Promise<void>;
  /** Persist and fire the logic tab (state-set). */
  saveAndFire(key: string, value: unknown): Promise<void>;
  /** Fire a named UI event with optional payload. */
  fire(eventName: string, payload?: Record<string, unknown>): Promise<void>;
  /** Control a device; resolves with the command's outcome once the host completes it. */
  control(deviceId: string, actionType: string, params?: Record<string, unknown>): Promise<CommandResult>;
  /** Publish an MQTT message. */
  publish(topic: string, payload: string): Promise<void>;
  /** Subscribe to state changes for this entity. Returns an unsubscribe fn. */
  subscribeState(listener: (key: string, value: unknown) => void): () => void;
  /** Subscribe to props patches. Returns an unsubscribe fn. */
  subscribeProps(listener: (patch: Partial<PropsPayload>) => void): () => void;
  /** The most recent full props payload (synchronously available after init). */
  getProps(): PropsPayload;
  /** Detach listeners and reject pending requests (called on teardown). */
  dispose(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Create the SDK client bound to a MessagePort and an initial props payload.
 * `read`/`getProps` are served synchronously from local mirrors kept current by
 * inbound `state`/`props` events.
 */
export function createSdkClient(
  port: MessagePort,
  initialProps: PropsPayload,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): AeolusUiSdk {
  const pending = new Map<string, PendingRequest>();
  const stateMirror = new Map<string, unknown>(
    Object.entries(initialProps.state ?? {}),
  );
  let propsSnapshot: PropsPayload = initialProps;

  const stateListeners = new Set<(key: string, value: unknown) => void>();
  const propsListeners = new Set<(patch: Partial<PropsPayload>) => void>();

  let idCounter = 0;
  const generateId = (): string => {
    idCounter += 1;
    return `req-${idCounter}-${Math.random().toString(36).slice(2, 10)}`;
  };

  function handlePortMessage(event: MessageEvent): void {
    const message = event.data as RpcResponse | RpcEvent | undefined;
    if (!message || message.channel !== RPC_CHANNEL) return;

    if (message.kind === "response") {
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.ok) {
        entry.resolve(message.result);
      } else {
        const code = message.error?.code ?? "OP_FAILED";
        const detail = message.error?.message ?? "Operation failed";
        entry.reject(new Error(`${code}: ${detail}`));
      }
      return;
    }

    if (message.kind === "event") {
      if (message.event === "state") {
        const { key, value } = message.data as { key: string; value: unknown };
        stateMirror.set(key, value);
        for (const listener of stateListeners) listener(key, value);
      } else if (message.event === "props") {
        const patch = message.data as Partial<PropsPayload>;
        propsSnapshot = { ...propsSnapshot, ...patch };
        // Keep the state mirror in sync if a full state snapshot arrives.
        if (patch.state) {
          for (const [key, value] of Object.entries(patch.state)) {
            stateMirror.set(key, value);
          }
        }
        for (const listener of propsListeners) listener(patch);
      }
    }
  }

  port.onmessage = handlePortMessage;

  /** Send a request and return a Promise resolved by the correlated response. */
  function request(op: SdkOp, params: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = generateId();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`TIMEOUT: SDK op '${op}' exceeded ${timeoutMs}ms`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });

      const message: RpcRequest = {
        channel: RPC_CHANNEL,
        kind: "request",
        id,
        op,
        params,
      };
      port.postMessage(message);
    });
  }

  return {
    read(key: string): unknown {
      return stateMirror.get(key);
    },

    async save(key: string, value: unknown): Promise<void> {
      // Optimistically mirror so a subsequent read reflects the write immediately.
      stateMirror.set(key, value);
      await request("save", { key, value });
    },

    async saveAndFire(key: string, value: unknown): Promise<void> {
      stateMirror.set(key, value);
      await request("saveAndFire", { key, value });
    },

    async fire(eventName: string, payload?: Record<string, unknown>): Promise<void> {
      await request("fire", { eventName, ...(payload !== undefined ? { payload } : {}) });
    },

    async control(deviceId: string, actionType: string, params?: Record<string, unknown>): Promise<CommandResult> {
      // The host resolves with the command's outcome. Discarding it here was why a
      // UI could not tell an accepted command from a proven one.
      const result = await request("control", {
        deviceId,
        actionType,
        ...(params !== undefined ? { params } : {}),
      });
      return (result ?? { success: false, error: "No result returned for control" }) as CommandResult;
    },

    async publish(topic: string, payload: string): Promise<void> {
      await request("publish", { topic, payload });
    },

    subscribeState(listener: (key: string, value: unknown) => void): () => void {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    subscribeProps(listener: (patch: Partial<PropsPayload>) => void): () => void {
      propsListeners.add(listener);
      return () => propsListeners.delete(listener);
    },

    getProps(): PropsPayload {
      return propsSnapshot;
    },

    dispose(): void {
      port.onmessage = null;
      stateListeners.clear();
      propsListeners.clear();
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("SANDBOX_DESTROYED: SDK client disposed"));
      }
      pending.clear();
    },
  };
}
