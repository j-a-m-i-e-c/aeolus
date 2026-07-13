// src/connectors/kasa/kasa-connector.branches.test.ts — Tests targeting uncovered branches

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the tplink-smarthome-api package
const mockStartDiscovery = vi.fn();
const mockStopDiscovery = vi.fn();
const mockOn = vi.fn();

vi.mock("tplink-smarthome-api", () => ({
  default: {
    Client: vi.fn().mockImplementation(() => ({
      startDiscovery: mockStartDiscovery,
      stopDiscovery: mockStopDiscovery,
      on: mockOn,
    })),
  },
}));

import { KasaConnector } from "./kasa-connector.js";

describe("KasaConnector — branch coverage", () => {
  let connector: KasaConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connector = new KasaConnector({
      broadcastAddress: "192.168.1.255",
      discoveryTimeout: 500,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await connector.dispose();
  });

  describe("discoverDevices — device mapping branches", () => {
    it("maps a Bulb device correctly", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "Bedroom Bulb",
              host: "192.168.1.51",
              constructor: { name: "Bulb" },
              deviceType: "bulb",
              sysInfo: { light_state: { on_off: 1 } },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices.length).toBe(1);
      expect(devices[0].type).toBe("light");
      expect(devices[0].capabilities).toContain("brightness");
      expect(devices[0].state.on).toBe(true);
      expect(devices[0].name).toBe("Bedroom Bulb");
    });

    it("maps a Plug device with energy monitoring data", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "Office Plug",
              host: "192.168.1.52",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 1 },
              emeter: {
                realtime: {
                  voltage: 120.5,
                  current: 0.8,
                  power: 96.4,
                  total: 1234.5,
                },
              },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices.length).toBe(1);
      expect(devices[0].type).toBe("plug");
      expect(devices[0].state.voltage).toBe(120.5);
      expect(devices[0].state.current).toBe(0.8);
      expect(devices[0].state.power).toBe(96.4);
      expect(devices[0].state.totalConsumption).toBe(1234.5);
    });

    it("maps a Plug device with total_wh (fallback energy field)", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "Kitchen Plug",
              host: "192.168.1.53",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 0 },
              emeter: {
                realtime: {
                  voltage: 119,
                  current: 0,
                  power: 0,
                  total_wh: 567,
                },
              },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices[0].state.totalConsumption).toBe(567);
      expect(devices[0].state.on).toBe(false);
    });

    it("uses host as fallback when alias is empty", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "",
              host: "192.168.1.60",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 0 },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices[0].id).toBe("kasa-192.168.1.60");
      expect(devices[0].name).toBe("192.168.1.60");
    });

    it("handles device-online events (not just device-new)", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-online") {
          setTimeout(() => {
            handler({
              alias: "Online Plug",
              host: "192.168.1.70",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 1 },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices.length).toBe(1);
      expect(devices[0].name).toBe("Online Plug");
    });

    it("deduplicates devices with same id", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "Dup Plug",
              host: "192.168.1.80",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 1 },
            });
            // Same device again
            handler({
              alias: "Dup Plug",
              host: "192.168.1.80",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 1 },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices.length).toBe(1);
    });

    it("logs warning when mapDevice throws", async () => {
      await connector.connect();
      const { default: logger } = await import("../../logger.js");
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            // Provide a device that will cause mapDevice to work but trigger error elsewhere
            // Actually, mapDevice is forgiving. We need to throw inside the handler try/catch.
            // Let's trigger by passing null which will throw on property access
            handler(null);
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices.length).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sets degraded health when previously found devices but current scan is empty", async () => {
      await connector.connect();

      // First scan: find a device
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "First Plug",
              host: "192.168.1.90",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 1 },
            });
          }, 50);
        }
      });
      let devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      await devicesPromise;

      // Second scan: no devices
      mockOn.mockImplementation(() => {});
      devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      await devicesPromise;

      const health = connector.getHealthStatus();
      expect(health.status).toBe("degraded");
      expect(health.errorMessage).toContain("previously discovered");
    });

    it("maps Bulb with light_state.on_off === 0 as off", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "Dim Bulb",
              host: "192.168.1.55",
              constructor: { name: "Bulb" },
              deviceType: "bulb",
              sysInfo: { light_state: { on_off: 0 } },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices[0].state.on).toBe(false);
    });

    it("maps device with deviceType 'bulb' but non-Bulb constructor", async () => {
      await connector.connect();
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => {
            handler({
              alias: "Weird Bulb",
              host: "192.168.1.56",
              constructor: { name: "Unknown" },
              deviceType: "bulb",
              sysInfo: { light_state: { on_off: 1 } },
            });
          }, 50);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      const devices = await devicesPromise;

      expect(devices[0].type).toBe("light");
    });
  });

  describe("execute — action type branches", () => {
    async function setupWithDevice(deviceId: string, deviceObj: Record<string, unknown>) {
      await connector.connect();
      // We need to get a device into discoveredDevices via discovery
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          setTimeout(() => handler(deviceObj), 50);
        }
      });
      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(600);
      await devicesPromise;
    }

    it("executes 'on' action", async () => {
      const mockSetPower = vi.fn().mockResolvedValue(undefined);
      await setupWithDevice("kasa-test-plug", {
        alias: "Test Plug",
        host: "192.168.1.100",
        constructor: { name: "Plug" },
        deviceType: "plug",
        sysInfo: { relay_state: 0 },
        setPowerState: mockSetPower,
      });

      await connector.execute({ type: "on", deviceId: "kasa-test-plug", params: {} });
      expect(mockSetPower).toHaveBeenCalledWith(true);
    });

    it("executes 'off' action", async () => {
      const mockSetPower = vi.fn().mockResolvedValue(undefined);
      await setupWithDevice("kasa-off-plug", {
        alias: "Off Plug",
        host: "192.168.1.101",
        constructor: { name: "Plug" },
        deviceType: "plug",
        sysInfo: { relay_state: 1 },
        setPowerState: mockSetPower,
      });

      await connector.execute({ type: "off", deviceId: "kasa-off-plug", params: {} });
      expect(mockSetPower).toHaveBeenCalledWith(false);
    });

    it("executes 'toggle' action (currently on → off)", async () => {
      const mockSetPower = vi.fn().mockResolvedValue(undefined);
      await setupWithDevice("kasa-toggle-plug", {
        alias: "Toggle Plug",
        host: "192.168.1.102",
        constructor: { name: "Plug" },
        deviceType: "plug",
        sysInfo: { relay_state: 1 },
        setPowerState: mockSetPower,
      });

      await connector.execute({ type: "toggle", deviceId: "kasa-toggle-plug", params: {} });
      expect(mockSetPower).toHaveBeenCalledWith(false);
    });

    it("executes 'toggle' action (currently off → on)", async () => {
      const mockSetPower = vi.fn().mockResolvedValue(undefined);
      await setupWithDevice("kasa-toggle-off", {
        alias: "Toggle Off",
        host: "192.168.1.103",
        constructor: { name: "Plug" },
        deviceType: "plug",
        sysInfo: { relay_state: 0 },
        setPowerState: mockSetPower,
      });

      await connector.execute({ type: "toggle", deviceId: "kasa-toggle-off", params: {} });
      expect(mockSetPower).toHaveBeenCalledWith(true);
    });

    it("throws on unsupported action type", async () => {
      const mockSetPower = vi.fn().mockResolvedValue(undefined);
      await setupWithDevice("kasa-unsupported", {
        alias: "Unsupported",
        host: "192.168.1.104",
        constructor: { name: "Plug" },
        deviceType: "plug",
        sysInfo: { relay_state: 0 },
        setPowerState: mockSetPower,
      });

      await expect(
        connector.execute({ type: "dim" as any, deviceId: "kasa-unsupported", params: {} }),
      ).rejects.toThrow("Unsupported action type: dim");
    });

    it("throws when device lacks setPowerState", async () => {
      await setupWithDevice("kasa-no-power", {
        alias: "No Power",
        host: "192.168.1.105",
        constructor: { name: "Plug" },
        deviceType: "plug",
        sysInfo: { relay_state: 0 },
        // No setPowerState
      });

      await expect(
        connector.execute({ type: "on", deviceId: "kasa-no-power", params: {} }),
      ).rejects.toThrow("does not support power state control");
    });

    it("updates health status after successful execute", async () => {
      const mockSetPower = vi.fn().mockResolvedValue(undefined);
      await setupWithDevice("kasa-health", {
        alias: "Health",
        host: "192.168.1.106",
        constructor: { name: "Plug" },
        deviceType: "plug",
        sysInfo: { relay_state: 0 },
        setPowerState: mockSetPower,
      });

      await connector.execute({ type: "on", deviceId: "kasa-health", params: {} });
      const health = connector.getHealthStatus();
      expect(health.status).toBe("connected");
    });
  });

  describe("disconnect — when client is null", () => {
    it("disconnect without connect does not throw", async () => {
      // No connect called — client is null
      await expect(connector.disconnect()).resolves.toBeUndefined();
    });
  });
});
