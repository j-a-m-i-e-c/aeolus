import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import logger from "../../logger.js";
import { randomUUID } from "node:crypto";
import { isBodyParserError } from "../../log-safety.js";
import { loggablePath } from "./request-logger.js";

/** Fixed messages for body-parser failures; the parser's own message may quote the body. */
const BODY_ERROR_MESSAGES: Record<string, string> = {
  "entity.parse.failed": "The request body is not valid JSON",
  "entity.too.large": "The request body is too large",
  "entity.verify.failed": "The request body could not be verified",
  "encoding.unsupported": "The request body encoding is not supported",
  "charset.unsupported": "The request body character set is not supported",
  "request.aborted": "The request was aborted",
  "request.size.invalid": "The request body length does not match its Content-Length",
  "stream.encoding.set": "The request body could not be read",
};
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
  // A body the parser refused (malformed JSON, too large, bad encoding). The parser's
  // error carries the raw body and its message quotes it, so neither is logged or
  // returned: only a stable category, the method, the path and a request id.
  if (isBodyParserError(err)) {
    const requestId = randomUUID();
    logger.warn(
      { requestId, category: err.type, status: err.status, method: _req.method, path: loggablePath(_req) },
      "Request body refused",
    );
    res.status(err.status).json({ error: BODY_ERROR_MESSAGES[err.type] ?? "The request body could not be read", requestId });
    return;
  }

  // Log at appropriate level based on error type
  if (err instanceof AppError && err.statusCode < 500) {
    logger.debug({ err, method: _req.method, path: loggablePath(_req) }, "Request error");
  } else {
    logger.error({ err, method: _req.method, path: loggablePath(_req) }, "Request error");
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
