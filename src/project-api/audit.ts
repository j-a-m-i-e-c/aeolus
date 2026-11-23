// src/project-api/audit.ts — the one writer for Project API administrative history (ADR-0027).
//
// Callers write inside the transaction of the change they record, so a change whose
// record cannot be stored rolls back with it. Records hold identities, hashes and
// structured metadata only: never source, bundles, keys or secrets.

import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";

export interface AuditContext {
  actor: { userId: string; username: string };
  /** Correlates the audit record with the HTTP request that caused it. */
  requestId: string;
}

export interface AuditFields {
  automationId?: string | null;
  apiId?: string | null;
  snapshotId?: string | null;
  clientId?: string | null;
  credentialId?: string | null;
  routeId?: string | null;
  oldHash?: string | null;
  newHash?: string | null;
  metadata?: Record<string, unknown>;
}

const statements = new WeakMap<DatabaseType, ReturnType<DatabaseType["prepare"]>>();

export function writeAudit(db: DatabaseType, ctx: AuditContext, action: string, fields: AuditFields, at: number): void {
  let insert = statements.get(db);
  if (!insert) {
    insert = db.prepare(`
      INSERT INTO project_api_audit (at, actor_user_id, actor_username, action, automation_id, api_id, snapshot_id,
        client_id, credential_id, route_id, old_hash, new_hash, request_id, metadata)
      VALUES (@at, @actorUserId, @actorUsername, @action, @automationId, @apiId, @snapshotId,
        @clientId, @credentialId, @routeId, @oldHash, @newHash, @requestId, @metadata)`);
    statements.set(db, insert);
  }
  insert.run({
    at,
    actorUserId: ctx.actor.userId,
    actorUsername: ctx.actor.username,
    action,
    automationId: fields.automationId ?? null,
    apiId: fields.apiId ?? null,
    snapshotId: fields.snapshotId ?? null,
    clientId: fields.clientId ?? null,
    credentialId: fields.credentialId ?? null,
    routeId: fields.routeId ?? null,
    oldHash: fields.oldHash ?? null,
    newHash: fields.newHash ?? null,
    requestId: ctx.requestId,
    metadata: JSON.stringify(fields.metadata ?? {}),
  });
}

/**
 * What a grant to a route actually permits: its method, path, handler and response
 * contract. A grant survives a republish only while this is unchanged, so reusing a
 * route id for different behaviour never extends an existing grant to it.
 */
export function routeFingerprint(route: { method: string; path: string; handler: string; response: unknown }): string {
  return createHash("sha256")
    .update(JSON.stringify([route.method, route.path, route.handler, route.response]))
    .digest("hex");
}

export type GrantRevokeReason =
  | "revoked"
  | "unpublished"
  | "route-changed"
  | "api-deleted"
  | "publication-withdrawn";

/**
 * Revoke an API's active grants, each with its own audit record, keeping the rows as
 * history. `keep` spares a grant whose route is still published with the same
 * fingerprint. Returns how many were revoked.
 */
export function revokeActiveGrants(
  db: DatabaseType,
  ctx: AuditContext,
  apiId: string,
  reason: GrantRevokeReason,
  at: number,
  keep?: (routeId: string, fingerprint: string) => boolean,
): number {
  const active = db.prepare("SELECT id, client_id, route_id, route_fingerprint FROM api_grants WHERE api_id = ? AND revoked_at IS NULL")
    .all(apiId) as Array<{ id: string; client_id: string; route_id: string; route_fingerprint: string }>;
  const revoke = db.prepare("UPDATE api_grants SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ?");
  let count = 0;
  for (const grant of active) {
    if (keep?.(grant.route_id, grant.route_fingerprint)) continue;
    revoke.run(at, ctx.actor.userId, reason, grant.id);
    writeAudit(db, ctx, "grant.revoked", { apiId, clientId: grant.client_id, routeId: grant.route_id, metadata: { reason, grantId: grant.id } }, at);
    count++;
  }
  return count;
}
