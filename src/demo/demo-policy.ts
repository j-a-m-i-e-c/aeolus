// src/demo/demo-policy.ts — The fail-closed allowlist for public-demo sessions.
//
// This is the single source of truth for what a public-demo visitor may reach.
// It is an ALLOWLIST: any (method, path) not listed here is denied. Adding a new
// route to Aeolus therefore does NOT expose it to the demo until it is added
// here and reviewed (public-demo-mode spec, Req 4.4, 4.6).
//
// Path patterns use a tiny segment matcher: a literal segment matches itself and
// a ":param" segment matches any single non-empty segment. No path-to-regexp
// dependency; matching is against req.path (full path at app-level middleware).

import type { Request } from "express";
import { makeDemoStateWriteValidator, makeDemoFireValidator, type DemoValidatorDeps } from "./demo-validators.js";

/**
 * A single allowlist entry. `validate` (mutations only) throws 4xx to reject.
 * It receives the request and the params extracted from the path (e.g. `id`),
 * because the guard runs as app-level middleware where Express has not yet
 * populated `req.params` for the matched route.
 */
export interface DemoPolicyEntry {
  method: string;
  pattern: string;
  validate?: (req: Request, params: Record<string, string>) => void;
}

/** A successful match: the entry plus the params extracted from the path. */
export interface DemoPolicyMatch {
  entry: DemoPolicyEntry;
  params: Record<string, string>;
}

/** Compiled matcher over an ordered list of policy entries. */
export interface DemoPolicyMatcher {
  /** Returns the match (entry + extracted params), or undefined (deny). */
  match(method: string, path: string): DemoPolicyMatch | undefined;
}

/**
 * Compile the allowlist into a matcher. Patterns are split into segments once;
 * `:param` segments match any single non-empty segment, everything else matches
 * literally. Method comparison is case-insensitive; trailing slashes ignored.
 */
export function compileDemoPolicy(entries: DemoPolicyEntry[]): DemoPolicyMatcher {
  const compiled = entries.map((entry) => ({
    entry,
    method: entry.method.toUpperCase(),
    segments: splitPath(entry.pattern),
  }));

  return {
    match(method: string, path: string): DemoPolicyMatch | undefined {
      const reqMethod = method.toUpperCase();
      const reqSegments = splitPath(path);
      for (const c of compiled) {
        if (c.method !== reqMethod) continue;
        if (c.segments.length !== reqSegments.length) continue;
        let ok = true;
        const params: Record<string, string> = {};
        for (let i = 0; i < c.segments.length; i++) {
          const seg = c.segments[i];
          if (seg.startsWith(":")) {
            if (reqSegments[i].length === 0) { ok = false; break; } // param must be non-empty
            params[seg.slice(1)] = reqSegments[i];
          } else if (seg !== reqSegments[i]) {
            ok = false;
            break;
          }
        }
        if (ok) return { entry: c.entry, params };
      }
      return undefined;
    },
  };
}

/** Split a path into non-empty segments (ignoring leading/trailing slashes). */
function splitPath(path: string): string[] {
  return path.split("?")[0].split("/").filter((s) => s.length > 0);
}

/**
 * Build the demo allowlist. Reads are validator-less (they still pass through
 * their existing resource/collection permission filters downstream). The two
 * mutating routes carry demo-specific validators.
 */
export function buildDemoPolicy(deps: DemoValidatorDeps): DemoPolicyEntry[] {
  const validateDemoStateWrite = makeDemoStateWriteValidator(deps);
  const validateDemoFire = makeDemoFireValidator(deps);

  return [
    // ── Safe reads (each still filtered by existing resource authorization) ──
    { method: "GET", pattern: "/api/auth/me" },
    { method: "GET", pattern: "/api/layout" },
    { method: "GET", pattern: "/api/devices" },
    { method: "GET", pattern: "/api/devices/:id" },
    { method: "GET", pattern: "/api/devices/:id/history" },
    { method: "GET", pattern: "/api/devices/:id/actions" },
    { method: "GET", pattern: "/api/devices/:id/completion-tiers" },
    { method: "GET", pattern: "/api/state" },
    { method: "GET", pattern: "/api/automations" },
    { method: "GET", pattern: "/api/automations/:id" },
    { method: "GET", pattern: "/api/automations/:id/ui-module" },
    { method: "GET", pattern: "/api/automations/:id/state" },
    { method: "GET", pattern: "/api/automations/history" },
    { method: "GET", pattern: "/api/data-store/collections" },
    { method: "GET", pattern: "/api/data-store/collections/:name/records" },
    { method: "GET", pattern: "/api/health" },
    { method: "GET", pattern: "/api/system/version" },

    // ── Admin read-only surfaces (public-demo visibility) ───────────────────
    // These are normally admin-only. A public-demo session is granted read-only
    // visibility so the demo showcases the whole platform (System, Data Store,
    // Security, Connectors). Two additive safeguards make this safe on the
    // throwaway demo box: (1) requireAdmin only relaxes for demo GET/HEAD, so
    // writes stay blocked; (2) the demo-scrub layer masks sensitive fields
    // (host/network identifiers, credentials, usernames, log contents) before
    // the response leaves the process. Reads only — no mutating admin routes.
    { method: "GET", pattern: "/api/system" },
    { method: "GET", pattern: "/api/system/logs" },
    { method: "GET", pattern: "/api/connectors" },
    { method: "GET", pattern: "/api/connectors/available" },
    { method: "GET", pattern: "/api/connectors/:id/status" },
    { method: "GET", pattern: "/api/data-store/config" },
    { method: "GET", pattern: "/api/data-store/stats" },
    { method: "GET", pattern: "/api/data-store/buckets" },
    { method: "GET", pattern: "/api/data-store/buckets/:bucket" },
    { method: "GET", pattern: "/api/auth/users" },
    { method: "GET", pattern: "/api/auth/groups" },
    { method: "GET", pattern: "/api/auth/mqtt-credentials" },
    { method: "GET", pattern: "/api/mqtt/provisioning/status" },
    { method: "GET", pattern: "/api/mqtt/private-topics" },

    // ── Approved bounded mutations ──
    { method: "PUT", pattern: "/api/automations/:id/state", validate: validateDemoStateWrite },
    { method: "POST", pattern: "/api/automations/:id/fire", validate: validateDemoFire },
  ];
}
