import type { Request, Response, NextFunction } from "express";
import logger from "../../logger.js";

/** Paths that are polled frequently by the dashboard and don't need logging */
const SILENT_PATHS = [
  "/api/system/logs",
  "/api/system",
  "/api/health",
  "/api/simulator",
];

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Skip logging for high-frequency polling endpoints to avoid noise
  if (SILENT_PATHS.some((p) => req.originalUrl.startsWith(p))) {
    return next();
  }

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(
      {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseTime: `${duration}ms`,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });

  next();
}
