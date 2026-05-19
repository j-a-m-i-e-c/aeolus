// src/api/routes/service.routes.test.ts — Unit tests for service routes

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createServiceRoutes } from "./service.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../auth/auth-middleware.js", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockServiceManager() {
  return {
    listEnabled: vi.fn().mockReturnValue([
      { id: "svc-1", serviceType: "cron", displayName: "Cron Scheduler", icon: "clock", config: {}, health: { status: "running", lastActivity: 1000 }, enabled: true },
    ]),
    enable: vi.fn().mockResolvedValue("new-svc-id"),
    disable: vi.fn().mockResolvedValue(undefined),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({ id: "svc-1", serviceType: "cron", health: { status: "running", lastActivity: 1000 } }),
    retry: vi.fn().mockResolvedValue(undefined),
    getServiceInstance: vi.fn().mockReturnValue(undefined),
  };
}

function createMockServiceRegistry() {
  return {
    listAvailable: vi.fn().mockReturnValue([
      { metadata: { id: "cron", displayName: "Cron Scheduler", icon: "clock", description: "Time-based scheduling", category: "scheduling" }, configSchema: [{ id: "schedules", label: "Schedules", type: "text", required: false }] },
      { metadata: { id: "trigger", displayName: "API Trigger", icon: "webhook", description: "HTTP triggers", category: "integration" }, configSchema: [] },
    ]),
    getModule: vi.fn().mockReturnValue({
      metadata: { id: "cron", displayName: "Cron Scheduler" },
      configSchema: [{ id: "schedules", label: "Schedules", type: "text", required: false }],
      createService: vi.fn(),
    }),
  };
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) options.body = JSON.stringify(body);
      fetch(`http://127.0.0.1:${addr.port}${path}`, options)
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("service.routes", () => {
  let app: express.Express;
  let serviceManager: ReturnType<typeof createMockServiceManager>;
  let serviceRegistry: ReturnType<typeof createMockServiceRegistry>;

  beforeEach(() => {
    vi.clearAllMocks();
    serviceManager = createMockServiceManager();
    serviceRegistry = createMockServiceRegistry();
    app = express();
    app.use(express.json());
    app.use("/api/services", createServiceRoutes(serviceManager as any, serviceRegistry as any));
    app.use(errorHandler);
  });

  describe("GET /api/services/available", () => {
    it("returns list of available service types", async () => {
      const res = await request(app, "GET", "/api/services/available");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(serviceRegistry.listAvailable).toHaveBeenCalled();
    });
  });

  describe("GET /api/services/topics", () => {
    it("returns empty topics when no services have topics", async () => {
      const res = await request(app, "GET", "/api/services/topics");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("returns cron topics when cron service has schedules", async () => {
      serviceManager.listEnabled.mockReturnValue([
        { id: "svc-1", serviceType: "cron", config: {} },
      ]);
      serviceManager.getServiceInstance.mockReturnValue({
        getState: () => ({ schedules: [{ name: "backup" }, { name: "cleanup" }] }),
      });

      const res = await request(app, "GET", "/api/services/topics");
      expect(res.status).toBe(200);
      expect(res.body).toContain("service/cron/backup");
      expect(res.body).toContain("service/cron/cleanup");
    });

    it("returns trigger and system topics", async () => {
      serviceManager.listEnabled.mockReturnValue([
        { id: "svc-2", serviceType: "trigger", config: {} },
        { id: "svc-3", serviceType: "system", config: {} },
      ]);

      const res = await request(app, "GET", "/api/services/topics");
      expect(res.status).toBe(200);
      expect(res.body).toContain("service/trigger/{name}");
      expect(res.body).toContain("service/system/startup");
      expect(res.body).toContain("service/system/shutdown");
    });
  });

  describe("GET /api/services", () => {
    it("returns list of enabled services", async () => {
      const res = await request(app, "GET", "/api/services");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].serviceType).toBe("cron");
    });
  });

  describe("POST /api/services", () => {
    it("enables a service and returns success with id", async () => {
      const res = await request(app, "POST", "/api/services", {
        service_type: "cron",
        config: { schedules: "[]" },
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBe("new-svc-id");
      expect(serviceManager.enable).toHaveBeenCalledWith("cron", { schedules: "[]" });
    });

    it("returns 404 when service type not found", async () => {
      serviceRegistry.getModule.mockReturnValue(null);
      const res = await request(app, "POST", "/api/services", {
        service_type: "unknown",
        config: {},
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("returns 400 when required config fields are missing", async () => {
      serviceRegistry.getModule.mockReturnValue({
        metadata: { id: "cron" },
        configSchema: [{ id: "schedules", label: "Schedules", type: "text", required: true }],
      });
      const res = await request(app, "POST", "/api/services", {
        service_type: "cron",
        config: {},
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("schedules");
    });
  });

  describe("POST /api/services/trigger/:name", () => {
    it("fires a trigger and returns success", async () => {
      const mockTriggerInstance = { emitTrigger: vi.fn() };
      serviceManager.getServiceInstance.mockReturnValue(mockTriggerInstance);

      const res = await request(app, "POST", "/api/services/trigger/my-event", { data: "test" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.trigger).toBe("my-event");
      expect(mockTriggerInstance.emitTrigger).toHaveBeenCalledWith("my-event", { data: "test" });
    });

    it("returns success even when trigger service is not enabled", async () => {
      serviceManager.getServiceInstance.mockReturnValue(undefined);
      const res = await request(app, "POST", "/api/services/trigger/test");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("PATCH /api/services/:id", () => {
    it("updates service config and returns success", async () => {
      const res = await request(app, "PATCH", "/api/services/svc-1", {
        config: { schedules: '[{"name":"test","cron":"* * * * *"}]' },
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(serviceManager.updateConfig).toHaveBeenCalledWith("svc-1", { schedules: '[{"name":"test","cron":"* * * * *"}]' });
    });
  });

  describe("DELETE /api/services/:id", () => {
    it("disables a service and returns success", async () => {
      const res = await request(app, "DELETE", "/api/services/svc-1");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(serviceManager.disable).toHaveBeenCalledWith("svc-1");
    });
  });

  describe("GET /api/services/:id/status", () => {
    it("returns service status", async () => {
      const res = await request(app, "GET", "/api/services/svc-1/status");
      expect(res.status).toBe(200);
      expect(res.body.serviceType).toBe("cron");
    });

    it("returns 404 when service not found", async () => {
      serviceManager.getStatus.mockReturnValue(undefined);
      const res = await request(app, "GET", "/api/services/nonexistent/status");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/services/:id/retry", () => {
    it("retries a service and returns success", async () => {
      const res = await request(app, "POST", "/api/services/svc-1/retry");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(serviceManager.retry).toHaveBeenCalledWith("svc-1");
    });
  });
});
