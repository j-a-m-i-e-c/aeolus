// showcase-cleanup §2.8 — the live command feed across the iframe boundary.
//
// This adds a capability to an opaque-origin sandbox, so the assertions that matter
// are the boundary ones: the feed is scoped by the grant and not by anything the frame
// says, it survives a read-only grant because it is a read, and it is torn down with
// the frame so a closed port is never written to.

import { describe, it, expect, vi } from "vitest";
import { SdkBroker, type BrokerDeps, type FrameGrant } from "./sdk-broker";
import { RPC_CHANNEL, READ_ONLY_SDK_OPS, SDK_OPS, type RpcRequest, type SdkOp } from "./rpc-types";
import { createSdkClient } from "./runtime/sdk-client";
import type { PropsPayload } from "./rpc-types";

function createFakePort(): MessagePort & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    postMessage: vi.fn((message: unknown) => sent.push(message)),
    onmessage: null,
    onmessageerror: null,
    close: vi.fn(),
    start: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MessagePort & { sent: unknown[] };
}

const ACTIVITY = [{ commandId: "cmd-1", lifecycleState: "DISPATCHED" }];

function createDeps(overrides: Partial<BrokerDeps> = {}): BrokerDeps {
  return {
    control: vi.fn(async () => ({ success: true })),
    save: vi.fn(),
    saveAndFire: vi.fn(),
    fire: vi.fn(),
    publish: vi.fn(),
    readState: vi.fn(() => "cached"),
    subscribeState: vi.fn(() => vi.fn()),
    readCommands: vi.fn(() => ACTIVITY),
    subscribeCommands: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function makeGrant(overrides: Partial<FrameGrant> = {}): FrameGrant {
  return {
    frameId: "frame-1",
    entityType: "automation",
    entityId: "rule-water",
    port: createFakePort(),
    ...overrides,
  };
}

function request(op: SdkOp, params: Record<string, unknown> = {}): RpcRequest {
  return { channel: RPC_CHANNEL, kind: "request", id: "req-1", op, params };
}

describe("the commands op", () => {
  it("is in the allowlist, so a request is not discarded", () => {
    expect(SDK_OPS.has("commands")).toBe(true);
  });

  it("is classed as a read", () => {
    // The classification is what keeps it working in the public demo, and what stops
    // a future mutating op being permitted by omission.
    expect(READ_ONLY_SDK_OPS.has("commands")).toBe(true);
    for (const mutating of ["save", "saveAndFire", "fire", "control", "publish"] as const) {
      expect(READ_ONLY_SDK_OPS.has(mutating)).toBe(false);
    }
  });

  it("returns this automation's activity", async () => {
    const deps = createDeps();
    const grant = makeGrant();
    const broker = new SdkBroker(deps);
    broker.register(grant);

    await broker.handleMessage(grant, request("commands"));

    const port = grant.port as MessagePort & { sent: unknown[] };
    const response = port.sent.find((m) => (m as { kind?: string }).kind === "response") as {
      ok: boolean;
      result: unknown;
    };
    expect(response.ok).toBe(true);
    expect(response.result).toEqual(ACTIVITY);
  });

  it("is scoped to the grant, ignoring any entity the frame names", async () => {
    // The boundary. A frame that asks for another automation's activity is answered
    // with its own, because the entity never comes from the request.
    const readCommands = vi.fn(() => ACTIVITY);
    const grant = makeGrant({ entityId: "rule-water" });
    const broker = new SdkBroker(createDeps({ readCommands }));
    broker.register(grant);

    await broker.handleMessage(
      grant,
      request("commands", { ruleId: "rule-bunker", entityId: "rule-bunker" }),
    );

    expect(readCommands).toHaveBeenCalledWith("automation", "rule-water");
  });

  it("still answers under a read-only grant", async () => {
    // A public-demo visitor should watch commands climb; refusing a read would make
    // the pane look broken rather than restricted.
    const grant = makeGrant({ readOnly: true });
    const broker = new SdkBroker(createDeps());
    broker.register(grant);

    await broker.handleMessage(grant, request("commands"));

    const port = grant.port as MessagePort & { sent: unknown[] };
    const response = port.sent.find((m) => (m as { kind?: string }).kind === "response") as {
      ok: boolean;
      result: unknown;
    };
    expect(response.result).toEqual(ACTIVITY);
  });

  it("still neutralises mutating ops under a read-only grant", async () => {
    // The allowlist rewrite must not have widened anything.
    const deps = createDeps();
    const grant = makeGrant({ readOnly: true });
    const broker = new SdkBroker(deps);
    broker.register(grant);

    for (const op of ["save", "saveAndFire", "fire", "publish"] as const) {
      await broker.handleMessage(grant, request(op, { key: "k", value: 1, eventName: "e", topic: "t", payload: "p" }));
    }
    await broker.handleMessage(grant, request("control", { deviceId: "d", actionType: "a" }));

    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.saveAndFire).not.toHaveBeenCalled();
    expect(deps.fire).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.control).not.toHaveBeenCalled();
  });
});

describe("the command subscription", () => {
  it("is wired at registration, not on first request", async () => {
    // A pane must see stages reached while it was mounted but before it asked, since
    // those are exactly the transitions the live feed exists for.
    const subscribeCommands = vi.fn(() => vi.fn());
    const grant = makeGrant();
    new SdkBroker(createDeps({ subscribeCommands })).register(grant);

    expect(subscribeCommands).toHaveBeenCalledWith("automation", "rule-water", expect.any(Function));
  });

  it("pushes a commands event into the frame", () => {
    let emit: ((commands: unknown[]) => void) | undefined;
    const subscribeCommands: BrokerDeps["subscribeCommands"] = (_t, _i, cb) => {
      emit = cb;
      return vi.fn();
    };
    const grant = makeGrant();
    new SdkBroker(createDeps({ subscribeCommands })).register(grant);

    emit!(ACTIVITY);

    const port = grant.port as MessagePort & { sent: unknown[] };
    expect(port.sent).toContainEqual({
      channel: RPC_CHANNEL,
      kind: "event",
      event: "commands",
      data: { commands: ACTIVITY },
    });
  });

  it("is unsubscribed when the frame is torn down", () => {
    // Otherwise a late store update postMessages into a closed port.
    const unsubscribe = vi.fn();
    const grant = makeGrant();
    const broker = new SdkBroker(createDeps({ subscribeCommands: vi.fn(() => unsubscribe) }));
    broker.register(grant);
    broker.unregister(grant.frameId);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("the frame-side mirror", () => {
  const props: PropsPayload = {
    entityType: "automation",
    ruleId: "rule-water",
    ruleName: "Water",
    lastFired: null,
    enabled: true,
    devices: [],
    history: [],
    state: {},
  };

  function clientOnPort() {
    const port = createFakePort();
    const sdk = createSdkClient(port, props);
    const deliver = (message: unknown) => {
      (port.onmessage as ((e: MessageEvent) => void) | null)?.({ data: message } as MessageEvent);
    };
    return { sdk, deliver };
  }

  it("starts empty rather than claiming activity nobody reported", () => {
    const { sdk } = clientOnPort();
    expect(sdk.recentCommands()).toEqual([]);
  });

  it("mirrors a commands event and notifies subscribers", () => {
    const { sdk, deliver } = clientOnPort();
    const seen: unknown[][] = [];
    sdk.subscribeCommands((commands) => seen.push(commands));

    deliver({ channel: RPC_CHANNEL, kind: "event", event: "commands", data: { commands: ACTIVITY } });

    expect(sdk.recentCommands()).toEqual(ACTIVITY);
    expect(seen).toEqual([ACTIVITY]);
  });

  it("ignores a malformed push rather than emptying a feed already rendering", () => {
    const { sdk, deliver } = clientOnPort();
    deliver({ channel: RPC_CHANNEL, kind: "event", event: "commands", data: { commands: ACTIVITY } });

    deliver({ channel: RPC_CHANNEL, kind: "event", event: "commands", data: {} });
    deliver({ channel: RPC_CHANNEL, kind: "event", event: "commands", data: { commands: "nope" } });

    expect(sdk.recentCommands()).toEqual(ACTIVITY);
  });

  it("drops command listeners on dispose", () => {
    const { sdk, deliver } = clientOnPort();
    const listener = vi.fn();
    sdk.subscribeCommands(listener);
    sdk.dispose();

    deliver({ channel: RPC_CHANNEL, kind: "event", event: "commands", data: { commands: ACTIVITY } });

    expect(listener).not.toHaveBeenCalled();
  });
});
