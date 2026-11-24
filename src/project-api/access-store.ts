// src/project-api/access-store.ts — API clients, keys and grants (ADR-0027, Phase 2).
//
// Consumer access is evaluated live on every request: client status, key expiry and
// revocation, and grants are read from the database each time, never from a
// publication snapshot. A change therefore applies to the next request. A request
// already running when access is revoked is allowed to finish; for read-only GET
// handlers bounded by the sandbox deadline, that is intended.
//
// API clients are not dashboard users. They have no password, role, session or
// refresh token, and nothing here touches `users` or `req.user`.

import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import { generateKey, parseBearerKey, secretMatches, UNKNOWN_KEY_HASH } from "./api-keys.js";
import { routeFingerprint, writeAudit, type AuditContext, type AuditFields } from "./audit.js";
import { parseApiManifest } from "./manifest.js";
import { ProjectApiError } from "./publication-store.js";

export const MAX_CLIENTS = 200;
export const MAX_KEYS_PER_CLIENT = 10;
export const MAX_ROTATION_OVERLAP_SECONDS = 7 * 24 * 3600;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export interface ApiClient { id: string; name: string; status: "active" | "disabled"; createdBy: string; createdAt: number; updatedAt: number }
export interface ApiCredential {
  id: string; clientId: string; keyId: string; last4: string; expiresAt: number | null; revokedAt: number | null;
  lastUsedAt: number | null; createdBy: string; createdAt: number;
}
export interface ApiGrant {
  id: string; clientId: string; apiId: string; routeId: string; routeFingerprint: string; access: "read";
  grantedBy: string; grantedAt: number; revokedAt: number | null; revokedBy: string | null; revokeReason: string | null;
}
export type AuthResult = { ok: true; client: ApiClient; credentialId: string } | { ok: false };

interface ClientRow { id: string; name: string; status: "active" | "disabled"; created_by: string; created_at: number; updated_at: number }
interface CredentialRow {
  id: string; client_id: string; key_id: string; secret_hash: string; last4: string; expires_at: number | null;
  revoked_at: number | null; last_used_at: number | null; created_by: string; created_at: number;
}
interface GrantRow {
  id: string; client_id: string; api_id: string; route_id: string; route_fingerprint: string; access: "read";
  granted_by: string; granted_at: number; revoked_at: number | null; revoked_by: string | null; revoke_reason: string | null;
}

const toClient = (r: ClientRow): ApiClient => ({ id: r.id, name: r.name, status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });
const toCredential = (r: CredentialRow): ApiCredential => ({
  id: r.id, clientId: r.client_id, keyId: r.key_id, last4: r.last4, expiresAt: r.expires_at, revokedAt: r.revoked_at,
  lastUsedAt: r.last_used_at, createdBy: r.created_by, createdAt: r.created_at,
});
const toGrant = (r: GrantRow): ApiGrant => ({
  id: r.id, clientId: r.client_id, apiId: r.api_id, routeId: r.route_id, routeFingerprint: r.route_fingerprint, access: r.access,
  grantedBy: r.granted_by, grantedAt: r.granted_at, revokedAt: r.revoked_at, revokedBy: r.revoked_by, revokeReason: r.revoke_reason,
});

export function createApiAccessStore(db: DatabaseType, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const audit = (ctx: AuditContext, action: string, fields: AuditFields) => writeAudit(db, ctx, action, fields, now());
  const lastUsedWritten = new Map<string, number>();

  const clientRow = (id: string) => db.prepare("SELECT * FROM api_clients WHERE id = ?").get(id) as ClientRow | undefined;
  function requireClient(id: string): ClientRow {
    const row = clientRow(id);
    if (!row) throw new ProjectApiError("not-found", "API client not found");
    return row;
  }
  function credentialOf(clientId: string, credentialId: string): CredentialRow {
    const row = db.prepare("SELECT * FROM api_credentials WHERE id = ? AND client_id = ?").get(credentialId, clientId) as CredentialRow | undefined;
    if (!row) throw new ProjectApiError("not-found", "API key not found");
    return row;
  }
  /** The API of an automation and the route as its live published snapshot declares it. */
  function publishedRoute(automationId: string, routeId: string) {
    const api = db.prepare(`SELECT a.id, s.manifest FROM project_apis a JOIN project_api_snapshots s ON s.id = a.published_snapshot_id
        WHERE a.automation_id = ?`).get(automationId) as { id: string; manifest: string } | undefined;
    if (!api) throw new ProjectApiError("conflict", "Publish the API before granting access to it");
    const route = parseApiManifest(api.manifest).routes.find((r) => r.id === routeId);
    if (!route) throw new ProjectApiError("not-found", `The published API has no route ${routeId}`);
    return { apiId: api.id, fingerprint: routeFingerprint(route) };
  }
  function issue(clientId: string, expiresAt: number | null, ctx: AuditContext, rotatedFrom?: string) {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM api_credentials WHERE client_id = ? AND revoked_at IS NULL").get(clientId) as { n: number }).n;
    if (count >= MAX_KEYS_PER_CLIENT) throw new ProjectApiError("conflict", `A client may hold at most ${MAX_KEYS_PER_CLIENT} active keys`);
    const generated = generateKey();
    const row: CredentialRow = {
      id: randomUUID(), client_id: clientId, key_id: generated.keyId, secret_hash: generated.secretHash, last4: generated.last4,
      expires_at: expiresAt, revoked_at: null, last_used_at: null, created_by: ctx.actor.userId, created_at: now(),
    };
    db.prepare(`INSERT INTO api_credentials (id, client_id, key_id, secret_hash, last4, expires_at, revoked_at, last_used_at, created_by, created_at)
      VALUES (@id, @client_id, @key_id, @secret_hash, @last4, @expires_at, NULL, NULL, @created_by, @created_at)`).run(row);
    audit(ctx, rotatedFrom ? "key.rotated" : "key.issued", {
      clientId, credentialId: row.id, metadata: { keyId: row.key_id, last4: row.last4, expiresAt, ...(rotatedFrom ? { replaces: rotatedFrom } : {}) },
    });
    return { key: generated.key, credential: toCredential(row) };
  }

  return {
    createClient(name: string, ctx: AuditContext): ApiClient {
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 100) throw new ProjectApiError("invalid", "Client name must be 1 to 100 characters");
      return db.transaction(() => {
        if ((db.prepare("SELECT COUNT(*) AS n FROM api_clients").get() as { n: number }).n >= MAX_CLIENTS) {
          throw new ProjectApiError("conflict", `At most ${MAX_CLIENTS} API clients`);
        }
        const at = now();
        const row: ClientRow = { id: randomUUID(), name: trimmed, status: "active", created_by: ctx.actor.userId, created_at: at, updated_at: at };
        db.prepare("INSERT INTO api_clients (id, name, status, created_by, created_at, updated_at) VALUES (@id, @name, @status, @created_by, @created_at, @updated_at)").run(row);
        audit(ctx, "client.created", { clientId: row.id, metadata: { name: trimmed } });
        return toClient(row);
      })();
    },

    /** Disabling stops every key of the client on the next request; its grants are kept. */
    setClientStatus(clientId: string, status: "active" | "disabled", ctx: AuditContext): ApiClient {
      return db.transaction(() => {
        const row = requireClient(clientId);
        if (row.status === status) return toClient(row);
        const at = now();
        db.prepare("UPDATE api_clients SET status = ?, updated_at = ? WHERE id = ?").run(status, at, clientId);
        audit(ctx, status === "disabled" ? "client.disabled" : "client.enabled", { clientId });
        return toClient({ ...row, status, updated_at: at });
      })();
    },

    listClients(): Array<ApiClient & { activeKeys: number; activeGrants: number }> {
      const rows = db.prepare(`SELECT c.*,
          (SELECT COUNT(*) FROM api_credentials k WHERE k.client_id = c.id AND k.revoked_at IS NULL) AS active_keys,
          (SELECT COUNT(*) FROM api_grants g WHERE g.client_id = c.id AND g.revoked_at IS NULL) AS active_grants
        FROM api_clients c ORDER BY c.created_at`).all() as Array<ClientRow & { active_keys: number; active_grants: number }>;
      return rows.map((r) => ({ ...toClient(r), activeKeys: r.active_keys, activeGrants: r.active_grants }));
    },

    /** A client with its keys (never secrets or hashes) and its grants, revoked ones included. */
    getClient(clientId: string): { client: ApiClient; credentials: ApiCredential[]; grants: ApiGrant[] } {
      const client = toClient(requireClient(clientId));
      const credentials = (db.prepare("SELECT * FROM api_credentials WHERE client_id = ? ORDER BY created_at").all(clientId) as CredentialRow[]).map(toCredential);
      const grants = (db.prepare("SELECT * FROM api_grants WHERE client_id = ? ORDER BY granted_at").all(clientId) as GrantRow[]).map(toGrant);
      return { client, credentials, grants };
    },

    /** Issue a key. The returned `key` is the only time the secret exists outside the caller's hands. */
    issueKey(clientId: string, expiresAt: number | null, ctx: AuditContext) {
      if (expiresAt !== null && expiresAt <= now()) throw new ProjectApiError("invalid", "Expiry must be in the future");
      return db.transaction(() => {
        requireClient(clientId);
        return issue(clientId, expiresAt, ctx);
      })();
    },

    /**
     * Replace a key. Two separate lifetimes are chosen here:
     *
     *   - `expiresAt` is the replacement key's own expiry, chosen explicitly (`null`
     *     for none). It is never inherited from the old key, so rotating a key that
     *     is about to expire does not hand out one that is about to expire too;
     *   - `overlapSeconds` is how long the OLD key keeps working. With 0 it is revoked
     *     at once; otherwise it expires then, never later than its own expiry, so a
     *     consumer can switch without downtime.
     *
     * Both are in the audit records.
     */
    rotateKey(clientId: string, credentialId: string, rotation: { expiresAt: number | null; overlapSeconds: number }, ctx: AuditContext) {
      const { expiresAt, overlapSeconds } = rotation;
      if (!Number.isInteger(overlapSeconds) || overlapSeconds < 0 || overlapSeconds > MAX_ROTATION_OVERLAP_SECONDS) {
        throw new ProjectApiError("invalid", `Overlap must be 0 to ${MAX_ROTATION_OVERLAP_SECONDS} seconds`);
      }
      if (expiresAt !== null && expiresAt <= now()) throw new ProjectApiError("invalid", "Expiry must be in the future");
      return db.transaction(() => {
        requireClient(clientId);
        const old = credentialOf(clientId, credentialId);
        if (old.revoked_at !== null) throw new ProjectApiError("conflict", "That key is already revoked");
        const at = now();
        if (overlapSeconds === 0) {
          db.prepare("UPDATE api_credentials SET revoked_at = ? WHERE id = ?").run(at, old.id);
          audit(ctx, "key.revoked", { clientId, credentialId: old.id, metadata: { keyId: old.key_id, reason: "rotated", overlapSeconds } });
        } else {
          const until = Math.min(old.expires_at ?? Number.MAX_SAFE_INTEGER, at + overlapSeconds * 1000);
          db.prepare("UPDATE api_credentials SET expires_at = ? WHERE id = ?").run(until, old.id);
          audit(ctx, "key.expiring", { clientId, credentialId: old.id, metadata: { keyId: old.key_id, reason: "rotated", overlapSeconds, expiresAt: until } });
        }
        return issue(clientId, expiresAt, ctx, old.id);
      })();
    },

    revokeKey(clientId: string, credentialId: string, ctx: AuditContext): ApiCredential {
      return db.transaction(() => {
        const row = credentialOf(clientId, credentialId);
        if (row.revoked_at !== null) return toCredential(row);
        const at = now();
        db.prepare("UPDATE api_credentials SET revoked_at = ? WHERE id = ?").run(at, row.id);
        audit(ctx, "key.revoked", { clientId, credentialId: row.id, metadata: { keyId: row.key_id, reason: "revoked" } });
        return toCredential({ ...row, revoked_at: at });
      })();
    },

    /** Grant a client read access to one route of a published API. Never extends to other routes. */
    grant(clientId: string, automationId: string, routeId: string, ctx: AuditContext): ApiGrant {
      return db.transaction(() => {
        const client = requireClient(clientId);
        if (client.status !== "active") throw new ProjectApiError("conflict", "Enable the client before granting it access");
        const { apiId, fingerprint } = publishedRoute(automationId, routeId);
        const existing = db.prepare("SELECT * FROM api_grants WHERE client_id = ? AND api_id = ? AND route_id = ? AND revoked_at IS NULL")
          .get(clientId, apiId, routeId) as GrantRow | undefined;
        if (existing) return toGrant(existing);
        const row: GrantRow = {
          id: randomUUID(), client_id: clientId, api_id: apiId, route_id: routeId, route_fingerprint: fingerprint, access: "read",
          granted_by: ctx.actor.userId, granted_at: now(), revoked_at: null, revoked_by: null, revoke_reason: null,
        };
        db.prepare(`INSERT INTO api_grants (id, client_id, api_id, route_id, route_fingerprint, access, granted_by, granted_at)
          VALUES (@id, @client_id, @api_id, @route_id, @route_fingerprint, @access, @granted_by, @granted_at)`).run(row);
        audit(ctx, "grant.created", { apiId, automationId, clientId, routeId, metadata: { grantId: row.id, access: "read" } });
        return toGrant(row);
      })();
    },

    revokeGrant(clientId: string, automationId: string, routeId: string, ctx: AuditContext): boolean {
      return db.transaction(() => {
        const api = db.prepare("SELECT id FROM project_apis WHERE automation_id = ?").get(automationId) as { id: string } | undefined;
        if (!api) throw new ProjectApiError("not-found", "This automation has no API");
        const grant = db.prepare("SELECT id FROM api_grants WHERE client_id = ? AND api_id = ? AND route_id = ? AND revoked_at IS NULL")
          .get(clientId, api.id, routeId) as { id: string } | undefined;
        if (!grant) return false;
        const at = now();
        db.prepare("UPDATE api_grants SET revoked_at = ?, revoked_by = ?, revoke_reason = 'revoked' WHERE id = ?").run(at, ctx.actor.userId, grant.id);
        audit(ctx, "grant.revoked", { apiId: api.id, automationId, clientId, routeId, metadata: { reason: "revoked", grantId: grant.id } });
        return true;
      })();
    },

    /**
     * Identify the caller from an Authorization header. Every failure is the same
     * result, and an unknown key id still costs a hash comparison.
     */
    authenticate(header: string | undefined): AuthResult {
      const parsed = parseBearerKey(header);
      if (!parsed) return { ok: false };
      const row = db.prepare(`SELECT k.id, k.secret_hash, k.expires_at, k.revoked_at, k.last_used_at, c.id AS client_id, c.name, c.status,
          c.created_by, c.created_at, c.updated_at
        FROM api_credentials k JOIN api_clients c ON c.id = k.client_id WHERE k.key_id = ?`).get(parsed.keyId) as
        (Pick<CredentialRow, "id" | "secret_hash" | "expires_at" | "revoked_at" | "last_used_at"> & ClientRow & { client_id: string }) | undefined;
      const matches = secretMatches(parsed.secret, row?.secret_hash ?? UNKNOWN_KEY_HASH);
      if (!row || !matches) return { ok: false };
      const at = now();
      if (row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= at) || row.status !== "active") return { ok: false };
      // Bounded writes: last-used is recorded at most once a minute per key.
      if (at - (lastUsedWritten.get(row.id) ?? 0) >= LAST_USED_WRITE_INTERVAL_MS) {
        lastUsedWritten.set(row.id, at);
        db.prepare("UPDATE api_credentials SET last_used_at = ? WHERE id = ?").run(at, row.id);
      }
      return {
        ok: true,
        credentialId: row.id,
        client: toClient({ id: row.client_id, name: row.name, status: row.status, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at }),
      };
    },

    /** True when the client holds a live grant to this route, for exactly this route behaviour. */
    isGranted(clientId: string, apiId: string, routeId: string, fingerprint: string): boolean {
      return Boolean(db.prepare(`SELECT 1 FROM api_grants WHERE client_id = ? AND api_id = ? AND route_id = ?
          AND route_fingerprint = ? AND revoked_at IS NULL`).get(clientId, apiId, routeId, fingerprint));
    },
  };
}

export type ApiAccessStore = ReturnType<typeof createApiAccessStore>;
