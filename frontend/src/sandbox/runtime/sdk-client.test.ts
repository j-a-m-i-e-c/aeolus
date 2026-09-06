// frontend/src/sandbox/runtime/sdk-client.test.ts — Unit tests for SDK client

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSdkClient, type AeolusUiSdk } from "./sdk-client";
import { RPC_CHANNEL, type PropsPayload, type RpcResponse, type RpcEvent } from "../rpc-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createFakePort() {
  const port = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
    onmessageerror: null,
    close: vi.fn(),
    start: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  return port as unknown as MessagePort & { onmessage: ((event: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn> };
}

function makeProps(overrides?: Partial<PropsPayload>): PropsPayload {
  return {
    entityType: "automation",
    ruleId: "rule-1",
    ruleName: "Test Rule",
    lastFired: null,
    enabled: true,
    devices: [],
    history: [],
    state: { temp: 22, mode: "cool" },
    ...overrides,
  };
}

function sendResponse(port: ReturnType<typeof createFakePort>, id: string, ok: boolean, result?: unknown, error?: { code: string; message: string }) {
  const response: RpcResponse = {
    channel: RPC_CHANNEL,
    kind: "response",
    id,
    ok,
    ...(ok ? { result } : { error: error as RpcResponse["error"] }),
  };
  port.onmessage?.({ data: response } as MessageEvent);
}

function sendStateEvent(port: ReturnType<typeof createFakePort>, key: string, value: unknown) {
  const event: RpcEvent = {
    channel: RPC_CHANNEL,
    kind: "event",
    event: "state",
    data: { key, value },
  };
  port.onmessage?.({ data: event } as MessageEvent);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createSdkClient", () => {
  let port: ReturnType<typeof createFakePort>;
  let sdk: AeolusUiSdk;

  beforeEach(() => {
    vi.useFakeTimers();
    port = createFakePort();
    sdk = createSdkClient(port as unknown as MessagePort, makeProps(), 100); // Short timeout for tests
  });

  afterEach(() => {
    sdk.dispose();
    vi.useRealTimers();
  });

  describe("read (synchronous from mirror)", () => {
    it("returns initial state values without sending a message", () => {
      expect(sdk.read("temp")).toBe(22);
      expect(sdk.read("mode")).toBe("cool");
      expect(port.postMessage).not.toHaveBeenCalled();
    });

    it("returns undefined for unknown keys", () => {
      expect(sdk.read("nonexistent")).toBeUndefined();
    });
  });

  describe("control (async, resolves after response)", () => {
    it("resolves with the command outcome the host reported", async () => {
      const promise = sdk.control("light-1", "toggle");

      // Extract the request id from the posted message
      const msg = port.postMessage.mock.calls[0][0];
      expect(msg.op).toBe("control");
      expect(msg.params.deviceId).toBe("light-1");
      expect(msg.params.actionType).toBe("toggle");

      // The result must reach the frame intact. This client used to await the
      // response and discard it, which is why a custom UI could not tell an accepted
      // command from a proven one — the whole point of the evidence ladder.
      const result = {
        success: true,
        commandId: "cmd-1",
        effectiveTier: "observed",
      };
      sendResponse(port, msg.id, true, result);
      await expect(promise).resolves.toEqual(result);
    });

    it("fails closed when the host reports success but sends no result", async () => {
      // A success response with no payload is a protocol violation. Resolving with
      // undefined would let a pane treat an unproven command as proven, so the client
      // reports a failure the UI can render instead.
      const promise = sdk.control("light-1", "toggle");
      const msg = port.postMessage.mock.calls[0][0];
      sendResponse(port, msg.id, true);
      await expect(promise).resolves.toEqual({
        success: false,
        error: "No result returned for control",
      });
    });

    it("rejects when host sends an error response", async () => {
      const promise = sdk.control("light-1", "toggle");
      const msg = port.postMessage.mock.calls[0][0];
      sendResponse(port, msg.id, false, undefined, { code: "OP_FAILED", message: "Device offline" });
      await expect(promise).rejects.toThrow("OP_FAILED: Device offline");
    });
  });

  describe("timeout", () => {
    it("rejects with TIMEOUT when no response arrives within budget", async () => {
      const promise = sdk.control("light-1", "toggle");
      vi.advanceTimersByTime(101);
      await expect(promise).rejects.toThrow("TIMEOUT");
    });
  });

  describe("save (optimistic mirror update)", () => {
    it("updates the local mirror immediately", async () => {
      const promise = sdk.save("target", 25);
      expect(sdk.read("target")).toBe(25);

      const msg = port.postMessage.mock.calls[0][0];
      sendResponse(port, msg.id, true);
      await promise;
    });
  });

  describe("subscribeState", () => {
    it("delivers state events to listeners", () => {
      const listener = vi.fn();
      sdk.subscribeState(listener);
      sendStateEvent(port, "temp", 30);
      expect(listener).toHaveBeenCalledWith("temp", 30);
      expect(sdk.read("temp")).toBe(30);
    });

    it("unsubscribe stops delivery", () => {
      const listener = vi.fn();
      const unsub = sdk.subscribeState(listener);
      unsub();
      sendStateEvent(port, "temp", 99);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("getProps", () => {
    it("returns the initial props", () => {
      const props = sdk.getProps();
      expect(props.ruleId).toBe("rule-1");
      expect(props.ruleName).toBe("Test Rule");
      expect(props.enabled).toBe(true);
    });

    it("reflects props patches", () => {
      const propsEvent: RpcEvent = {
        channel: RPC_CHANNEL,
        kind: "event",
        event: "props",
        data: { enabled: false, lastFired: 12345 },
      };
      port.onmessage?.({ data: propsEvent } as MessageEvent);
      expect(sdk.getProps().enabled).toBe(false);
      expect(sdk.getProps().lastFired).toBe(12345);
    });
  });

  describe("dispose", () => {
    it("rejects pending requests with SANDBOX_DESTROYED", async () => {
      const promise = sdk.fire("click");
      sdk.dispose();
      await expect(promise).rejects.toThrow("SANDBOX_DESTROYED");
    });
  });

  describe("privileged surface", () => {
    it("exposes no token, authFetch, or fetch member", () => {
      const sdkAny = sdk as unknown as Record<string, unknown>;
      expect(sdkAny.token).toBeUndefined();
      expect(sdkAny.authFetch).toBeUndefined();
      expect(sdkAny.fetch).toBeUndefined();
      expect(sdkAny.accessToken).toBeUndefined();
    });
  });
});
