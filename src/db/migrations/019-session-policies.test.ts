import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { sessionPolicies } from "./019-session-policies.js";

let db: DatabaseType;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT,
      role TEXT, group_id TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE refresh_tokens (
      id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    INSERT INTO users VALUES ('existing', 'existing', 'hash', 'user', NULL, 1);
    INSERT INTO refresh_tokens VALUES ('old', 'existing', 'hash', 9999999999999, 100);
  `);
});
afterEach(() => db.close());

describe("migration 019 — session policy", () => {
  it("adds default policies without shortening the recorded expiry of existing sessions", () => {
    sessionPolicies.up(db);
    expect(db.prepare("SELECT session_days, inactivity_minutes FROM users").get())
      .toEqual({ session_days: 7, inactivity_minutes: 0 });
    const row = db.prepare("SELECT last_activity_at, expires_at FROM refresh_tokens").get() as {
      last_activity_at: number; expires_at: number;
    };
    expect(row.last_activity_at).toBeGreaterThan(0);
    expect(row.expires_at).toBe(9999999999999);
  });

  it("skips tables an adopted legacy database never created", () => {
    // A pre-migration-runner database is adopted by stamping the baseline rather
    // than running it, so the auth tables may simply not exist. Aborting here
    // would fail the whole migration run and stop the backend from starting.
    const legacy = new Database(":memory:");
    legacy.exec("CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
    expect(() => sessionPolicies.up(legacy)).not.toThrow();
    legacy.close();
  });

  it("adds the token activity clock even when only refresh_tokens exists", () => {
    const partial = new Database(":memory:");
    partial.exec(`
      CREATE TABLE refresh_tokens (
        id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT INTO refresh_tokens VALUES ('t', 'u', 'h', 9999999999999, 100);
    `);
    sessionPolicies.up(partial);
    const row = partial.prepare("SELECT last_activity_at FROM refresh_tokens").get() as {
      last_activity_at: number;
    };
    expect(row.last_activity_at).toBeGreaterThan(0);
    partial.close();
  });

  it("is safely repeatable after a partial column add", () => {
    db.exec("ALTER TABLE users ADD COLUMN session_days INTEGER NOT NULL DEFAULT 7");
    sessionPolicies.up(db);
    expect(() => sessionPolicies.up(db)).not.toThrow();
    const cols = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map(c => c.name);
    expect(cols).toContain("session_days");
    expect(cols).toContain("inactivity_minutes");
  });
});
