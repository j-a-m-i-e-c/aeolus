import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";

/**
 * Create a fresh in-memory SQLite database with the full Aeolus schema.
 * Each call returns an independent database instance.
 */
export function createTestDatabase(): DatabaseType {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}
