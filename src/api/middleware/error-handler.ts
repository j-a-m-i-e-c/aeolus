import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import logger from "../../logger.js";
import { config } from "../../config.js";

export class AppError extends Error {
  public details?: unknown;

  constructor(
    public statusCode: number,
    message: string,
    public isOperational = true,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, message);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request") {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "Payload too large") {
    super(413, message);
  }
}

/**
 * The change was written and a reload was triggered, but the broker did not
 * confirm it within the verification budget. The files/settings are already
 * persisted, so the broker will apply them on its next reload or restart — this
 * signals that live confirmation did not land in time, not that the change was lost.
 */
export class BrokerNotConfirmedError extends AppError {
  constructor(message = "Broker did not confirm the change within the verification window") {
    super(503, message);
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Log at appropriate level based on error type
  if (err instanceof AppError && err.statusCode < 500) {
    logger.debug({ err, method: _req.method, path: _req.path }, "Request error");
  } else {
    logger.error({ err, method: _req.method, path: _req.path }, "Request error");
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: err.issues,
    });
    return;
  }

  // Handle known operational errors
  if (err instanceof AppError) {
    const response: { error: string; details?: unknown } = { error: err.message };
    if (err.details) response.details = err.details;
    res.status(err.statusCode).json(response);
    return;
  }

  // Unexpected errors — suppress details in production
  res.status(500).json({
    error: config.nodeEnv === "production" ? "Internal server error" : err.message,
  });
}
