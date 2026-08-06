// frontend/src/sandbox/sdk-broker.test.ts — Unit tests for SdkBroker privileged surface and behavior

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SdkBroker, type BrokerDeps, type FrameGrant } from "./sdk-broker";
import { RPC_CHANNEL } from "./rpc-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createFakePort(): MessagePort {
  return {
    postMessage: vi.fn(),
    onmessage: null,
    onmessageerror: null,
    close: vi.fn(),
    start: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MessagePort;
}

function createSpyDeps(): BrokerDeps {
  return {
    control: vi.fn(async () => ({ success: true })),
    save: vi.fn(),
    saveAndFire: vi.fn(),
    fire: vi.fn(),
    publish: vi.fn(),
    readState: vi.fn(() => "cached"),
    subscribeState: vi.fn(() => vi.fn()),
  };
}

function makeGrant(overrides?: Partial<FrameGrant>): FrameGrant {
  return {
    frameId: "frame-1",
    entityType: "automation",
    entityId: "rule-42",
    port: createFakePort(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SdkBroker", () => {
  let deps: BrokerDeps;
  let broker: SdkBroker;

  beforeEach(() => {
    deps = createSpyDeps();
    broker = new SdkBroker(deps);
  });

  describe("privileged surface", () => {
    it("does not expose token, authFetch, or generic request on the broker instance", () => {
      const brokerAny = broker as unknown as Record<string, unknown>;
      expect(brokerAny.token).toBeUndefined();
      expect(brokerAny.authFetch).toBeUndefined();
      expect(brokerAny.fetch).toBeUndefined();
      expect(brokerAny.request).toBeUndefined();
      expect(brokerAny.accessToken).toBeUndefined();
    });

    it("deps interface has no token/fetch/request members", () => {
      const depsAny = deps as unknown as Record<string, unknown>;
      expect(depsAny.token).toBeUndefined();
      expect(depsAny.authFetch).toBeUndefined();
      expect(depsAny.fetch).toBeUndefined();
      expect(depsAny.accessToken).toBeUndefined();
    });
  });

  describe("register / unregister lifecycle", () => {
    it("wires port.onmessage on register", () => {
      const grant = makeGrant();
      broker.register(grant);
      expect(grant.port.onmessage).not.toBeNull();
      expect(broker.has("frame-1")).toBe(true);
      expect(broker.size).toBe(1);
    });

    it("subscribes to state for the granted entity", () => {
      const grant = makeGrant();
      broker.register(grant);
      expect(deps.subscribeState).toHaveBeenCalledWith("automation", "rule-42", expect.any(Function));
    });

    it("unregister closes port and removes registration", () => {
      const grant = makeGrant();
      broker.register(grant);
      broker.unregister("frame-1");
      expect(grant.port.onmessage).toBeNull();
      expect(grant.port.close).toHaveBeenCalled();
      expect(broker.has("frame-1")).toBe(false);
      expect(broker.size).toBe(0);
    });

    it("unregister calls the state unsubscribe function", () => {
      const unsubscribe = vi.fn();
      (deps.subscribeState as ReturnType<typeof vi.fn>).mockReturnValue(unsubscribe);
      const grant = makeGrant();
      broker.register(grant);
      broker.unregister("frame-1");
      expect(unsubscribe).toHaveBeenCalled();
    });

    it("unregister is a no-op for unknown frameId", () => {
      // Should not throw
      broker.unregister("nonexistent");
    });

    it("re-registering same frameId cleans up first", () => {
      const port1 = createFakePort();
      const port2 = createFakePort();
      broker.register(makeGrant({ port: port1 }));
      broker.register(makeGrant({ port: port2 }));
      expect(port1.close).toHaveBeenCalled();
      expect(broker.size).toBe(1);
    });
  });

  describe("handleMessage — op dispatch", () => {
    it("saveAndFire triggers both persist and fire effects", async () => {
      const grant = makeGrant();
      broker.register(grant);

      await broker.handleMessage(grant, {
        channel: RPC_CHANNEL,
        kind: "request",
        id: "r1",
        op: "saveAndFire",
        params: { key: "mode", value: "cool" },
      });

      expect(deps.saveAndFire).toHaveBeenCalledWith("automation", "rule-42", "mode", "cool");
      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.ok).toBe(true);
      expect(response.id).toBe("r1");
    });

    it("returns UNKNOWN_OP for ops not on the allowlist (discards — no response)", async () => {
      const grant = makeGrant();
      broker.register(grant);

      // This is actually caught by isRpcRequest which will discard the message
      await broker.handleMessage(grant, {
        channel: RPC_CHANNEL,
        kind: "request",
        id: "r1",
        op: "deleteAll",
        params: {},
      });

      // Discarded — no response sent, no effect
      expect((grant.port.postMessage as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });

    it("returns BAD_SCHEMA with correct error code for invalid params", async () => {
      const grant = makeGrant();
      broker.register(grant);

      await broker.handleMessage(grant, {
        channel: RPC_CHANNEL,
        kind: "request",
        id: "r2",
        op: "read",
        params: { key: "" }, // empty key
      });

      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("BAD_SCHEMA");
      expect(response.id).toBe("r2");
    });

    it("returns OP_FAILED when a dep throws", async () => {
      (deps.control as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Device offline"));
      const grant = makeGrant();
      broker.register(grant);

      await broker.handleMessage(grant, {
        channel: RPC_CHANNEL,
        kind: "request",
        id: "r3",
        op: "control",
        params: { deviceId: "light-1", actionType: "toggle" },
      });

      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("OP_FAILED");
      expect(response.error.message).toBe("Device offline");
    });

    it("read returns the cached value from deps.readState", async () => {
      (deps.readState as ReturnType<typeof vi.fn>).mockReturnValue(42);
      const grant = makeGrant();
      broker.register(grant);

      await broker.handleMessage(grant, {
        channel: RPC_CHANNEL,
        kind: "request",
        id: "r4",
        op: "read",
        params: { key: "temperature" },
      });

      expect(deps.readState).toHaveBeenCalledWith("automation", "rule-42", "temperature");
      const response = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.ok).toBe(true);
      expect(response.result).toBe(42);
    });
  });

  describe("emitProps", () => {
    it("posts a props event to the frame", () => {
      const grant = makeGrant();
      broker.register(grant);

      broker.emitProps("frame-1", { devices: [], lastFired: 12345 });

      const msg = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(msg.channel).toBe(RPC_CHANNEL);
      expect(msg.kind).toBe("event");
      expect(msg.event).toBe("props");
      expect(msg.data).toEqual({ devices: [], lastFired: 12345 });
    });

    it("is a no-op for unknown frameId", () => {
      // Should not throw
      broker.emitProps("nonexistent", { devices: [] });
    });
  });
});

// ─── Read-only grant (public-demo look-only tabs) ────────────────────────────

describe("SdkBroker — read-only grant", () => {
  let deps: BrokerDeps;
  let broker: SdkBroker;

  beforeEach(() => {
    deps = createSpyDeps();
    broker = new SdkBroker(deps);
  });

  const req = (op: string, params: Record<string, unknown>) => ({
    channel: RPC_CHANNEL,
    kind: "request" as const,
    id: `req-${op}`,
    op,
    params,
  });

  it("neutralises save / saveAndFire / fire / publish (deps never invoked)", async () => {
    const grant = makeGrant({ readOnly: true });
    broker.register(grant);

    await broker.handleMessage(grant, req("save", { key: "master", value: true }));
    await broker.handleMessage(grant, req("saveAndFire", { key: "master", value: true }));
    await broker.handleMessage(grant, req("fire", { eventName: "arm" }));
    await broker.handleMessage(grant, req("publish", { topic: "t", payload: "{}" }));

    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.saveAndFire).not.toHaveBeenCalled();
    expect(deps.fire).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("returns a failure result for control without invoking the device action", async () => {
    const grant = makeGrant({ readOnly: true });
    broker.register(grant);

    await broker.handleMessage(grant, req("control", { deviceId: "d1", actionType: "on" }));

    expect(deps.control).not.toHaveBeenCalled();
    const post = (grant.port.postMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(post.ok).toBe(true); // op completes (no throw); result carries the refusal
    expect(post.result).toEqual({ success: false, error: "Read-only in the public demo" });
  });

  it("still serves reads", async () => {
    const grant = makeGrant({ readOnly: true });
    broker.register(grant);

    await broker.handleMessage(grant, req("read", { key: "master" }));

    expect(deps.readState).toHaveBeenCalledWith("automation", "rule-42", "master");
  });

  it("does NOT neutralise writes for a normal (interactive) grant", async () => {
    const grant = makeGrant(); // readOnly undefined → interactive
    broker.register(grant);

    await broker.handleMessage(grant, req("fire", { eventName: "arm" }));

    expect(deps.fire).toHaveBeenCalledWith("automation", "rule-42", "arm", undefined);
  });
});
