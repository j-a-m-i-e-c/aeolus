// src/connectors/connector-registry.test.ts — Unit tests for ConnectorRegistry

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectorRegistry } from "./connector-registry.js";
import type { ConnectorModule } from "./connector.interface.js";

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeModule(
  id: string,
  overrides: Partial<ConnectorModule> = {},
): ConnectorModule {
  return {
    metadata: {
      id,
      displayName: `Test ${id}`,
      icon: "plug",
      description: `Test connector ${id}`,
      supportedDeviceTypes: ["light"],
      requiresSetup: false,
    },
    configSchema: [],
    createConnector: () => ({}) as any,
    ...overrides,
  };
}

describe("ConnectorRegistry", () => {
  let registry: ConnectorRegistry;

  beforeEach(() => {
    registry = new ConnectorRegistry();
  });

  describe("register()", () => {
    it("should register a valid connector module", () => {
      const mod = makeModule("hue");
      registry.register(mod);

      expect(registry.getModule("hue")).toBe(mod);
    });

    it("should skip invalid modules (missing metadata)", () => {
      const invalid = {
        configSchema: [],
        createConnector: () => ({}),
      } as any;
      registry.register(invalid);

      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("should skip invalid modules (missing configSchema)", () => {
      const invalid = {
        metadata: { id: "bad" },
        createConnector: () => ({}),
      } as any;
      registry.register(invalid);

      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("should skip invalid modules (missing createConnector)", () => {
      const invalid = {
        metadata: { id: "bad" },
        configSchema: [],
      } as any;
      registry.register(invalid);

      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("should overwrite when registering duplicate type id", () => {
      const mod1 = makeModule("hue");
      const mod2 = makeModule("hue", {
        metadata: {
          id: "hue",
          displayName: "Updated Hue",
          icon: "lightbulb",
          description: "Updated",
          supportedDeviceTypes: ["light"],
          requiresSetup: true,
        },
      });

      registry.register(mod1);
      registry.register(mod2);

      expect(registry.getModule("hue")).toBe(mod2);
      expect(registry.listAvailable()).toHaveLength(1);
    });
  });

  describe("listAvailable()", () => {
    it("should return empty array when no modules registered", () => {
      expect(registry.listAvailable()).toEqual([]);
    });

    it("should return metadata and configSchema for all registered modules", () => {
      registry.register(makeModule("hue"));
      registry.register(makeModule("kasa"));

      const available = registry.listAvailable();
      expect(available).toHaveLength(2);

      const ids = available.map((a) => a.metadata.id).sort();
      expect(ids).toEqual(["hue", "kasa"]);

      // Each entry should have metadata and configSchema, not createConnector
      for (const entry of available) {
        expect(entry).toHaveProperty("metadata");
        expect(entry).toHaveProperty("configSchema");
        expect(entry).not.toHaveProperty("createConnector");
      }
    });
  });

  describe("getModule()", () => {
    it("should return the module for a registered type", () => {
      const mod = makeModule("kasa");
      registry.register(mod);

      expect(registry.getModule("kasa")).toBe(mod);
    });

    it("should return undefined for an unknown type", () => {
      expect(registry.getModule("nonexistent")).toBeUndefined();
    });

    it("should return undefined when registry is empty", () => {
      expect(registry.getModule("hue")).toBeUndefined();
    });
  });
});
