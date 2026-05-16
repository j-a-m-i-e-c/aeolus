// src/api/routes/provisioning.routes.ts — MQTT provisioning management endpoints
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8

import { Router } from "express";
import { validate } from "../middleware/validate.js";
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
  router.get("/status", authenticate, async (req, res, next) => {
    try {
      const status = provisioningService.getStatus();
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  // ─── Security Level Management (admin-only) ──────────────────────────────

  /** PUT /api/mqtt/provisioning/level — Change security level */
  router.put(
    "/level",
    authenticate,
    requireAdmin,
    validate({ body: setSecurityLevelSchema }),
    async (req, res, next) => {
      try {
        const { level } = req.body;
        const status = await provisioningService.setSecurityLevel(level);
        res.json(status);
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── Shared Password Management (admin-only) ─────────────────────────────

  /** POST /api/mqtt/provisioning/shared/regenerate — Regenerate shared password */
  router.post(
    "/shared/regenerate",
    authenticate,
    requireAdmin,
    async (req, res, next) => {
      try {
        const credential = await provisioningService.regenerateSharedPassword();
        res.json(credential);
      } catch (err) {
        next(err);
      }
    },
  );

  // ─── Device Credential Management (admin-only) ───────────────────────────

  /** GET /api/mqtt/provisioning/credentials — List device credentials */
  router.get(
    "/credentials",
    authenticate,
    requireAdmin,
    (req, res, next) => {
      try {
        const credentials = provisioningService.listDeviceCredentials();
        res.json(credentials);
      } catch (err) {
        next(err);
      }
    },
  );

  /** POST /api/mqtt/provisioning/credentials — Create device credential */
  router.post(
    "/credentials",
    authenticate,
    requireAdmin,
    validate({ body: createDeviceCredentialSchema }),
    async (req, res, next) => {
      try {
        const { deviceName } = req.body;
        const credential =
          await provisioningService.createDeviceCredential(deviceName);
        res.status(201).json(credential);
      } catch (err) {
        next(err);
      }
    },
  );

  /** DELETE /api/mqtt/provisioning/credentials/:id — Revoke device credential */
  router.delete(
    "/credentials/:id",
    authenticate,
    requireAdmin,
    async (req, res, next) => {
      try {
        const id = req.params.id as string;
        await provisioningService.revokeDeviceCredential(id);
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
