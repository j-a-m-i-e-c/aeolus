// src/connectors/connector-manager.polling.test.ts — per-instance poll intervals,
// non-overlapping polls, cancellation on disable, and safe config updates.
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorManager, pollDelayMs } from "./connector-manager.js";
import { CONNECTOR_POLL_DEFAULT_MS, CONNECTOR_POLL_MAX_MS, CONNECTOR_POLL_MIN_MS, type Connector } from "./connector.interface.js";
import { ConnectorConfigError, PASSWORD_MASK } from "./connector-config.js";
import { DEVICE_STATE_CHANGE } from "../core/event-bus.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const device = { id: "d1", name: "D1", type: "sensor", state: {}, integration: "mock", lastSeen: 1, capabilities: [] };

function connector(overrides: Partial<Connector> = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    discoverDevices: vi.fn<(signal?: AbortSignal) => Promise<typeof device[]>>().mockResolvedValue([device]),
    execute: vi.fn(),
    getHealthStatus: vi.fn().mockReturnValue({ status: "connected", lastSeen: 0 }),
    onConfigUpdate: vi.fn(),
    ...overrides,
  };
}

function setup(instance: ReturnType<typeof connector>, schema = [{ id: "host", type: "text", required: false }, { id: "apiKey", type: "password", required: false }]) {
  const createConnector = vi.fn().mockReturnValue(instance);
  const mod = { metadata: { displayName: "Mock", icon: "plug" }, configSchema: schema, createConnector };
  const registry = { getModule: vi.fn().mockReturnValue(mod), listAvailable: vi.fn() };
  const store = { save: vi.fn(), disable: vi.fn(), loadEnabled: vi.fn().mockReturnValue([]), loadAll: vi.fn() };
  const deviceRegistry = { getAll: vi.fn().mockReturnValue([]), getById: vi.fn(), remove: vi.fn() };
  const bus = new EventEmitter();
  const manager = new ConnectorManager(registry as never, store as never, deviceRegistry as never, bus);
  return { manager, store, createConnector, bus, mod };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("pollDelayMs", () => {
  it("defaults to 60 s and clamps a connector's request to the documented bounds", () => {
    expect(pollDelayMs(connector() as never)).toBe(CONNECTOR_POLL_DEFAULT_MS);
    expect(pollDelayMs(connector({ getPollIntervalMs: () => 1 }) as never)).toBe(CONNECTOR_POLL_MIN_MS);
    expect(pollDelayMs(connector({ getPollIntervalMs: () => 1e12 }) as never)).toBe(CONNECTOR_POLL_MAX_MS);
    expect(pollDelayMs(connector({ getPollIntervalMs: () => Number.NaN }) as never)).toBe(CONNECTOR_POLL_DEFAULT_MS);
    expect(pollDelayMs(connector({ getPollIntervalMs: () => 12_345.6 }) as never)).toBe(12_346);
  });
});

describe("polling", () => {
  it("passes the instance id to the factory and polls at the connector's interval", async () => {
    const c = connector({ getPollIntervalMs: () => 10_000 });
    const { manager, createConnector } = setup(c);
    const id = await manager.enable("mock", { host: "h" });
    expect(createConnector).toHaveBeenCalledWith({ host: "h" }, { instanceId: id });
    c.discoverDevices.mockClear();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(c.discoverDevices).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(c.discoverDevices).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.discoverDevices).toHaveBeenCalledTimes(2);
  });

  it("keeps 60 s for connectors that do not choose an interval", async () => {
    const c = connector();
    const { manager } = setup(c);
    await manager.enable("mock", {});
    c.discoverDevices.mockClear();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(c.discoverDevices).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(c.discoverDevices).toHaveBeenCalledTimes(1);
  });

  it("never runs two polls of one instance at once, however long one stalls", async () => {
    const c = connector({ getPollIntervalMs: () => 5_000 });
    const { manager } = setup(c);
    await manager.enable("mock", {});
    let release: () => void = () => {};
    let running = 0;
    let most = 0;
    c.discoverDevices.mockImplementation(() => new Promise((resolve) => {
      running += 1; most = Math.max(most, running);
      release = () => { running -= 1; resolve([device]); };
    }));
    await vi.advanceTimersByTimeAsync(5_000 * 20);
    expect(c.discoverDevices).toHaveBeenCalledTimes(2); // the initial one is mocked out; one stalled poll
    expect(most).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(most).toBe(1);
  });

  it("aborts a poll in flight on disable, and its late result registers no device", async () => {
    const c = connector({ getPollIntervalMs: () => 5_000 });
    const { manager, bus } = setup(c);
    const id = await manager.enable("mock", {});
    let signal: AbortSignal | undefined;
    let release: () => void = () => {};
    c.discoverDevices.mockImplementation((s?: AbortSignal) => new Promise((resolve) => { signal = s; release = () => resolve([device]); }));
    await vi.advanceTimersByTimeAsync(5_000);
    const events: unknown[] = [];
    bus.on(DEVICE_STATE_CHANGE, (event) => events.push(event));
    await manager.disable(id);
    expect(signal?.aborted).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toEqual([]);
    // The discovery at enable and the aborted poll; nothing is scheduled after disable.
    expect(c.discoverDevices).toHaveBeenCalledTimes(2);
  });

  it("polls promptly after a config change, or straight after a poll in flight", async () => {
    const c = connector({ getPollIntervalMs: () => 60_000 });
    const { manager } = setup(c);
    const id = await manager.enable("mock", {});
    c.discoverDevices.mockClear();
    await manager.updateConfig(id, { host: "h2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.discoverDevices).toHaveBeenCalledTimes(1);

    let release: () => void = () => {};
    c.discoverDevices.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([device]); }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.discoverDevices).toHaveBeenCalledTimes(2);
    await manager.updateConfig(id, { host: "h3" });
    expect(c.discoverDevices).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.discoverDevices).toHaveBeenCalledTimes(3);
  });

  it("runs a retry through the same guard, and stops every instance on disposeAll", async () => {
    const c = connector({ getPollIntervalMs: () => 5_000 });
    const { manager } = setup(c);
    const id = await manager.enable("mock", {});
    c.discoverDevices.mockClear();
    await manager.retry(id);
    expect(c.discoverDevices).toHaveBeenCalledTimes(1);
    await manager.disposeAll();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.discoverDevices).toHaveBeenCalledTimes(1);
  });
});

describe("secrets in config updates", () => {
  it("keeps the stored secret when the mask comes back, and gives the connector the real value", async () => {
    const c = connector();
    const { manager, store } = setup(c);
    const id = await manager.enable("mock", { host: "h", apiKey: "real-secret" });
    await manager.updateConfig(id, { host: "h2", apiKey: PASSWORD_MASK });
    expect(c.onConfigUpdate).toHaveBeenCalledWith({ host: "h2", apiKey: "real-secret" });
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ config: { host: "h2", apiKey: "real-secret" } }));
  });

  it("refuses the mask at enable and when no secret is stored, persisting nothing", async () => {
    const c = connector();
    const { manager, store } = setup(c);
    await expect(manager.enable("mock", { apiKey: PASSWORD_MASK })).rejects.toBeInstanceOf(ConnectorConfigError);
    expect(store.save).not.toHaveBeenCalled();
    const id = await manager.enable("mock", { host: "h" });
    await expect(manager.updateConfig(id, { apiKey: PASSWORD_MASK })).rejects.toBeInstanceOf(ConnectorConfigError);
    expect(c.onConfigUpdate).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it("does not persist an update the connector rejects", async () => {
    const c = connector({ onConfigUpdate: vi.fn(() => { throw new Error("bad endpoint"); }) });
    const { manager, store } = setup(c);
    const id = await manager.enable("mock", { host: "h", apiKey: "real-secret" });
    await expect(manager.updateConfig(id, { host: "h2", apiKey: PASSWORD_MASK })).rejects.toThrow("bad endpoint");
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(manager.getStatus(id)?.config).toEqual({ host: "h", apiKey: "real-secret" });
  });

  it("does not persist an update the module's validation rejects", async () => {
    const c = connector();
    const { manager, store, mod } = setup(c);
    Object.assign(mod, { validateConfig: (config: Record<string, unknown>) => (config.host === "bad" ? ["host is bad"] : []) });
    await expect(manager.enable("mock", { host: "bad" })).rejects.toThrow("host is bad");
    const id = await manager.enable("mock", { host: "ok" });
    await expect(manager.updateConfig(id, { host: "bad" })).rejects.toThrow("host is bad");
    expect(c.onConfigUpdate).not.toHaveBeenCalled();
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});
