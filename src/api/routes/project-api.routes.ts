// src/api/routes/project-api.routes.ts — manage Project API publications (ADR-0027).
//
// Mounted under the normal dashboard authentication. Only a real admin may use any of
// it: `requireAdmin` lets a public-demo session through on GET, so it is not used here,
// and none of these routes is on the public-demo allowlist either.
//
// Nothing here serves an API. It decides what /api/exposed (Phase 2) may serve.

import { createHash, randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Database as DatabaseType } from "better-sqlite3";
import { AutomationProjectCompileError, compileAutomationProject, readAutomationProject, type ProjectCompileError } from "../../automations/automation-project.js";
import type { CompiledProjectApi } from "../../project-api/api-compiler.js";
import { ProjectApiError, type AuditContext, type ProjectApiStore } from "../../project-api/publication-store.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../middleware/error-handler.js";
import { mutationIdFromRequest } from "../middleware/revision-precondition.js";
import { validate } from "../middleware/validate.js";
import { auditQuerySchema, clientBodySchema, grantBodySchema, issueKeyBodySchema, publishBodySchema, rotateKeyBodySchema, slugBodySchema, tryRequestBodySchema } from "../schemas/project-api.schemas.js";
import type { ApiAccessStore } from "../../project-api/access-store.js";
import { routeFingerprint } from "../../project-api/audit.js";
import type { ApiRoute, CompiledApiRoute } from "../../project-api/manifest.js";
import { buildOpenApiDocument } from "../../project-api/openapi.js";

/**
 * Nothing here may be cached: responses carry one-time API keys, and every other one
 * describes access that can change at any moment.
 */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
}

/** A real admin: not a public-demo session, whatever the method. */
function requireRealAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin" || req.user.sessionType === "public-demo") {
    next(new ForbiddenError());
    return;
  }
  next();
}

function auditContext(req: Request): AuditContext {
  return {
    actor: { userId: req.user!.userId, username: req.user!.username },
    requestId: mutationIdFromRequest(req) ?? randomUUID(),
  };
}

function rethrow(error: unknown): never {
  if (error instanceof ProjectApiError) {
    const mapped = error.code === "invalid" ? new BadRequestError(error.message)
      : error.code === "not-found" ? new NotFoundError(error.message)
        : error.code === "forbidden" ? new ForbiddenError(error.message)
          : new ConflictError(error.message);
    // A stable reason the Endpoints UI can act on, such as offering to reclaim a slug.
    if (error.reason) mapped.details = { reason: error.reason };
    throw mapped;
  }
  throw error;
}

/**
 * How each route would change if the current source were published over the current
 * snapshot. A grant survives a republish only for an `unchanged` route; `changed` and
 * `removed` routes lose their grants, and `added` routes start with none.
 */
function routeChanges(published: ApiRoute[] | null, declared: ApiRoute[] | null): Array<{ routeId: string; change: "unchanged" | "changed" | "removed" | "added" }> {
  if (!published || !declared) return [];
  const current = new Map(declared.map((route) => [route.id, routeFingerprint(route)]));
  const changes: Array<{ routeId: string; change: "unchanged" | "changed" | "removed" | "added" }> = published.map((route) => {
    const next = current.get(route.id);
    return { routeId: route.id, change: next === undefined ? "removed" : next === routeFingerprint(route) ? "unchanged" : "changed" };
  });
  const before = new Set(published.map((route) => route.id));
  for (const route of declared) if (!before.has(route.id)) changes.push({ routeId: route.id, change: "added" });
  return changes;
}

const withoutSegments = ({ segments: _segments, ...route }: CompiledApiRoute): ApiRoute => route;

type CurrentApi =
  | { revision: number; api: CompiledProjectApi | null; errors: null }
  | { revision: number; api: null; errors: ProjectCompileError[] };

/**
 * Compile the automation's current source, as a save would. Results are cached by
 * automation and revision: every save bumps the revision, so a cached compile is never
 * stale, and an Endpoints view that polls status costs one compile per revision.
 */
const compileCache = new Map<string, Promise<CurrentApi>>();
const MAX_CACHED_COMPILES = 32;

async function compileCurrent(db: DatabaseType, automationId: string): Promise<CurrentApi | null> {
  const stored = readAutomationProject(db, automationId);
  if (!stored) return null;
  // Keyed by what would be compiled, not only by revision, so an edit that bypassed
  // the revision (direct SQL, a future import path) can never be served from cache.
  const source = createHash("sha256");
  for (const file of stored.files) source.update(file.path).update("\0").update(file.content).update("\0");
  const key = `${automationId}:${stored.revision}:${stored.logicEntry}:${stored.uiEntry ?? ""}:${source.digest("hex")}`;
  let pending = compileCache.get(key);
  if (!pending) {
    pending = compileAutomationProject({ files: stored.files, logicEntry: stored.logicEntry, uiEntry: stored.uiEntry })
      .then((compiled): CurrentApi => ({ revision: stored.revision, api: compiled.api, errors: null }))
      .catch((error: unknown): CurrentApi => {
        if (error instanceof AutomationProjectCompileError) return { revision: stored.revision, api: null, errors: error.details };
        compileCache.delete(key);
        throw error;
      });
    if (compileCache.size >= MAX_CACHED_COMPILES) compileCache.delete(compileCache.keys().next().value!);
    compileCache.set(key, pending);
  }
  return pending;
}

export interface ProjectApiRouteOptions {
  /**
   * Where this server's /api/exposed router answers over loopback, for test requests
   * from the Endpoints UI. A browser cannot call /api/exposed itself: it allows no
   * CORS. Without it the test route answers 404.
   */
  exposedBaseUrl?: string | (() => string);
  /**
   * A public-demo server refuses every management route, to every session including a
   * real admin's: its /api/exposed serves nothing, so nothing may be published there.
   */
  publicDemo?: boolean;
}

const TRY_TIMEOUT_MS = 10_000;
const TRY_MAX_BODY_CHARS = 70_000;

export function createProjectApiRoutes(db: DatabaseType, store: ProjectApiStore, access?: ApiAccessStore, options: ProjectApiRouteOptions = {}): Router {
  const router = Router();
  router.use(noStore);
  if (options.publicDemo) {
    router.use((_req, _res, next) => next(new ForbiddenError("Project APIs are not available in the public demo")));
    return router;
  }
  router.use(requireRealAdmin);

  if (access) mountAccessRoutes(router, access);

  /** GET /api/project-apis/audit — publication history, newest first, with storage use. */
  router.get("/audit", validate({ query: auditQuerySchema }), (req, res) => {
    const query = req.query as unknown as { apiId?: string; before?: number; limit?: number };
    res.json({ ...store.listAudit(query), storage: store.storageStats() });
  });

  /**
   * GET /api/project-apis/:automationId — what the source declares, what is published,
   * and whether they differ. The content hash returned here is what publish expects.
   */
  router.get("/:automationId", asyncHandler(async (req, res) => {
    const automationId = String(req.params.automationId);
    const current = await compileCurrent(db, automationId);
    if (!current) throw new NotFoundError("Automation not found");
    const record = store.get(automationId);
    const published = record?.publishedSnapshotId ? store.snapshotSummary(record.publishedSnapshotId) : null;
    const publishedRoutes = store.published(automationId)?.routes.map(withoutSegments) ?? null;
    const declaredRoutes = current.api ? current.api.routes.map(withoutSegments) : null;
    const servable = record ? store.resolve(record.slug) : null;
    res.json({
      automationId,
      revision: current.revision,
      declared: current.api && declaredRoutes
        ? { contentHash: current.api.contentHash, routes: declaredRoutes, files: current.api.sources.map((file) => file.path) }
        : null,
      compileErrors: current.errors,
      api: record ? { id: record.id, slug: record.slug, path: `/api/exposed/v1/${record.slug}` } : null,
      published,
      publishedRoutes,
      routeChanges: routeChanges(publishedRoutes, declaredRoutes),
      unpublishedChanges: Boolean(published && current.api && published.contentHash !== current.api.contentHash),
      status: !record ? "no-api" : servable?.ok ? "serving" : servable?.reason,
      lastPublicationEvent: record ? store.lastPublicationEvent(record.id) : null,
    });
  }));

  /**
   * GET /api/project-apis/:automationId/openapi.json — an OpenAPI 3.1 document for
   * what is published. Built from the immutable snapshot, never the editable source.
   */
  router.get("/:automationId/openapi.json", (req, res) => {
    const automationId = String(req.params.automationId);
    const published = store.published(automationId);
    if (!published) throw new NotFoundError("This automation has no published API");
    const automation = db.prepare("SELECT name FROM automation_rules WHERE id = ?").get(automationId) as { name: string } | undefined;
    res.setHeader("Content-Disposition", `attachment; filename="${published.api.slug}.openapi.json"`);
    res.json(buildOpenApiDocument({
      slug: published.api.slug,
      automationName: automation?.name ?? published.api.slug,
      snapshot: published.snapshot,
      routes: published.routes.map(withoutSegments),
    }));
  });

  /**
   * POST /api/project-apis/:automationId/try — call one published route with a key,
   * through the real /api/exposed pipeline (key, grant, limits, sandbox), and report
   * what a client would receive. The key is used for this request only: it is not
   * stored, logged, audited or echoed back.
   */
  router.post("/:automationId/try", validate({ body: tryRequestBodySchema }), asyncHandler(async (req, res) => {
    const base = typeof options.exposedBaseUrl === "function" ? options.exposedBaseUrl() : options.exposedBaseUrl;
    if (!base) throw new NotFoundError("Not found");
    const body = req.body as { routeId: string; params?: Record<string, string>; key: string };
    const published = store.published(String(req.params.automationId));
    if (!published) throw new ConflictError("Publish the API before testing it");
    const route = published.routes.find((candidate) => candidate.id === body.routeId);
    if (!route) throw new NotFoundError(`The published API has no route ${body.routeId}`);
    const parts: string[] = [];
    for (const segment of route.segments) {
      if (segment.kind === "literal") { parts.push(segment.value); continue; }
      const value = body.params?.[segment.name];
      if (value === undefined) throw new BadRequestError(`Fill in the path parameter ${segment.name}`);
      parts.push(encodeURIComponent(value));
    }
    const path = `/api/exposed/v1/${published.api.slug}/${parts.join("/")}`;
    const started = Date.now();
    let response: globalThis.Response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${body.key}`, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(TRY_TIMEOUT_MS),
      });
    } catch {
      throw new AppError(502, "The test request could not reach this server's API endpoint");
    }
    const text = (await response.text()).slice(0, TRY_MAX_BODY_CHARS);
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* reported as text */ }
    res.json({
      path,
      status: response.status,
      durationMs: Date.now() - started,
      requestId: response.headers.get("x-request-id"),
      retryAfter: response.headers.get("retry-after"),
      body: parsed,
    });
  }));

  /** GET /api/project-apis/:automationId/grants — the API's live grants, with client names. */
  router.get("/:automationId/grants", (req, res) => {
    if (!access) throw new NotFoundError("Not found");
    const record = store.get(String(req.params.automationId));
    res.json({ grants: record ? access.listGrantsForApi(record.id) : [] });
  });

  /** PUT /api/project-apis/:automationId/slug — create the API or change its slug. */
  router.put("/:automationId/slug", validate({ body: slugBodySchema }), (req, res) => {
    const body = req.body as { slug: string; reclaim?: boolean };
    try {
      res.json(store.setSlug(String(req.params.automationId), body.slug, auditContext(req), body.reclaim === true));
    } catch (error) {
      rethrow(error);
    }
  });

  /**
   * POST /api/project-apis/:automationId/publish — snapshot the current API source and
   * serve it. `contentHash` must be the hash the admin reviewed (from GET).
   */
  router.post("/:automationId/publish", validate({ body: publishBodySchema }), asyncHandler(async (req, res) => {
    const automationId = String(req.params.automationId);
    const current = await compileCurrent(db, automationId);
    if (!current) throw new NotFoundError("Automation not found");
    if (current.errors) throw new BadRequestError("The project does not compile; fix it before publishing");
    if (!current.api) throw new BadRequestError("The project declares no API (api/routes.json)");
    try {
      const snapshot = store.publish(automationId, current.api, current.revision, (req.body as { contentHash: string }).contentHash, auditContext(req));
      res.status(201).json(snapshot);
    } catch (error) {
      rethrow(error);
    }
  }));

  /**
   * POST /api/project-apis/:automationId/unpublish — stop serving at once and revoke
   * every client grant to this API. Republishing restores none of them.
   */
  router.post("/:automationId/unpublish", (req, res) => {
    try {
      const { revokedGrants } = store.unpublish(String(req.params.automationId), auditContext(req));
      res.json({ success: true, revokedGrants });
    } catch (error) {
      rethrow(error);
    }
  });

  /** POST /api/project-apis/:automationId/grants — grant a client one published route. */
  router.post("/:automationId/grants", validate({ body: grantBodySchema }), (req, res) => {
    if (!access) throw new NotFoundError("Not found");
    const body = req.body as { clientId: string; routeId: string };
    try {
      res.status(201).json(access.grant(body.clientId, String(req.params.automationId), body.routeId, auditContext(req)));
    } catch (error) {
      rethrow(error);
    }
  });

  /** POST /api/project-apis/:automationId/grants/revoke — withdraw one grant; the next request is refused. */
  router.post("/:automationId/grants/revoke", validate({ body: grantBodySchema }), (req, res) => {
    if (!access) throw new NotFoundError("Not found");
    const body = req.body as { clientId: string; routeId: string };
    try {
      res.json({ revoked: access.revokeGrant(body.clientId, String(req.params.automationId), body.routeId, auditContext(req)) });
    } catch (error) {
      rethrow(error);
    }
  });

  return router;
}

/** Clients and keys. Registered before /:automationId so /clients is never read as an id. */
function mountAccessRoutes(router: Router, access: ApiAccessStore): void {
  const handle = (fn: (req: Request) => unknown, status = 200) => (req: Request, res: Response) => {
    try {
      res.status(status).json(fn(req));
    } catch (error) {
      rethrow(error);
    }
  };

  router.get("/clients", handle(() => ({ clients: access.listClients() })));
  router.post("/clients", validate({ body: clientBodySchema }), handle((req) => access.createClient((req.body as { name: string }).name, auditContext(req)), 201));
  router.get("/clients/:clientId", handle((req) => access.getClient(String(req.params.clientId))));
  router.post("/clients/:clientId/disable", handle((req) => access.setClientStatus(String(req.params.clientId), "disabled", auditContext(req))));
  router.post("/clients/:clientId/enable", handle((req) => access.setClientStatus(String(req.params.clientId), "active", auditContext(req))));

  /** The response carries the full key once. It is not stored and cannot be shown again. */
  router.post("/clients/:clientId/keys", validate({ body: issueKeyBodySchema }), handle((req) =>
    access.issueKey(String(req.params.clientId), (req.body as { expiresAt?: number | null }).expiresAt ?? null, auditContext(req)), 201));
  router.post("/clients/:clientId/keys/:credentialId/rotate", validate({ body: rotateKeyBodySchema }), handle((req) =>
    access.rotateKey(String(req.params.clientId), String(req.params.credentialId), {
      expiresAt: (req.body as { expiresAt: number | null }).expiresAt,
      overlapSeconds: (req.body as { overlapSeconds?: number }).overlapSeconds ?? 0,
    }, auditContext(req)), 201));
  router.post("/clients/:clientId/keys/:credentialId/revoke", handle((req) =>
    access.revokeKey(String(req.params.clientId), String(req.params.credentialId), auditContext(req))));
}
