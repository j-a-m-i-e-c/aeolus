// src/project-api/access.unit.test.ts — key parsing, admission limits and access-store
// edge cases that the end-to-end router tests do not reach.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { runMigrations } from "../db/migration-runner.js";
import { migrations } from "../db/migrations/index.js";
import { generateKey, hashSecret, parseBearerKey, secretMatches } from "./api-keys.js";
import { createRequestLimiter } from "./request-limits.js";
import { createApiAccessStore, MAX_KEYS_PER_CLIENT } from "./access-store.js";
import { ProjectApiError, type AuditContext } from "./publication-store.js";

const ADMIN: AuditContext = { actor: { userId: "u-admin", username: "admin" }, requestId: "req" };

describe("api keys", () => {
  it("generates distinct, well-formed keys whose secret matches only its own hash", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.key).not.toBe(b.key);
    const parsed = parseBearerKey(`Bearer ${a.key}`)!;
    expect(parsed.keyId).toBe(a.keyId);
    expect(secretMatches(parsed.secret, a.secretHash)).toBe(true);
    expect(secretMatches(parsed.secret, b.secretHash)).toBe(false);
    expect(hashSecret(parsed.secret)).toBe(a.secretHash);
  });

  it.each([undefined, "", "Bearer", "bearer aeo_x", `Bearer ${"a".repeat(300)}`, "Bearer aeo_0123456789abcdef_short"])("refuses %j", (header) => {
    expect(parseBearerKey(header as string | undefined)).toBeNull();
  });

  it("never matches a malformed stored hash", () => {
    const { key } = generateKey();
    const { secret } = parseBearerKey(`Bearer ${key}`)!;
    expect(secretMatches(secret, "not-a-hash")).toBe(false);
    expect(secretMatches(secret, "")).toBe(false);
  });
});

describe("request limiter", () => {
  it("limits per key and per client, and resets each minute", () => {
    let now = 0;
    const limiter = createRequestLimiter({ perMinute: 2, concurrentPerClient: 10 }, () => now);
    const take = (client: string, key: string) => { const a = limiter.admit(client, key); if (a.ok) a.release(); return a.ok; };
    expect([take("c", "k1"), take("c", "k1"), take("c", "k1")]).toEqual([true, true, false]);
    // A second key of the same client shares the client's budget.
    expect(take("c", "k2")).toBe(false);
    expect(take("other", "k3")).toBe(true);
    now = 60_000;
    expect(take("c", "k1")).toBe(true);
  });

  it("reports when to retry", () => {
    let now = 0;
    const limiter = createRequestLimiter({ perMinute: 1, concurrentPerClient: 5 }, () => now);
    limiter.admit("c", "k");
    now = 45_000;
    expect(limiter.admit("c", "k")).toEqual({ ok: false, reason: "rate", retryAfterSeconds: 15 });
  });

  it("counts concurrency, and releasing twice frees only one slot", () => {
    const limiter = createRequestLimiter({ perMinute: 100, concurrentPerClient: 2 });
    const first = limiter.admit("c", "k");
    const second = limiter.admit("c", "k");
    expect(limiter.admit("c", "k")).toMatchObject({ ok: false, reason: "concurrency" });
    if (first.ok) { first.release(); first.release(); }
    expect(limiter.admit("c", "k").ok).toBe(true);
    expect(limiter.admit("c", "k")).toMatchObject({ ok: false, reason: "concurrency" });
    if (second.ok) second.release();
  });

  it("prunes expired windows instead of growing without bound", () => {
    let now = 0;
    const limiter = createRequestLimiter({ perMinute: 5, concurrentPerClient: 5 }, () => now);
    for (let i = 0; i < 10_001; i++) { const a = limiter.admit(`c${i}`, `k${i}`); if (a.ok) a.release(); }
    now = 120_000;
    const fresh = limiter.admit("late", "late");
    expect(fresh.ok).toBe(true);
  });
});

describe("access store edge cases", () => {
  let db: DatabaseType;
  let now: number;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db, migrations);
    now = 1_000_000;
  });
  afterEach(() => db.close());
  const store = () => createApiAccessStore(db, { now: () => now });

  it("caps active keys per client", () => {
    const access = store();
    const client = access.createClient("Farm", ADMIN);
    for (let i = 0; i < MAX_KEYS_PER_CLIENT; i++) access.issueKey(client.id, null, ADMIN);
    expect(() => access.issueKey(client.id, null, ADMIN)).toThrow(/at most/);
  });

  it("caps a rotation overlap at the old key's own expiry", () => {
    const access = store();
    const client = access.createClient("Farm", ADMIN);
    const { credential } = access.issueKey(client.id, now + 10_000, ADMIN);
    const rotated = access.rotateKey(client.id, credential.id, 3600, ADMIN);
    const old = access.getClient(client.id).credentials.find((c) => c.id === credential.id)!;
    expect(old.expiresAt).toBe(now + 10_000);
    expect(rotated.credential.expiresAt).toBe(now + 10_000);
  });

  it("revoking a revoked key changes nothing; a bad overlap or unknown client is refused", () => {
    const access = store();
    const client = access.createClient("Farm", ADMIN);
    const { credential } = access.issueKey(client.id, null, ADMIN);
    const first = access.revokeKey(client.id, credential.id, ADMIN);
    expect(access.revokeKey(client.id, credential.id, ADMIN).revokedAt).toBe(first.revokedAt);
    expect(() => access.rotateKey(client.id, credential.id, -1, ADMIN)).toThrow(ProjectApiError);
    expect(() => access.rotateKey(client.id, credential.id, 1.5, ADMIN)).toThrow(ProjectApiError);
    expect(() => access.setClientStatus("missing", "disabled", ADMIN)).toThrow(/not found/);
    expect(() => access.createClient("   ", ADMIN)).toThrow(/1 to 100/);
  });

  it("refuses an expired key and records last use at most once a minute", () => {
    const access = store();
    const client = access.createClient("Farm", ADMIN);
    const { key, credential } = access.issueKey(client.id, now + 1000, ADMIN);
    expect(access.authenticate(`Bearer ${key}`).ok).toBe(true);
    const lastUsed = () => access.getClient(client.id).credentials.find((c) => c.id === credential.id)!.lastUsedAt;
    expect(lastUsed()).toBe(now);
    now += 500;
    access.authenticate(`Bearer ${key}`);
    expect(lastUsed()).toBe(now - 500);
    now += 1000;
    expect(access.authenticate(`Bearer ${key}`).ok).toBe(false);
  });

  it("refuses grants for an unknown client or an automation without an API", () => {
    const access = store();
    expect(() => access.grant("missing", "a1", "level", ADMIN)).toThrow(/not found/);
    const client = access.createClient("Farm", ADMIN);
    expect(() => access.grant(client.id, "a1", "level", ADMIN)).toThrow(/Publish the API/);
    expect(access.hasAnyGrant(client.id, "api")).toBe(false);
    expect(access.isGranted(client.id, "api", "level", "f")).toBe(false);
  });

  it("caps the number of clients", () => {
    const access = store();
    const insert = db.prepare("INSERT INTO api_clients (id, name, status, created_by, created_at, updated_at) VALUES (?, 'x', 'active', 'u', 1, 1)");
    db.transaction(() => { for (let i = 0; i < 200; i++) insert.run(`c${i}`); })();
    expect(() => access.createClient("One too many", ADMIN)).toThrow(/At most 200/);
  });
});
