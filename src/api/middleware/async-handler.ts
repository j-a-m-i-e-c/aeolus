// src/api/middleware/async-handler.ts — wrapper that forwards async errors to Express.

import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wrap an async route handler so any thrown error or rejected promise is
 * forwarded to `next()` (and thus the central errorHandler), removing the
 * repetitive `try { … } catch (err) { next(err) }` boilerplate from handlers.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
