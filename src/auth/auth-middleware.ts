// Auth Middleware — Express middleware for route protection
// Implements: authenticate, requireAdmin, requireTabPermission, setupGuard

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyAccessToken } from "./token-service.js";
import { hasPermission, type PermissionLevel } from "./permission-service.js";
import type { PermissionResolver, ResourceKind } from "./permission-resolver.js";
import {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from "../api/middleware/error-handler.js";
import logger from "../logger.js";

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
        sessionType?: "normal" | "public-demo";
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
  { method: "GET", path: "/api/system/version" },
  { method: "GET", path: "/api/auth/status" },
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/auth/refresh" },
  { method: "POST", path: "/api/auth/setup" },
  { method: "POST", path: "/api/auth/demo-session" },
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
      sessionType: payload.sessionType ?? "normal",
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

  if (req.user.role === "admin") {
    next();
    return;
  }

  // Public-demo sessions are granted read-only visibility into admin surfaces so
  // the demo can showcase the whole platform (System, Data Store, Security,
  // Connectors). This relaxation is deliberately limited to safe (read-only)
  // methods. It is additive and safe because:
  //   1. The PublicDemoGuard (fail-closed allowlist) already restricts a demo
  //      session to a fixed set of paths — it is the authoritative gate, so a
  //      demo GET only reaches here for explicitly allowlisted admin reads.
  //   2. The demo-scrub layer masks sensitive fields (host/network identifiers,
  //      credentials, usernames, log contents) before the response is sent.
  // Mutations remain blocked: the guard denies any non-allowlisted method, and
  // no mutating admin route is on the allowlist.
  if (req.user.sessionType === "public-demo" && isReadOnlyMethod(req.method)) {
    next();
    return;
  }

  throw new ForbiddenError();
}

/** Read-only HTTP methods — the only methods a demo session may use on admin routes. */
function isReadOnlyMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
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

// ─── Resource-Level Authorization Middleware ─────────────────────────────────

/**
 * Dependencies injected into the resource-permission middleware factories so
 * existence checks and permission resolution share a single source of truth.
 */
export interface ResourceGuardDeps {
  /** Resolves effective permission for a (user, resource) pair, server-side. */
  resolver: PermissionResolver;
  /** Existence predicate: `registry.getById` for devices, rule lookup for automations. */
  exists: (resourceId: string) => boolean;
}

/**
 * Shared control flow for the resource-permission guards. Differs between kinds
 * only in the resource kind, the injected existence predicate, and log labels.
 *
 * Order of checks:
 *  1. 401 if unauthenticated.
 *  2. Admins proceed immediately — no existence check, no store/resolver call.
 *  3. Resource id is read from the request PATH only (never body/query), which
 *     structurally eliminates the caller-supplied-tab bypass.
 *  4. 404 if the resource does not exist, before any permission evaluation.
 *  5. 403 when the user's effective permission is below the required level
 *     (including the fail-closed no-exposing-tabs case), else proceed.
 */
function createResourceGuard(
  kind: ResourceKind,
  level: PermissionLevel,
  deps: ResourceGuardDeps,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    // Admin bypass: unconditional, store-free, and resolver-free.
    if (req.user.role === "admin") {
      next();
      return;
    }

    const resourceId = req.params.id;
    if (!resourceId || typeof resourceId !== "string") {
      throw new NotFoundError(`${kind} not found`);
    }

    // Existence before permission (404 before 403).
    if (!deps.exists(resourceId)) {
      throw new NotFoundError(`${kind} not found: ${resourceId}`);
    }

    const allowed = deps.resolver.hasResourcePermission(
      req.user.userId,
      kind,
      resourceId,
      level,
    );

    if (!allowed) {
      // Covers both insufficient permission and the fail-closed
      // no-exposing-tabs case. Log for auditability without secrets.
      logger.warn(
        { userId: req.user.userId, kind, resourceId, requiredLevel: level },
        "Resource authorization denied",
      );
      throw new ForbiddenError();
    }

    next();
  };
}

/**
 * Require at least `level` permission on the target DEVICE identified by
 * `req.params.id`. Device exposure is resolved live by the
 * Device_Exposure_Resolver via the injected resolver.
 */
export function requireDevicePermission(
  level: PermissionLevel,
  deps: ResourceGuardDeps,
): RequestHandler {
  return createResourceGuard("device", level, deps);
}

/**
 * Require at least `level` permission on the target AUTOMATION identified by
 * `req.params.id`. Automation exposure is resolved via the
 * Resource_Ownership_Store through the injected resolver.
 */
export function requireAutomationPermission(
  level: PermissionLevel,
  deps: ResourceGuardDeps,
): RequestHandler {
  return createResourceGuard("automation", level, deps);
}
