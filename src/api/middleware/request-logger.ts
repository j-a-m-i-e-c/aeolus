import type { Request, Response, NextFunction } from "express";
import logger from "../../logger.js";
import { maskCredentialSegments } from "../../log-safety.js";

/** Paths that are polled frequently by the dashboard and don't need logging */
const SILENT_PATHS = [
  "/api/system/logs",
  "/api/system",
  "/api/health",
];

const MAX_LOGGED_PATH = 512;

/**
 * The request path as it may be logged: no query string or fragment, credential-shaped
 * segments masked, and length-capped.
 *
 * Request logs reach stdout, container logs and the admin-visible log buffer
 * (`/api/system/logs`). `req.originalUrl` includes the query string, so a caller that
 * put a token there, even one the route then rejects, used to have it written to all
 * three. Masking covers a credential pasted into the path itself: an Aeolus API key
 * (`aeo_…`) or a JWT (`eyJ…` with three dot-separated parts).
 */
export function loggablePath(req: Pick<Request, "originalUrl" | "url">): string {
  const raw = String(req.originalUrl ?? req.url ?? "");
  const end = raw.search(/[?#]/);
  const masked = maskCredentialSegments(end === -1 ? raw : raw.slice(0, end));
  return masked.length > MAX_LOGGED_PATH ? masked.slice(0, MAX_LOGGED_PATH) + "…" : masked;
}

// Mask an Aeolus API key or a JWT anywhere in a path. Also used for metrics labels.
export { maskCredentialSegments } from "../../log-safety.js";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const path = loggablePath(req);
  // Skip logging for high-frequency polling endpoints to avoid noise
  if (SILENT_PATHS.some((p) => path.startsWith(p))) {
    next();
    return;
  }

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(
      {
        method: req.method,
        path,
        statusCode: res.statusCode,
        responseTime: `${duration}ms`,
      },
      `${req.method} ${path} ${res.statusCode} ${duration}ms`,
    );
  });

  next();
}
