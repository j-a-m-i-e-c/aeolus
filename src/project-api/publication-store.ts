// src/project-api/publication-store.ts — what a Project API serves, and who changed it (ADR-0027).
//
// Code is snapshotted; authority is checked live. A published snapshot fixes the
// manifest, the source of the handlers' import graph and the compiled bundle an admin
// reviewed, so editing the project never changes what is served. Whether the snapshot
// may be served is decided on every resolve() from current facts: the automation still
// exists, is enabled and admin-authored, the admin who published it is still an admin,
// the snapshot matches this server's runtime contract and its bundle is intact. None of
// those is copied into the snapshot.
//
// Every mutation writes its audit record in the same transaction, so a change whose
// audit record cannot be stored does not happen.

import { createHash, randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type { AutomationProjectFile } from "../automations/automation-project.js";
import type { CompiledProjectApi } from "./api-compiler.js";
import { API_RUNTIME_CONTRACT } from "./api-sandbox.js";
import { parseApiManifest, type CompiledApiRoute } from "./manifest.js";
import { revokeActiveGrants, routeFingerprint, writeAudit, type AuditContext, type AuditFields } from "./audit.js";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46})[a-z0-9]$/;
const MAX_AUDIT_PAGE = 200;

export type { AuditContext } from "./audit.js";

export interface ProjectApiRecord {
  id: string;
  automationId: string;
  slug: string;
  publishedSnapshotId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SnapshotSummary {
  id: string;
  apiId: string;
  automationRevision: number;
  runtimeContract: number;
  contentHash: string;
  bundleHash: string;
  publishedBy: string;
  publishedAt: number;
  routeIds: string[];
}

export interface Snapshot extends SnapshotSummary {
  manifest: string;
  sources: AutomationProjectFile[];
  bundle: string;
}

export type UnservableReason =
  | "not-found"
  | "unpublished"
  | "disabled"
  | "authority-lost"
  | "publisher-not-admin"
  | "contract-mismatch"
  | "integrity";

/** A published API that exists but may not be served right now. Grants are untouched. */
export type UnavailableReason = Exclude<UnservableReason, "not-found" | "unpublished">;

export type Resolution =
  | { ok: true; api: ProjectApiRecord; snapshot: Snapshot; routes: CompiledApiRoute[] }
  | { ok: false; reason: "not-found" | "unpublished" }
  /**
   * `routes` are the published snapshot's routes, so the router can tell whether the
   * caller is granted the route it asked for before admitting the API is unavailable.
   * Empty when the stored manifest no longer parses: then no route can be identified,
   * and every caller gets 404.
   */
  | { ok: false; reason: UnavailableReason; api: ProjectApiRecord; routes: CompiledApiRoute[] };

export interface AuditEvent {
  id: number;
  at: number;
  actorUserId: string;
  actorUsername: string;
  action: string;
  automationId: string | null;
  apiId: string | null;
  snapshotId: string | null;
  clientId: string | null;
  credentialId: string | null;
  routeId: string | null;
  oldHash: string | null;
  newHash: string | null;
  requestId: string;
  metadata: Record<string, unknown>;
}

/** A refused change. `code` maps to an HTTP status in the routes. */
export class ProjectApiError extends Error {
  constructor(public readonly code: "invalid" | "not-found" | "conflict" | "forbidden", message: string) {
    super(message);
    this.name = "ProjectApiError";
  }
}

interface ApiRow { id: string; automation_id: string; slug: string; published_snapshot_id: string | null; created_at: number; updated_at: number }
interface SnapshotRow {
  id: string; api_id: string; automation_revision: number; runtime_contract: number; content_hash: string;
  bundle_hash: string; manifest: string; sources: string; bundle: string; published_by: string; published_at: number;
}
interface AuditRow {
  id: number; at: number; actor_user_id: string; actor_username: string; action: string; automation_id: string | null;
  api_id: string | null; snapshot_id: string | null; client_id: string | null; credential_id: string | null;
  route_id: string | null; old_hash: string | null; new_hash: string | null; request_id: string; metadata: string;
}

const toApi = (row: ApiRow): ProjectApiRecord => ({
  id: row.id, automationId: row.automation_id, slug: row.slug, publishedSnapshotId: row.published_snapshot_id,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

function routeIdsOf(manifest: string): string[] {
  try {
    const parsed = JSON.parse(manifest) as { routes?: Array<{ id?: unknown }> };
    return (parsed.routes ?? []).map((route) => String(route.id));
  } catch {
    return [];
  }
}

const toSummary = (row: Omit<SnapshotRow, "sources" | "bundle">): SnapshotSummary => ({
  id: row.id, apiId: row.api_id, automationRevision: row.automation_revision, runtimeContract: row.runtime_contract,
  contentHash: row.content_hash, bundleHash: row.bundle_hash, publishedBy: row.published_by, publishedAt: row.published_at,
  routeIds: routeIdsOf(row.manifest),
});

export interface ProjectApiStoreOptions {
  /** The runtime contract this server serves. Overridable for tests. */
  runtimeContract?: number;
  now?: () => number;
}

export function createProjectApiStore(db: DatabaseType, options: ProjectApiStoreOptions = {}) {
  const runtimeContract = options.runtimeContract ?? API_RUNTIME_CONTRACT;
  const now = options.now ?? Date.now;

  const audit = (ctx: AuditContext, action: string, fields: AuditFields) => writeAudit(db, ctx, action, fields, now());

  const apiByAutomation = (automationId: string) =>
    db.prepare("SELECT * FROM project_apis WHERE automation_id = ?").get(automationId) as ApiRow | undefined;
  const snapshotRow = (id: string) => db.prepare("SELECT * FROM project_api_snapshots WHERE id = ?").get(id) as SnapshotRow | undefined;
  const automationRow = (automationId: string) =>
    db.prepare("SELECT id, enabled, authored_unrestricted, revision FROM automation_rules WHERE id = ?").get(automationId) as
      { id: string; enabled: number; authored_unrestricted: number; revision: number } | undefined;

  function requireAdminAuthored(automationId: string) {
    const automation = automationRow(automationId);
    if (!automation) throw new ProjectApiError("not-found", "Automation not found");
    if (automation.authored_unrestricted !== 1) {
      throw new ProjectApiError("forbidden", "Only admin-authored automations can publish an API");
    }
    return automation;
  }

  function validSlug(slug: string): void {
    if (!SLUG_PATTERN.test(slug) || slug.includes("--")) {
      throw new ProjectApiError("invalid", "Slug must be 3 to 48 lowercase letters, digits and single hyphens, starting and ending with a letter or digit");
    }
  }

  return {
    get(automationId: string): ProjectApiRecord | null {
      const row = apiByAutomation(automationId);
      return row ? toApi(row) : null;
    },

    snapshotSummary(id: string): SnapshotSummary | null {
      const row = db.prepare("SELECT id, api_id, automation_revision, runtime_contract, content_hash, bundle_hash, manifest, published_by, published_at FROM project_api_snapshots WHERE id = ?")
        .get(id) as Omit<SnapshotRow, "sources" | "bundle"> | undefined;
      return row ? toSummary(row) : null;
    },

    /**
     * Give an automation's API a slug, or change it. A changed slug stops resolving at
     * once and is retired for good. Reusing a retired slug takes `reclaim`, which is
     * audited: it is how an admin deliberately points an old URL at a new API, such as
     * after reseeding the showcase.
     */
    setSlug(automationId: string, slug: string, ctx: AuditContext, reclaim = false): ProjectApiRecord & { reclaimedFrom?: string } {
      validSlug(slug);
      return db.transaction(() => {
        requireAdminAuthored(automationId);
        const existing = apiByAutomation(automationId);
        if (existing?.slug === slug) return toApi(existing);
        const live = db.prepare("SELECT automation_id FROM project_apis WHERE slug = ?").get(slug) as { automation_id: string } | undefined;
        if (live) throw new ProjectApiError("conflict", "Slug is already used by another API");
        const retired = db.prepare("SELECT api_id FROM project_api_retired_slugs WHERE slug = ?").get(slug) as { api_id: string } | undefined;
        if (retired && !reclaim) throw new ProjectApiError("conflict", "Slug was used before and is retired; reclaim it explicitly to reuse it");
        if (retired) {
          db.prepare("DELETE FROM project_api_retired_slugs WHERE slug = ?").run(slug);
          audit(ctx, "api.slug.reclaimed", { automationId, apiId: existing?.id, metadata: { slug, previousApiId: retired.api_id } });
        }
        const at = now();
        if (existing) {
          db.prepare("UPDATE project_apis SET slug = ?, updated_at = ? WHERE id = ?").run(slug, at, existing.id);
          audit(ctx, "api.slug.changed", { automationId, apiId: existing.id, metadata: { from: existing.slug, to: slug } });
          // A reclaimed slug now names this API. Grants, keys and publications belong to
        // API ids, so nothing of the previous holder's carries over.
        return { ...toApi({ ...existing, slug, updated_at: at }), ...(retired ? { reclaimedFrom: retired.api_id } : {}) };
        }
        const row: ApiRow = { id: randomUUID(), automation_id: automationId, slug, published_snapshot_id: null, created_at: at, updated_at: at };
        db.prepare("INSERT INTO project_apis (id, automation_id, slug, published_snapshot_id, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
          .run(row.id, automationId, slug, at, at);
        audit(ctx, "api.created", { automationId, apiId: row.id, metadata: { slug } });
        return { ...toApi(row), ...(retired ? { reclaimedFrom: retired.api_id } : {}) };
      })();
    },

    /**
     * Publish a compiled API as a new immutable snapshot and serve it.
     *
     * `reviewedHash` is the content hash the admin saw. `automationRevision` is the
     * revision the compile was taken from; both are checked inside the transaction, so
     * an edit that lands between review and publish is refused rather than published
     * unseen. Publishing never revives an earlier snapshot, even one with identical
     * content: it always records a new one, by this admin, now.
     */
    publish(automationId: string, api: CompiledProjectApi, automationRevision: number, reviewedHash: string, ctx: AuditContext): SnapshotSummary {
      if (api.contentHash !== reviewedHash) {
        throw new ProjectApiError("conflict", "The API source changed after it was reviewed; review it again before publishing");
      }
      return db.transaction(() => {
        const automation = requireAdminAuthored(automationId);
        if (automation.revision !== automationRevision) {
          throw new ProjectApiError("conflict", "The automation changed after it was reviewed; review it again before publishing");
        }
        const record = apiByAutomation(automationId);
        if (!record) throw new ProjectApiError("conflict", "Choose a slug before publishing");
        const previous = record.published_snapshot_id ? snapshotRow(record.published_snapshot_id) : undefined;
        const at = now();
        const id = randomUUID();
        const manifest = api.sources.find((file) => file.path === "api/routes.json")?.content ?? JSON.stringify(api.manifest);
        db.prepare(`INSERT INTO project_api_snapshots (id, api_id, automation_revision, runtime_contract, content_hash, bundle_hash,
            manifest, sources, bundle, published_by, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, record.id, automationRevision, runtimeContract, api.contentHash, api.bundleHash, manifest,
            JSON.stringify(api.sources), api.bundle, ctx.actor.userId, at);
        db.prepare("UPDATE project_apis SET published_snapshot_id = ?, updated_at = ? WHERE id = ?").run(id, at, record.id);
        // A grant carries over only to a route that still does exactly what it did.
        const fingerprints = new Map(api.routes.map((route) => [route.id, routeFingerprint(route)]));
        revokeActiveGrants(db, ctx, record.id, "route-changed", at, (routeId, fingerprint) => fingerprints.get(routeId) === fingerprint);
        audit(ctx, "api.published", {
          automationId, apiId: record.id, snapshotId: id, oldHash: previous?.content_hash ?? null, newHash: api.contentHash,
          metadata: {
            slug: record.slug, automationRevision, runtimeContract, previousSnapshotId: previous?.id ?? null,
            routeIds: api.routes.map((route) => route.id), files: api.sources.map((file) => file.path),
          },
        });
        return toSummary({ id, api_id: record.id, automation_revision: automationRevision, runtime_contract: runtimeContract,
          content_hash: api.contentHash, bundle_hash: api.bundleHash, manifest, published_by: ctx.actor.userId, published_at: at });
      })();
    },

    /**
     * Stop serving, and revoke every client's grant to this API in the same
     * transaction. The snapshot is kept as history and is never served again, and no
     * later publish, even of identical source, restores a revoked grant. Clients and
     * their keys are untouched: they may hold grants to other APIs.
     */
    unpublish(automationId: string, ctx: AuditContext): { revokedGrants: number } {
      return db.transaction(() => {
        const record = apiByAutomation(automationId);
        if (!record) throw new ProjectApiError("not-found", "This automation has no API");
        const at = now();
        const revokedGrants = revokeActiveGrants(db, ctx, record.id, "unpublished", at);
        if (!record.published_snapshot_id) return { revokedGrants };
        const previous = snapshotRow(record.published_snapshot_id);
        db.prepare("UPDATE project_apis SET published_snapshot_id = NULL, updated_at = ? WHERE id = ?").run(at, record.id);
        audit(ctx, "api.unpublished", { automationId, apiId: record.id, snapshotId: record.published_snapshot_id, oldHash: previous?.content_hash ?? null, metadata: { slug: record.slug, revokedGrants } });
        return { revokedGrants };
      })();
    },

    /**
     * Remove an automation's API ahead of deleting the automation. Call inside the
     * same transaction as the automation delete. Snapshots go with it (cascade) and the
     * slug is retired by trigger.
     */
    deleteForAutomation(automationId: string, ctx: AuditContext): void {
      const record = apiByAutomation(automationId);
      if (!record) return;
      // Recorded before the cascade removes the grant rows with the API.
      revokeActiveGrants(db, ctx, record.id, "api-deleted", now());
      audit(ctx, "api.deleted", { automationId, apiId: record.id, snapshotId: record.published_snapshot_id, metadata: { slug: record.slug, reason: "automation-deleted" } });
      db.prepare("DELETE FROM project_apis WHERE id = ?").run(record.id);
    },

    /** The API record behind a slug, published or not. */
    getBySlug(slug: string): ProjectApiRecord | null {
      const row = db.prepare("SELECT * FROM project_apis WHERE slug = ?").get(slug) as ApiRow | undefined;
      return row ? toApi(row) : null;
    },

    /** Decide from current facts whether the API at `slug` may be served, and with what. */
    resolve(slug: string): Resolution {
      const row = db.prepare("SELECT * FROM project_apis WHERE slug = ?").get(slug) as ApiRow | undefined;
      if (!row) return { ok: false, reason: "not-found" };
      const automation = automationRow(row.automation_id);
      if (!automation) return { ok: false, reason: "not-found" };
      if (!row.published_snapshot_id) return { ok: false, reason: "unpublished" };
      const snap = snapshotRow(row.published_snapshot_id);
      if (!snap || snap.api_id !== row.id) return { ok: false, reason: "unpublished" };
      let routes: CompiledApiRoute[] | null;
      try {
        routes = parseApiManifest(snap.manifest).routes;
      } catch {
        routes = null;
      }
      const api = toApi(row);
      const unavailable = (reason: UnavailableReason): Resolution => ({ ok: false, reason, api, routes: routes ?? [] });
      if (automation.enabled !== 1) return unavailable("disabled");
      if (automation.authored_unrestricted !== 1) return unavailable("authority-lost");
      const publisher = db.prepare("SELECT role FROM users WHERE id = ?").get(snap.published_by) as { role: string } | undefined;
      if (publisher?.role !== "admin") return unavailable("publisher-not-admin");
      if (snap.runtime_contract !== runtimeContract) return unavailable("contract-mismatch");
      if (createHash("sha256").update(snap.bundle).digest("hex") !== snap.bundle_hash) return unavailable("integrity");
      if (!routes) return unavailable("contract-mismatch");
      let sources: AutomationProjectFile[];
      try {
        sources = JSON.parse(snap.sources) as AutomationProjectFile[];
      } catch {
        return unavailable("integrity");
      }
      return { ok: true, api, snapshot: { ...toSummary(snap), manifest: snap.manifest, sources, bundle: snap.bundle }, routes };
    },

    /** Newest first. Pass the last event's id as `before` for the next page. */
    listAudit(query: { apiId?: string; before?: number; limit?: number } = {}): { events: AuditEvent[]; nextBefore: number | null } {
      const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 50)), MAX_AUDIT_PAGE);
      const rows = db.prepare(`SELECT * FROM project_api_audit
          WHERE (@apiId IS NULL OR api_id = @apiId) AND (@before IS NULL OR id < @before)
          ORDER BY id DESC LIMIT @limit`)
        .all({ apiId: query.apiId ?? null, before: query.before ?? null, limit: limit + 1 }) as AuditRow[];
      const page = rows.slice(0, limit).map((row): AuditEvent => ({
        id: row.id, at: row.at, actorUserId: row.actor_user_id, actorUsername: row.actor_username, action: row.action,
        automationId: row.automation_id, apiId: row.api_id, snapshotId: row.snapshot_id, clientId: row.client_id,
        credentialId: row.credential_id, routeId: row.route_id, oldHash: row.old_hash, newHash: row.new_hash,
        requestId: row.request_id, metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      }));
      return { events: page, nextBefore: rows.length > limit ? page[page.length - 1]!.id : null };
    },

    /** Row counts and stored bytes, for watching growth on a small device. */
    storageStats(): { auditEvents: number; auditBytes: number; snapshots: number; snapshotBytes: number } {
      const auditStats = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(metadata) + LENGTH(action) + LENGTH(request_id) + 64), 0) AS bytes FROM project_api_audit`).get() as { n: number; bytes: number };
      const snapStats = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(bundle) + LENGTH(sources) + LENGTH(manifest)), 0) AS bytes FROM project_api_snapshots`).get() as { n: number; bytes: number };
      return { auditEvents: auditStats.n, auditBytes: auditStats.bytes, snapshots: snapStats.n, snapshotBytes: snapStats.bytes };
    },
  };
}

export type ProjectApiStore = ReturnType<typeof createProjectApiStore>;

/**
 * Withdraw every publication approved by `publisherUserId`, because that user is about
 * to stop being an admin (demoted or deleted). Call inside the user-management
 * transaction, before the change, so the acting admin is recorded.
 *
 * This is not the same as an automation being disabled. Disabling makes an API
 * temporarily unavailable and leaves its approval and grants in place. Losing the
 * publisher's admin role withdraws the approval itself: the API is unpublished and
 * its grants revoked, and promoting the user back to admin restores nothing. An admin
 * must republish and regrant. Snapshots and audit history are kept.
 *
 * A database trigger (migration 022) does the same for any path that changes the user
 * without calling this, recording the actor as `system`.
 */
export function withdrawApprovalsBy(
  db: DatabaseType,
  publisherUserId: string,
  ctx: AuditContext,
  reason: "publisher-demoted" | "publisher-deleted",
  now: () => number = Date.now,
): number {
  // Databases built without migrations (some unit-test schemas) have no API tables.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_apis'").get()) return 0;
  const approved = db.prepare(`SELECT a.id, a.automation_id, a.slug, s.id AS snapshot_id, s.content_hash
      FROM project_apis a JOIN project_api_snapshots s ON s.id = a.published_snapshot_id
      WHERE s.published_by = ?`).all(publisherUserId) as Array<{ id: string; automation_id: string; slug: string; snapshot_id: string; content_hash: string }>;
  const at = now();
  for (const api of approved) {
    const revokedGrants = revokeActiveGrants(db, ctx, api.id, "publication-withdrawn", at);
    db.prepare("UPDATE project_apis SET published_snapshot_id = NULL, updated_at = ? WHERE id = ?").run(at, api.id);
    writeAudit(db, ctx, "api.approval.revoked", {
      automationId: api.automation_id, apiId: api.id, snapshotId: api.snapshot_id, oldHash: api.content_hash,
      metadata: { reason, publisherUserId, slug: api.slug, revokedGrants },
    }, at);
  }
  return approved.length;
}
