// src/api/routes/connector.routes.test.ts — Unit tests for connector REST API routes

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createConnectorRoutes } from "./connector.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { ConnectorManager } from "../../connectors/connector-manager.js";
import type { ConnectorRegistry } from "../../connectors/connector-registry.js";
import type { ConnectorModule, ConnectorInstanceInfo, ConnectorHealthStatus } from "../../connectors/connector.interface.js";

// Mock logger
vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock auth middleware to pass through — these tests focus on connector route logic, not auth
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

/** Minimal HTTP helper — sends a request to an Express app and returns status + body */
async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}${path}`;
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(url, options)
        .then(async (res) => {
          const json = await res.json();
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

function makeHealthStatus(overrides: Partial<ConnectorHealthStatus> = {}): ConnectorHealthStatus {
  return {
    status: "connected",
    lastSeen: Date.now(),
    ...overrides,
  };
}

function makeInstanceInfo(id: string, overrides: Partial<ConnectorInstanceInfo> = {}): ConnectorInstanceInfo {
  return {
    id,
    connectorType: "hue",
    displayName: "Philips Hue",
    icon: "lightbulb",
    config: { bridgeIp: "192.168.1.100", apiKey: "secret-key" },
    health: makeHealthStatus(),
    deviceCount: 3,
    enabled: true,
    ...overrides,
  };
}

function makeModule(id: string): ConnectorModule {
  return {
    metadata: {
      id,
      displayName: `Test ${id}`,
      icon: "plug",
      description: `Test connector ${id}`,
      supportedDeviceTypes: ["light"],
      requiresSetup: false,
    },
    configSchema: [
      { id: "host", label: "Host", type: "text", required: true },
      { id: "apiKey", label: "API Key", type: "password", required: true },
      { id: "timeout", label: "Timeout", type: "number", required: false, default: 5000 },
    ],
    createConnector: () => ({}) as any,
  };
}

describe("connector.routes", () => {
  let app: express.Express;
  let mockManager: Record<string, any>;
  let mockRegistry: Record<string, any>;

  beforeEach(() => {
    mockManager = {
      listEnabled: vi.fn().mockReturnValue([]),
      enable: vi.fn().mockResolvedValue("new-id-123"),
      disable: vi.fn().mockResolvedValue(undefined),
      updateConfig: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue(undefined),
      executeSetupStep: vi.fn().mockResolvedValue({ success: true, message: "Done" }),
      retry: vi.fn().mockResolvedValue(undefined),
    };

    mockRegistry = {
      listAvailable: vi.fn().mockReturnValue([]),
      getModule: vi.fn().mockReturnValue(undefined),
    };

    app = express();
    app.use(express.json());
    app.use(
      "/api/connectors",
      createConnectorRoutes(
        mockManager as unknown as ConnectorManager,
        mockRegistry as unknown as ConnectorRegistry,
      ),
    );
    app.use(errorHandler);
  });

  describe("GET /api/connectors/available", () => {
    it("should return empty array when no connectors discovered", async () => {
      const res = await request(app, "GET", "/api/connectors/available");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return discovered connector types with metadata and configSchema", async () => {
      const mod = makeModule("hue");
      mockRegistry.listAvailable.mockReturnValue([
        { metadata: mod.metadata, configSchema: mod.configSchema },
      ]);

      const res = await request(app, "GET", "/api/connectors/available");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].metadata.id).toBe("hue");
      expect(body[0].configSchema).toHaveLength(3);
    });
  });

  describe("GET /api/connectors", () => {
    it("should return empty array when no connectors enabled", async () => {
      const res = await request(app, "GET", "/api/connectors");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should redact password fields in config", async () => {
      const mod = makeModule("hue");
      mockRegistry.getModule.mockReturnValue(mod);
      mockManager.listEnabled.mockReturnValue([
        makeInstanceInfo("inst-1", {
          connectorType: "hue",
          config: { host: "192.168.1.100", apiKey: "super-secret" },
        }),
      ]);

      const res = await request(app, "GET", "/api/connectors");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].config.host).toBe("192.168.1.100");
      expect(body[0].config.apiKey).toBe("********");
    });

    it("should not redact non-password fields", async () => {
      const mod = makeModule("kasa");
      // kasa module has no password fields
      mod.configSchema = [
        { id: "broadcastAddress", label: "Broadcast", type: "text", required: false },
      ];
      mockRegistry.getModule.mockReturnValue(mod);
      mockManager.listEnabled.mockReturnValue([
        makeInstanceInfo("inst-2", {
          connectorType: "kasa",
          config: { broadcastAddress: "255.255.255.255" },
        }),
      ]);

      const res = await request(app, "GET", "/api/connectors");
      const body = res.body as any[];
      expect(body[0].config.broadcastAddress).toBe("255.255.255.255");
    });
  });

  describe("POST /api/connectors", () => {
    it("should return 404 when connector_type not in registry", async () => {
      const res = await request(app, "POST", "/api/connectors", {
        connector_type: "nonexistent",
        config: {},
      });
      expect(res.status).toBe(404);
    });

    it("should return 400 when required config fields are missing", async () => {
      const mod = makeModule("hue");
      mockRegistry.getModule.mockReturnValue(mod);

      const res = await request(app, "POST", "/api/connectors", {
        connector_type: "hue",
        config: { timeout: 3000 },
      });
      expect(res.status).toBe(400);
      const body = res.body as any;
      expect(body.error).toContain("host");
      expect(body.error).toContain("apiKey");
    });

    it("should enable connector when type exists and config is valid", async () => {
      const mod = makeModule("hue");
      mockRegistry.getModule.mockReturnValue(mod);

      const res = await request(app, "POST", "/api/connectors", {
        connector_type: "hue",
        config: { host: "192.168.1.100", apiKey: "my-key" },
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect((res.body as any).id).toBe("new-id-123");
      expect(mockManager.enable).toHaveBeenCalledWith("hue", {
        host: "192.168.1.100",
        apiKey: "my-key",
      });
    });
  });

  describe("PATCH /api/connectors/:id", () => {
    it("should call updateConfig on the manager", async () => {
      const res = await request(app, "PATCH", "/api/connectors/inst-1", {
        config: { timeout: 10000 },
      });
      expect(res.status).toBe(200);
      expect(mockManager.updateConfig).toHaveBeenCalledWith("inst-1", { timeout: 10000 });
    });
  });

  describe("DELETE /api/connectors/:id", () => {
    it("should call disable on the manager", async () => {
      const res = await request(app, "DELETE", "/api/connectors/inst-1");
      expect(res.status).toBe(200);
      expect(mockManager.disable).toHaveBeenCalledWith("inst-1");
    });
  });

  describe("GET /api/connectors/:id/status", () => {
    it("should return 404 when instance not found", async () => {
      const res = await request(app, "GET", "/api/connectors/unknown/status");
      expect(res.status).toBe(404);
    });

    it("should return status when instance exists", async () => {
      const info = makeInstanceInfo("inst-1");
      mockManager.getStatus.mockReturnValue(info);

      const res = await request(app, "GET", "/api/connectors/inst-1/status");
      expect(res.status).toBe(200);
      expect((res.body as any).id).toBe("inst-1");
    });

    it("should redact password fields in the status config", async () => {
      const mod = makeModule("hue");
      mockRegistry.getModule.mockReturnValue(mod);
      mockManager.getStatus.mockReturnValue(
        makeInstanceInfo("inst-1", {
          connectorType: "hue",
          config: { host: "192.168.1.100", apiKey: "super-secret-bridge-key" },
        }),
      );

      const res = await request(app, "GET", "/api/connectors/inst-1/status");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.config.host).toBe("192.168.1.100");
      expect(body.config.apiKey).toBe("********");
      // The raw secret must never appear anywhere in the serialized payload.
      expect(JSON.stringify(body)).not.toContain("super-secret-bridge-key");
    });
  });

  describe("POST /api/connectors/:id/setup/:stepId", () => {
    it("should delegate to executeSetupStep", async () => {
      const res = await request(app, "POST", "/api/connectors/inst-1/setup/discover-bridges", {
        bridgeIp: "192.168.1.100",
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockManager.executeSetupStep).toHaveBeenCalledWith(
        "inst-1",
        "discover-bridges",
        { bridgeIp: "192.168.1.100" },
      );
    });
  });

  describe("POST /api/connectors/:id/retry", () => {
    it("should delegate to retry", async () => {
      const res = await request(app, "POST", "/api/connectors/inst-1/retry");
      expect(res.status).toBe(200);
      expect(mockManager.retry).toHaveBeenCalledWith("inst-1");
    });
  });

  describe("GET /api/connectors/:id/setup-steps", () => {
    it("should return 404 when instance not found", async () => {
      mockManager.getStatus.mockReturnValue(undefined);
      const res = await request(app, "GET", "/api/connectors/unknown/setup-steps");
      expect(res.status).toBe(404);
    });

    it("should return setup steps when instance exists", async () => {
      mockManager.getStatus.mockReturnValue(makeInstanceInfo("inst-1"));
      mockManager.getSetupSteps = vi.fn().mockReturnValue([{ id: "step-1", title: "Configure" }]);
      const res = await request(app, "GET", "/api/connectors/inst-1/setup-steps");
      expect(res.status).toBe(200);
      expect((res.body as any[])[0].id).toBe("step-1");
    });
  });

  describe("POST /api/connectors/:id/search-lights", () => {
    it("should return 404 when instance not found", async () => {
      mockManager.getStatus.mockReturnValue(undefined);
      mockManager.getConnectorInstance = vi.fn().mockReturnValue(undefined);
      const res = await request(app, "POST", "/api/connectors/unknown/search-lights");
      expect(res.status).toBe(404);
    });

    it("should return 400 when connector does not support light search", async () => {
      mockManager.getStatus.mockReturnValue(makeInstanceInfo("inst-1"));
      mockManager.getConnectorInstance = vi.fn().mockReturnValue({});
      const res = await request(app, "POST", "/api/connectors/inst-1/search-lights");
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("does not support");
    });

    it("should call searchForNewLights and return result", async () => {
      mockManager.getStatus.mockReturnValue(makeInstanceInfo("inst-1"));
      mockManager.getConnectorInstance = vi.fn().mockReturnValue({
        searchForNewLights: vi.fn().mockResolvedValue({ active: true, startedAt: 1000, newLights: [] }),
      });
      const res = await request(app, "POST", "/api/connectors/inst-1/search-lights");
      expect(res.status).toBe(200);
      expect((res.body as any).active).toBe(true);
    });
  });

  describe("GET /api/connectors/:id/search-lights/status", () => {
    it("should return 404 when instance not found", async () => {
      mockManager.getStatus.mockReturnValue(undefined);
      mockManager.getConnectorInstance = vi.fn().mockReturnValue(undefined);
      const res = await request(app, "GET", "/api/connectors/unknown/search-lights/status");
      expect(res.status).toBe(404);
    });

    it("should return 400 when connector does not support getSearchStatus", async () => {
      mockManager.getStatus.mockReturnValue(makeInstanceInfo("inst-1"));
      mockManager.getConnectorInstance = vi.fn().mockReturnValue({});
      const res = await request(app, "GET", "/api/connectors/inst-1/search-lights/status");
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("does not support");
    });

    it("should return search status when supported", async () => {
      mockManager.getStatus.mockReturnValue(makeInstanceInfo("inst-1"));
      mockManager.getConnectorInstance = vi.fn().mockReturnValue({
        getSearchStatus: vi.fn().mockReturnValue({ active: false, newLights: [{ id: "1", name: "New Light" }] }),
      });
      const res = await request(app, "GET", "/api/connectors/inst-1/search-lights/status");
      expect(res.status).toBe(200);
      expect((res.body as any).active).toBe(false);
      expect((res.body as any).newLights).toHaveLength(1);
    });
  });
});
