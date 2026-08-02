// src/connectors/hue/hue-connector.catalog.test.ts
// Regression tests for the connector-correctness-release-gates Hue work:
// explicit action catalog (H5) and explicit on/off execution.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { HueConnector } from "./hue-connector.js";

const EXTENDED_COLOR_LIGHTS = {
  "1": {
    state: { on: true, bri: 200, hue: 5000, sat: 150, ct: 300, colormode: "hs", reachable: true },
    type: "Extended color light",
    name: "Living Room",
    modelid: "LCT001",
    manufacturername: "Signify",
    uniqueid: "00:11:22:33:44:55:66:77-0b",
    swversion: "1.0",
    capabilities: { control: { ct: { min: 153, max: 500 }, colorgamuttype: "C" } },
    config: { archetype: "sultanbulb" },
  },
};

const ONOFF_LIGHTS = {
  "1": {
    state: { on: false, bri: 0, reachable: true },
    type: "On/Off light",
    name: "Porch",
    modelid: "LOM001",
    manufacturername: "Signify",
    uniqueid: "AA:BB:CC:DD:EE:FF:00:11-0b",
    swversion: "1.0",
  },
};

function mockFetchReturning(lights: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => lights,
  });
}

describe("HueConnector — action catalog (H5)", () => {
  let connector: HueConnector;

  beforeEach(() => {
    vi.restoreAllMocks();
    connector = new HueConnector({ bridgeIp: "1.2.3.4", apiKey: "key" });
  });

  afterEach(async () => {
    await connector.dispose();
  });

  it("advertises color-temp, rename, delete, on, off for an extended color light", async () => {
    vi.stubGlobal("fetch", mockFetchReturning(EXTENDED_COLOR_LIGHTS));
    const devices = await connector.discoverDevices();
    const catalog = connector.getActionCatalog(devices[0].id);
    const types = catalog?.map((d) => d.type) ?? [];

    expect(types).toContain("toggle");
    expect(types).toContain("on");
    expect(types).toContain("off");
    expect(types).toContain("brightness");
    expect(types).toContain("color");
    expect(types).toContain("color-temp");
    expect(types).toContain("rename");
    expect(types).toContain("delete");
  });

  it("uses a 0–100 brightness schema (canonical, see H6)", async () => {
    vi.stubGlobal("fetch", mockFetchReturning(EXTENDED_COLOR_LIGHTS));
    const devices = await connector.discoverDevices();
    const catalog = connector.getActionCatalog(devices[0].id);
    const brightness = catalog?.find((d) => d.type === "brightness");
    const props = (brightness?.params as { properties?: { brightness?: { maximum?: number } } })
      .properties;
    expect(props?.brightness?.maximum).toBe(100);
  });

  it("omits brightness/color/color-temp for an on/off-only light", async () => {
    vi.stubGlobal("fetch", mockFetchReturning(ONOFF_LIGHTS));
    const devices = await connector.discoverDevices();
    const catalog = connector.getActionCatalog(devices[0].id);
    const types = catalog?.map((d) => d.type) ?? [];

    expect(types).toContain("toggle");
    expect(types).toContain("on");
    expect(types).toContain("off");
    expect(types).not.toContain("brightness");
    expect(types).not.toContain("color");
    expect(types).not.toContain("color-temp");
    // Bridge management still available
    expect(types).toContain("rename");
    expect(types).toContain("delete");
  });

  it("returns undefined for an unknown device (fall back to generic map)", () => {
    expect(connector.getActionCatalog("hue-unknown")).toBeUndefined();
  });
});

describe("HueConnector — device identity (H7)", () => {
  let connector: HueConnector;

  beforeEach(() => {
    vi.restoreAllMocks();
    connector = new HueConnector({ bridgeIp: "1.2.3.4", apiKey: "key" });
  });

  afterEach(async () => {
    await connector.dispose();
  });

  it("derives id from the light uniqueid, not the bridge-local index", async () => {
    vi.stubGlobal("fetch", mockFetchReturning(EXTENDED_COLOR_LIGHTS));
    const devices = await connector.discoverDevices();
    // uniqueid "00:11:22:33:44:55:66:77-0b" → sanitised
    expect(devices[0].id).toBe("hue-00-11-22-33-44-55-66-77-0b");
    expect(devices[0].id).not.toBe("hue-light-1");
  });

  it("falls back to the index id when uniqueid is missing", async () => {
    const noUniqueId = {
      "1": {
        state: { on: true, bri: 100, reachable: true },
        type: "Dimmable light",
        name: "Nameless",
        modelid: "X",
        manufacturername: "Y",
        uniqueid: "",
        swversion: "1.0",
      },
    };
    vi.stubGlobal("fetch", mockFetchReturning(noUniqueId));
    const devices = await connector.discoverDevices();
    expect(devices[0].id).toBe("hue-light-1");
  });
});

describe("HueConnector — explicit on/off execution", () => {
  let connector: HueConnector;

  beforeEach(() => {
    vi.restoreAllMocks();
    connector = new HueConnector({ bridgeIp: "1.2.3.4", apiKey: "key" });
  });

  afterEach(async () => {
    await connector.dispose();
  });

  it("executes 'on' by PUTting { on: true } without throwing unsupported", async () => {
    const fetchMock = vi.fn()
      // discovery
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => EXTENDED_COLOR_LIGHTS })
      // the PUT to /state
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ success: {} }] });
    vi.stubGlobal("fetch", fetchMock);

    const devices = await connector.discoverDevices();
    await expect(
      connector.execute({ type: "on", deviceId: devices[0].id, params: {} }),
    ).resolves.toBeUndefined();

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ on: true });
  });

  it("executes 'off' by PUTting { on: false }", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => EXTENDED_COLOR_LIGHTS })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ success: {} }] });
    vi.stubGlobal("fetch", fetchMock);

    const devices = await connector.discoverDevices();
    await connector.execute({ type: "off", deviceId: devices[0].id, params: {} });

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ on: false });
  });
});
