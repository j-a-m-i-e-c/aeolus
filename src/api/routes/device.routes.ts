// src/api/routes/device.routes.ts — Device CRUD and action endpoints
//
// The device-action endpoint (POST /:id/action) routes every command through
// the CommandService — the single physical-command boundary — rather than
// calling ConnectorManager.executeAction() directly. This route is a
// Command_Source and therefore is NOT handed a ConnectorManager reference: the
// action catalog is served through a read-only `getActionCatalog` accessor
// bound from the manager at composition (unified-command-boundary, Req 2.1,
// 2.8, 3.1–3.6).

import { Router } from "express";
import type { RequestHandler } from "express";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { CommandService } from "../../automations/command-service.js";
import type { CapabilityDescriptor } from "../../connectors/connector.interface.js";
import type { StateHistory } from "../../core/state-history.js";
import type { ActionResult } from "../../core/types.js";
import { config } from "../../config.js";
import { NotFoundError, ForbiddenError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { httpStatusForCommandResult } from "./command-status.js";
import { validateAction } from "../middleware/validators.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import type { PermissionLevel } from "../../auth/permission-service.js";
import type { PermissionResolver } from "../../auth/permission-resolver.js";
import logger from "../../logger.js";

import type { ConfirmationTier } from "../../automations/command-lifecycle.js";

/**
 * Race a promise against a timeout, resolving with `onTimeout()` if the promise
 * has not settled within `timeoutMs`. Never rejects on timeout; the in-flight
 * promise is left to settle on its own. Used to bound the REST device-action
 * route so a command still awaiting acknowledgement/observation cannot hang the
 * HTTP response (Req 3.6). The startup assertion `restActionTimeoutMs >=
 * maxConfirmTimeoutMs` guarantees this never preempts a legitimately-confirming
 * command (Req 3.7).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createDeviceRoutes(
  registry: DeviceRegistry,
  commandService: CommandService,
  getActionCatalog: (id: string) => CapabilityDescriptor[],
  requireDevice: (level: PermissionLevel) => RequestHandler,
  resolver: PermissionResolver,
  stateHistory?: StateHistory,
  getCompletionTierCapability?: (deviceId: string, observationAvailable?: boolean) => { resolved: boolean; tiers: ConfirmationTier[]; ceiling: ConfirmationTier | null },
): Router {
  const router = Router();

  /**
   * GET /api/devices — list devices. Admins see all; non-admins see only
   * devices exposed by a tab their group can reach at >= `read`, with exposure
   * resolved live by the Device_Exposure_Resolver.
   */
  router.get("/", (req, res) => {
    const all = registry.getAll();
    if (req.user?.role === "admin") {
      res.json(all);
      return;
    }
    const userId = req.user?.userId ?? "";
    const readable = new Set(
      resolver.filterByPermission(userId, "device", all.map((d) => d.id), "read"),
    );
    res.json(all.filter((d) => readable.has(d.id)));
  });

  /**
   * GET /api/devices/:id — get single device. Existence is checked before
   * permission (404 before 403). Non-admins require >= `read` on a tab that
   * exposes the device.
   */
  router.get("/:id", (req, res, next) => {
    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      return next(new NotFoundError(`Device not found: ${id}`));
    }
    if (
      req.user?.role !== "admin" &&
      !resolver.hasResourcePermission(req.user?.userId ?? "", "device", id, "read")
    ) {
      return next(new ForbiddenError());
    }
    return res.json(device);
  });

  /** GET /api/devices/:id/actions — return the action catalog for a device (requires device read) */
  router.get("/:id/actions", requireDevice("read"), (req, res) => {
    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      res.status(404).json({ error: `Device not found: ${id}` });
      return;
    }

    // Resolve the catalog through the injected read-only accessor. The route is
    // a Command_Source and never holds a full ConnectorManager reference.
    const catalog = getActionCatalog(id);
    res.json(catalog);
  });

  /** GET /api/devices/:id/completion-tiers — report the device's Capability_Ceiling (requires device read) (Req 2.6, 2.8, 7.6) */
  router.get("/:id/completion-tiers", requireDevice("read"), (req, res) => {
    if (!getCompletionTierCapability) {
      res.status(501).json({ error: "Completion tier capability not available" });
      return;
    }
    const id = req.params.id as string;
    const cap = getCompletionTierCapability(id);
    if (!cap.resolved) {
      res.status(404).json({ deviceId: id, resolved: false, availableTiers: [], ceiling: null, error: `Device not found: ${id}` });
      return;
    }
    res.json({ deviceId: id, resolved: true, availableTiers: cap.tiers, ceiling: cap.ceiling });
  });

  /** GET /api/devices/:id/history — get state history for a device (requires device read) */
  router.get("/:id/history", requireDevice("read"), (req, res, next) => {
    if (!stateHistory) {
      return res.json([]);
    }

    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      return next(new NotFoundError(`Device not found: ${id}`));
    }

    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;

    if (from !== undefined && to !== undefined) {
      return res.json(stateHistory.getHistoryRange(id, from, to));
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    return res.json(stateHistory.getHistory(id, limit));
  });

  /**
   * DELETE /api/devices/:id/history — clear history for a specific device.
   * Destructive: gated behind `requireAdmin`. Finer-grained per-resource
   * authorization will arrive with the resource-authorization rework.
   */
  router.delete("/:id/history", requireAdmin, (req, res, next) => {
    if (!stateHistory) {
      return res.json({ success: true, deleted: 0 });
    }

    const id = req.params.id as string;
    const device = registry.getById(id);
    if (!device) {
      return next(new NotFoundError(`Device not found: ${id}`));
    }

    const deleted = stateHistory.clearDevice(id);
    logger.info({ deviceId: id, deleted }, "Cleared device state history");
    return res.json({ success: true, deleted });
  });

  /** DELETE /api/devices/history/all — clear ALL device history (destructive, admin-only) */
  router.delete("/history/all", requireAdmin, (_req, res) => {
    if (!stateHistory) {
      return res.json({ success: true, deleted: 0 });
    }

    const deleted = stateHistory.clearAll();
    logger.info({ deleted }, "Cleared all device state history");
    return res.json({ success: true, deleted });
  });

  /** POST /api/devices/:id/action — execute action on device via the CommandService */
  router.post("/:id/action", requireDevice("interact"), validateAction, asyncHandler(async (req, res) => {
    const id = req.params.id as string;

    // Route through the single physical-command boundary. Bound by an outer
    // timeout so the HTTP response is never held open indefinitely (Req 3.6).
    const result = await withTimeout(
      commandService.execute(
        { type: req.body.type, target: id, params: req.body.params ?? {} },
        `rest:${id}`,
      ),
      config.restActionTimeoutMs,
      (): ActionResult => ({
        success: false,
        lifecycleState: "TIMED_OUT",
        error: "Device command timed out",
      }),
    );

    if (result.success) {
      logger.info({ deviceId: id, action: req.body.type }, "Action executed");
    } else {
      logger.warn({ deviceId: id, action: req.body.type, error: result.error }, "Action failed");
    }

    // Map the outcome to an expressive HTTP status while keeping the full
    // Command_Result as the authoritative body (success / lifecycleState /
    // error). A timeout is 504, a rejection 4xx, a transport failure 5xx.
    res.status(httpStatusForCommandResult(result)).json(result);
  }));

  return router;
}
