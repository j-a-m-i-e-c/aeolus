// src/api/routes/auth.routes.ts — Authentication, user, group, and MQTT credential endpoints

import { Router } from "express";
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../middleware/validate.js";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set the refresh token as an HttpOnly cookie.
 */
function setRefreshCookie(res: import("express").Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
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
    sameSite: "strict",
    path: "/api/auth",
  });
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAuthRoutes(): Router {
  const router = Router();
  const setupGuard = createSetupGuard(() => authService.needsSetup());

  // ─── Core Auth Endpoints (Task 8.1) ──────────────────────────────────────

  /** POST /api/auth/setup — First-run admin creation */
  router.post(
    "/setup",
    setupGuard as RequestHandler,
    validate({ body: setupSchema }),
    async (req, res, next) => {
      try {
        const { username, password } = req.body;
        const result = await authService.setupAdmin(username, password);
        setRefreshCookie(res, result.refreshToken);
        res.status(201).json({
          accessToken: result.accessToken,
          user: result.user,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /** POST /api/auth/login — Login with credentials */
  router.post(
    "/login",
    loginRateLimiter,
    validate({ body: loginSchema }),
    async (req, res, next) => {
      try {
        const { username, password } = req.body;
        const result = await authService.login(username, password);
        setRefreshCookie(res, result.refreshToken);
        res.json({
          accessToken: result.accessToken,
          user: result.user,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /** POST /api/auth/refresh — Exchange refresh cookie for new access token */
  router.post("/refresh", (req, res, next) => {
    try {
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        res.status(401).json({ error: "No refresh token provided" });
        return;
      }
      const accessToken = authService.refresh(refreshToken);
      res.json({ accessToken });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/auth/logout — Revoke refresh token and clear cookie */
  router.post("/logout", (req, res, next) => {
    try {
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
      if (refreshToken) {
        authService.logout(refreshToken);
      }
      clearRefreshCookie(res);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/auth/password — Change own password (authenticated) */
  router.put(
    "/password",
    authenticate,
    validate({ body: passwordChangeSchema }),
    async (req, res, next) => {
      try {
        const { currentPassword, newPassword } = req.body;
        await userService.changePassword(
          req.user!.userId,
          currentPassword,
          newPassword,
        );
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    },
  );

  /** GET /api/auth/me — Get current user info + accessible tabs */
  router.get("/me", authenticate, (req, res, next) => {
    try {
      const user = req.user!;
      const accessibleTabs = getUserAccessibleTabs(user.userId);
      res.json({
        id: user.userId,
        username: user.username,
        role: user.role,
        groupId: user.groupId,
        accessibleTabs,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── User Management Endpoints (Task 8.2) ────────────────────────────────

  /** GET /api/auth/users — List all users (admin only) */
  router.get("/users", authenticate, requireAdmin, (_req, res, next) => {
    try {
      const users = userService.listUsers();
      res.json(users);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/auth/users — Create a new user (admin only) */
  router.post(
    "/users",
    authenticate,
    requireAdmin,
    validate({ body: createUserSchema }),
    async (req, res, next) => {
      try {
        const { username, password, groupId } = req.body;
        const user = await userService.createUser(username, password, groupId);
        res.status(201).json({
          id: user.id,
          username: user.username,
          role: user.role,
          groupId: user.groupId,
          createdAt: user.createdAt,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /** PUT /api/auth/users/:id — Update a user (admin only) */
  router.put(
    "/users/:id",
    authenticate,
    requireAdmin,
    validate({ body: updateUserSchema }),
    async (req, res, next) => {
      try {
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
      } catch (err) {
        next(err);
      }
    },
  );

  /** DELETE /api/auth/users/:id — Delete a user (admin only) */
  router.delete(
    "/users/:id",
    authenticate,
    requireAdmin,
    (req, res, next) => {
      try {
        const id = req.params.id as string;
        userService.deleteUser(id);
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── Group Management Endpoints (Task 8.3) ───────────────────────────────

  /** GET /api/auth/groups — List all groups (admin only) */
  router.get("/groups", authenticate, requireAdmin, (_req, res, next) => {
    try {
      const groups = groupService.listGroups();
      res.json(groups);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/auth/groups — Create a new group (admin only) */
  router.post(
    "/groups",
    authenticate,
    requireAdmin,
    validate({ body: createGroupSchema }),
    (req, res, next) => {
      try {
        const { name, tabAssignments } = req.body;
        const group = groupService.createGroup(name, tabAssignments);
        res.status(201).json(group);
      } catch (err) {
        next(err);
      }
    },
  );

  /** PUT /api/auth/groups/:id — Update a group (admin only) */
  router.put(
    "/groups/:id",
    authenticate,
    requireAdmin,
    validate({ body: updateGroupSchema }),
    (req, res, next) => {
      try {
        const id = req.params.id as string;
        const { name, tabAssignments } = req.body;
        const group = groupService.updateGroup(id, name, tabAssignments);
        res.json(group);
      } catch (err) {
        next(err);
      }
    },
  );

  /** DELETE /api/auth/groups/:id — Delete a group (admin only) */
  router.delete(
    "/groups/:id",
    authenticate,
    requireAdmin,
    (req, res, next) => {
      try {
        const id = req.params.id as string;
        groupService.deleteGroup(id);
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── MQTT Credential Endpoints (Task 8.4) ────────────────────────────────

  /** GET /api/auth/mqtt-credentials — List all MQTT credentials (admin only) */
  router.get(
    "/mqtt-credentials",
    authenticate,
    requireAdmin,
    (_req, res, next) => {
      try {
        const credentials = mqttCredentialService.listCredentials();
        res.json(credentials);
      } catch (err) {
        next(err);
      }
    },
  );

  /** POST /api/auth/mqtt-credentials — Create MQTT credential (admin only) */
  router.post(
    "/mqtt-credentials",
    authenticate,
    requireAdmin,
    validate({ body: createMqttCredentialSchema }),
    async (req, res, next) => {
      try {
        const { deviceName } = req.body;
        const credential =
          await mqttCredentialService.createCredential(deviceName);
        res.status(201).json(credential);
      } catch (err) {
        next(err);
      }
    },
  );

  /** DELETE /api/auth/mqtt-credentials/:id — Delete MQTT credential (admin only) */
  router.delete(
    "/mqtt-credentials/:id",
    authenticate,
    requireAdmin,
    (req, res, next) => {
      try {
        const id = req.params.id as string;
        mqttCredentialService.deleteCredential(id);
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
