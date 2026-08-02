// src/api/routes/state.routes.ts — Aggregated state endpoint

import { Router } from "express";
import type { DeviceRegistry } from "../../core/device-registry.js";
import type { PermissionResolver } from "../../auth/permission-resolver.js";

export function createStateRoutes(
  registry: DeviceRegistry,
  resolver: PermissionResolver,
): Router {
  const router = Router();

  /**
   * GET /api/state — all visible devices keyed by ID.
   *
   * Mirrors `GET /api/devices`: admins see the full inventory; non-admins see
   * only devices exposed by a tab their group can reach at >= `read`, with
   * exposure resolved server-side. Device visibility is never derived from a
   * caller-supplied tab identifier.
   */
  router.get("/", (req, res) => {
    const all = registry.getAll();

    const visible =
      req.user?.role === "admin"
        ? all
        : (() => {
            const readable = new Set(
              resolver.filterByPermission(
                req.user?.userId ?? "",
                "device",
                all.map((d) => d.id),
                "read",
              ),
            );
            return all.filter((d) => readable.has(d.id));
          })();

    const state: Record<string, unknown> = {};
    for (const device of visible) {
      state[device.id] = device;
    }
    res.json(state);
  });

  return router;
}
