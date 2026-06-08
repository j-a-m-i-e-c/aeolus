// Auth Middleware — Express middleware for route protection
// Implements: authenticate, requireAdmin, requireTabPermission, setupGuard

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyAccessToken } from "./token-service.js";
import { hasPermission, type PermissionLevel } from "./permission-service.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../api/middleware/error-handler.js";

// ─── Express Request Type Augmentation ───────────────────────────────────────

declare global {
// eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        username: string;
        role: "admin" | "user";
        groupId: string | null;
      };
    }
  }
}

// ─── Public Routes ───────────────────────────────────────────────────────────

/**
 * Routes that do not require authentication.
 * Matched by method + path.
 */
export const PUBLIC_ROUTES: { method: string; path: string }[] = [
  { method: "GET", path: "/api/health" },
  { method: "HEAD", path: "/api/health" },
  { method: "GET", path: "/api/system" },
  { method: "GET", path: "/api/system/logs" },
  { method: "GET", path: "/api/system/version" },
  { method: "GET", path: "/api/auth/status" },
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/auth/refresh" },
  { method: "POST", path: "/api/auth/setup" },
  { method: "GET", path: "/metrics" },
];

/**
 * Check if a request matches a public route.
 */
function isPublicRoute(req: Request): boolean {
  return PUBLIC_ROUTES.some(
    (route) =>
      req.method.toUpperCase() === route.method &&
      req.path === route.path,
  );
}

// ─── Middleware Functions ─────────────────────────────────────────────────────

/**
 * Authenticate middleware: extract Bearer token from Authorization header,
 * verify with TokenService, attach user context to req.user.
 * Returns 401 if token is missing, invalid, or expired.
 * Skips authentication for public routes.
 */
export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Skip auth for public routes
  if (isPublicRoute(req)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  if (!token) {
    throw new UnauthorizedError();
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
      groupId: payload.groupId,
    };
    next();
  } catch {
    throw new UnauthorizedError();
  }
}

/**
 * Require the authenticated user to have role "admin".
 * Returns 403 Forbidden if the user is not an admin.
 * Must be used after `authenticate` middleware.
 */
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  if (req.user.role !== "admin") {
    throw new ForbiddenError();
  }

  next();
}

/**
 * Require the authenticated user to have at least the specified permission
 * level on the tab identified by the request.
 *
 * Tab ID is extracted from: req.params.tabId || req.body.tabId || req.query.tabId
 *
 * Admin users always pass (bypass permission check).
 * Returns 403 Forbidden if the user has insufficient permission.
 * Must be used after `authenticate` middleware.
 */
export function requireTabPermission(level: PermissionLevel): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    // Admin bypasses all permission checks
    if (req.user.role === "admin") {
      next();
      return;
    }

    // Extract tabId from params, body, or query
    const tabId =
      req.params.tabId ||
      (req.body as Record<string, unknown>)?.tabId ||
      req.query.tabId;

    if (!tabId || typeof tabId !== "string") {
      throw new ForbiddenError();
    }

    const allowed = hasPermission(req.user.userId, tabId, level);

    if (!allowed) {
      throw new ForbiddenError();
    }

    next();
  };
}

/**
 * Setup guard middleware: skip authentication if setup is needed (no admin exists).
 * Otherwise, require authentication.
 *
 * Accepts a `needsSetup` function to avoid circular dependency with auth-service.
 */
export function createSetupGuard(
  needsSetupFn: () => boolean,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (needsSetupFn()) {
      // Setup is needed — allow unauthenticated access
      next();
      return;
    }

    // Setup is complete — require authentication
    authenticate(req, res, next);
  };
}
