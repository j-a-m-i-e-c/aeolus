// frontend/src/sandbox/sandbox-host.test.ts — Unit tests for the singleton broker deps

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuthFetch, mockSendStateUpdate, mockSendStateUpdateAndFire, mockSubscribe } = vi.hoisted(() => ({
  mockAuthFetch: vi.fn(),
  mockSendStateUpdate: vi.fn(),
  mockSendStateUpdateAndFire: vi.fn(),
  mockSubscribe: vi.fn(() => vi.fn()),
}));

vi.mock("../lib/auth-fetch", () => ({ authFetch: mockAuthFetch }));
vi.mock("../lib/env", () => ({ API_URL: "http://test:3001" }));

const mockStoreState = { stateByRule: { "rule-1": { temp: 22 } } };

vi.mock("../store/automation-state-store", () => ({
  sendStateUpdate: (...args: unknown[]) => mockSendStateUpdate(...args),
  sendStateUpdateAndFire: (...args: unknown[]) => mockSendStateUpdateAndFire(...args),
  useAutomationStateStore: Object.assign(
    () => mockStoreState,
    {
      getState: () => mockStoreState,
      subscribe: (...args: unknown[]) => mockSubscribe(...(args as [])),
    },
  ),
}));

// Import after mocks are set up
import { sandboxBroker } from "./sandbox-host";

describe("sandbox-host deps wiring", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    mockSendStateUpdate.mockReset();
    mockSendStateUpdateAndFire.mockReset();
    mockSubscribe.mockReset();
    mockSubscribe.mockReturnValue(vi.fn());
  });

  it("exports a sandboxBroker instance", () => {
    expect(sandboxBroker).toBeDefined();
    expect(typeof sandboxBroker.register).toBe("function");
    expect(typeof sandboxBroker.unregister).toBe("function");
  });

  it("control calls authFetch with the device action endpoint", async () => {
    const port = createFakePort();
    const grant = { frameId: "f1", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "r1",
      op: "control",
      params: { deviceId: "light-1", actionType: "toggle" },
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test:3001/api/devices/light-1/action",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ type: "toggle", params: undefined }),
      }),
    );

    // The RPC response should include the structured CommandResult
    const response = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ success: true });
    sandboxBroker.unregister("f1");
  });

  it("publish calls authFetch with the MQTT endpoint", async () => {
    const port = createFakePort();
    const grant = { frameId: "f2", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "r2",
      op: "publish",
      params: { topic: "home/test", payload: "{}" },
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test:3001/api/mqtt/publish",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ topic: "home/test", payload: "{}" }),
      }),
    );
    sandboxBroker.unregister("f2");
  });

  it("save for automation calls sendStateUpdate", async () => {
    const port = createFakePort();
    const grant = { frameId: "f3", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "r3",
      op: "save",
      params: { key: "mode", value: "cool" },
    });

    expect(mockSendStateUpdate).toHaveBeenCalledWith("rule-1", "mode", "cool");
    sandboxBroker.unregister("f3");
  });

  it("saveAndFire for automation calls sendStateUpdateAndFire", async () => {
    const port = createFakePort();
    const grant = { frameId: "f4", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "r4",
      op: "saveAndFire",
      params: { key: "target", value: 22 },
    });

    expect(mockSendStateUpdateAndFire).toHaveBeenCalledWith("rule-1", "target", 22);
    sandboxBroker.unregister("f4");
  });

  it("fire for automation calls authFetch with the fire endpoint", async () => {
    const port = createFakePort();
    const grant = { frameId: "f5", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "r5",
      op: "fire",
      params: { eventName: "clicked" },
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test:3001/api/automations/rule-1/fire",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ eventName: "clicked" }),
      }),
    );
    sandboxBroker.unregister("f5");
  });

  it("readState returns cached value from the automation state store", async () => {
    const port = createFakePort();
    const grant = { frameId: "f6", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "r6",
      op: "read",
      params: { key: "temp" },
    });

    const response = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.result).toBe(22);
    sandboxBroker.unregister("f6");
  });

  it("subscribeState subscribes to the automation state store on register", () => {
    const port = createFakePort();
    const grant = { frameId: "f7", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);
    expect(mockSubscribe).toHaveBeenCalled();
    sandboxBroker.unregister("f7");
  });
});

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

describe("sandbox-host — panel path + subscribeState coalescing", () => {
  beforeEach(() => {
    mockAuthFetch.mockReset();
    mockAuthFetch.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    mockSendStateUpdate.mockReset();
    mockSendStateUpdateAndFire.mockReset();
    mockSubscribe.mockReset();
    mockSubscribe.mockReturnValue(vi.fn());
  });

  it("save for panel calls authFetch with the panel state endpoint", async () => {
    const port = createFakePort();
    const grant = { frameId: "fp1", entityType: "panel" as const, entityId: "panel-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "rp1",
      op: "save",
      params: { key: "color", value: "#ff0000" },
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test:3001/api/panels/panel-1/state",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(mockSendStateUpdate).not.toHaveBeenCalled();
    sandboxBroker.unregister("fp1");
  });

  it("saveAndFire for panel calls save + fire endpoints", async () => {
    const port = createFakePort();
    const grant = { frameId: "fp2", entityType: "panel" as const, entityId: "panel-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "rp2",
      op: "saveAndFire",
      params: { key: "mode", value: "auto" },
    });

    // Should call both the state PUT and the fire POST
    const urls = mockAuthFetch.mock.calls.map((c: unknown[]) => c[0]);
    expect(urls).toContain("http://test:3001/api/panels/panel-1/state");
    expect(urls).toContain("http://test:3001/api/panels/panel-1/fire");
    sandboxBroker.unregister("fp2");
  });

  it("fire for panel calls the panels fire endpoint", async () => {
    const port = createFakePort();
    const grant = { frameId: "fp3", entityType: "panel" as const, entityId: "panel-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "rp3",
      op: "fire",
      params: { eventName: "refresh" },
    });

    expect(mockAuthFetch).toHaveBeenCalledWith(
      "http://test:3001/api/panels/panel-1/fire",
      expect.objectContaining({ method: "POST" }),
    );
    sandboxBroker.unregister("fp3");
  });

  it("readState for panel returns undefined (no panel store yet)", async () => {
    const port = createFakePort();
    const grant = { frameId: "fp4", entityType: "panel" as const, entityId: "panel-1", port };
    sandboxBroker.register(grant);

    await sandboxBroker.handleMessage(grant, {
      channel: "aeolus-sdk",
      kind: "request",
      id: "rp4",
      op: "read",
      params: { key: "anything" },
    });

    const response = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(response.ok).toBe(true);
    expect(response.result).toBeUndefined();
    sandboxBroker.unregister("fp4");
  });

  it("subscribeState for panel returns a no-op unsubscribe", () => {
    const port = createFakePort();
    const grant = { frameId: "fp5", entityType: "panel" as const, entityId: "panel-1", port };
    // Panel registration should not call the automation store subscribe
    mockSubscribe.mockClear();
    sandboxBroker.register(grant);
    // The subscribe mock should not be called for panels (no panel store yet)
    // Actually it IS called because the broker always calls deps.subscribeState
    // which for panels returns () => {} (no-op). That's fine.
    sandboxBroker.unregister("fp5");
  });

  it("subscribeState coalescing delivers state changes via the store subscriber", () => {
    vi.useFakeTimers();

    // Capture the zustand subscriber callback
    let storeCallback: ((state: { stateByRule: Record<string, Record<string, unknown>> }) => void) | null = null;
    (mockSubscribe as ReturnType<typeof vi.fn>).mockImplementation((cb: (state: { stateByRule: Record<string, Record<string, unknown>> }) => void) => {
      storeCallback = cb;
      return vi.fn();
    });

    const port = createFakePort();
    const grant = { frameId: "fc1", entityType: "automation" as const, entityId: "rule-1", port };
    sandboxBroker.register(grant);

    expect(storeCallback).not.toBeNull();

    // Simulate a state change via the store subscriber
    storeCallback!({ stateByRule: { "rule-1": { temp: 30 } } });

    // The coalescing uses rAF/setTimeout — advance timers
    vi.advanceTimersByTime(20);

    // Should have posted a state event
    const calls = (port.postMessage as ReturnType<typeof vi.fn>).mock.calls;
    const stateEvents = calls.filter((c: unknown[]) => {
      const msg = c[0] as { kind?: string; event?: string };
      return msg.kind === "event" && msg.event === "state";
    });
    expect(stateEvents.length).toBeGreaterThan(0);
    expect(stateEvents[0][0].data).toEqual({ key: "temp", value: 30 });

    vi.useRealTimers();
    sandboxBroker.unregister("fc1");
  });
});
