// src/db/database.ts — SQLite database using better-sqlite3 (native, disk-backed)

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import logger from "../logger.js";
import { runMigrations } from "./migration-runner.js";
import { migrations } from "./migrations/index.js";

let db: DatabaseType | null = null;

/**
 * Legacy schema initializer — retained as the body of the baseline migration
 * and for backward-compatible tests that call it directly. New code should not
 * call this; use getDatabase() which applies versioned migrations.
 */
export function initSchema(database: DatabaseType): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT '{}',
      integration TEXT NOT NULL DEFAULT 'mqtt',
      last_seen INTEGER NOT NULL,
      topic TEXT DEFAULT NULL,
      command_topic TEXT DEFAULT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_topic TEXT NOT NULL,
      condition_type TEXT DEFAULT NULL,
      condition_value TEXT DEFAULT NULL,
      action_type TEXT NOT NULL DEFAULT 'log',
      action_target TEXT NOT NULL DEFAULT '',
      action_params TEXT NOT NULL DEFAULT '{}',
      rule_type TEXT NOT NULL DEFAULT 'form',
      script_source TEXT DEFAULT NULL,
      compiled_js TEXT DEFAULT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);

  // Migration: add script rule columns to existing automation_rules tables
  const addColumn = (col: string, def: string) => {
    try { database.exec(`ALTER TABLE automation_rules ADD COLUMN ${col} ${def};`); }
    catch { /* column already exists */ }
  };
  const addDeviceColumn = (col: string, def: string) => {
    try { database.exec(`ALTER TABLE devices ADD COLUMN ${col} ${def};`); }
    catch { /* column already exists */ }
  };
  // MQTT source metadata is nullable so pre-existing devices remain valid and
  // acquire their exact source topic lazily on the next observation.
  addDeviceColumn("topic", "TEXT DEFAULT NULL");
  addDeviceColumn("command_topic", "TEXT DEFAULT NULL");
  // Connector instance ownership is nullable so MQTT and pre-existing devices
  // stay valid and connector devices reacquire their owner on the next poll.
  addDeviceColumn("connector_instance_id", "TEXT DEFAULT NULL");
  addColumn("rule_type", "TEXT NOT NULL DEFAULT 'form'");
  addColumn("script_source", "TEXT DEFAULT NULL");
  addColumn("compiled_js", "TEXT DEFAULT NULL");
  addColumn("structured_metadata", "TEXT DEFAULT NULL");
  addColumn("ui_source", "TEXT DEFAULT NULL");
  addColumn("compiled_ui", "TEXT DEFAULT NULL");
  addColumn("trigger_type", "TEXT DEFAULT 'mqtt'");
  addColumn("cron_expression", "TEXT DEFAULT NULL");
  addColumn("completion_tier", "TEXT DEFAULT NULL");

  // Backfill existing rows that lack a rule_type value
  database.exec(`UPDATE automation_rules SET rule_type = 'form' WHERE rule_type IS NULL;`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'layout',
      "order" INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS panes (
      id TEXT PRIMARY KEY,
      tab_id TEXT NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
      pane_type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      w INTEGER NOT NULL DEFAULT 6,
      h INTEGER NOT NULL DEFAULT 4,
      created_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      connector_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_state (
      rule_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (rule_id, key)
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS device_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      state TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_device_history_device_ts
    ON device_history(device_id, timestamp DESC);
  `);

  // Auth tables
  database.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS group_tab_assignments (
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      tab_id TEXT NOT NULL,
      permission TEXT NOT NULL CHECK(permission IN ('read', 'interact', 'write')),
      PRIMARY KEY (group_id, tab_id)
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
    ON refresh_tokens(user_id);
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash
    ON refresh_tokens(token_hash);
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS mqtt_credentials (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Resource-level authorization: server-side automation→tab ownership.
  // Mirrors migration 006 so legacy/test databases built via initSchema have it.
  database.exec(`
    CREATE TABLE IF NOT EXISTS automation_tab_assignments (
      automation_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
      tab_id        TEXT NOT NULL REFERENCES tabs(id)             ON DELETE CASCADE,
      PRIMARY KEY (automation_id, tab_id)
    );
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_automation_tab_assignments_tab
    ON automation_tab_assignments(tab_id);
  `);

  // Admin-managed private MQTT topic filters. Mirrors migration 007 so
  // legacy/test databases built via initSchema have it.
  database.exec(`
    CREATE TABLE IF NOT EXISTS mqtt_private_topics (
      id         TEXT PRIMARY KEY,
      pattern    TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_integration_topic
    ON devices(integration, topic)
    WHERE topic IS NOT NULL;
  `);

  migrateRemoveTypeCheck(database);
}

/**
 * Migrate existing databases that have the old CHECK(type IN (...)) constraint
 * on the devices table. SQLite doesn't support ALTER TABLE DROP CONSTRAINT,
 * so we recreate the table without it: rename → create → copy → drop old.
 *
 * @deprecated Used only by the legacy initSchema path. New code uses migration 003.
 */
function migrateRemoveTypeCheck(database: DatabaseType): void {
  const row = database.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'`
  ).get() as { sql: string } | undefined;

  if (!row) {
    return;
  }

  const createSql = row.sql;

  if (!/CHECK\s*\(/i.test(createSql)) {
    return;
  }

  logger.info("Migrating devices table to remove CHECK constraint on type column");

  database.exec("PRAGMA foreign_keys = OFF;");
  database.exec("BEGIN TRANSACTION;");
  try {
    database.exec("ALTER TABLE devices RENAME TO devices_old;");
    database.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT '{}',
        integration TEXT NOT NULL DEFAULT 'mqtt',
        last_seen INTEGER NOT NULL,
        topic TEXT DEFAULT NULL,
        command_topic TEXT DEFAULT NULL,
        connector_instance_id TEXT DEFAULT NULL
      );
    `);
    database.exec(`
      INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen, topic, command_topic, connector_instance_id)
      SELECT id, name, type, capabilities, state, integration, last_seen, topic, command_topic, connector_instance_id
      FROM devices_old;
    `);
    database.exec("DROP TABLE devices_old;");
    database.exec("COMMIT;");
    logger.info("Successfully migrated devices table — CHECK constraint removed");
  } catch (err) {
    database.exec("ROLLBACK;");
    logger.error({ err }, "Failed to migrate devices table — rolling back");
    throw err;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
}

/**
 * Get the database instance. Creates and initializes on first call.
 *
 * Opens the database, sets WAL mode and foreign keys, then applies all
 * pending versioned migrations. If any migration fails, throws — no
 * half-migrated instance is returned.
 */
export function getDatabase(): DatabaseType {
  if (db) return db;

  const dir = path.dirname(config.dbPath);
  fs.mkdirSync(dir, { recursive: true });

  // Fail fast with an actionable message if the data directory is not writable.
  // SQLite's WAL mode (set below) must create -wal/-shm sidecar files in this
  // directory; when the mounted volume is owned by another user the raw driver
  // error is an opaque "SQLITE_READONLY_DIRECTORY" thrown from deep inside a
  // pragma call. Surfacing the real cause here turns a cryptic crash loop into
  // a clear operator instruction.
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
    throw new Error(
      `Data directory is not writable: "${dir}" (process uid=${uid}). ` +
        `SQLite needs to create WAL files here, so this directory must be writable ` +
        `by the backend user. This usually means the mounted data volume is owned ` +
        `by a different user — fix the volume ownership and restart. ` +
        `See docs/production-deployment.md (data volume ownership).`,
    );
  }

  const instance = new Database(config.dbPath);

  // Enable WAL mode for better concurrent read performance
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");

  // Apply versioned migrations. If any fails, the instance is NOT assigned to
  // the module singleton — no half-migrated database is exposed to the app.
  runMigrations(instance, migrations, { dbPath: config.dbPath });

  db = instance;
  logger.info({ dbPath: config.dbPath }, "Database initialized (migrations applied, WAL mode)");
  return db;
}

/**
 * Close the database connection gracefully.
 * Called during shutdown.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
