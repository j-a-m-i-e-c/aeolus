// src/demo/public-demo-guard.ts — Fail-closed capability envelope for public
// demo sessions (public-demo-mode spec).
//
// Placement: mounted once at the app level, AFTER `authenticate` and BEFORE the
// route handlers/resource guards. This makes it strictly additive — an
// allowlisted demo request still faces its route's normal resource
// authorization; the guard can only further restrict, never widen.
//
// Behaviour:
//   • demo mode off, or a normal/absent session  → pass through unchanged
//   • public-demo session + allowlisted           → run any validator, then next()
//   • public-demo session + not allowlisted        → 403 (fail closed)

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ForbiddenError } from "../api/middleware/error-handler.js";
import { config } from "../config.js";
import { buildDemoPolicy, compileDemoPolicy, type DemoPolicyMatcher } from "./demo-policy.js";
import type { DemoValidatorDeps } from "./demo-validators.js";

export interface PublicDemoGuardDeps extends DemoValidatorDeps {
  /** Overridable for tests; defaults to the global config. */
  enabled?: boolean;
}

/**
 * Create the public-demo guard middleware. Compiles the allowlist once.
 */
export function createPublicDemoGuard(deps: PublicDemoGuardDeps): RequestHandler {
  const matcher: DemoPolicyMatcher = compileDemoPolicy(buildDemoPolicy(deps));
  const isEnabled = () => deps.enabled ?? config.publicDemo.enabled;

  return function publicDemoGuard(req: Request, _res: Response, next: NextFunction): void {
    // Inert unless demo mode is on AND this is a public-demo session. Normal and
    // unauthenticated requests (req.user undefined) are never constrained.
    if (!isEnabled() || req.user?.sessionType !== "public-demo") {
      next();
      return;
    }

    const matched = matcher.match(req.method, req.path);
    if (!matched) {
      throw new ForbiddenError("Unavailable in the public demo");
    }

    // Bounded-mutation validators throw 4xx on violation (before the handler).
    // Params come from the matcher because app-level middleware has no req.params.
    if (matched.entry.validate) {
      matched.entry.validate(req, matched.params);
    }

    next();
  };
}
