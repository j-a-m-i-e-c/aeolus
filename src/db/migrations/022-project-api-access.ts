// src/db/migrations/022-project-api-access.ts — API clients, keys and grants (ADR-0027, Phase 2).
//
//   api_clients      named machine integrations; never dashboard users
//   api_credentials  keys: only a SHA-256 of the secret is stored, looked up by key id
//   api_grants       read access to one route of one published API. Revoked grants keep
//                    their row (revoked_at, revoked_by, revoke_reason) as history; at
//                    most one active grant per client, API and route
//
// It also makes the loss of a publisher's admin role durable. When an admin is demoted
// or deleted, every publication they approved is withdrawn and its grants revoked, in
// the same statement, whatever code path changed the user. Regaining the admin role
// later restores nothing: an admin must republish and regrant. The application does the
// same first, inside its user-management transaction, so it can record which admin
// made the change; these triggers then find nothing left to do. They exist for every
// other path, such as direct SQL or the emergency admin recovery procedure.

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

const NOW = "CAST(strftime('%s','now') AS INTEGER) * 1000";

/** Body shared by the demote and delete triggers; `reason` is a SQL string literal. */
function withdrawApprovalsOf(reason: string): string {
  const approved = `SELECT a.id FROM project_apis a JOIN project_api_snapshots s ON s.id = a.published_snapshot_id WHERE s.published_by = OLD.id`;
  return `
    INSERT INTO project_api_audit (at, actor_user_id, actor_username, action, automation_id, api_id, snapshot_id, old_hash, request_id, metadata)
      SELECT ${NOW}, 'system', 'user-management', 'api.approval.revoked', a.automation_id, a.id, s.id, s.content_hash,
             'db-trigger', json_object('reason', ${reason}, 'publisherUserId', OLD.id, 'slug', a.slug)
      FROM project_apis a JOIN project_api_snapshots s ON s.id = a.published_snapshot_id WHERE s.published_by = OLD.id;
    INSERT INTO project_api_audit (at, actor_user_id, actor_username, action, api_id, client_id, route_id, request_id, metadata)
      SELECT ${NOW}, 'system', 'user-management', 'grant.revoked', g.api_id, g.client_id, g.route_id,
             'db-trigger', json_object('reason', 'publication-withdrawn', 'grantId', g.id)
      FROM api_grants g WHERE g.revoked_at IS NULL AND g.api_id IN (${approved});
    UPDATE api_grants SET revoked_at = ${NOW}, revoked_by = 'system', revoke_reason = 'publication-withdrawn'
      WHERE revoked_at IS NULL AND api_id IN (${approved});
    UPDATE project_apis SET published_snapshot_id = NULL, updated_at = ${NOW} WHERE id IN (${approved});`;
}

export const projectApiAccess: Migration = {
  id: 22,
  name: "project-api-access",
  up(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_credentials (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
        key_id TEXT NOT NULL UNIQUE,
        secret_hash TEXT NOT NULL,
        last4 TEXT NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        last_used_at INTEGER,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_api_credentials_client ON api_credentials(client_id);

      CREATE TABLE IF NOT EXISTS api_grants (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
        api_id TEXT NOT NULL REFERENCES project_apis(id) ON DELETE CASCADE,
        route_id TEXT NOT NULL,
        route_fingerprint TEXT NOT NULL,
        access TEXT NOT NULL DEFAULT 'read' CHECK (access IN ('read')),
        granted_by TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        revoked_at INTEGER,
        revoked_by TEXT,
        revoke_reason TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_grants_active
        ON api_grants(client_id, api_id, route_id) WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_api_grants_api ON api_grants(api_id, revoked_at);
    `);

    // Every real database has users (baseline migration 001); some legacy test
    // fixtures do not, and a trigger cannot be created on a missing table.
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) return;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS project_api_publisher_demoted
        AFTER UPDATE OF role ON users
        WHEN OLD.role = 'admin' AND NEW.role <> 'admin'
        BEGIN ${withdrawApprovalsOf("'publisher-demoted'")} END;

      CREATE TRIGGER IF NOT EXISTS project_api_publisher_deleted
        AFTER DELETE ON users
        WHEN OLD.role = 'admin'
        BEGIN ${withdrawApprovalsOf("'publisher-deleted'")} END;
    `);
  },
};
