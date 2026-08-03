// src/demo/demo-scrub.ts
//
// Feature: public-demo-mode. Response-masking layer for public-demo sessions.
//
// Demo sessions are granted read-only visibility into admin surfaces (System,
// Data Store, Security, Connectors) so the demo can showcase the whole platform
// — see demo-policy.ts (allowlist) and auth-middleware.requireAdmin (the demo
// read relaxation). This module is the second half of that bargain: before an
// admin read leaves the process for a demo session, sensitive fields are masked
// so the public demo box never discloses host/network identifiers, credentials,
// real usernames, or raw log contents.
//
// It works by wrapping `res.json` for demo sessions only (keyed on
// `req.user.sessionType`) and transforming the body based on `req.path`. Normal
// sessions are never touched.

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { config } from "../config.js";

/** Masked placeholder shown in the demo in place of a sensitive value. */
const MASK = "•••";

// ─── Sensitive-field detection ────────────────────────────────────────────────

/**
 * Tokenise a key into lowercase words, splitting on camelCase and separators.
 * `bridgeIp` → ["bridge","ip"]; `api_key` → ["api","key"]; `userId` → ["user","id"].
 * Token-level matching avoids substring false positives (e.g. "recipient" would
 * wrongly match a bare "ip" substring, but tokenises to ["recipient"]).
 */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

const SENSITIVE_TOKENS = new Set([
  "password", "pass", "passwd", "secret", "token", "apikey", "authorization",
  "auth", "credential", "credentials", "privatekey", "salt", "hash",
  "username", "user", "ip", "ipaddress", "host", "hostname", "address",
  "url", "endpoint", "broker", "mac",
]);

/** True when a key name suggests its value is sensitive and should be masked. */
function looksSensitiveKey(key: string): boolean {
  const tokens = keyTokens(key);
  if (tokens.includes("api") && tokens.includes("key")) return true; // apiKey / api_key
  return tokens.some((t) => SENSITIVE_TOKENS.has(t));
}

// ─── String scrubbing (inline identifiers/secrets) ─────────────────────────────

const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Colon-separated hextets — matches typical IPv6 (needs at least two colons).
const IPV6_RE = /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{0,4}\b/g;
// Long opaque tokens (base64url / hex) that could be secrets embedded in text.
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;

/** Redact IP addresses and long opaque tokens embedded in a free-text string. */
function scrubText(value: string): string {
  return value
    .replace(IPV4_RE, MASK)
    .replace(IPV6_RE, MASK)
    .replace(LONG_TOKEN_RE, MASK);
}

// ─── Deep structural scrub ─────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively mask sensitive fields in an arbitrary JSON value:
 *  - a value under a sensitive key name is replaced with MASK (null/undefined
 *    are preserved so shapes the frontend depends on stay intact);
 *  - other strings are scrubbed for inline IPs/tokens;
 *  - arrays and objects are walked.
 */
function deepScrub(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(deepScrub);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (looksSensitiveKey(key)) {
        out[key] = val == null ? val : MASK;
      } else {
        out[key] = deepScrub(val);
      }
    }
    return out;
  }
  return value;
}

// ─── Path-specific scrubbers ───────────────────────────────────────────────────

/**
 * Users list: pseudonymise usernames (the real admin username must not be
 * disclosed) while preserving the role/group structure so the security model is
 * still visible.
 */
function scrubUsers(body: unknown): unknown {
  if (!Array.isArray(body)) return body;
  return body.map((user, i) => {
    if (!isPlainObject(user)) return user;
    const pseudonym = user.role === "admin" ? "administrator" : `member-${i + 1}`;
    return { ...user, username: pseudonym };
  });
}

const CONNECTOR_STATUS_RE = /^\/api\/connectors\/[^/]+\/status$/;

/** Paths whose responses are deep-scrubbed for a demo session. */
const DEEP_SCRUB_PATHS = new Set<string>([
  "/api/system",
  "/api/system/logs",
  "/api/connectors",
  "/api/auth/mqtt-credentials",
  "/api/mqtt/provisioning/status",
]);

/**
 * Transform a response body for a public-demo session based on the request path.
 * Unlisted paths are returned unchanged (they carry no host/credential data:
 * groups, private-topic patterns, data-store records/config/stats are demo-
 * generated fake content).
 */
export function scrubForDemo(path: string, body: unknown): unknown {
  if (path === "/api/auth/users") return scrubUsers(body);
  // The connector catalog is static type metadata + config schemas — no secrets.
  if (path === "/api/connectors/available") return body;
  if (DEEP_SCRUB_PATHS.has(path) || CONNECTOR_STATUS_RE.test(path)) {
    return deepScrub(body);
  }
  return body;
}

// ─── Middleware ────────────────────────────────────────────────────────────────

export interface DemoScrubDeps {
  /** Overridable for tests; defaults to the global config. */
  enabled?: boolean;
}

/**
 * Create the demo-scrub middleware. Inert unless demo mode is on AND the request
 * is a public-demo session; then it wraps `res.json` so the body is masked by
 * `scrubForDemo` before being serialised. Mounted app-level after `authenticate`
 * (alongside the PublicDemoGuard).
 */
export function createDemoScrubMiddleware(deps: DemoScrubDeps = {}): RequestHandler {
  const isEnabled = () => deps.enabled ?? config.publicDemo.enabled;

  return function demoScrub(req: Request, res: Response, next: NextFunction): void {
    if (!isEnabled() || req.user?.sessionType !== "public-demo") {
      next();
      return;
    }

    // Capture the full request path NOW. This middleware runs at the app level
    // (before routing), where `req.path` is the complete path (e.g.
    // "/api/system"). Express mutates `req.path` to be relative once the request
    // enters a mounted router, so reading it later — inside the deferred
    // `res.json` wrapper that fires from within the route handler — would yield
    // the stripped path ("/") and match nothing.
    const requestPath = req.path;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => originalJson(scrubForDemo(requestPath, body))) as Response["json"];
    next();
  };
}
