// src/connectors/connector-registry.test.ts — Unit tests for ConnectorRegistry

import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectorRegistry } from "./connector-registry.js";
import type { ConnectorModule } from "./connector.interface.js";

/**
 * A fixture directory under the platform's real temp location.
 *
 * These cases used to hardcode `/tmp/...`, which on Windows is a drive-relative
 * path: it resolves against the current drive rather than naming a root. Discovery
 * imports the files it finds, and a specifier built from that path has no drive
 * letter to carry, so the import fails for a reason that has nothing to do with the
 * connector being tested — which is how "invalid exports" started reporting a failed
 * import instead.
 */
const fixtureDir = (name: string) => path.join(os.tmpdir(), `aeolus-registry-test-${name}`);

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

  describe("discoverFromDirectory()", () => {
    it("should handle non-existent directory gracefully", async () => {
      const logger = await import("../logger.js");
      await registry.discoverFromDirectory("/nonexistent/path");
      expect(logger.default.error).toHaveBeenCalled();
      expect(registry.listAvailable()).toHaveLength(0);
    });

    it("should skip non-directory entries", async () => {
      const fs = await import("node:fs");
      const tmpDir = fixtureDir("files");
      fs.mkdirSync(tmpDir, { recursive: true });
      // Create a file (not a directory)
      fs.writeFileSync(path.join(tmpDir, "somefile.ts"), "export default {}");
      try {
        await registry.discoverFromDirectory(tmpDir);
        expect(registry.listAvailable()).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should skip _template directory", async () => {
      const fs = await import("node:fs");
      const tmpDir = fixtureDir("template");
      const templateDir = path.join(tmpDir, "_template");
      fs.mkdirSync(templateDir, { recursive: true });
      fs.writeFileSync(path.join(templateDir, "index.ts"), "export const metadata = { id: 'template' };");
      try {
        await registry.discoverFromDirectory(tmpDir);
        expect(registry.listAvailable()).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should skip directories starting with 'connector'", async () => {
      const fs = await import("node:fs");
      const tmpDir = fixtureDir("connector");
      const connDir = path.join(tmpDir, "connector-utils");
      fs.mkdirSync(connDir, { recursive: true });
      fs.writeFileSync(path.join(connDir, "index.ts"), "export const metadata = { id: 'utils' };");
      try {
        await registry.discoverFromDirectory(tmpDir);
        expect(registry.listAvailable()).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should warn when subdirectory has no index file", async () => {
      const fs = await import("node:fs");
      const logger = await import("../logger.js");
      const tmpDir = fixtureDir("noindex");
      const subDir = path.join(tmpDir, "myconnector");
      fs.mkdirSync(subDir, { recursive: true });
      // No index.ts or index.js
      fs.writeFileSync(path.join(subDir, "other.ts"), "export default {}");
      try {
        await registry.discoverFromDirectory(tmpDir);
        expect(logger.default.warn).toHaveBeenCalledWith(
          expect.objectContaining({ dir: "myconnector" }),
          expect.stringContaining("no index.ts or index.js"),
        );
        expect(registry.listAvailable()).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("should warn when module has invalid exports", async () => {
      const fs = await import("node:fs");
      const logger = await import("../logger.js");
      const tmpDir = fixtureDir("invalid");
      const subDir = path.join(tmpDir, "badmod");
      fs.mkdirSync(subDir, { recursive: true });
      // Create an index.ts that exports an invalid module (no metadata, no configSchema, no createConnector)
      fs.writeFileSync(path.join(subDir, "index.ts"), "export const foo = 'bar';");
      try {
        await registry.discoverFromDirectory(tmpDir);
        expect(logger.default.warn).toHaveBeenCalledWith(
          expect.objectContaining({ dir: "badmod", missing: expect.any(Array) }),
          expect.stringContaining("missing required exports"),
        );
        expect(registry.listAvailable()).toHaveLength(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
