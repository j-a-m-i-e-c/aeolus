// Metrics Auth Guard — Bearer token middleware for the /metrics Prometheus endpoint
// This guard is ONLY for the Prometheus scrape endpoint, NOT for /api/metrics/summary (which uses JWT)

import type { Request, Response, NextFunction } from "express";

/**
 * Middleware that checks the METRICS_TOKEN environment variable.
 * - If METRICS_TOKEN is not set or empty: allow all requests (no auth required)
 * - If METRICS_TOKEN is set: require Authorization: Bearer <token> header
 *
 * Returns 401 with JSON body on failure.
 * Reads process.env.METRICS_TOKEN on each request so it can be changed at runtime.
 */
export function metricsAuthGuard(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const metricsToken = process.env.METRICS_TOKEN;

  // If METRICS_TOKEN is not set or empty, allow all requests unconditionally
  if (!metricsToken) {
    next();
    return;
  }

  const authHeader = request.headers.authorization;

  // If Authorization header is missing or doesn't start with "Bearer "
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  // If token doesn't match METRICS_TOKEN exactly
  if (token !== metricsToken) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Token matches — allow request
  next();
}
