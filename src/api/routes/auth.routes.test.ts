// src/api/routes/auth.routes.test.ts — Unit tests for auth route handlers
// Tests login, setup, refresh, logout, password change, user/group/MQTT credential CRUD
// Requirements: 8.4

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import { createAuthRoutes } from "./auth.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockAuthenticate = vi.fn((req: any, _res: any, next: any) => {
    req.user = {
      userId: "test-user-id",
      username: "testuser",
      role: "admin" as const,
      groupId: null,
    };
    next();
  });

  const mockRequireAdmin = vi.fn((_req: any, _res: any, next: any) => next());
  const mockCreateSetupGuard = vi.fn(() => (_req: any, _res: any, next: any) => next());

  return {
    mockAuthenticate,
    mockRequireAdmin,
    mockCreateSetupGuard,
    // Auth service
    needsSetup: vi.fn().mockReturnValue(true),
    setupAdmin: vi.fn().mockResolvedValue({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      user: { id: "admin-id", username: "admin", role: "admin" },
    }),
    login: vi.fn().mockResolvedValue({
      accessToken: "access-token-789",
      refreshToken: "refresh-token-abc",
      user: { id: "user-id", username: "testuser", role: "admin" },
    }),
    refresh: vi.fn().mockReturnValue("new-access-token-xyz"),
    logout: vi.fn(),
    // User service
    changePassword: vi.fn().mockResolvedValue(undefined),
    listUsers: vi.fn().mockReturnValue([
      { id: "u1", username: "admin", role: "admin", groupId: null, createdAt: 1000 },
    ]),
    createUser: vi.fn().mockResolvedValue({
      id: "new-user-id",
      username: "newuser",
      role: "user",
      groupId: "group-1",
      createdAt: 2000,
    }),
    updateUser: vi.fn().mockResolvedValue({
      id: "u1",
      username: "admin",
      role: "admin",
      groupId: "group-2",
      createdAt: 1000,
    }),
    deleteUser: vi.fn(),
    // Group service
    listGroups: vi.fn().mockReturnValue([
      { id: "g1", name: "Viewers", tabAssignments: [], createdAt: 1000 },
    ]),
    createGroup: vi.fn().mockReturnValue({
      id: "new-group-id",
      name: "Editors",
      tabAssignments: [{ tabId: "tab-1", permission: "write" }],
      createdAt: 3000,
    }),
    updateGroup: vi.fn().mockReturnValue({
      id: "g1",
      name: "Updated",
      tabAssignments: [{ tabId: "tab-2", permission: "read" }],
      createdAt: 1000,
    }),
    deleteGroup: vi.fn(),
    // MQTT credential service
    listCredentials: vi.fn().mockReturnValue([
      { id: "mc1", deviceName: "sensor-1", username: "mqtt-sensor-1", createdAt: 1000 },
    ]),
    createCredential: vi.fn().mockResolvedValue({
      id: "new-cred-id",
      deviceName: "new-sensor",
      username: "mqtt-new-sensor",
      password: "generated-pass",
      createdAt: 4000,
    }),
    deleteCredential: vi.fn(),
    // Permission service
    getUserAccessibleTabs: vi.fn().mockReturnValue([
      { tabId: "tab-1", permission: "write" },
    ]),
  };
});

vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (...args: any[]) => mocks.mockAuthenticate(...args),
  requireAdmin: (...args: any[]) => mocks.mockRequireAdmin(...args),
  createSetupGuard: (...args: any[]) => mocks.mockCreateSetupGuard(...args),
}));

vi.mock("../../auth/auth-service.js", () => ({
  needsSetup: (...args: any[]) => mocks.needsSetup(...args),
  setupAdmin: (...args: any[]) => mocks.setupAdmin(...args),
  login: (...args: any[]) => mocks.login(...args),
  refresh: (...args: any[]) => mocks.refresh(...args),
  logout: (...args: any[]) => mocks.logout(...args),
}));

vi.mock("../../auth/user-service.js", () => ({
  changePassword: (...args: any[]) => mocks.changePassword(...args),
  listUsers: (...args: any[]) => mocks.listUsers(...args),
  createUser: (...args: any[]) => mocks.createUser(...args),
  updateUser: (...args: any[]) => mocks.updateUser(...args),
  deleteUser: (...args: any[]) => mocks.deleteUser(...args),
}));

vi.mock("../../auth/group-service.js", () => ({
  listGroups: (...args: any[]) => mocks.listGroups(...args),
  createGroup: (...args: any[]) => mocks.createGroup(...args),
  updateGroup: (...args: any[]) => mocks.updateGroup(...args),
  deleteGroup: (...args: any[]) => mocks.deleteGroup(...args),
}));

vi.mock("../../auth/mqtt-credential-service.js", () => ({
  listCredentials: (...args: any[]) => mocks.listCredentials(...args),
  createCredential: (...args: any[]) => mocks.createCredential(...args),
  deleteCredential: (...args: any[]) => mocks.deleteCredential(...args),
}));

vi.mock("../../auth/permission-service.js", () => ({
  getUserAccessibleTabs: (...args: any[]) => mocks.getUserAccessibleTabs(...args),
}));

// Mock rate limiter to pass through
vi.mock("express-rate-limit", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── Test Helpers ────────────────────────────────────────────────────────────

/** Minimal HTTP helper — sends a request to an Express app and returns status + body */
async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
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
          const json = await res.json().catch(() => ({}));
          const responseHeaders: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });
          server.close();
          resolve({ status: res.status, body: json, headers: responseHeaders });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

/** Send a request with a cookie header */
async function requestWithCookie(
  app: express.Express,
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
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
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(url, options)
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          const responseHeaders: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });
          server.close();
          resolve({ status: res.status, body: json, headers: responseHeaders });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", createAuthRoutes());
  app.use(errorHandler);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("auth.routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.needsSetup.mockReturnValue(true);
    mocks.setupAdmin.mockResolvedValue({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      user: { id: "admin-id", username: "admin", role: "admin" },
    });
    mocks.login.mockResolvedValue({
      accessToken: "access-token-789",
      refreshToken: "refresh-token-abc",
      user: { id: "user-id", username: "testuser", role: "admin" },
    });
    mocks.refresh.mockReturnValue("new-access-token-xyz");
    mocks.mockAuthenticate.mockImplementation((req: any, _res: any, next: any) => {
      req.user = {
        userId: "test-user-id",
        username: "testuser",
        role: "admin" as const,
        groupId: null,
      };
      next();
    });
    mocks.mockRequireAdmin.mockImplementation((_req: any, _res: any, next: any) => next());
    app = createApp();
  });

  // ─── GET /api/auth/status ──────────────────────────────────────────────────

  describe("GET /api/auth/status", () => {
    it("returns needsSetup: true when no admin exists", async () => {
      mocks.needsSetup.mockReturnValue(true);
      const res = await request(app, "GET", "/api/auth/status");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ needsSetup: true });
    });

    it("returns needsSetup: false when admin exists", async () => {
      mocks.needsSetup.mockReturnValue(false);
      const res = await request(app, "GET", "/api/auth/status");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ needsSetup: false });
    });
  });

  // ─── POST /api/auth/setup ─────────────────────────────────────────────────

  describe("POST /api/auth/setup", () => {
    it("returns 201 with accessToken and user on successful setup", async () => {
      const res = await request(app, "POST", "/api/auth/setup", {
        username: "admin",
        password: "securepass123",
      });
      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.accessToken).toBe("access-token-123");
      expect(body.user).toEqual({ id: "admin-id", username: "admin", role: "admin" });
      expect(mocks.setupAdmin).toHaveBeenCalledWith("admin", "securepass123");
    });

    it("returns 400 when username is missing", async () => {
      const res = await request(app, "POST", "/api/auth/setup", {
        password: "securepass123",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when password is too short", async () => {
      const res = await request(app, "POST", "/api/auth/setup", {
        username: "admin",
        password: "short",
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/auth/login ─────────────────────────────────────────────────

  describe("POST /api/auth/login", () => {
    it("returns 200 with accessToken and user on valid credentials", async () => {
      const res = await request(app, "POST", "/api/auth/login", {
        username: "testuser",
        password: "validpassword123",
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.accessToken).toBe("access-token-789");
      expect(body.user).toEqual({ id: "user-id", username: "testuser", role: "admin" });
      expect(mocks.login).toHaveBeenCalledWith("testuser", "validpassword123");
    });

    it("sets refresh token as HttpOnly cookie", async () => {
      const res = await request(app, "POST", "/api/auth/login", {
        username: "testuser",
        password: "validpassword123",
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("refreshToken=");
      expect(setCookie).toContain("HttpOnly");
    });

    it("returns 401 when credentials are invalid", async () => {
      const { UnauthorizedError } = await import("../middleware/error-handler.js");
      mocks.login.mockRejectedValue(new UnauthorizedError("Invalid username or password"));
      const res = await request(app, "POST", "/api/auth/login", {
        username: "baduser",
        password: "wrongpass",
      });
      expect(res.status).toBe(401);
      const body = res.body as any;
      expect(body.error).toContain("Invalid");
    });

    it("returns 400 when username is missing", async () => {
      const res = await request(app, "POST", "/api/auth/login", {
        password: "somepassword",
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/auth/refresh ───────────────────────────────────────────────

  describe("POST /api/auth/refresh", () => {
    it("returns new accessToken when valid refresh cookie is present", async () => {
      const res = await requestWithCookie(
        app,
        "POST",
        "/api/auth/refresh",
        "refreshToken=valid-refresh-token",
      );
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.accessToken).toBe("new-access-token-xyz");
      expect(mocks.refresh).toHaveBeenCalledWith("valid-refresh-token");
    });

    it("returns 401 when no refresh cookie is present", async () => {
      const res = await request(app, "POST", "/api/auth/refresh");
      expect(res.status).toBe(401);
      const body = res.body as any;
      expect(body.error).toContain("No refresh token");
    });

    it("returns 401 when refresh token is invalid", async () => {
      const { UnauthorizedError } = await import("../middleware/error-handler.js");
      mocks.refresh.mockImplementation(() => {
        throw new UnauthorizedError("Invalid or expired refresh token");
      });
      const res = await requestWithCookie(
        app,
        "POST",
        "/api/auth/refresh",
        "refreshToken=expired-token",
      );
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /api/auth/logout ────────────────────────────────────────────────

  describe("POST /api/auth/logout", () => {
    it("returns success and calls logout with refresh token", async () => {
      const res = await requestWithCookie(
        app,
        "POST",
        "/api/auth/logout",
        "refreshToken=some-token",
      );
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(mocks.logout).toHaveBeenCalledWith("some-token");
    });

    it("returns success even without refresh cookie", async () => {
      const res = await request(app, "POST", "/api/auth/logout");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(mocks.logout).not.toHaveBeenCalled();
    });
  });

  // ─── PUT /api/auth/password ───────────────────────────────────────────────

  describe("PUT /api/auth/password", () => {
    it("returns success when password change succeeds", async () => {
      const res = await request(app, "PUT", "/api/auth/password", {
        currentPassword: "oldpass123",
        newPassword: "newpass456!",
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(mocks.changePassword).toHaveBeenCalledWith(
        "test-user-id",
        "oldpass123",
        "newpass456!",
      );
    });

    it("returns 400 when newPassword is too short", async () => {
      const res = await request(app, "PUT", "/api/auth/password", {
        currentPassword: "oldpass123",
        newPassword: "short",
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/auth/me ─────────────────────────────────────────────────────

  describe("GET /api/auth/me", () => {
    it("returns current user info with accessible tabs", async () => {
      const res = await request(app, "GET", "/api/auth/me");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.id).toBe("test-user-id");
      expect(body.username).toBe("testuser");
      expect(body.role).toBe("admin");
      expect(body.groupId).toBeNull();
      expect(body.accessibleTabs).toEqual([{ tabId: "tab-1", permission: "write" }]);
    });
  });

  // ─── GET /api/auth/users ──────────────────────────────────────────────────

  describe("GET /api/auth/users", () => {
    it("returns list of users", async () => {
      const res = await request(app, "GET", "/api/auth/users");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].username).toBe("admin");
    });
  });

  // ─── POST /api/auth/users ─────────────────────────────────────────────────

  describe("POST /api/auth/users", () => {
    it("returns 201 with created user", async () => {
      const res = await request(app, "POST", "/api/auth/users", {
        username: "newuser",
        password: "password123",
        groupId: "group-1",
      });
      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.id).toBe("new-user-id");
      expect(body.username).toBe("newuser");
      expect(body.role).toBe("user");
      expect(body.groupId).toBe("group-1");
    });

    it("returns 400 when username is empty", async () => {
      const res = await request(app, "POST", "/api/auth/users", {
        username: "",
        password: "password123",
        groupId: "group-1",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when password is too short", async () => {
      const res = await request(app, "POST", "/api/auth/users", {
        username: "newuser",
        password: "short",
        groupId: "group-1",
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /api/auth/users/:id ──────────────────────────────────────────────

  describe("PUT /api/auth/users/:id", () => {
    it("returns updated user", async () => {
      const res = await request(app, "PUT", "/api/auth/users/u1", {
        groupId: "group-2",
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.id).toBe("u1");
      expect(body.groupId).toBe("group-2");
      expect(mocks.updateUser).toHaveBeenCalledWith("u1", { groupId: "group-2" });
    });
  });

  // ─── DELETE /api/auth/users/:id ───────────────────────────────────────────

  describe("DELETE /api/auth/users/:id", () => {
    it("returns success on deletion", async () => {
      const res = await request(app, "DELETE", "/api/auth/users/u1");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(mocks.deleteUser).toHaveBeenCalledWith("u1");
    });
  });

  // ─── GET /api/auth/groups ─────────────────────────────────────────────────

  describe("GET /api/auth/groups", () => {
    it("returns list of groups", async () => {
      const res = await request(app, "GET", "/api/auth/groups");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("Viewers");
    });
  });

  // ─── POST /api/auth/groups ────────────────────────────────────────────────

  describe("POST /api/auth/groups", () => {
    it("returns 201 with created group", async () => {
      const res = await request(app, "POST", "/api/auth/groups", {
        name: "Editors",
        tabAssignments: [{ tabId: "tab-1", permission: "write" }],
      });
      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.id).toBe("new-group-id");
      expect(body.name).toBe("Editors");
    });

    it("returns 400 when name is empty", async () => {
      const res = await request(app, "POST", "/api/auth/groups", {
        name: "",
        tabAssignments: [],
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT /api/auth/groups/:id ─────────────────────────────────────────────

  describe("PUT /api/auth/groups/:id", () => {
    it("returns updated group", async () => {
      const res = await request(app, "PUT", "/api/auth/groups/g1", {
        name: "Updated",
        tabAssignments: [{ tabId: "tab-2", permission: "read" }],
      });
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.name).toBe("Updated");
      expect(mocks.updateGroup).toHaveBeenCalledWith(
        "g1",
        "Updated",
        [{ tabId: "tab-2", permission: "read" }],
      );
    });
  });

  // ─── DELETE /api/auth/groups/:id ──────────────────────────────────────────

  describe("DELETE /api/auth/groups/:id", () => {
    it("returns success on deletion", async () => {
      const res = await request(app, "DELETE", "/api/auth/groups/g1");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(mocks.deleteGroup).toHaveBeenCalledWith("g1");
    });
  });

  // ─── GET /api/auth/mqtt-credentials ───────────────────────────────────────

  describe("GET /api/auth/mqtt-credentials", () => {
    it("returns list of MQTT credentials", async () => {
      const res = await request(app, "GET", "/api/auth/mqtt-credentials");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].deviceName).toBe("sensor-1");
    });
  });

  // ─── POST /api/auth/mqtt-credentials ──────────────────────────────────────

  describe("POST /api/auth/mqtt-credentials", () => {
    it("returns 201 with created credential", async () => {
      const res = await request(app, "POST", "/api/auth/mqtt-credentials", {
        deviceName: "new-sensor",
      });
      expect(res.status).toBe(201);
      const body = res.body as any;
      expect(body.id).toBe("new-cred-id");
      expect(body.deviceName).toBe("new-sensor");
      expect(body.username).toBe("mqtt-new-sensor");
      expect(mocks.createCredential).toHaveBeenCalledWith("new-sensor");
    });

    it("returns 400 when deviceName is empty", async () => {
      const res = await request(app, "POST", "/api/auth/mqtt-credentials", {
        deviceName: "",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when deviceName is missing", async () => {
      const res = await request(app, "POST", "/api/auth/mqtt-credentials", {});
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /api/auth/mqtt-credentials/:id ────────────────────────────────

  describe("DELETE /api/auth/mqtt-credentials/:id", () => {
    it("returns success on deletion", async () => {
      const res = await request(app, "DELETE", "/api/auth/mqtt-credentials/mc1");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.success).toBe(true);
      expect(mocks.deleteCredential).toHaveBeenCalledWith("mc1");
    });

    it("returns 404 when credential not found", async () => {
      const { NotFoundError } = await import("../middleware/error-handler.js");
      mocks.deleteCredential.mockImplementation(() => {
        throw new NotFoundError("MQTT credential not found");
      });
      const res = await request(app, "DELETE", "/api/auth/mqtt-credentials/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/auth/mqtt-credentials error handling", () => {
    it("returns 409 when credential already exists", async () => {
      const { ConflictError } = await import("../middleware/error-handler.js");
      mocks.createCredential.mockRejectedValue(new ConflictError("already exists"));
      const res = await request(app, "POST", "/api/auth/mqtt-credentials", {
        deviceName: "duplicate-sensor",
      });
      expect(res.status).toBe(409);
    });
  });
});
