// src/api/routes/project-api.routes.ts — manage Project API publications (ADR-0027).
//
// Mounted under the normal dashboard authentication. Only a real admin may use any of
// it: `requireAdmin` lets a public-demo session through on GET, so it is not used here,
// and none of these routes is on the public-demo allowlist either.
//
// Nothing here serves an API. It decides what /api/exposed (Phase 2) may serve.

import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Database as DatabaseType } from "better-sqlite3";
import { AutomationProjectCompileError, compileAutomationProject, readAutomationProject, type ProjectCompileError } from "../../automations/automation-project.js";
import type { CompiledProjectApi } from "../../project-api/api-compiler.js";
import { ProjectApiError, type AuditContext, type ProjectApiStore } from "../../project-api/publication-store.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../middleware/error-handler.js";
import { mutationIdFromRequest } from "../middleware/revision-precondition.js";
import { validate } from "../middleware/validate.js";
import { auditQuerySchema, publishBodySchema, slugBodySchema } from "../schemas/project-api.schemas.js";

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
    if (error.code === "invalid") throw new BadRequestError(error.message);
    if (error.code === "not-found") throw new NotFoundError(error.message);
    if (error.code === "forbidden") throw new ForbiddenError(error.message);
    throw new ConflictError(error.message);
  }
  throw error;
}

type CurrentApi =
  | { revision: number; api: CompiledProjectApi | null; errors: null }
  | { revision: number; api: null; errors: ProjectCompileError[] };

/** Compile the automation's current source, as a save would. */
async function compileCurrent(db: DatabaseType, automationId: string): Promise<CurrentApi | null> {
  const stored = readAutomationProject(db, automationId);
  if (!stored) return null;
  try {
    const compiled = await compileAutomationProject({ files: stored.files, logicEntry: stored.logicEntry, uiEntry: stored.uiEntry });
    return { revision: stored.revision, api: compiled.api, errors: null };
  } catch (error) {
    if (error instanceof AutomationProjectCompileError) return { revision: stored.revision, api: null, errors: error.details };
    throw error;
  }
}

export function createProjectApiRoutes(db: DatabaseType, store: ProjectApiStore): Router {
  const router = Router();
  router.use(requireRealAdmin);

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
    const servable = record ? store.resolve(record.slug) : null;
    res.json({
      automationId,
      revision: current.revision,
      declared: current.api
        ? { contentHash: current.api.contentHash, routes: current.api.routes.map(({ segments: _segments, ...route }) => route), files: current.api.sources.map((file) => file.path) }
        : null,
      compileErrors: current.errors,
      api: record ? { id: record.id, slug: record.slug, path: `/api/exposed/v1/${record.slug}` } : null,
      published,
      unpublishedChanges: Boolean(published && current.api && published.contentHash !== current.api.contentHash),
      status: !record ? "no-api" : servable?.ok ? "serving" : servable?.reason,
    });
  }));

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

  /** POST /api/project-apis/:automationId/unpublish — stop serving at once. */
  router.post("/:automationId/unpublish", (req, res) => {
    try {
      store.unpublish(String(req.params.automationId), auditContext(req));
      res.json({ success: true });
    } catch (error) {
      rethrow(error);
    }
  });

  return router;
}
