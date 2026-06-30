import { type ZodType } from "zod";
import type { Request, Response, NextFunction } from "express";

interface ValidateOptions {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export function validate(schemas: ValidateOptions) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
      next();
    } catch (err) {
      // Forward ZodError (and anything else) to the central errorHandler,
      // which formats validation failures as a 400 in one place.
      next(err);
    }
  };
}
