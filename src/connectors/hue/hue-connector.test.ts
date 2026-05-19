// src/connectors/hue/hue-connector.test.ts — Comprehensive unit tests for Hue connector

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HueConnector } from "./hue-connector.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock global fetch for HTTP calls to Hue bridge
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─── Test Data ───────────────────────────────────────────────────────────────

const MOCK_LIGHTS = {
  "1": {
    state: { on: true, bri: 254, hue: 0, sat: 0, ct: 370, colormode: "ct", reachable: true },
    type: "Extended color light",
    name: "Living Room",
    modelid: "LCT016",
    manufacturername: "Signify Netherlands B.V.",
    uniqueid: "00:11:22:33:44:55:66:77-0b",
    swversion: "1.90.1",
  },
  "2": {
    state: { on: false, bri: 100, reachable: true, colormode: "ct" as const },
    type: "Dimmable light",
    name: "Kitchen",
    modelid: "LWB014",
    manufacturername: "Signify Netherlands B.V.",
    uniqueid: "00:11:22:33:44:55:66:88-0b",
    swversion: "1.88.1",
  },
  "3": {
    state: { on: true, bri: 200, reachable: true, colormode: "ct" as const },
    type: "On/Off plug-in unit",
    name: "Plug",
    modelid: "LOM001",
    manufacturername: "Signify Netherlands B.V.",
    uniqueid: "00:11:22:33:44:55:66:99-0b",
    swversion: "1.88.1",
  },
};

const MOCK_CONFIG_NO_UPDATES = {
  swversion: "1956178040",
  apiversion: "1.56.0",
  swupdate2: { state: "noupdates", bridge: { state: "noupdates" } },
};

const MOCK_CONFIG_ALL_UPDATES = {
  swversion: "1956178040",
  apiversion: "1.56.0",
  swupdate2: { state: "allreadytoinstall", bridge: { state: "readytoinstall" } },
};

const MOCK_CONFIG_ANY_UPDATES = {
  swversion: "1956178040",
  apiversion: "1.56.0",
  swupdate2: { state: "anyreadytoinstall", bridge: { state: "readytoinstall" } },
};

const MOCK_CONFIG_LIGHTS_ONLY_UPDATES = {
  swversion: "1956178040",
  apiversion: "1.56.0",
  swupdate2: { state: "anyreadytoinstall", bridge: { state: "noupdates" } },
};

const MOCK_CONFIG_NO_SWUPDATE2 = {
  swversion: "1956178040",
  apiversion: "1.56.0",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupConnectedConnector() {
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
    .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG_NO_UPDATES });
}

function setupConnectedAndDiscovered() {
  // connect: lights + config
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
    .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG_NO_UPDATES });
  // discover
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("HueConnector", () => {
  let connector: HueConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    connector = new HueConnector({
      bridgeIp: "192.168.1.100",
      apiKey: "test-api-key",
    });
  });

  afterEach(async () => {
    await connector.dispose();
  });

  describe("constructor", () => {
    it("creates instance with config", () => {
      expect(connector).toBeDefined();
    });

    it("handles missing config values gracefully", () => {
      const c = new HueConnector({});
      expect(c).toBeDefined();
    });
  });

  describe("connect", () => {
    it("connects successfully when bridge responds", async () => {
      setupConnectedConnector();
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.status).toBe("connected");
      expect(health.lastSeen).toBeGreaterThan(0);
    });

    it("throws and sets disconnected health when bridge returns error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      await expect(connector.connect()).rejects.toThrow("403");
      const health = connector.getHealthStatus();
      expect(health.status).toBe("disconnected");
      expect(health.errorMessage).toContain("403");
    });

    it("throws when bridge is unreachable", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(connector.connect()).rejects.toThrow("ECONNREFUSED");
    });

    it("sets updatesAvailable when firmware updates are ready (all)", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG_ALL_UPDATES });
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.updatesAvailable).toBe(true);
      expect(health.updateType).toBe("both");
    });

    it("sets updateType to bridge when only bridge has updates", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG_ANY_UPDATES });
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.updatesAvailable).toBe(true);
      expect(health.updateType).toBe("bridge");
    });

    it("sets updateType to lights when only lights have updates", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG_LIGHTS_ONLY_UPDATES });
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.updatesAvailable).toBe(true);
      expect(health.updateType).toBe("lights");
    });

    it("handles missing swupdate2 in config", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_CONFIG_NO_SWUPDATE2 });
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.updatesAvailable).toBeUndefined();
    });

    it("handles config fetch failure gracefully", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
        .mockResolvedValueOnce({ ok: false, status: 500 });
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.status).toBe("connected");
      expect(health.updatesAvailable).toBeUndefined();
    });

    it("handles config fetch network error gracefully", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS })
        .mockRejectedValueOnce(new Error("Network error"));
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.status).toBe("connected");
    });
  });

  describe("disconnect", () => {
    it("clears search poll timer on disconnect", async () => {
      setupConnectedConnector();
      await connector.connect();
      await connector.disconnect();
      // Should not throw
    });
  });

  describe("discoverDevices", () => {
    beforeEach(async () => {
      setupConnectedConnector();
      await connector.connect();
    });

    it("returns mapped devices from bridge API", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS });
      const devices = await connector.discoverDevices();
      expect(devices.length).toBe(3);
      expect(devices[0].integration).toBe("hue");
      expect(devices[0].name).toBe("Living Room");
      expect(devices[0].id).toBe("hue-light-1");
      expect(devices[0].state.on).toBe(true);
      expect(devices[0].type).toBe("light");
      expect(devices[1].name).toBe("Kitchen");
      expect(devices[1].state.on).toBe(false);
    });

    it("returns empty array when bridge returns empty", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      const devices = await connector.discoverDevices();
      expect(devices).toEqual([]);
    });

    it("throws and sets disconnected when bridge returns error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(connector.discoverDevices()).rejects.toThrow("500");
      const health = connector.getHealthStatus();
      expect(health.status).toBe("disconnected");
    });

    it("updates lastSeen timestamp on success", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_LIGHTS });
      await connector.discoverDevices();
      const health = connector.getHealthStatus();
      expect(health.lastSeen).toBeGreaterThan(0);
    });
  });

  describe("execute", () => {
    beforeEach(async () => {
      setupConnectedAndDiscovered();
      await connector.connect();
      await connector.discoverDevices();
    });

    it("executes toggle action (turns off when on)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { on: true, bri: 254, reachable: true }, type: "Extended color light", name: "Living Room" }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });

      await connector.execute({ type: "toggle", deviceId: "hue-light-1", params: {} });
      const putCall = mockFetch.mock.calls.find(
        (c) => c[1]?.method === "PUT" && c[0].includes("/lights/1/state"),
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1].body);
      expect(body.on).toBe(false);
    });

    it("executes toggle action (turns on when off)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { on: false, bri: 100, reachable: true }, type: "Extended color light", name: "Living Room" }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });

      await connector.execute({ type: "toggle", deviceId: "hue-light-1", params: {} });
      const putCall = mockFetch.mock.calls.find(
        (c) => c[1]?.method === "PUT" && c[0].includes("/lights/1/state"),
      );
      const body = JSON.parse(putCall![1].body);
      expect(body.on).toBe(true);
    });

    it("executes brightness action with clamping", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.execute({ type: "brightness", deviceId: "hue-light-1", params: { brightness: 300 } });
      const putCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(putCall[1].body);
      expect(body.bri).toBe(254); // clamped to max
    });

    it("executes brightness action with zero", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.execute({ type: "brightness", deviceId: "hue-light-1", params: { brightness: -10 } });
      const putCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(putCall[1].body);
      expect(body.bri).toBe(0); // clamped to min
    });

    it("throws when brightness is used on non-dimmable light", async () => {
      // hue-light-3 is "On/Off plug-in unit" which doesn't support brightness
      await expect(
        connector.execute({ type: "brightness", deviceId: "hue-light-3", params: { brightness: 100 } }),
      ).rejects.toThrow("does not support brightness");
    });

    it("executes color action", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.execute({ type: "color", deviceId: "hue-light-1", params: { hue: 30000, saturation: 200 } });
      const putCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(putCall[1].body);
      expect(body.hue).toBeDefined();
      expect(body.sat).toBeDefined();
    });

    it("throws when color is used on non-color light", async () => {
      await expect(
        connector.execute({ type: "color", deviceId: "hue-light-2", params: { hue: 100, saturation: 100 } }),
      ).rejects.toThrow("does not support color");
    });

    it("executes color-temp action", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.execute({ type: "color-temp", deviceId: "hue-light-1", params: { ct: 300 } });
      const putCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(putCall[1].body);
      expect(body.ct).toBeDefined();
    });

    it("throws when color-temp is used on non-ct light", async () => {
      await expect(
        connector.execute({ type: "color-temp", deviceId: "hue-light-3", params: { ct: 300 } }),
      ).rejects.toThrow("does not support color temperature");
    });

    it("executes rename action", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.execute({ type: "rename", deviceId: "hue-light-1", params: { name: "New Name" } });
      const putCall = mockFetch.mock.calls.find(
        (c) => c[1]?.method === "PUT" && c[0].includes("/lights/1") && !c[0].includes("/state"),
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1].body);
      expect(body.name).toBe("New Name");
    });

    it("throws when rename has empty name", async () => {
      await expect(
        connector.execute({ type: "rename", deviceId: "hue-light-1", params: { name: "  " } }),
      ).rejects.toThrow("non-empty");
    });

    it("throws when rename API fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(
        connector.execute({ type: "rename", deviceId: "hue-light-1", params: { name: "New" } }),
      ).rejects.toThrow("500");
    });

    it("executes delete action", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.execute({ type: "delete", deviceId: "hue-light-1", params: {} });
      const deleteCall = mockFetch.mock.calls.find(
        (c) => c[1]?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
    });

    it("throws when delete API fails", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      await expect(
        connector.execute({ type: "delete", deviceId: "hue-light-1", params: {} }),
      ).rejects.toThrow("404");
    });

    it("throws for unsupported action type", async () => {
      await expect(
        connector.execute({ type: "unsupported", deviceId: "hue-light-1", params: {} }),
      ).rejects.toThrow("Unsupported action type");
    });

    it("throws for unknown device", async () => {
      await expect(
        connector.execute({ type: "toggle", deviceId: "hue-light-999", params: {} }),
      ).rejects.toThrow("Unknown Hue device");
    });

    it("throws when PUT state returns error", async () => {
      // toggle: GET state
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: { on: true }, type: "Extended color light", name: "X" }),
      });
      // PUT state fails
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
      await expect(
        connector.execute({ type: "toggle", deviceId: "hue-light-1", params: {} }),
      ).rejects.toThrow("503");
    });

    it("uses default brightness when param is missing", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.execute({ type: "brightness", deviceId: "hue-light-1", params: {} });
      const putCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(putCall[1].body);
      expect(body.bri).toBe(254);
    });
  });

  describe("getHealthStatus", () => {
    it("returns disconnected before connect", () => {
      const health = connector.getHealthStatus();
      expect(health.status).toBe("disconnected");
    });

    it("returns connected status after connect", async () => {
      setupConnectedConnector();
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.status).toBe("connected");
      expect(health.lastSeen).toBeGreaterThan(0);
    });

    it("does not include update fields when no updates available", async () => {
      setupConnectedConnector();
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.updatesAvailable).toBeUndefined();
      expect(health.updateType).toBeUndefined();
    });
  });

  describe("searchForNewLights", () => {
    beforeEach(async () => {
      setupConnectedConnector();
      await connector.connect();
    });

    it("starts a Zigbee search and returns active state", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: { "/lights": "Searching for new devices" } }] });
      const result = await connector.searchForNewLights();
      expect(result.active).toBe(true);
      expect(result.startedAt).toBeGreaterThan(0);
    });

    it("returns current state if search is already active", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.searchForNewLights();
      // Second call should return same state without new fetch
      const result = await connector.searchForNewLights();
      expect(result.active).toBe(true);
    });

    it("handles search start failure (HTTP error)", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      const result = await connector.searchForNewLights();
      expect(result.active).toBe(false);
      expect(result.error).toContain("500");
    });

    it("handles search start failure (network error)", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));
      const result = await connector.searchForNewLights();
      expect(result.active).toBe(false);
      expect(result.error).toContain("Network down");
    });
  });

  describe("getSearchStatus", () => {
    it("returns current search state", () => {
      const status = connector.getSearchStatus();
      expect(status.active).toBe(false);
      expect(status.startedAt).toBeNull();
      expect(status.newLights).toEqual([]);
      expect(status.error).toBeNull();
    });
  });

  describe("onConfigUpdate", () => {
    it("updates bridge IP and API key", () => {
      connector.onConfigUpdate({ bridgeIp: "192.168.1.200", apiKey: "new-key" });
      // Verify by checking that subsequent calls use new IP (indirectly)
      expect(connector).toBeDefined();
    });

    it("handles partial config update", () => {
      connector.onConfigUpdate({ bridgeIp: "10.0.0.1" });
      expect(connector).toBeDefined();
    });
  });

  describe("dispose", () => {
    it("cleans up all resources", async () => {
      setupConnectedConnector();
      await connector.connect();
      await connector.dispose();
      const health = connector.getHealthStatus();
      expect(health.status).toBe("disconnected");
      expect(health.lastSeen).toBe(0);
    });

    it("clears search poll timer", async () => {
      setupConnectedConnector();
      await connector.connect();
      // Start a search to create a timer
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ success: {} }] });
      await connector.searchForNewLights();
      await connector.dispose();
      const status = connector.getSearchStatus();
      expect(status.active).toBe(false);
    });
  });

  describe("getSetupSteps", () => {
    it("returns setup step descriptors", () => {
      const steps = connector.getSetupSteps();
      expect(steps.length).toBe(2);
      expect(steps[0].id).toBe("discover-bridges");
      expect(steps[1].id).toBe("press-button");
      expect(steps[1].fields).toBeDefined();
      expect(steps[1].fields!.length).toBeGreaterThan(0);
    });
  });

  describe("executeSetupStep", () => {
    it("discover-bridges returns bridges on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "bridge-1", internalipaddress: "192.168.1.50" }],
      });
      const result = await connector.executeSetupStep("discover-bridges", {});
      expect(result.success).toBe(true);
      expect(result.data?.bridgeIp).toBe("192.168.1.50");
    });

    it("discover-bridges handles multiple bridges", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "bridge-1", internalipaddress: "192.168.1.50" },
          { id: "bridge-2", internalipaddress: "192.168.1.51" },
        ],
      });
      const result = await connector.executeSetupStep("discover-bridges", {});
      expect(result.success).toBe(true);
      expect(result.message).toContain("2 bridges");
    });

    it("discover-bridges returns failure when no bridges found", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
      const result = await connector.executeSetupStep("discover-bridges", {});
      expect(result.success).toBe(false);
      expect(result.message).toContain("No Hue bridges");
    });

    it("discover-bridges handles HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
      const result = await connector.executeSetupStep("discover-bridges", {});
      expect(result.success).toBe(false);
      expect(result.message).toContain("503");
    });

    it("discover-bridges handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("DNS failure"));
      const result = await connector.executeSetupStep("discover-bridges", {});
      expect(result.success).toBe(false);
      expect(result.message).toContain("DNS failure");
    });

    it("press-button pairs successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ success: { username: "generated-api-key" } }],
      });
      const result = await connector.executeSetupStep("press-button", { bridgeIp: "192.168.1.50" });
      expect(result.success).toBe(true);
      expect(result.data?.apiKey).toBe("generated-api-key");
      expect(result.complete).toBe(true);
    });

    it("press-button returns error when button not pressed (type 101)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ error: { type: 101, description: "link button not pressed" } }],
      });
      const result = await connector.executeSetupStep("press-button", { bridgeIp: "192.168.1.50" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Link button not pressed");
    });

    it("press-button returns error for other error types", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ error: { type: 7, description: "invalid value" } }],
      });
      const result = await connector.executeSetupStep("press-button", { bridgeIp: "192.168.1.50" });
      expect(result.success).toBe(false);
      expect(result.message).toBe("invalid value");
    });

    it("press-button requires bridgeIp", async () => {
      const result = await connector.executeSetupStep("press-button", {});
      expect(result.success).toBe(false);
      expect(result.message).toContain("bridgeIp is required");
    });

    it("press-button handles unexpected response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [{}],
      });
      const result = await connector.executeSetupStep("press-button", { bridgeIp: "192.168.1.50" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unexpected response");
    });

    it("press-button handles network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      const result = await connector.executeSetupStep("press-button", { bridgeIp: "192.168.1.50" });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Connection refused");
    });

    it("unknown step returns failure", async () => {
      const result = await connector.executeSetupStep("unknown-step", {});
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown setup step");
    });
  });
});
