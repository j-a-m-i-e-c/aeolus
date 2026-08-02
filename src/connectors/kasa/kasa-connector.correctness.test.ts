// src/connectors/kasa/kasa-connector.correctness.test.ts
// Regression tests for the connector-correctness-release-gates work:
// truthful action catalog (H3) and bounded discovery listeners (H4).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// A minimal EventEmitter-like client so listener counts are real, not mocked.
class FakeClient {
  private handlers = new Map<string, Set<(d: unknown) => void>>();
  startDiscovery = vi.fn();
  stopDiscovery = vi.fn();
  on(event: string, handler: (d: unknown) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }
  off(event: string, handler: (d: unknown) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
  emit(event: string, device: unknown) {
    this.handlers.get(event)?.forEach((h) => h(device));
  }
}

const fakeClient = new FakeClient();

vi.mock("tplink-smarthome-api", () => ({
  default: {
    Client: vi.fn().mockImplementation(() => fakeClient),
  },
}));

import { KasaConnector } from "./kasa-connector.js";

describe("KasaConnector — action catalog (H3)", () => {
  let connector: KasaConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connector = new KasaConnector({ discoveryTimeout: 500 });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await connector.dispose();
  });

  async function discoverOne(device: Record<string, unknown>) {
    await connector.connect();
    const promise = connector.discoverDevices();
    fakeClient.emit("device-new", device);
    vi.advanceTimersByTime(600);
    return promise;
  }

  it("advertises only toggle/on/off for a discovered plug", async () => {
    await discoverOne({
      alias: "Plug A",
      host: "192.168.1.10",
      deviceId: "plug-a",
      constructor: { name: "Plug" },
      deviceType: "plug",
      sysInfo: { relay_state: 1 },
    });
    const catalog = connector.getActionCatalog("kasa-plug-a");
    expect(catalog?.map((d) => d.type).sort()).toEqual(["off", "on", "toggle"]);
  });

  it("does not advertise brightness for a bulb", async () => {
    await discoverOne({
      alias: "Bulb A",
      host: "192.168.1.11",
      deviceId: "bulb-a",
      constructor: { name: "Bulb" },
      deviceType: "bulb",
      sysInfo: { light_state: { on_off: 1 } },
    });
    const catalog = connector.getActionCatalog("kasa-bulb-a");
    expect(catalog?.some((d) => d.type === "brightness")).toBe(false);
  });

  it("returns undefined for an unknown device (fall back to generic map)", () => {
    expect(connector.getActionCatalog("kasa-nope")).toBeUndefined();
  });
});

describe("KasaConnector — discovery listeners (H4)", () => {
  let connector: KasaConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connector = new KasaConnector({ discoveryTimeout: 500 });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await connector.dispose();
  });

  it("keeps device-new / device-online listener counts constant across many polls", async () => {
    await connector.connect();
    const before = {
      neu: fakeClient.listenerCount("device-new"),
      online: fakeClient.listenerCount("device-online"),
    };

    for (let i = 0; i < 5; i++) {
      const promise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      await promise;
    }

    expect(fakeClient.listenerCount("device-new")).toBe(before.neu);
    expect(fakeClient.listenerCount("device-online")).toBe(before.online);
  });
});

describe("KasaConnector — device identity (H7)", () => {
  let connector: KasaConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connector = new KasaConnector({ discoveryTimeout: 500 });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await connector.dispose();
  });

  async function discoverOne(device: Record<string, unknown>) {
    await connector.connect();
    const promise = connector.discoverDevices();
    fakeClient.emit("device-new", device);
    vi.advanceTimersByTime(600);
    return promise;
  }

  it("derives id from the native deviceId, not the alias", async () => {
    const devices = await discoverOne({
      alias: "Kitchen Plug",
      host: "192.168.1.20",
      deviceId: "8006ABCD1234",
      constructor: { name: "Plug" },
      deviceType: "plug",
      sysInfo: { relay_state: 1 },
    });
    expect(devices[0].id).toBe("kasa-8006abcd1234");
    expect(devices[0].name).toBe("Kitchen Plug");
  });

  it("keeps the same id after a rename (alias change)", async () => {
    const first = await discoverOne({
      alias: "Old Name",
      host: "192.168.1.20",
      deviceId: "8006ABCD1234",
      constructor: { name: "Plug" },
      deviceType: "plug",
      sysInfo: { relay_state: 1 },
    });
    const second = await discoverOne({
      alias: "New Name",
      host: "192.168.1.20",
      deviceId: "8006ABCD1234",
      constructor: { name: "Plug" },
      deviceType: "plug",
      sysInfo: { relay_state: 1 },
    });
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].name).toBe("New Name");
  });
});
