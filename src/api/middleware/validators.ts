import type { Request, Response, NextFunction } from "express";
import { BadRequestError } from "./error-handler.js";

export function validateAction(req: Request, _res: Response, next: NextFunction): void {
  const { type } = req.body ?? {};

  if (!type || typeof type !== "string" || type.trim().length === 0) {
    next(new BadRequestError("Action type is required and must be a non-empty string"));
    return;
  }

  next();
}
