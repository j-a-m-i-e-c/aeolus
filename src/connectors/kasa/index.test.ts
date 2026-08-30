// src/connectors/kasa/index.test.ts — Unit tests for Kasa connector module exports

import { describe, it, expect, vi } from "vitest";
import { metadata, configSchema, createConnector, snippets, actionHandlers, conditions } from "./index.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("tplink-smarthome-api", () => ({
  default: {
    Client: vi.fn().mockImplementation(() => ({
      startDiscovery: vi.fn(),
      stopDiscovery: vi.fn(),
      on: vi.fn(),
    })),
  },
}));

describe("kasa/index module exports", () => {
  describe("metadata", () => {
    it("has correct id and displayName", () => {
      expect(metadata.id).toBe("kasa");
      expect(metadata.displayName).toBe("TP-Link Kasa");
      expect(metadata.icon).toBe("plug");
      expect(metadata.supportedDeviceTypes).toContain("plug");
      expect(metadata.requiresSetup).toBe(false);
    });
  });

  describe("configSchema", () => {
    it("has broadcastAddress and discoveryTimeout fields", () => {
      expect(configSchema.length).toBe(2);
      expect(configSchema[0].id).toBe("broadcastAddress");
      expect(configSchema[1].id).toBe("discoveryTimeout");
    });
  });

  describe("createConnector", () => {
    it("returns a KasaConnector instance", () => {
      const connector = createConnector({ broadcastAddress: "255.255.255.255" });
      expect(connector).toBeDefined();
      expect(connector.connect).toBeDefined();
      expect(connector.discoverDevices).toBeDefined();
      expect(connector.execute).toBeDefined();
    });
  });

  describe("snippets", () => {
    it("exports an array of snippet descriptors", () => {
      expect(Array.isArray(snippets)).toBe(true);
      expect(snippets.length).toBeGreaterThan(0);
    });

    it("each snippet has required fields", () => {
      for (const snippet of snippets) {
        expect(snippet.id).toBeDefined();
        expect(snippet.name).toBeDefined();
        expect(snippet.description).toBeDefined();
        expect(snippet.code).toBeDefined();
      }
    });

    it("includes automation and UI snippets", () => {
      const automationSnippets = snippets.filter((s) => !s.mode || s.mode !== "ui");
      const uiSnippets = snippets.filter((s) => s.mode === "ui");
      expect(automationSnippets.length).toBeGreaterThan(0);
      expect(uiSnippets.length).toBeGreaterThan(0);
    });
  });

  describe("actionHandlers", () => {
    it("exports kasa_energy_report handler", () => {
      expect(actionHandlers.kasa_energy_report).toBeDefined();
      expect(actionHandlers.kasa_energy_report.physical).toBe(false);
      expect(typeof actionHandlers.kasa_energy_report.handler).toBe("function");
    });

    it("kasa_energy_report logs energy data", () => {
      const mockDeps = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        connectorManager: { executeAction: vi.fn() },
      };
      const action = { target: "kasa-plug-1", params: { energy: { power: 100 } } };

      actionHandlers.kasa_energy_report.handler(action as any, "rule-1", mockDeps as any);
      expect(mockDeps.logger.info).toHaveBeenCalled();
    });
  });

  describe("conditions", () => {
    it("exports power_above condition factory", () => {
      expect(conditions.power_above).toBeDefined();
      expect(typeof conditions.power_above).toBe("function");
    });

    it("power_above returns true when power exceeds threshold", () => {
      const condition = conditions.power_above("100");
      const context = { state: { power: 150 } } as any;
      expect(condition(context)).toBe(true);
    });

    it("power_above returns false when power is below threshold", () => {
      const condition = conditions.power_above("100");
      const context = { state: { power: 50 } } as any;
      expect(condition(context)).toBe(false);
    });
  });
});
