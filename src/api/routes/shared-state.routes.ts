// src/api/routes/shared-state.routes.ts — Shared State REST API (ADR-0016)

import { Router } from "express";
import type { SharedStateStore } from "../../shared-state/shared-state-store.js";
import { SharedStateLimitError } from "../../shared-state/shared-state-store.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { BadRequestError, NotFoundError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { validate } from "../middleware/validate.js";
import {
  sharedStateBucketParamsSchema,
  sharedStateKeyParamsSchema,
  setSharedStateValueBodySchema,
} from "../schemas/shared-state.schemas.js";

/**
 * Shared State management routes.
 *
 * Admin-only throughout, preserving the boundary the bucket API has always had:
 * Shared State is global and has no bucket-to-tab ownership model, so there is no
 * basis on which to grant a non-admin partial authority over it. Widening this
 * needs an explicit ownership design, not a string-prefix guess.
 *
 * These routes are mounted at `/api/shared-state`. The older
 * `/api/data-store/buckets/*` paths remain as deprecated aliases over the same
 * store, so nothing breaks while callers migrate.
 */
export function createSharedStateRoutes(sharedState: SharedStateStore): Router {
  const router = Router();

  /** GET / — every bucket that holds at least one entry. */
  router.get("/", requireAdmin, (_req, res) => {
    res.json(sharedState.listBuckets());
  });

  /** GET /:bucket — every entry in one bucket. */
  router.get(
    "/:bucket",
    requireAdmin,
    validate({ params: sharedStateBucketParamsSchema }),
    (req, res) => {
      const bucket = req.params.bucket as string;
      res.json(sharedState.listBucket(bucket));
    },
  );

  /**
   * GET /:bucket/:key — one current value.
   *
   * 404 when the key is not set, so a caller can distinguish "no such key" from a
   * key deliberately holding `null`. Returning `null` for both would make a stored
   * null unreadable.
   */
  router.get(
    "/:bucket/:key",
    requireAdmin,
    validate({ params: sharedStateKeyParamsSchema }),
    asyncHandler((req, res) => {
      const bucket = req.params.bucket as string;
      const key = req.params.key as string;
      const value = sharedState.get(bucket, key);
      if (value === undefined) {
        throw new NotFoundError(`Shared State key not found: ${bucket}/${key}`);
      }
      res.json({ bucket, key, value });
    }),
  );

  /**
   * PUT /:bucket/:key — write one current value.
   *
   * Reports `changed` truthfully. An identical write performs no SQLite write and
   * triggers no reactive automation, and the response says so rather than implying
   * work happened.
   */
  router.put(
    "/:bucket/:key",
    requireAdmin,
    validate({ body: setSharedStateValueBodySchema, params: sharedStateKeyParamsSchema }),
    asyncHandler((req, res) => {
      const bucket = req.params.bucket as string;
      const key = req.params.key as string;

      if (!("value" in req.body)) {
        throw new BadRequestError("Request body must include a 'value' field");
      }

      try {
        const changed = sharedState.set(bucket, key, req.body.value, {
          source: { kind: "api", ...(req.user?.userId ? { userId: req.user.userId } : {}) },
        });
        res.json({ success: true, changed });
      } catch (err) {
        // A refused bound is the caller's error, not a server fault.
        if (err instanceof SharedStateLimitError) {
          throw new BadRequestError(err.message);
        }
        throw err;
      }
    }),
  );

  /**
   * DELETE /:bucket/:key — remove one current value.
   *
   * Idempotent: deleting a key that is not set succeeds with `changed: false`
   * rather than 404, so a reconciling caller does not have to probe first.
   */
  router.delete(
    "/:bucket/:key",
    requireAdmin,
    validate({ params: sharedStateKeyParamsSchema }),
    asyncHandler((req, res) => {
      const bucket = req.params.bucket as string;
      const key = req.params.key as string;
      const changed = sharedState.delete(bucket, key, {
        source: { kind: "api", ...(req.user?.userId ? { userId: req.user.userId } : {}) },
      });
      res.json({ success: true, changed });
    }),
  );

  return router;
}
