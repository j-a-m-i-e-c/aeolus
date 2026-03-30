// src/db/database.ts — SQLite database using sql.js (pure JS, no native deps)

import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import logger from "../logger.js";

let db: Database | null = null;

function initSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('light', 'sensor', 'switch', 'climate')),
      capabilities TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT '{}',
      integration TEXT NOT NULL DEFAULT 'mqtt',
      last_seen INTEGER NOT NULL
    );
  `);
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
