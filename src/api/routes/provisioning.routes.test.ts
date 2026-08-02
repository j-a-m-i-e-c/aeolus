// Feature: mqtt-device-provisioning — Integration tests for provisioning routes
// Properties 10, 11 + HTTP layer integration tests

import { describe, it, expect, vi, beforeEach } from "vitest";
import { test, fc } from "@fast-check/vitest";
import express from "express";
import { createProvisioningRoutes } from "./provisioning.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { ConflictError, NotFoundError } from "../middleware/error-handler.js";
import type { MqttProvisioningService, SecurityLevel, SecurityStatus } from "../../mqtt/mqtt-provisioning-service.js";

// Mock logger
vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock auth middleware — tests focus on route logic, not token verification.
// The authenticated user's role is driven by the `x-test-role` request header
// so individual tests can exercise the admin vs non-admin status redaction.
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => {
    const req = _req as express.Request;
    const role = req.headers["x-test-role"] === "user" ? "user" : "admin";
    req.user = {
      userId: role === "admin" ? "admin-1" : "user-1",
      username: role,
      role: role as "admin" | "user",
      groupId: null,
    };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Minimal HTTP helper — sends a request to an Express app and returns status + body */
async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
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
        headers: { "Content-Type": "application/json", ...headers },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(url, options)
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

function createMockProvisioningService(
  overrides: Partial<Record<keyof MqttProvisioningService, unknown>> = {},
): MqttProvisioningService {
  return {
    getStatus: vi.fn().mockReturnValue({
      level: "open",
      sharedCredential: null,
      backendConnected: true,
    } satisfies SecurityStatus),
    setSecurityLevel: vi.fn().mockResolvedValue({
      level: "open",
      sharedCredential: null,
      backendConnected: true,
    } satisfies SecurityStatus),
    regenerateSharedPassword: vi.fn().mockResolvedValue({
      username: "aeolus-shared",
      password: "new-random-password-base64url",
    }),
    createDeviceCredential: vi.fn().mockResolvedValue({
      id: "cred-123",
      deviceName: "test-device",
      username: "mqtt-test-device",
      password: "generated-password-base64url",
    }),
    revokeDeviceCredential: vi.fn().mockResolvedValue(undefined),
    listDeviceCredentials: vi.fn().mockReturnValue([]),
    initialize: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MqttProvisioningService;
}

function createApp(
  mockService: MqttProvisioningService,
  managedProvisioningEnabled = true,
): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/mqtt/provisioning",
    createProvisioningRoutes(mockService, { managedProvisioningEnabled }),
  );
  app.use(errorHandler);
  return app;
}

// ─── Integration Tests ───────────────────────────────────────────────────────

describe("Feature: mqtt-device-provisioning — Provisioning Routes Integration Tests", () => {
  let mockService: MqttProvisioningService;
  let app: express.Express;

  beforeEach(() => {
    mockService = createMockProvisioningService();
    app = createApp(mockService);
  });

  // ─── GET /status ─────────────────────────────────────────────────────────

  describe("GET /api/mqtt/provisioning/status", () => {
    it("returns 200 with security status", async () => {
      const res = await request(app, "GET", "/api/mqtt/provisioning/status");
      expect(res.status).toBe(200);
      const body = res.body as SecurityStatus;
      expect(body.level).toBe("open");
      expect(body.backendConnected).toBe(true);
      expect((res.body as { managedProvisioningEnabled: boolean }).managedProvisioningEnabled).toBe(true);
    });

    it("exposes the shared credential to admins", async () => {
      const sharedService = createMockProvisioningService({
        getStatus: vi.fn().mockReturnValue({
          level: "shared_password",
          sharedCredential: { username: "aeolus-shared", password: "super-secret-broker-pw" },
          backendConnected: true,
        } satisfies SecurityStatus),
      });
      const sharedApp = createApp(sharedService);

      const res = await request(sharedApp, "GET", "/api/mqtt/provisioning/status");
      expect(res.status).toBe(200);
      const body = res.body as SecurityStatus;
      expect(body.level).toBe("shared_password");
      expect(body.sharedCredential).toEqual({
        username: "aeolus-shared",
        password: "super-secret-broker-pw",
      });
    });

    it("redacts the shared credential for non-admins", async () => {
      const sharedService = createMockProvisioningService({
        getStatus: vi.fn().mockReturnValue({
          level: "shared_password",
          sharedCredential: { username: "aeolus-shared", password: "super-secret-broker-pw" },
          backendConnected: true,
        } satisfies SecurityStatus),
      });
      const sharedApp = createApp(sharedService);

      const res = await request(
        sharedApp,
        "GET",
        "/api/mqtt/provisioning/status",
        undefined,
        { "x-test-role": "user" },
      );
      expect(res.status).toBe(200);
      const body = res.body as SecurityStatus;
      // Non-admins still see level/connection (useful health signal)...
      expect(body.level).toBe("shared_password");
      expect(body.backendConnected).toBe(true);
      // ...but never the broker-wide password.
      expect(body.sharedCredential).toBeNull();
      expect(JSON.stringify(body)).not.toContain("super-secret-broker-pw");
    });
  });

  it("reports management as disabled and rejects mutating operations by default", async () => {
    const disabledApp = createApp(mockService, false);

    const status = await request(disabledApp, "GET", "/api/mqtt/provisioning/status");
    expect(status.status).toBe(200);
    expect((status.body as { managedProvisioningEnabled: boolean }).managedProvisioningEnabled).toBe(false);

    const mutation = await request(disabledApp, "PUT", "/api/mqtt/provisioning/level", {
      level: "shared_password",
    });
    expect(mutation.status).toBe(503);
    expect((mutation.body as { error: string }).error).toContain("under development");
    expect(mockService.setSecurityLevel).not.toHaveBeenCalled();
  });

  // ─── PUT /level ──────────────────────────────────────────────────────────

  describe("PUT /api/mqtt/provisioning/level", () => {
    it("returns 200 with valid body", async () => {
      (mockService.setSecurityLevel as ReturnType<typeof vi.fn>).mockResolvedValue({
        level: "shared_password",
        sharedCredential: { username: "aeolus-shared", password: "abc123" },
        backendConnected: true,
      });

      const res = await request(app, "PUT", "/api/mqtt/provisioning/level", {
        level: "shared_password",
      });
      expect(res.status).toBe(200);
      expect((res.body as SecurityStatus).level).toBe("shared_password");
    });

    it("returns 400 with invalid body (missing level)", async () => {
      const res = await request(app, "PUT", "/api/mqtt/provisioning/level", {});
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe("Validation failed");
    });

    it("returns 400 with invalid level value", async () => {
      const res = await request(app, "PUT", "/api/mqtt/provisioning/level", {
        level: "invalid_level",
      });
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe("Validation failed");
    });
  });

  // ─── POST /shared/regenerate ─────────────────────────────────────────────

  describe("POST /api/mqtt/provisioning/shared/regenerate", () => {
    it("returns 200 when in shared_password mode", async () => {
      const res = await request(
        app,
        "POST",
        "/api/mqtt/provisioning/shared/regenerate",
      );
      expect(res.status).toBe(200);
      const body = res.body as { username: string; password: string };
      expect(body.username).toBe("aeolus-shared");
      expect(body.password).toBeDefined();
    });

    it("returns 409 when not in shared_password mode", async () => {
      (mockService.regenerateSharedPassword as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ConflictError("Operation requires shared_password security level"),
      );

      const res = await request(
        app,
        "POST",
        "/api/mqtt/provisioning/shared/regenerate",
      );
      expect(res.status).toBe(409);
      expect((res.body as { error: string }).error).toContain(
        "shared_password",
      );
    });
  });

  // ─── GET /credentials ────────────────────────────────────────────────────

  describe("GET /api/mqtt/provisioning/credentials", () => {
    it("returns 200 with credential list", async () => {
      (mockService.listDeviceCredentials as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          id: "cred-1",
          deviceName: "sensor-1",
          username: "mqtt-sensor-1",
          createdAt: Date.now(),
        },
      ]);

      const res = await request(
        app,
        "GET",
        "/api/mqtt/provisioning/credentials",
      );
      expect(res.status).toBe(200);
      const body = res.body as Array<{ id: string }>;
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("cred-1");
    });
  });

  // ─── POST /credentials ──────────────────────────────────────────────────

  describe("POST /api/mqtt/provisioning/credentials", () => {
    it("returns 201 with valid body", async () => {
      const res = await request(
        app,
        "POST",
        "/api/mqtt/provisioning/credentials",
        { deviceName: "my-sensor" },
      );
      expect(res.status).toBe(201);
      const body = res.body as { id: string; username: string; password: string };
      expect(body.id).toBe("cred-123");
      expect(body.username).toBe("mqtt-test-device");
      expect(body.password).toBeDefined();
    });

    it("returns 400 with invalid body (empty deviceName)", async () => {
      const res = await request(
        app,
        "POST",
        "/api/mqtt/provisioning/credentials",
        { deviceName: "" },
      );
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe("Validation failed");
    });

    it("returns 400 with missing deviceName", async () => {
      const res = await request(
        app,
        "POST",
        "/api/mqtt/provisioning/credentials",
        {},
      );
      expect(res.status).toBe(400);
    });

    it("returns 409 when not in per_device mode", async () => {
      (mockService.createDeviceCredential as ReturnType<typeof vi.fn>).mockRejectedValue(
        new ConflictError("Operation requires per_device security level"),
      );

      const res = await request(
        app,
        "POST",
        "/api/mqtt/provisioning/credentials",
        { deviceName: "my-sensor" },
      );
      expect(res.status).toBe(409);
    });
  });

  // ─── DELETE /credentials/:id ─────────────────────────────────────────────

  describe("DELETE /api/mqtt/provisioning/credentials/:id", () => {
    it("returns 200 on successful revocation", async () => {
      const res = await request(
        app,
        "DELETE",
        "/api/mqtt/provisioning/credentials/cred-123",
      );
      expect(res.status).toBe(200);
      expect((res.body as { success: boolean }).success).toBe(true);
    });

    it("returns 404 when credential not found", async () => {
      (mockService.revokeDeviceCredential as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError("MQTT credential not found"),
      );

      const res = await request(
        app,
        "DELETE",
        "/api/mqtt/provisioning/credentials/nonexistent",
      );
      expect(res.status).toBe(404);
      expect((res.body as { error: string }).error).toContain("not found");
    });
  });

  // ─── Property 10: Mode-mismatch operations return HTTP 409 ─────────────────
  // **Validates: Requirements 9.7**

  describe("Property 10: Mode-mismatch operations return HTTP 409", () => {
    test.prop(
      [fc.constantFrom<SecurityLevel>("open", "shared_password")],
      { numRuns: 100 },
    )(
      "POST /credentials returns 409 when not in per_device mode",
      async () => {
        const conflictService = createMockProvisioningService({
          createDeviceCredential: vi
            .fn()
            .mockRejectedValue(
              new ConflictError("Operation requires per_device security level"),
            ),
        });
        const conflictApp = createApp(conflictService);

        const res = await request(
          conflictApp,
          "POST",
          "/api/mqtt/provisioning/credentials",
          { deviceName: "test-device" },
        );
        expect(res.status).toBe(409);
        expect((res.body as { error: string }).error).toContain("per_device");
      },
    );

    test.prop(
      [fc.constantFrom<SecurityLevel>("open", "per_device")],
      { numRuns: 100 },
    )(
      "POST /shared/regenerate returns 409 when not in shared_password mode",
      async () => {
        const conflictService = createMockProvisioningService({
          regenerateSharedPassword: vi
            .fn()
            .mockRejectedValue(
              new ConflictError(
                "Operation requires shared_password security level",
              ),
            ),
        });
        const conflictApp = createApp(conflictService);

        const res = await request(
          conflictApp,
          "POST",
          "/api/mqtt/provisioning/shared/regenerate",
        );
        expect(res.status).toBe(409);
        expect((res.body as { error: string }).error).toContain(
          "shared_password",
        );
      },
    );
  });

  // ─── Property 11: Status endpoint reflects current state ───────────────────
  // **Validates: Requirements 1.4, 10.3**

  describe("Property 11: Status endpoint reflects current state", () => {
    const validLevels: SecurityLevel[] = ["open", "shared_password", "per_device"];

    test.prop([fc.constantFrom<SecurityLevel>(...validLevels)], { numRuns: 100 })(
      "GET /status returns the level that was set on the service",
      async (level) => {
        const statusForLevel: SecurityStatus = {
          level,
          sharedCredential:
            level === "shared_password"
              ? { username: "aeolus-shared", password: "test-pass" }
              : null,
          backendConnected: true,
        };

        const statusService = createMockProvisioningService({
          getStatus: vi.fn().mockReturnValue(statusForLevel),
        });
        const statusApp = createApp(statusService);

        const res = await request(
          statusApp,
          "GET",
          "/api/mqtt/provisioning/status",
        );
        expect(res.status).toBe(200);
        const body = res.body as SecurityStatus;
        expect(body.level).toBe(level);

        if (level === "shared_password") {
          expect(body.sharedCredential).not.toBeNull();
          expect(body.sharedCredential?.username).toBe("aeolus-shared");
        } else {
          expect(body.sharedCredential).toBeNull();
        }
      },
    );
  });
});
