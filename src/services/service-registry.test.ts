// src/services/service-registry.test.ts — Unit tests for ServiceRegistry

import { describe, it, expect, vi } from "vitest";
import { ServiceRegistry } from "./service-registry.js";
import type { ServiceModule } from "./service.interface.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createValidModule(id: string): ServiceModule {
  return {
    metadata: {
      id,
      displayName: `${id} Service`,
      icon: "zap",
      description: `Test ${id}`,
      category: "test",
    },
    configSchema: [{ id: "key", label: "Key", type: "text" as const, required: false }],
    createService: vi.fn(),
  };
}

describe("ServiceRegistry", () => {
  describe("register", () => {
    it("registers a valid service module", () => {
      const registry = new ServiceRegistry();
      registry.register(createValidModule("test"));
      expect(registry.getModule("test")).toBeDefined();
    });

    it("skips null/undefined modules", () => {
      const registry = new ServiceRegistry();
      registry.register(null as any);
      registry.register(undefined as any);
      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("skips modules without metadata", () => {
      const registry = new ServiceRegistry();
      registry.register({ configSchema: [], createService: vi.fn() } as any);
      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("skips modules without configSchema array", () => {
      const registry = new ServiceRegistry();
      registry.register({
        metadata: { id: "bad", displayName: "Bad", icon: "x", description: "x", category: "x" },
        configSchema: "not-array",
        createService: vi.fn(),
      } as any);
      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("skips modules without createService function", () => {
      const registry = new ServiceRegistry();
      registry.register({
        metadata: { id: "bad", displayName: "Bad", icon: "x", description: "x", category: "x" },
        configSchema: [],
        createService: "not-a-function",
      } as any);
      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("overwrites on duplicate ID with warning", () => {
      const registry = new ServiceRegistry();
      const mod1 = createValidModule("dup");
      const mod2 = createValidModule("dup");
      mod2.metadata.displayName = "Updated";

      registry.register(mod1);
      registry.register(mod2);

      const result = registry.getModule("dup");
      expect(result!.metadata.displayName).toBe("Updated");
    });
  });

  describe("listAvailable", () => {
    it("returns empty array when no modules registered", () => {
      const registry = new ServiceRegistry();
      expect(registry.listAvailable()).toEqual([]);
    });

    it("returns metadata and configSchema for all registered modules", () => {
      const registry = new ServiceRegistry();
      registry.register(createValidModule("cron"));
      registry.register(createValidModule("trigger"));

      const available = registry.listAvailable();
      expect(available).toHaveLength(2);
      expect(available[0].metadata.id).toBe("cron");
      expect(available[0].configSchema).toHaveLength(1);
    });
  });

  describe("getModule", () => {
    it("returns module by id", () => {
      const registry = new ServiceRegistry();
      const mod = createValidModule("test");
      registry.register(mod);
      expect(registry.getModule("test")).toBe(mod);
    });

    it("returns undefined for non-existent id", () => {
      const registry = new ServiceRegistry();
      expect(registry.getModule("nonexistent")).toBeUndefined();
    });
  });
});
