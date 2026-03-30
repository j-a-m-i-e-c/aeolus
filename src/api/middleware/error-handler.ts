import type { Request, Response, NextFunction } from "express";
import logger from "../../logger.js";
import { config } from "../../config.js";

export class AppError extends Error {
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
  if (err instanceof AppError) {
    logger.error({ statusCode: err.statusCode, message: err.message }, err.message);
    res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode,
    });
    return;
  }

  logger.error(err, "Unexpected error");
  const statusCode = 500;
  res.status(statusCode).json({
    error: config.nodeEnv === "production" ? "Internal server error" : err.message,
    statusCode,
  });
}
