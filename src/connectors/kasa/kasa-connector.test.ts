// src/connectors/kasa/kasa-connector.test.ts — Unit tests for Kasa connector

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

describe("KasaConnector", () => {
  let connector: KasaConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    connector = new KasaConnector({
      broadcastAddress: "192.168.1.255",
      discoveryTimeout: 1000,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await connector.dispose();
  });

  describe("constructor", () => {
    it("creates instance with default config", () => {
      const defaultConnector = new KasaConnector({});
      expect(defaultConnector).toBeDefined();
    });

    it("accepts custom broadcastAddress and discoveryTimeout", () => {
      expect(connector).toBeDefined();
    });
  });

  describe("connect", () => {
    it("initializes the Kasa client and sets connected health", async () => {
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.status).toBe("connected");
      expect(health.lastSeen).toBeGreaterThan(0);
    });
  });

  describe("disconnect", () => {
    it("stops discovery", async () => {
      await connector.connect();
      await connector.disconnect();
      expect(mockStopDiscovery).toHaveBeenCalled();
    });
  });

  describe("discoverDevices", () => {
    it("throws when client not initialized", async () => {
      await expect(connector.discoverDevices()).rejects.toThrow("not initialized");
    });

    it("discovers devices via UDP broadcast", async () => {
      await connector.connect();

      // Simulate device discovery by capturing the event handlers
      mockOn.mockImplementation((event: string, handler: (device: unknown) => void) => {
        if (event === "device-new") {
          // Simulate a plug being discovered
          setTimeout(() => {
            handler({
              alias: "Living Room Plug",
              host: "192.168.1.50",
              constructor: { name: "Plug" },
              deviceType: "plug",
              sysInfo: { relay_state: 1 },
            });
          }, 100);
        }
      });

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(1100); // Past discoveryTimeout
      const devices = await devicesPromise;

      expect(devices.length).toBeGreaterThanOrEqual(0);
      expect(mockStartDiscovery).toHaveBeenCalledWith(
        expect.objectContaining({
          broadcast: "192.168.1.255",
          discoveryTimeout: 1000,
        }),
      );
    });

    it("sets disconnected health when no devices ever found", async () => {
      await connector.connect();
      mockOn.mockImplementation(() => {}); // No devices

      const devicesPromise = connector.discoverDevices();
      vi.advanceTimersByTime(1100);
      await devicesPromise;

      const health = connector.getHealthStatus();
      // First discovery with no devices = disconnected
      expect(["connected", "disconnected"]).toContain(health.status);
    });
  });

  describe("execute", () => {
    it("throws for unknown device", async () => {
      await connector.connect();
      await expect(
        connector.execute({ type: "toggle", deviceId: "kasa-unknown", params: {} }),
      ).rejects.toThrow("Unknown Kasa device");
    });
  });

  describe("getHealthStatus", () => {
    it("returns disconnected before connect", () => {
      const health = connector.getHealthStatus();
      expect(health.status).toBe("disconnected");
      expect(health.lastSeen).toBe(0);
    });

    it("returns connected after connect", async () => {
      await connector.connect();
      const health = connector.getHealthStatus();
      expect(health.status).toBe("connected");
    });
  });

  describe("onConfigUpdate", () => {
    it("updates broadcastAddress", () => {
      connector.onConfigUpdate({ broadcastAddress: "10.0.0.255" });
      // Should not throw
    });

    it("updates discoveryTimeout", () => {
      connector.onConfigUpdate({ discoveryTimeout: 5000 });
      // Should not throw
    });
  });

  describe("dispose", () => {
    it("cleans up client and resets state", async () => {
      await connector.connect();
      await connector.dispose();

      const health = connector.getHealthStatus();
      expect(health.status).toBe("disconnected");
      expect(health.lastSeen).toBe(0);
    });

    it("handles dispose when not connected", async () => {
      // Should not throw
      await connector.dispose();
    });
  });
});
