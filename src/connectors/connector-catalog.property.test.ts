// src/connectors/connector-catalog.property.test.ts
// Feature: device-action-system-uplift, Property 7: Connector-provided catalog takes precedence over fallback map

import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as fc from "fast-check";
import { ConnectorManager } from "./connector-manager.js";
import type { CapabilityDescriptor } from "./connector.interface.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const capabilityDescriptorArb = fc.record({
  type: fc.string({ minLength: 1 }),
  label: fc.string({ minLength: 1 }),
  description: fc.string(),
  params: fc.dictionary(fc.string(), fc.jsonValue()),
}) as fc.Arbitrary<CapabilityDescriptor>;

// Feature: device-action-system-uplift, Property 7: Connector-provided catalog takes precedence over fallback map
describe("Property 7: Connector-provided catalog takes precedence over fallback map", () => {
  afterEach(() => vi.clearAllMocks());

  it("getActionCatalog returns connector-provided descriptors when connector implements getActionCatalog()", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(capabilityDescriptorArb, { minLength: 1, maxLength: 10 }),
        async (connectorCatalog) => {
          const eventBus = new EventEmitter();
          const device = {
            id: "device-1",
            name: "Test",
            type: "light",
            capabilities: ["on/off", "brightness"],
            state: {},
            integration: "mock",
            lastSeen: Date.now(),
          };

          const connector = {
            connect: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
            discoverDevices: vi.fn().mockResolvedValue([]),
            execute: vi.fn().mockResolvedValue(undefined),
            getHealthStatus: vi.fn().mockReturnValue({ status: "connected", lastSeen: Date.now() }),
            onConfigUpdate: vi.fn(),
            // Connector provides its own catalog
            getActionCatalog: vi.fn().mockReturnValue(connectorCatalog),
          };

          const mockRegistry = {
            getModule: vi.fn().mockReturnValue({
              metadata: { displayName: "Mock", icon: "plug" },
              configSchema: [],
              createConnector: vi.fn().mockReturnValue(connector),
            }),
            listAvailable: vi.fn().mockReturnValue([]),
          };

          const mockStore = {
            save: vi.fn(),
            disable: vi.fn(),
            loadEnabled: vi.fn().mockReturnValue([]),
          };

          const mockDeviceRegistry = {
            getAll: vi.fn().mockReturnValue([device]),
            getById: vi.fn().mockReturnValue(device),
            remove: vi.fn(),
          };

          const manager = new ConnectorManager(
            mockRegistry as any,
            mockStore as any,
            mockDeviceRegistry as any,
            eventBus,
          );

          await manager.enable("mock", {});

          const catalog = manager.getActionCatalog("device-1");

          // Connector-provided catalog must take precedence
          expect(catalog).toEqual(connectorCatalog);
          await manager.disposeAll();
        },
      ),
      { numRuns: 50 },
    );
  });
});
