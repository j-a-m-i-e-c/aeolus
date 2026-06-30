// src/api/routes/provisioning.routes.ts — MQTT provisioning management endpoints
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8

import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/async-handler.js";
import {
  setSecurityLevelSchema,
  createDeviceCredentialSchema,
} from "../schemas/provisioning.schemas.js";
import { authenticate, requireAdmin } from "../../auth/auth-middleware.js";
import type { MqttProvisioningService } from "../../mqtt/mqtt-provisioning-service.js";

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createProvisioningRoutes(
  provisioningService: MqttProvisioningService,
): Router {
  const router = Router();

  // ─── Status Endpoint (any authenticated user) ────────────────────────────

  /** GET /api/mqtt/provisioning/status — Return current security status */
  router.get("/status", authenticate, asyncHandler((req, res) => {
    const status = provisioningService.getStatus();
    res.json(status);
  }));

  // ─── Security Level Management (admin-only) ──────────────────────────────

  /** PUT /api/mqtt/provisioning/level — Change security level */
  router.put(
    "/level",
    authenticate,
    requireAdmin,
    validate({ body: setSecurityLevelSchema }),
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
    asyncHandler(async (req, res) => {
      const id = req.params.id as string;
      await provisioningService.revokeDeviceCredential(id);
      res.json({ success: true });
    }),
  );

  return router;
}
