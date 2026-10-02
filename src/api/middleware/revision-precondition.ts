import type { Request } from "express";
import { BadRequestError, AppError } from "./error-handler.js";

export class PreconditionRequiredError extends AppError {
  constructor(message = "If-Match revision is required") {
    super(428, message);
  }
}

/**
 * Parse an integer If-Match value, accepting 7, the conventional quoted "7", or
 * the weak form W/"7".
 *
 * The quotes are mandatory once W/ is present: RFC 7232 has no unquoted weak
 * validator, so W/7 is malformed and must be refused rather than silently read
 * as revision 7.
 */
export function requireIfMatchRevision(req: Request): number {
  const raw = req.header("if-match");
  if (!raw) throw new PreconditionRequiredError();
  const trimmed = raw.trim();
  const match = trimmed.match(/^(?:W\/"(\d+)"|"(\d+)"|(\d+))$/);
  if (!match) throw new BadRequestError("If-Match must contain an integer revision");
  const value = match[1] ?? match[2] ?? match[3];
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new BadRequestError("If-Match must contain a positive integer revision");
  }
  return revision;
}

/** Optional opaque correlation ID used only to suppress a mutation's own WS echo. */
export function mutationIdFromRequest(req: Request): string | null {
  const raw = req.header("x-aeolus-mutation-id")?.trim();
  return raw && raw.length <= 128 ? raw : null;
}
