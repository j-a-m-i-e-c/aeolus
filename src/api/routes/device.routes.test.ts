// src/api/routes/device.routes.test.ts — Unit tests for device REST API routes

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createDeviceRoutes } from "./device.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { CommandService } from "../../automations/command-service.js";
import type { CapabilityDescriptor } from "../../connectors/connector.interface.js";
import type { StateHistory } from "../../core/state-history.js";
import type { Device } from "../../core/types.js";

// Mock logger
vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock auth middleware to pass through — these tests focus on device route logic, not auth
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  requireTabPermission: () => (_req: any, _res: any, next: any) => next(),
}));

// Passthrough resource guard and a permissive resolver stub — these tests focus
// on device route logic, not resource-level authorization (covered elsewhere).
const passthroughGuard = () => (_req: any, _res: any, next: any) => next();
const stubResolver = {
  hasResourcePermission: () => true,
  filterByPermission: (_userId: string, _kind: string, ids: string[]) => ids,
  effectivePermission: () => "write",
} as any;

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

function makeDevice(id: string, overrides: Partial<Device> = {}): Device {
  return {
    id,
    name: `Test Device ${id}`,
    type: "light",
    capabilities: ["on/off", "brightness"],
    state: { on: true, brightness: 80 },
    integration: "hue",
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe("device.routes", () => {
  let app: express.Express;
  let mockRegistry: Record<string, any>;
  let mockCommandService: Record<string, any>;
  let mockGetActionCatalog: ReturnType<typeof vi.fn>;
  let mockStateHistory: Record<string, any>;

  beforeEach(() => {
    mockRegistry = {
      getAll: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(undefined),
    };

    mockCommandService = {
      execute: vi.fn().mockResolvedValue({ success: true, lifecycleState: "DISPATCHED" }),
    };

    mockGetActionCatalog = vi.fn().mockReturnValue([] as CapabilityDescriptor[]);

    mockStateHistory = {
      getHistory: vi.fn().mockReturnValue([]),
      getHistoryRange: vi.fn().mockReturnValue([]),
      clearDevice: vi.fn().mockReturnValue(0),
      clearAll: vi.fn().mockReturnValue(0),
    };

    app = express();
    app.use(express.json());
    app.use(
      "/api/devices",
      createDeviceRoutes(
        mockRegistry as unknown as DeviceRegistry,
        mockCommandService as unknown as CommandService,
        mockGetActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
        passthroughGuard,
        stubResolver,
        mockStateHistory as unknown as StateHistory,
      ),
    );
    app.use(errorHandler);
  });

  describe("GET /api/devices", () => {
    it("should return empty array when no devices registered", async () => {
      const res = await request(app, "GET", "/api/devices");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return all registered devices", async () => {
      const devices = [makeDevice("dev-1"), makeDevice("dev-2")];
      mockRegistry.getAll.mockReturnValue(devices);

      const res = await request(app, "GET", "/api/devices");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe("dev-1");
      expect(body[1].id).toBe("dev-2");
    });
  });

  describe("GET /api/devices/:id", () => {
    it("should return 404 when device not found", async () => {
      const res = await request(app, "GET", "/api/devices/nonexistent");
      expect(res.status).toBe(404);
      expect((res.body as any).error).toContain("Device not found");
    });

    it("should return device when found", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);

      const res = await request(app, "GET", "/api/devices/dev-1");
      expect(res.status).toBe(200);
      expect((res.body as any).id).toBe("dev-1");
      expect((res.body as any).name).toBe("Test Device dev-1");
      expect((res.body as any).type).toBe("light");
    });
  });

  describe("GET /api/devices/:id/actions", () => {
    it("should return 404 when device not found", async () => {
      const res = await request(app, "GET", "/api/devices/nonexistent/actions");
      expect(res.status).toBe(404);
      expect((res.body as any).error).toContain("Device not found");
    });

    it("should return the action catalog via the injected accessor", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      const catalog: CapabilityDescriptor[] = [
        { type: "toggle", displayName: "Toggle", params: [] } as unknown as CapabilityDescriptor,
      ];
      mockGetActionCatalog.mockReturnValue(catalog);

      const res = await request(app, "GET", "/api/devices/dev-1/actions");
      expect(res.status).toBe(200);
      expect(mockGetActionCatalog).toHaveBeenCalledWith("dev-1");
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].type).toBe("toggle");
    });
  });

  describe("GET /api/devices/:id/history", () => {
    it("should return empty array when stateHistory is not provided", async () => {
      // Create app without stateHistory
      const appNoHistory = express();
      appNoHistory.use(express.json());
      appNoHistory.use(
        "/api/devices",
        createDeviceRoutes(
          mockRegistry as unknown as DeviceRegistry,
          mockCommandService as unknown as CommandService,
          mockGetActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
          passthroughGuard,
          stubResolver,
          undefined,
        ),
      );
      appNoHistory.use(errorHandler);

      mockRegistry.getById.mockReturnValue(makeDevice("dev-1"));
      const res = await request(appNoHistory, "GET", "/api/devices/dev-1/history");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return 404 when device not found", async () => {
      const res = await request(app, "GET", "/api/devices/nonexistent/history");
      expect(res.status).toBe(404);
      expect((res.body as any).error).toContain("Device not found");
    });

    it("should return history entries for a device", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      const historyEntries = [
        { deviceId: "dev-1", state: { on: true }, timestamp: 1000 },
        { deviceId: "dev-1", state: { on: false }, timestamp: 900 },
      ];
      mockStateHistory.getHistory.mockReturnValue(historyEntries);

      const res = await request(app, "GET", "/api/devices/dev-1/history");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(2);
      expect(body[0].timestamp).toBe(1000);
    });

    it("should use time range query when from and to are provided", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      const rangeEntries = [
        { deviceId: "dev-1", state: { on: true }, timestamp: 500 },
      ];
      mockStateHistory.getHistoryRange.mockReturnValue(rangeEntries);

      const res = await request(app, "GET", "/api/devices/dev-1/history?from=100&to=1000");
      expect(res.status).toBe(200);
      expect(mockStateHistory.getHistoryRange).toHaveBeenCalledWith("dev-1", 100, 1000);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
    });

    it("should respect limit parameter clamped between 1 and 500", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      mockStateHistory.getHistory.mockReturnValue([]);

      await request(app, "GET", "/api/devices/dev-1/history?limit=200");
      expect(mockStateHistory.getHistory).toHaveBeenCalledWith("dev-1", 200);
    });
  });

  describe("DELETE /api/devices/:id/history", () => {
    it("should return success with 0 deleted when stateHistory is not provided", async () => {
      const appNoHistory = express();
      appNoHistory.use(express.json());
      appNoHistory.use(
        "/api/devices",
        createDeviceRoutes(
          mockRegistry as unknown as DeviceRegistry,
          mockCommandService as unknown as CommandService,
          mockGetActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
          passthroughGuard,
          stubResolver,
          undefined,
        ),
      );
      appNoHistory.use(errorHandler);

      const res = await request(appNoHistory, "DELETE", "/api/devices/dev-1/history");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 0 });
    });

    it("should return 404 when device not found", async () => {
      const res = await request(app, "DELETE", "/api/devices/nonexistent/history");
      expect(res.status).toBe(404);
      expect((res.body as any).error).toContain("Device not found");
    });

    it("should clear history for a specific device", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      mockStateHistory.clearDevice.mockReturnValue(5);

      const res = await request(app, "DELETE", "/api/devices/dev-1/history");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 5 });
      expect(mockStateHistory.clearDevice).toHaveBeenCalledWith("dev-1");
    });
  });

  describe("DELETE /api/devices/history/all", () => {
    it("should return success with 0 deleted when stateHistory is not provided", async () => {
      const appNoHistory = express();
      appNoHistory.use(express.json());
      appNoHistory.use(
        "/api/devices",
        createDeviceRoutes(
          mockRegistry as unknown as DeviceRegistry,
          mockCommandService as unknown as CommandService,
          mockGetActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
          passthroughGuard,
          stubResolver,
          undefined,
        ),
      );
      appNoHistory.use(errorHandler);

      const res = await request(appNoHistory, "DELETE", "/api/devices/history/all");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 0 });
    });

    it("should clear all device history", async () => {
      mockStateHistory.clearAll.mockReturnValue(15);

      const res = await request(app, "DELETE", "/api/devices/history/all");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 15 });
      expect(mockStateHistory.clearAll).toHaveBeenCalled();
    });
  });

  describe("GET /api/devices/:id/completion-tiers", () => {
    it("should return 501 when getCompletionTierCapability is not provided", async () => {
      // Default app setup does not pass getCompletionTierCapability
      const res = await request(app, "GET", "/api/devices/dev-1/completion-tiers");
      expect(res.status).toBe(501);
      expect((res.body as any).error).toContain("not available");
    });

    it("should return 404 with resolved:false when device is not found", async () => {
      const mockGetTierCap = vi.fn().mockReturnValue({ resolved: false, tiers: [], ceiling: null });
      const appWithTiers = express();
      appWithTiers.use(express.json());
      appWithTiers.use(
        "/api/devices",
        createDeviceRoutes(
          mockRegistry as unknown as DeviceRegistry,
          mockCommandService as unknown as CommandService,
          mockGetActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
          passthroughGuard,
          stubResolver,
          mockStateHistory as unknown as StateHistory,
          mockGetTierCap,
        ),
      );
      appWithTiers.use(errorHandler);

      const res = await request(appWithTiers, "GET", "/api/devices/nonexistent/completion-tiers");
      expect(res.status).toBe(404);
      expect((res.body as any).resolved).toBe(false);
    });

    it("should return available tiers and ceiling for a valid device", async () => {
      const mockGetTierCap = vi.fn().mockReturnValue({
        resolved: true,
        tiers: ["dispatch", "acknowledged"],
        ceiling: "acknowledged",
      });
      const appWithTiers = express();
      appWithTiers.use(express.json());
      appWithTiers.use(
        "/api/devices",
        createDeviceRoutes(
          mockRegistry as unknown as DeviceRegistry,
          mockCommandService as unknown as CommandService,
          mockGetActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
          passthroughGuard,
          stubResolver,
          mockStateHistory as unknown as StateHistory,
          mockGetTierCap,
        ),
      );
      appWithTiers.use(errorHandler);

      const res = await request(appWithTiers, "GET", "/api/devices/dev-1/completion-tiers");
      expect(res.status).toBe(200);
      expect((res.body as any).deviceId).toBe("dev-1");
      expect((res.body as any).resolved).toBe(true);
      expect((res.body as any).availableTiers).toEqual(["dispatch", "acknowledged"]);
      expect((res.body as any).ceiling).toBe("acknowledged");
    });
  });

  describe("POST /api/devices/:id/action", () => {
    it("should return HTTP 404 with the Command_Result when the device is not found", async () => {
      // The CommandService owns validation and returns a terminal Command_Result.
      mockCommandService.execute.mockResolvedValue({
        success: false,
        lifecycleState: "FAILED",
        error: "Device 'nonexistent' not found",
        failureKind: "not_found",
      });

      const res = await request(app, "POST", "/api/devices/nonexistent/action", {
        type: "toggle",
      });
      // Expressive status; body still carries the authoritative Command_Result.
      expect(res.status).toBe(404);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error).toContain("not found");
    });

    it("should return 400 when action type is missing", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);

      const res = await request(app, "POST", "/api/devices/dev-1/action", {});
      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain("Action type is required");
    });

    it("should route the action through the CommandService and return the Command_Result", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      mockCommandService.execute.mockResolvedValue({ success: true, lifecycleState: "DISPATCHED" });

      const res = await request(app, "POST", "/api/devices/dev-1/action", {
        type: "toggle",
        params: { on: false },
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect((res.body as any).lifecycleState).toBe("DISPATCHED");
      expect(mockCommandService.execute).toHaveBeenCalledWith(
        { type: "toggle", target: "dev-1", params: { on: false } },
        "rest:dev-1",
      );
    });

    it("should pass empty params when not provided in body", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      mockCommandService.execute.mockResolvedValue({ success: true, lifecycleState: "DISPATCHED" });

      const res = await request(app, "POST", "/api/devices/dev-1/action", {
        type: "setBrightness",
      });
      expect(res.status).toBe(200);
      expect(mockCommandService.execute).toHaveBeenCalledWith(
        { type: "setBrightness", target: "dev-1", params: {} },
        "rest:dev-1",
      );
    });

    it("should return HTTP 503 with the Command_Result for a transport failure", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      mockCommandService.execute.mockResolvedValue({
        success: false,
        lifecycleState: "FAILED",
        error: "MQTT broker not connected",
        failureKind: "transport",
      });

      const res = await request(app, "POST", "/api/devices/dev-1/action", {
        type: "toggle",
      });
      // Transport unavailable → 503, never a masked 200 or a 500.
      expect(res.status).toBe(503);
      expect((res.body as any).success).toBe(false);
      expect((res.body as any).error).toContain("MQTT broker not connected");
    });

    it("should return HTTP 504 with the Command_Result when the command times out", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      mockCommandService.execute.mockResolvedValue({
        success: false,
        lifecycleState: "TIMED_OUT",
        error: "Device command timed out",
      });

      const res = await request(app, "POST", "/api/devices/dev-1/action", {
        type: "toggle",
      });
      expect(res.status).toBe(504);
      expect((res.body as any).lifecycleState).toBe("TIMED_OUT");
    });

    it("should return HTTP 422 with the Command_Result for an unsupported action", async () => {
      const device = makeDevice("dev-1");
      mockRegistry.getById.mockReturnValue(device);
      mockCommandService.execute.mockResolvedValue({
        success: false,
        lifecycleState: "FAILED",
        error: "unsupported action 'spin'",
        failureKind: "unsupported",
      });

      const res = await request(app, "POST", "/api/devices/dev-1/action", {
        type: "spin",
      });
      expect(res.status).toBe(422);
      expect((res.body as any).success).toBe(false);
    });
  });
});
