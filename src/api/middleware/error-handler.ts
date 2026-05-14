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

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Log full error details server-side always
  logger.error(err, "Request error");

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
