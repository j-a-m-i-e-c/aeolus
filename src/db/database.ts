// src/db/database.ts — SQLite database using sql.js (pure JS, no native deps)

import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import logger from "../logger.js";

let db: Database | null = null;

export function initSchema(database: Database): void {
  database.run("PRAGMA journal_mode=WAL;");
  database.run("PRAGMA foreign_keys = ON;");
  database.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      capabilities TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT '{}',
      integration TEXT NOT NULL DEFAULT 'mqtt',
      last_seen INTEGER NOT NULL
    );
  `);
  database.run(`
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
    try { database.run(`ALTER TABLE automation_rules ADD COLUMN ${col} ${def};`); }
    catch { /* column already exists */ }
  };
  addColumn("rule_type", "TEXT NOT NULL DEFAULT 'form'");
  addColumn("script_source", "TEXT DEFAULT NULL");
  addColumn("compiled_js", "TEXT DEFAULT NULL");
  addColumn("structured_metadata", "TEXT DEFAULT NULL");
  addColumn("ui_source", "TEXT DEFAULT NULL");
  addColumn("compiled_ui", "TEXT DEFAULT NULL");
  addColumn("trigger_type", "TEXT DEFAULT 'mqtt'");
  addColumn("cron_expression", "TEXT DEFAULT NULL");

  // Backfill existing rows that lack a rule_type value
  database.run(`UPDATE automation_rules SET rule_type = 'form' WHERE rule_type IS NULL;`);
  database.run(`
    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'layout',
      "order" INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  database.run(`
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
  database.run(`
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      connector_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      service_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS automation_state (
      rule_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (rule_id, key)
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS device_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      state TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_device_history_device_ts
    ON device_history(device_id, timestamp DESC);
  `);
  migrateRemoveTypeCheck(database);
}

/**
 * Migrate existing databases that have the old CHECK(type IN (...)) constraint
 * on the devices table. SQLite doesn't support ALTER TABLE DROP CONSTRAINT,
 * so we recreate the table without it: rename → create → copy → drop old.
 */
function migrateRemoveTypeCheck(database: Database): void {
  const result = database.exec(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'devices'`
  );

  if (result.length === 0 || result[0].values.length === 0) {
    return; // No devices table found — nothing to migrate
  }

  const createSql = result[0].values[0][0] as string;

  if (!/CHECK\s*\(/i.test(createSql)) {
    return; // No CHECK constraint — already migrated or fresh database
  }

  logger.info("Migrating devices table to remove CHECK constraint on type column");

  database.run("PRAGMA foreign_keys = OFF;");
  database.run("BEGIN TRANSACTION;");
  try {
    database.run("ALTER TABLE devices RENAME TO devices_old;");
    database.run(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL DEFAULT '{}',
        integration TEXT NOT NULL DEFAULT 'mqtt',
        last_seen INTEGER NOT NULL
      );
    `);
    database.run(`
      INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen)
      SELECT id, name, type, capabilities, state, integration, last_seen
      FROM devices_old;
    `);
    database.run("DROP TABLE devices_old;");
    database.run("COMMIT;");
    logger.info("Successfully migrated devices table — CHECK constraint removed");
  } catch (err) {
    database.run("ROLLBACK;");
    logger.error({ err }, "Failed to migrate devices table — rolling back");
    throw err;
  } finally {
    database.run("PRAGMA foreign_keys = ON;");
  }
}

function saveToFile(database: Database): void {
  const data = database.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(config.dbPath, buffer);
}

export async function getDatabase(): Promise<Database> {
  if (db) return db;

  const dir = path.dirname(config.dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(config.dbPath)) {
    const fileBuffer = fs.readFileSync(config.dbPath);
    db = new SQL.Database(fileBuffer);
    logger.info({ dbPath: config.dbPath }, "Loaded existing SQLite database");
  } else {
    db = new SQL.Database();
    logger.info({ dbPath: config.dbPath }, "Created new SQLite database");
  }

  initSchema(db);
  saveToFile(db);
  return db;
}

/** Save current database state to disk */
export function persistDatabase(): void {
  if (db) saveToFile(db);
}
