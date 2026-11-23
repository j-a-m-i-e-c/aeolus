// src/db/migrations/021-project-api-publications.ts — storage for published Project APIs (ADR-0027).
//
//   project_apis               one per automation that has a slug; points at the snapshot
//                              being served, or none
//   project_api_snapshots      immutable: the reviewed manifest, the source of the whole
//                              handler import graph, the compiled bundle and its hashes
//   project_api_retired_slugs  every slug that has stopped resolving, so no other API can
//                              take over a URL an integration still calls
//   project_api_audit          append-only history of publication changes, written in the
//                              same transaction as the change it records
//
// The triggers make "immutable" and "append-only" hold for every code path that goes
// through SQLite, not only for the store's own methods. They do not protect against
// someone with direct write access to the database file, who can drop them.

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

export const projectApiPublications: Migration = {
  id: 21,
  name: "project-api-publications",
  up(db: DatabaseType): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_apis (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL UNIQUE REFERENCES automation_rules(id) ON DELETE CASCADE,
        slug TEXT NOT NULL UNIQUE,
        published_snapshot_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_api_snapshots (
        id TEXT PRIMARY KEY,
        api_id TEXT NOT NULL REFERENCES project_apis(id) ON DELETE CASCADE,
        automation_revision INTEGER NOT NULL,
        runtime_contract INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        bundle_hash TEXT NOT NULL,
        manifest TEXT NOT NULL,
        sources TEXT NOT NULL,
        bundle TEXT NOT NULL,
        published_by TEXT NOT NULL,
        published_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_api_snapshots_api ON project_api_snapshots(api_id, published_at);

      CREATE TABLE IF NOT EXISTS project_api_retired_slugs (
        slug TEXT PRIMARY KEY,
        api_id TEXT NOT NULL,
        retired_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_api_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor_user_id TEXT NOT NULL,
        actor_username TEXT NOT NULL,
        action TEXT NOT NULL,
        automation_id TEXT,
        api_id TEXT,
        snapshot_id TEXT,
        client_id TEXT,
        credential_id TEXT,
        route_id TEXT,
        old_hash TEXT,
        new_hash TEXT,
        request_id TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_project_api_audit_api ON project_api_audit(api_id, id);

      CREATE TRIGGER IF NOT EXISTS project_api_snapshots_immutable
        BEFORE UPDATE ON project_api_snapshots
        BEGIN SELECT RAISE(ABORT, 'Project API snapshots are immutable'); END;

      CREATE TRIGGER IF NOT EXISTS project_api_audit_no_update
        BEFORE UPDATE ON project_api_audit
        BEGIN SELECT RAISE(ABORT, 'Project API audit history is append-only'); END;

      CREATE TRIGGER IF NOT EXISTS project_api_audit_no_delete
        BEFORE DELETE ON project_api_audit
        BEGIN SELECT RAISE(ABORT, 'Project API audit history is append-only'); END;

      -- Retire a slug whenever an API stops answering to it: renamed, deleted, or
      -- removed by its automation's cascade delete.
      CREATE TRIGGER IF NOT EXISTS project_apis_retire_on_delete
        AFTER DELETE ON project_apis
        BEGIN
          INSERT OR IGNORE INTO project_api_retired_slugs (slug, api_id, retired_at)
          VALUES (OLD.slug, OLD.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
        END;

      CREATE TRIGGER IF NOT EXISTS project_apis_retire_on_rename
        AFTER UPDATE OF slug ON project_apis
        WHEN OLD.slug <> NEW.slug
        BEGIN
          INSERT OR IGNORE INTO project_api_retired_slugs (slug, api_id, retired_at)
          VALUES (OLD.slug, OLD.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
        END;

      -- A retired slug is refused unless it is explicitly reclaimed first (the store
      -- deletes its retired row, with an audit record, in the same transaction).
      CREATE TRIGGER IF NOT EXISTS project_apis_no_retired_slug_insert
        BEFORE INSERT ON project_apis
        WHEN EXISTS (SELECT 1 FROM project_api_retired_slugs WHERE slug = NEW.slug)
        BEGIN SELECT RAISE(ABORT, 'Project API slug is retired'); END;

      CREATE TRIGGER IF NOT EXISTS project_apis_no_retired_slug_update
        BEFORE UPDATE OF slug ON project_apis
        WHEN OLD.slug <> NEW.slug AND EXISTS (SELECT 1 FROM project_api_retired_slugs WHERE slug = NEW.slug)
        BEGIN SELECT RAISE(ABORT, 'Project API slug is retired'); END;
    `);
  },
};
