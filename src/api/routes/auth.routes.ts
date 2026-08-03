// src/api/routes/auth.routes.ts — Authentication, user, group, and MQTT credential endpoints

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import {
  setupSchema,
  loginSchema,
  passwordChangeSchema,
  createUserSchema,
  updateUserSchema,
  createGroupSchema,
  updateGroupSchema,
  createMqttCredentialSchema,
} from "../schemas/auth.schemas.js";
import {
  authenticate,
  requireAdmin,
  createSetupGuard,
} from "../../auth/auth-middleware.js";
import * as authService from "../../auth/auth-service.js";
import * as userService from "../../auth/user-service.js";
import * as groupService from "../../auth/group-service.js";
import * as mqttCredentialService from "../../auth/mqtt-credential-service.js";
import { getUserAccessibleTabs } from "../../auth/permission-service.js";
import { config } from "../../config.js";
import { NotFoundError } from "../middleware/error-handler.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_MAX_AGE = 604800; // 7 days in seconds

// ─── Login Rate Limiter ──────────────────────────────────────────────────────

/**
 * Dedicated rate limiter for POST /api/auth/login.
 * 5 requests per minute per IP, independent from the global rate limiter.
 */
const loginRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later" },
});

/**
 * Rate limiter for public-demo session creation: 10 requests per minute per IP,
 * independent of login. Bounds anonymous session churn (public-demo-mode spec,
 * Req 2.8, 9.1).
 */
const demoSessionRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many demo session requests, please try again later" },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set the refresh token as an HttpOnly cookie.
 */
function setRefreshCookie(res: import("express").Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE * 1000, // Express expects milliseconds
  });
}

/**
 * Clear the refresh token cookie.
 */
function clearRefreshCookie(res: import("express").Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth",
  });
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAuthRoutes(): Router {
  const router = Router();
  const setupGuard = createSetupGuard(() => authService.needsSetup());

  // ─── Public Status Endpoint ──────────────────────────────────────────────

  /** GET /api/auth/status — Public endpoint to check if setup is needed */
  router.get("/status", (_req, res) => {
    res.json({ needsSetup: authService.needsSetup() });
  });

  // ─── Core Auth Endpoints (Task 8.1) ──────────────────────────────────────

  /** POST /api/auth/setup — First-run admin creation */
  router.post(
    "/setup",
    setupGuard as import("express").RequestHandler,
    validate({ body: setupSchema }),
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      const result = await authService.setupAdmin(username, password);
      setRefreshCookie(res, result.refreshToken);
      res.status(201).json({
        accessToken: result.accessToken,
        user: result.user,
      });
    }),
  );

  /** POST /api/auth/login — Login with credentials */
  router.post(
    "/login",
    loginRateLimiter,
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      const result = await authService.login(username, password);
      setRefreshCookie(res, result.refreshToken);
      res.json({
        accessToken: result.accessToken,
        user: result.user,
      });
    }),
  );

  /**
   * POST /api/auth/demo-session — Mint a short-lived public-demo session.
   *
   * Inert (404) unless AEOLUS_PUBLIC_DEMO is enabled. Requires no credentials,
   * returns only a short-lived access token stamped `sessionType: "public-demo"`
   * and NO refresh token/cookie (public-demo-mode spec, Req 2.1, 2.4, 2.5, 1.5).
   */
  router.post(
    "/demo-session",
    demoSessionRateLimiter,
    asyncHandler((_req, res) => {
      if (!config.publicDemo.enabled) {
        throw new NotFoundError("Not found");
      }
      const result = authService.createDemoSession();
      res.json({ accessToken: result.accessToken, user: result.user });
    }),
  );

  /** POST /api/auth/refresh — Exchange refresh cookie for new access token */
  router.post("/refresh", asyncHandler((req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      res.status(401).json({ error: "No refresh token provided" });
      return;
    }
    const accessToken = authService.refresh(refreshToken);
    res.json({ accessToken });
  }));

  /** POST /api/auth/logout — Revoke refresh token and clear cookie */
  router.post("/logout", asyncHandler((req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) {
      authService.logout(refreshToken);
    }
    clearRefreshCookie(res);
    res.json({ success: true });
  }));

  /** PUT /api/auth/password — Change own password (authenticated) */
  router.put(
    "/password",
    authenticate,
    validate({ body: passwordChangeSchema }),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body;
      await userService.changePassword(
        req.user!.userId,
        currentPassword,
        newPassword,
      );
      res.json({ success: true });
    }),
  );

  /** GET /api/auth/me — Get current user info + accessible tabs */
  router.get("/me", authenticate, asyncHandler((req, res) => {
    const user = req.user!;
    const accessibleTabs = getUserAccessibleTabs(user.userId);
    res.json({
      id: user.userId,
      username: user.username,
      role: user.role,
      groupId: user.groupId,
      accessibleTabs,
    });
  }));

  // ─── User Management Endpoints (Task 8.2) ────────────────────────────────

  /** GET /api/auth/users — List all users (admin only) */
  router.get("/users", authenticate, requireAdmin, asyncHandler((_req, res) => {
    const users = userService.listUsers();
    res.json(users);
  }));

  /** POST /api/auth/users — Create a new user (admin only) */
  router.post(
    "/users",
    authenticate,
    requireAdmin,
    validate({ body: createUserSchema }),
    asyncHandler(async (req, res) => {
      const { username, password, groupId, role } = req.body;
      const user = await userService.createUser(
        username,
        password,
        groupId,
        role,
      );
      res.status(201).json({
        id: user.id,
        username: user.username,
        role: user.role,
        groupId: user.groupId,
        createdAt: user.createdAt,
      });
    }),
  );

  /** PUT /api/auth/users/:id — Update a user (admin only) */
  router.put(
    "/users/:id",
    authenticate,
    requireAdmin,
    validate({ body: updateUserSchema }),
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      const updates = req.body;
      const user = await userService.updateUser(id, updates);
      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        groupId: user.groupId,
        createdAt: user.createdAt,
      });
    }),
  );

  /** DELETE /api/auth/users/:id — Delete a user (admin only) */
  router.delete(
    "/users/:id",
    authenticate,
    requireAdmin,
    asyncHandler((req, res) => {
      const id = req.params.id as string;
      userService.deleteUser(id);
      res.json({ success: true });
    }),
  );

  // ─── Group Management Endpoints (Task 8.3) ───────────────────────────────

  /** GET /api/auth/groups — List all groups (admin only) */
  router.get("/groups", authenticate, requireAdmin, asyncHandler((_req, res) => {
    const groups = groupService.listGroups();
    res.json(groups);
  }));

  /** POST /api/auth/groups — Create a new group (admin only) */
  router.post(
    "/groups",
    authenticate,
    requireAdmin,
    validate({ body: createGroupSchema }),
    asyncHandler((req, res) => {
      const { name, tabAssignments } = req.body;
      const group = groupService.createGroup(name, tabAssignments);
      res.status(201).json(group);
    }),
  );

  /** PUT /api/auth/groups/:id — Update a group (admin only) */
  router.put(
    "/groups/:id",
    authenticate,
    requireAdmin,
    validate({ body: updateGroupSchema }),
    asyncHandler((req, res) => {
      const id = req.params.id as string;
      const { name, tabAssignments } = req.body;
      const group = groupService.updateGroup(id, name, tabAssignments);
      res.json(group);
    }),
  );

  /** DELETE /api/auth/groups/:id — Delete a group (admin only) */
  router.delete(
    "/groups/:id",
    authenticate,
    requireAdmin,
    asyncHandler((req, res) => {
      const id = req.params.id as string;
      groupService.deleteGroup(id);
      res.json({ success: true });
    }),
  );

  // ─── MQTT Credential Endpoints (Task 8.4) ────────────────────────────────

  /** GET /api/auth/mqtt-credentials — List all MQTT credentials (admin only) */
  router.get(
    "/mqtt-credentials",
    authenticate,
    requireAdmin,
    asyncHandler((_req, res) => {
      const credentials = mqttCredentialService.listCredentials();
      res.json(credentials);
    }),
  );

  /** POST /api/auth/mqtt-credentials — Create MQTT credential (admin only) */
  router.post(
    "/mqtt-credentials",
    authenticate,
    requireAdmin,
    validate({ body: createMqttCredentialSchema }),
    asyncHandler(async (req, res) => {
      const { deviceName } = req.body;
      const credential =
        await mqttCredentialService.createCredential(deviceName);
      res.status(201).json(credential);
    }),
  );

  /** DELETE /api/auth/mqtt-credentials/:id — Delete MQTT credential (admin only) */
  router.delete(
    "/mqtt-credentials/:id",
    authenticate,
    requireAdmin,
    asyncHandler((req, res) => {
      const id = req.params.id as string;
      mqttCredentialService.deleteCredential(id);
      res.json({ success: true });
    }),
  );

  return router;
}
