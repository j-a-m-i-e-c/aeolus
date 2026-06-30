// frontend/src/lib/ws-client.test.ts — Unit tests for the WebSocket client

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./env", () => ({ WS_URL: "ws://test.local:3001/ws" }));

// Token is controlled per-test via the hoisted holder.
const authMock = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("../store/auth-store", () => ({
  useAuthStore: { getState: () => ({ accessToken: authMock.token }) },
}));

// Spy on data-store dispatch without pulling in the real store.
const dsMocks = vi.hoisted(() => ({ addRealtimeRecord: vi.fn(), removeCollection: vi.fn() }));
vi.mock("../store/data-store-store", () => ({
  useDataStoreStore: { getState: () => dsMocks },
}));

import { connectWebSocket, disconnectWebSocket } from "./ws-client";
import { useDeviceStore, type Device } from "../store/device-store";
import { useAutomationStateStore } from "../store/automation-state-store";

// ── Minimal WebSocket double ──────────────────────────────────────────────
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn(() => { this.readyState = 3; });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() { this.readyState = 1; this.onopen?.(); }
  message(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
  raw(data: string) { this.onmessage?.({ data }); }
  fireClose() { this.readyState = 3; this.onclose?.(); }
}

const latest = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

function device(id: string): Device {
  return { id, name: id, type: "sensor", capabilities: [], state: {}, integration: "mqtt", lastSeen: 0 };
}

describe("ws-client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authMock.token = null;
    MockWebSocket.instances = [];
    dsMocks.addRealtimeRecord.mockReset();
    dsMocks.removeCollection.mockReset();
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
    useDeviceStore.setState({ devices: {}, wsConnected: false, mqttMessages: [], automationEvents: [], deviceHistory: {} });
    useAutomationStateStore.setState({ stateByRule: {} });
  });

  afterEach(() => {
    disconnectWebSocket();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("connects to WS_URL without a token by default", () => {
    connectWebSocket();
    expect(latest().url).toBe("ws://test.local:3001/ws");
  });

  it("appends the access token as a query param when present", () => {
    authMock.token = "ab/cd";
    connectWebSocket();
    expect(latest().url).toBe("ws://test.local:3001/ws?token=ab%2Fcd");
  });

  it("marks the device store connected on open", () => {
    connectWebSocket();
    latest().open();
    expect(useDeviceStore.getState().wsConnected).toBe(true);
  });

  it("applies a snapshot message to the device store", () => {
    connectWebSocket();
    latest().message({ type: "snapshot", data: { "d-1": device("d-1") } });
    expect(Object.keys(useDeviceStore.getState().devices)).toEqual(["d-1"]);
  });

  it("updates an existing device and records numeric values for sparklines", () => {
    useDeviceStore.setState({ devices: { "d-1": device("d-1") } });
    connectWebSocket();
    latest().message({ type: "state-change", data: { deviceId: "d-1", state: { value: 42 } } });

    expect(useDeviceStore.getState().devices["d-1"].state).toEqual({ value: 42 });
    expect(useDeviceStore.getState().deviceHistory["d-1"]).toEqual([42]);
  });

  it("adds a brand-new device from a state-change carrying the device", () => {
    connectWebSocket();
    latest().message({ type: "state-change", data: { deviceId: "d-9", device: device("d-9"), state: {} } });
    expect(useDeviceStore.getState().devices["d-9"]).toBeDefined();
  });

  it("routes mqtt-message and automation-fired into their buffers", () => {
    connectWebSocket();
    latest().message({ type: "mqtt-message", data: { topic: "t", payload: "p", timestamp: 1 } });
    latest().message({ type: "automation-fired", data: { ruleId: "r", ruleName: "n", topic: "t", deviceId: "d", timestamp: 1 } });
    expect(useDeviceStore.getState().mqttMessages).toHaveLength(1);
    expect(useDeviceStore.getState().automationEvents).toHaveLength(1);
  });

  it("routes automation-state into the automation-state store", () => {
    connectWebSocket();
    latest().message({ type: "automation-state", data: { ruleId: "r1", key: "count", value: 3 } });
    expect(useAutomationStateStore.getState().stateByRule.r1).toEqual({ count: 3 });
  });

  it("dispatches data-store messages to the data-store store", () => {
    connectWebSocket();
    latest().message({ type: "data-store-write", data: { collection: "c", record: { id: 1 } } });
    latest().message({ type: "data-store-collection-deleted", data: { collection: "c" } });
    expect(dsMocks.addRealtimeRecord).toHaveBeenCalledWith("c", { id: 1 });
    expect(dsMocks.removeCollection).toHaveBeenCalledWith("c");
  });

  it("ignores malformed messages without throwing", () => {
    connectWebSocket();
    expect(() => latest().raw("not json{")).not.toThrow();
  });

  it("marks disconnected and reconnects after the delay on close", () => {
    connectWebSocket();
    latest().open();
    expect(MockWebSocket.instances).toHaveLength(1);

    latest().fireClose();
    expect(useDeviceStore.getState().wsConnected).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(2); // reconnected
  });

  it("disconnectWebSocket cancels a pending reconnect", () => {
    connectWebSocket();
    latest().fireClose(); // schedules reconnect
    disconnectWebSocket();
    vi.advanceTimersByTime(5000);
    expect(MockWebSocket.instances).toHaveLength(1); // no reconnect happened
  });
});
