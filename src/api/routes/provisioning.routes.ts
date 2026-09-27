// src/api/routes/provisioning.routes.ts — MQTT provisioning management endpoints
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8

import { Router, type RequestHandler } from "express";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import {
  setSecurityLevelSchema,
  createDeviceCredentialSchema,
} from "../schemas/provisioning.schemas.js";
import { authenticate, requireAdmin } from "../../auth/auth-middleware.js";
import type { MqttProvisioningService } from "../../mqtt/mqtt-provisioning-service.js";
import { AppError } from "../middleware/error-handler.js";

export interface ProvisioningRouteOptions {
  /** Deployment can safely write/reload the live broker configuration. */
  managedProvisioningEnabled?: boolean;
  /** Experimental Per-Device provisioning gate. */
  perDeviceProvisioningEnabled?: boolean;
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createProvisioningRoutes(
  provisioningService: MqttProvisioningService,
  options: ProvisioningRouteOptions = {},
): Router {
  const router = Router();
  const managedProvisioningEnabled = options.managedProvisioningEnabled ?? false;
  const perDeviceProvisioningEnabled = options.perDeviceProvisioningEnabled ?? false;

  const requireManagedProvisioning: RequestHandler = (_req, _res, next) => {
    if (!managedProvisioningEnabled) {
      next(new AppError(
        503,
        "Dashboard-managed MQTT security is unavailable in this deployment",
      ));
      return;
    }
    next();
  };

  const requirePerDeviceProvisioning: RequestHandler = (_req, _res, next) => {
    if (!perDeviceProvisioningEnabled) {
      next(new AppError(
        503,
        "Per-Device MQTT provisioning is under development and disabled by default",
      ));
      return;
    }
    next();
  };

  const requirePerDeviceLevelWhenSelected: RequestHandler = (req, _res, next) => {
    if (req.body?.level === "per_device" && !perDeviceProvisioningEnabled) {
      next(new AppError(
        503,
        "Per-Device MQTT provisioning is under development and disabled by default",
      ));
      return;
    }
    next();
  };

  // ─── Status Endpoint (any authenticated user) ────────────────────────────

  /** GET /api/mqtt/provisioning/status — Return current security status */
  router.get("/status", authenticate, asyncHandler((req, res) => {
    const status = provisioningService.getStatus();
    // getStatus() includes the broker-wide sharedCredential (username +
    // plaintext password) at the shared_password level. Only admins may see it;
    // non-admins receive the status with the credential stripped.
    const isAdmin = req.user?.role === "admin";
    const safeStatus = isAdmin
      ? status
      : { ...status, sharedCredential: null };
    res.json({ ...safeStatus, managedProvisioningEnabled, perDeviceProvisioningEnabled });
  }));

  // ─── Security Level Management (admin-only) ──────────────────────────────

  /** PUT /api/mqtt/provisioning/level — Change security level */
  router.put(
    "/level",
    authenticate,
    requireAdmin,
    requireManagedProvisioning,
    validate({ body: setSecurityLevelSchema }),
    requirePerDeviceLevelWhenSelected,
    asyncHandler(async (req, res) => {
      const { level } = req.body;
      const status = await provisioningService.setSecurityLevel(level);
      res.json(status);
    }),
  );

  // ─── Shared Password Management (admin-only) ─────────────────────────────

  /** POST /api/mqtt/provisioning/shared/regenerate — Regenerate shared password */
  router.post(
    "/shared/regenerate",
    authenticate,
    requireAdmin,
    requireManagedProvisioning,
    asyncHandler(async (req, res) => {
      const credential = await provisioningService.regenerateSharedPassword();
      res.json(credential);
    }),
  );

  // ─── Device Credential Management (admin-only) ───────────────────────────

  /** GET /api/mqtt/provisioning/credentials — List device credentials */
  router.get(
    "/credentials",
    authenticate,
    requireAdmin,
    requireManagedProvisioning,
    requirePerDeviceProvisioning,
    asyncHandler((req, res) => {
      const credentials = provisioningService.listDeviceCredentials();
      res.json(credentials);
    }),
  );

  /** POST /api/mqtt/provisioning/credentials — Create device credential */
  router.post(
    "/credentials",
    authenticate,
    requireAdmin,
    requireManagedProvisioning,
    requirePerDeviceProvisioning,
    validate({ body: createDeviceCredentialSchema }),
    asyncHandler(async (req, res) => {
      const { deviceName } = req.body;
      const credential =
        await provisioningService.createDeviceCredential(deviceName);
      res.status(201).json(credential);
    }),
  );

  /** DELETE /api/mqtt/provisioning/credentials/:id — Revoke device credential */
  router.delete(
    "/credentials/:id",
    authenticate,
    requireAdmin,
    requireManagedProvisioning,
    requirePerDeviceProvisioning,
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      await provisioningService.revokeDeviceCredential(id);
      res.json({ success: true });
    }),
  );

  return router;
}
