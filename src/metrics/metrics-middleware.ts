// src/metrics/metrics-middleware.ts — HTTP metrics middleware with route normalization

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { metricsService } from "./metrics-service.js";
import logger from "../logger.js";

/** UUID pattern: 8-4-4-4-12 hex characters */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Numeric-only segment pattern */
const NUMERIC_PATTERN = /^\d+$/;

/** Known resource paths whose next segment is always an ID */
const KNOWN_RESOURCE_PATHS = new Set([
  "devices",
  "automations",
  "connectors",
  "services",
  "users",
  "groups",
  "rules",
  "collections",
  "tabs",
  "layouts",
]);

/**
 * Normalize a request path by replacing dynamic segments with `:id` placeholders.
 * Exported for unit testing.
 *
 * Rules (applied in order):
 * - UUID patterns (e.g., `550e8400-e29b-41d4-a716-446655440000`) → `:id`
 * - Numeric-only segments (e.g., `12345`) → `:id`
 * - Segments after known resource paths (devices, automations, connectors, etc.) → `:id`
 *
 * The function is idempotent: normalizing an already-normalized path produces the same result.
 */
export function normalizeRoutePath(path: string, _method: string): string {
  const segments = path.split("/");
  const normalized: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Preserve empty segments (leading slash produces empty first segment)
    if (segment === "") {
      normalized.push(segment);
      continue;
    }

    // Already a placeholder — keep as-is (idempotency)
    if (segment.startsWith(":")) {
      normalized.push(segment);
      continue;
    }

    // UUID pattern → :id
    if (UUID_PATTERN.test(segment)) {
      normalized.push(":id");
      continue;
    }

    // Numeric-only segment → :id
    if (NUMERIC_PATTERN.test(segment)) {
      normalized.push(":id");
      continue;
    }

    // Segment after a known resource path → :id
    const previousSegment = i > 0 ? normalized[i - 1] : undefined;
    if (previousSegment && KNOWN_RESOURCE_PATHS.has(previousSegment)) {
      normalized.push(":id");
      continue;
    }

    // Keep the segment as-is
    normalized.push(segment);
  }

  return normalized.join("/");
}

/**
 * Express middleware that measures request duration and records it
 * via MetricsService. Must be mounted BEFORE route handlers.
 *
 * Uses `res.on('finish', ...)` to capture the response status code and compute duration.
 * Skips recording metrics for the `/metrics` endpoint itself to avoid self-referential noise.
 * Catches internal errors and calls `next()` without blocking the request pipeline.
 */
export function metricsMiddleware(): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    try {
      // Skip recording metrics for the /metrics endpoint itself
      if (request.path === "/metrics") {
        next();
        return;
      }

      const startTime = process.hrtime();

      response.on("finish", () => {
        try {
          const [seconds, nanoseconds] = process.hrtime(startTime);
          const durationSeconds = seconds + nanoseconds / 1e9;

          const method = request.method;
          const route = normalizeRoutePath(request.path, method);
          const statusCode = response.statusCode;

          metricsService.recordHttpRequest(method, route, statusCode, durationSeconds);
        } catch (error) {
          logger.error({ error }, "Non-fatal error recording HTTP metrics on finish");
        }
      });

      next();
    } catch (error) {
      logger.error({ error }, "Non-fatal error in metrics middleware setup");
      next();
    }
  };
}
