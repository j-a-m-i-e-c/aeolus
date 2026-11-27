// src/log-safety.ts — keep credentials out of every log line.
//
// Log lines go to stdout (and so `docker logs` and any log shipper) and to the
// admin-visible buffer behind /api/system/logs. Three layers keep secrets out:
//
// 1. Structure. `serializeError` keeps only an allowlist of error fields. Express's
//    JSON parse error carries the raw request `body`, and other libraries attach
//    configs, headers or requests; none of those are logged. Pino `redact` paths
//    (LOG_REDACT_PATHS) censor fields that are secret by name.
// 2. Callers. Request bodies are never logged; URLs are logged without query strings
//    (`loggableUrl`); a malformed body is reported by category only (error-handler.ts).
// 3. A last-line scrub (`scrubLogLine`) on every serialized line, before it reaches
//    stdout or the buffer, for credentials with a recognisable shape: Project API keys,
//    JWTs and bearer tokens. Free-form secrets such as passwords have no shape, which is
//    why layers 1 and 2 must not let them through in the first place.

/** Mask an Aeolus API key or a JWT anywhere in a string. Also used for request paths and metrics labels. */
export function maskCredentialSegments(text: string): string {
  return text
    .replace(/aeo_[A-Za-z0-9_-]+/g, "aeo_[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
}

/** Field paths censored by pino wherever they appear (one level of nesting for `*`). */
export const LOG_REDACT_PATHS = [
  "password",
  "newPassword",
  "currentPassword",
  "apiKey",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.apiKey",
  "*.secret",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.authorization",
  "*.headers.authorization",
  "*.headers.cookie",
  "body",
  "*.body",
];

const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;

/** Mask shaped credentials (API keys, JWTs, bearer tokens) anywhere in a log line. */
export function scrubLogLine(line: string): string {
  return maskCredentialSegments(line).replace(BEARER, "$1[redacted]");
}

const ERROR_FIELDS = ["type", "message", "stack", "code", "status", "statusCode", "reason"] as const;

/**
 * An error as it may be logged: type, message, stack and a few scalar codes. Nothing
 * else an error object carries (a request body, a config, headers) is copied.
 */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error, message: String(error) };
  const out: Record<string, unknown> = { type: error.constructor?.name ?? "Error" };
  const fields = error as unknown as Record<string, unknown>;
  for (const field of ERROR_FIELDS) {
    if (field === "type") continue;
    const value = fields[field];
    if (typeof value === "string" || typeof value === "number") out[field] = value;
  }
  if (error.cause instanceof Error) out.cause = serializeError(error.cause);
  return out;
}

/** A URL as it may be logged: scheme, host, port and path; no userinfo, query or fragment. */
export function loggableUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return maskCredentialSegments(`${url.protocol}//${url.host}${url.pathname}`);
  } catch {
    return "[invalid URL]";
  }
}

/** A command target as it may be logged: URLs (webhooks) lose their query string. */
export function loggableTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? loggableUrl(target) : maskCredentialSegments(target);
}

/** True for the errors Express's body parsers raise before a route runs. */
export function isBodyParserError(error: unknown): error is Error & { type: string; status: number } {
  if (!(error instanceof Error)) return false;
  const { type, status } = error as Error & { type?: unknown; status?: unknown };
  return typeof type === "string"
    && /^(entity\.|encoding\.|charset\.|request\.|stream\.)/.test(type)
    && typeof status === "number" && status >= 400 && status < 500;
}
