// src/project-api/exposed-router.ts — serve published Project APIs at /api/exposed (ADR-0027).
//
// Mounted before dashboard authentication and terminal: it answers every request
// under its prefix itself and never passes one on, so nothing here can fall through
// to a dashboard route. Order of checks, and the only responses a caller can see:
//
//   405  any method but GET or HEAD, for every path, before anything is looked up
//   414  over-long URL;  400  any query string
//   403  HTTPS required and Express could not establish it (EXPOSED_API_REQUIRE_HTTPS)
//   401  no key, malformed, unknown, wrong, expired or revoked key, disabled client
//   404  unknown version, slug, route, or any API or route the caller is not granted
//   503  a granted API that is unavailable (disabled, approval lost, contract)
//   429  over the rate or concurrency limit
//   200 / handler 400 / handler 404, or 500 / 504 / 503 from the sandbox
//
// Each status has one fixed body, so the body never reveals more than the status.
// Every request runs the immutable published snapshot in the API sandbox, with a
// read-only view of its own automation's state. Keys, query strings and response
// bodies are never logged.

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ApiAccessStore } from "./access-store.js";
import { routeFingerprint } from "./audit.js";
import { DEFAULT_API_LIMITS, invokeApiHandler, type ApiLimits, type ApiStateReader } from "./api-sandbox.js";
import { matchApiRoute, responseValidator, type CompiledApiRoute } from "./manifest.js";
import type { ProjectApiStore } from "./publication-store.js";
import type { RequestLimiter } from "./request-limits.js";
import { SLUG_PATTERN } from "./publication-store.js";

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface ExposedApiRouterDeps {
  publications: Pick<ProjectApiStore, "getBySlug" | "resolve">;
  access: Pick<ApiAccessStore, "authenticate" | "hasAnyGrant" | "isGranted">;
  /** Read-only state of the automation that owns an API. */
  stateFor: (automationId: string) => ApiStateReader;
  limiter: RequestLimiter;
  requireHttps: boolean;
  sandboxLimits?: ApiLimits;
  logger: Logger;
}

const MAX_URL_LENGTH = 2048;
const BODIES = {
  400: { error: "Query strings are not supported" },
  401: { error: "Unauthorized" },
  403: { error: "HTTPS is required" },
  404: { error: "Not found" },
  405: { error: "Method not allowed" },
  414: { error: "URI too long" },
  429: { error: "Too many requests" },
  500: { error: "Handler failed" },
  503: { error: "API unavailable" },
  504: { error: "Handler timed out" },
} as const;
type FixedStatus = keyof typeof BODIES;

export function createExposedApiRouter(deps: ExposedApiRouterDeps): Router {
  const router = Router();
  const sandboxLimits = deps.sandboxLimits ?? DEFAULT_API_LIMITS;
  const validators = new Map<string, (body: unknown) => boolean>();

  function validatorFor(snapshotId: string, route: CompiledApiRoute) {
    const key = `${snapshotId}:${route.id}`;
    let validate = validators.get(key);
    if (!validate) {
      if (validators.size > 500) validators.clear();
      validate = responseValidator(route);
      validators.set(key, validate);
    }
    return validate;
  }

  router.use((req: Request, res: Response) => {
    const started = Date.now();
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const facts: Record<string, unknown> = { requestId };

    const finish = (status: number, body: unknown, reason?: string) => {
      res.status(status).json(body);
      deps.logger.info({ ...facts, status, reason, durationMs: Date.now() - started }, "Project API request");
    };
    const fixed = (status: FixedStatus, reason: string) => finish(status, BODIES[status], reason);

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      fixed(405, "method");
      return;
    }
    const raw = req.originalUrl;
    if (raw.length > MAX_URL_LENGTH) { fixed(414, "url-length"); return; }
    if (raw.includes("?")) { fixed(400, "query"); return; }
    if (deps.requireHttps && !req.secure) { fixed(403, "https-required"); return; }

    const auth = deps.access.authenticate(req.headers.authorization);
    if (!auth.ok) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="aeolus-exposed-api"');
      fixed(401, "credentials");
      return;
    }
    facts.clientId = auth.client.id;

    // req.path is relative to the mount and still percent-encoded.
    const parts = /^\/v1\/([^/]+)(\/.*)$/.exec(req.path);
    if (!parts || !SLUG_PATTERN.test(parts[1]!)) { fixed(404, "path"); return; }
    const [, slug, rest] = parts as unknown as [string, string, string];

    // A caller with no grant to this API learns nothing about it, not even its state.
    const record = deps.publications.getBySlug(slug);
    if (!record || !deps.access.hasAnyGrant(auth.client.id, record.id)) { fixed(404, "not-granted"); return; }
    facts.apiId = record.id;

    const resolution = deps.publications.resolve(slug);
    if (!resolution.ok) {
      if (resolution.reason === "not-found" || resolution.reason === "unpublished") fixed(404, resolution.reason);
      else fixed(503, resolution.reason);
      return;
    }
    const match = matchApiRoute(resolution.routes, rest);
    if (!match || !deps.access.isGranted(auth.client.id, record.id, match.route.id, routeFingerprint(match.route))) {
      fixed(404, "not-granted");
      return;
    }
    facts.routeId = match.route.id;
    facts.snapshotId = resolution.snapshot.id;

    const admission = deps.limiter.admit(auth.client.id, auth.credentialId);
    if (!admission.ok) {
      res.setHeader("Retry-After", String(admission.retryAfterSeconds));
      fixed(429, admission.reason);
      return;
    }

    const { snapshot } = resolution;
    void invokeApiHandler(
      snapshot.bundle, match.route.handler, { routeId: match.route.id, params: match.params },
      deps.stateFor(record.automationId), sandboxLimits,
    ).then((result) => {
      if (!result.ok) {
        if (result.reason === "timeout") fixed(504, "timeout");
        else if (result.reason === "busy") { res.setHeader("Retry-After", "1"); fixed(503, "busy"); }
        else fixed(500, result.reason);
        return;
      }
      if (result.status === 200 && !validatorFor(snapshot.id, match.route)(result.body)) {
        fixed(500, "invalid-response");
        return;
      }
      finish(result.status, result.body);
    }).catch((error: unknown) => {
      deps.logger.warn({ ...facts, error: error instanceof Error ? error.message : String(error) }, "Project API request failed");
      if (!res.headersSent) fixed(500, "internal");
    }).finally(() => admission.release());
  });

  return router;
}

/** For a public demo: the same prefix answers everything with the fixed 404, unmounted from the API. */
export function createDisabledExposedApiRouter(): Router {
  const router = Router();
  router.use((_req, res) => { res.status(404).json(BODIES[404]); });
  return router;
}
