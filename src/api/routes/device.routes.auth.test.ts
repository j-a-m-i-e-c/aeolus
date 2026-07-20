// src/api/routes/device.routes.auth.test.ts — Authorization tests for the
// destructive device-history routes. Unlike device.routes.test.ts (which mocks
// the auth middleware to pass through so it can focus on route logic), this
// suite exercises the REAL `authenticate` + `requireAdmin` middleware to verify
// that clearing device history is gated behind an admin role.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import { createDeviceRoutes } from "./device.routes.js";
import { authenticate } from "../../auth/auth-middleware.js";
import { _resetSecretCache } from "../../auth/token-service.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { CommandService } from "../../automations/command-service.js";
import type { CapabilityDescriptor } from "../../connectors/connector.interface.js";
import type { StateHistory } from "../../core/state-history.js";
import type { Device } from "../../core/types.js";

// Mock logger — keep test output clean.
vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const TEST_SECRET = "test-device-history-auth-secret";

/** Sign an access token with the same shape TokenService verifies. */
function createToken(role: "admin" | "user"): string {
  return jwt.sign(
    {
      userId: `user-${role}`,
      username: role,
      role,
      groupId: role === "admin" ? null : "group-1",
    },
    TEST_SECRET,
    { algorithm: "HS256", expiresIn: "15m" },
  );
}

/** Minimal HTTP helper — sends a request to an Express app and returns status + body. */
async function request(
  app: express.Express,
  method: string,
  path: string,
  headers?: Record<string, string>,
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
      fetch(url, {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json", ...headers },
      })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
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

function makeDevice(id: string): Device {
  return {
    id,
    name: `Test Device ${id}`,
    type: "light",
    capabilities: ["on/off"],
    state: { on: true },
    integration: "hue",
    lastSeen: Date.now(),
  };
}

describe("device.routes — destructive history routes require admin", () => {
  let app: express.Express;
  let mockRegistry: Record<string, any>;
  let mockStateHistory: Record<string, any>;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    _resetSecretCache();

    mockRegistry = {
      getAll: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(makeDevice("dev-1")),
    };

    const mockCommandService = {
      execute: vi.fn().mockResolvedValue({ success: true, lifecycleState: "DISPATCHED" }),
    };

    const mockGetActionCatalog = vi.fn().mockReturnValue([] as CapabilityDescriptor[]);

    mockStateHistory = {
      getHistory: vi.fn().mockReturnValue([]),
      getHistoryRange: vi.fn().mockReturnValue([]),
      clearDevice: vi.fn().mockReturnValue(7),
      clearAll: vi.fn().mockReturnValue(15),
    };

    app = express();
    app.use(express.json());
    // Apply the real authenticate middleware so req.user is populated from the token.
    app.use(authenticate);
    app.use(
      "/api/devices",
      createDeviceRoutes(
        mockRegistry as unknown as DeviceRegistry,
        mockCommandService as unknown as CommandService,
        mockGetActionCatalog as unknown as (id: string) => CapabilityDescriptor[],
        mockStateHistory as unknown as StateHistory,
      ),
    );
    app.use(errorHandler);
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    _resetSecretCache();
  });

  describe("DELETE /api/devices/:id/history", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const res = await request(app, "DELETE", "/api/devices/dev-1/history");
      expect(res.status).toBe(401);
      expect(mockStateHistory.clearDevice).not.toHaveBeenCalled();
    });

    it("rejects a non-admin user with 403", async () => {
      const res = await request(app, "DELETE", "/api/devices/dev-1/history", {
        Authorization: `Bearer ${createToken("user")}`,
      });
      expect(res.status).toBe(403);
      expect(mockStateHistory.clearDevice).not.toHaveBeenCalled();
    });

    it("allows an admin user to clear a device's history", async () => {
      const res = await request(app, "DELETE", "/api/devices/dev-1/history", {
        Authorization: `Bearer ${createToken("admin")}`,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 7 });
      expect(mockStateHistory.clearDevice).toHaveBeenCalledWith("dev-1");
    });
  });

  describe("DELETE /api/devices/history/all", () => {
    it("rejects an unauthenticated request with 401", async () => {
      const res = await request(app, "DELETE", "/api/devices/history/all");
      expect(res.status).toBe(401);
      expect(mockStateHistory.clearAll).not.toHaveBeenCalled();
    });

    it("rejects a non-admin user with 403", async () => {
      const res = await request(app, "DELETE", "/api/devices/history/all", {
        Authorization: `Bearer ${createToken("user")}`,
      });
      expect(res.status).toBe(403);
      expect(mockStateHistory.clearAll).not.toHaveBeenCalled();
    });

    it("allows an admin user to clear all history", async () => {
      const res = await request(app, "DELETE", "/api/devices/history/all", {
        Authorization: `Bearer ${createToken("admin")}`,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, deleted: 15 });
      expect(mockStateHistory.clearAll).toHaveBeenCalled();
    });
  });
});
