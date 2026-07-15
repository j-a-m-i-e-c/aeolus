// src/db/migrations/001-baseline.ts — Baseline migration: the original production schema

import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

/**
 * The baseline migration creates the complete original production schema.
 *
 * This is the schema as it existed before the addColumn migrations and the
 * devices CHECK-constraint removal. On a fresh database, migrations 002 and 003
 * will bring the schema up to the current state. On a legacy database, adoption
 * stamps this migration as already applied without re-running the creates.
 *
 * Tables: devices, automation_rules (original columns only), tabs, panes,
 * connectors, automation_state, device_history, groups, users,
 * group_tab_assignments, refresh_tokens, mqtt_credentials, system_settings.
 *
 * Indexes: idx_device_history_device_ts, idx_refresh_tokens_user, idx_refresh_tokens_hash.
 */
export const baseline: Migration = {
  id: 1,
  name: "baseline",
  up(db: DatabaseType): void {
    db.exec(`
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

    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_topic TEXT NOT NULL,
        condition_type TEXT DEFAULT NULL,
        condition_value TEXT DEFAULT NULL,
        action_type TEXT NOT NULL DEFAULT 'log',
        action_target TEXT NOT NULL DEFAULT '',
        action_params TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS tabs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'layout',
        "order" INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);

    db.exec(`
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

    db.exec(`
      CREATE TABLE IF NOT EXISTS connectors (
        id TEXT PRIMARY KEY,
        connector_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_state (
        rule_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (rule_id, key)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS device_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        state TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_device_history_device_ts
      ON device_history(device_id, timestamp DESC);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
        group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS group_tab_assignments (
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        tab_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK(permission IN ('read', 'interact', 'write')),
        PRIMARY KEY (group_id, tab_id)
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
      ON refresh_tokens(user_id);
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash
      ON refresh_tokens(token_hash);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS mqtt_credentials (
        id TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },
};
