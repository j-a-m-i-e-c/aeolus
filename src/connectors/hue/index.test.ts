// src/connectors/hue/index.test.ts — Unit tests for Hue connector module exports

import { describe, it, expect, vi } from "vitest";
import { metadata, configSchema, createConnector, snippets, actionHandlers, conditions } from "./index.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("hue/index module exports", () => {
  describe("metadata", () => {
    it("has correct id and displayName", () => {
      expect(metadata.id).toBe("hue");
      expect(metadata.displayName).toBe("Philips Hue");
      expect(metadata.icon).toBe("lightbulb");
      expect(metadata.supportedDeviceTypes).toContain("light");
      expect(metadata.requiresSetup).toBe(true);
    });
  });

  describe("configSchema", () => {
    it("has bridgeIp and apiKey fields", () => {
      expect(configSchema.length).toBe(2);
      expect(configSchema[0].id).toBe("bridgeIp");
      expect(configSchema[1].id).toBe("apiKey");
    });
  });

  describe("createConnector", () => {
    it("returns a HueConnector instance", () => {
      const connector = createConnector({ bridgeIp: "192.168.1.1", apiKey: "key" });
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
    it("exports hue_scene handler", () => {
      expect(actionHandlers.hue_scene).toBeDefined();
      expect(typeof actionHandlers.hue_scene).toBe("function");
    });

    it("exports hue_color_loop handler", () => {
      expect(actionHandlers.hue_color_loop).toBeDefined();
      expect(typeof actionHandlers.hue_color_loop).toBe("function");
    });

    it("hue_scene calls connectorManager.executeAction", async () => {
      const mockDeps = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        connectorManager: { executeAction: vi.fn().mockResolvedValue(undefined) },
      };
      const action = { target: "hue-light-1", params: { sceneName: "Relax" } };

      await actionHandlers.hue_scene(action as any, "rule-1", mockDeps as any);
      expect(mockDeps.connectorManager.executeAction).toHaveBeenCalledWith(
        "hue-light-1",
        expect.objectContaining({ type: "scene", params: { sceneName: "Relax" } }),
      );
    });

    it("hue_scene uses 'unknown' when sceneName is not a string", async () => {
      const mockDeps = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        connectorManager: { executeAction: vi.fn().mockResolvedValue(undefined) },
      };
      const action = { target: "hue-light-1", params: { sceneName: 123 } };

      await actionHandlers.hue_scene(action as any, "rule-1", mockDeps as any);
      expect(mockDeps.connectorManager.executeAction).toHaveBeenCalledWith(
        "hue-light-1",
        expect.objectContaining({ type: "scene", params: { sceneName: "unknown" } }),
      );
    });

    it("hue_color_loop calls connectorManager.executeAction", async () => {
      const mockDeps = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        connectorManager: { executeAction: vi.fn().mockResolvedValue(undefined) },
      };
      const action = { target: "hue-light-1", params: { enable: true } };

      await actionHandlers.hue_color_loop(action as any, "rule-1", mockDeps as any);
      expect(mockDeps.connectorManager.executeAction).toHaveBeenCalledWith(
        "hue-light-1",
        expect.objectContaining({ type: "color_loop", params: { enable: true } }),
      );
    });
  });

  describe("conditions", () => {
    it("exports brightness_above condition factory", () => {
      expect(conditions.brightness_above).toBeDefined();
      expect(typeof conditions.brightness_above).toBe("function");
    });

    it("brightness_above returns true when brightness exceeds threshold", () => {
      const condition = conditions.brightness_above("100");
      const context = { state: { brightness: 150 } } as any;
      expect(condition(context)).toBe(true);
    });

    it("brightness_above returns false when brightness is below threshold", () => {
      const condition = conditions.brightness_above("100");
      const context = { state: { brightness: 50 } } as any;
      expect(condition(context)).toBe(false);
    });
  });
});
