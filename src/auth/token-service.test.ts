import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { initSchema } from "../db/database.js";

let testDb: InstanceType<typeof Database>;

vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

// Must import after mock is set up
const {
  getSecret,
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  _resetSecretCache,
} = await import("./token-service.js");

describe("Token Service", () => {
  beforeEach(() => {
    // Create a fresh in-memory database for each test
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    testDb.pragma("foreign_keys = ON");
    initSchema(testDb);

    // Clear env var and cached secret between tests
    delete process.env.JWT_SECRET;
    _resetSecretCache();
  });

  afterEach(() => {
    testDb.close();
    vi.resetModules();
  });

  describe("getSecret()", () => {
    it("should use JWT_SECRET env var when set", () => {
      process.env.JWT_SECRET = "test-env-secret-value";
      const secret = getSecret();
      expect(secret).toBe("test-env-secret-value");
    });

    it("should generate and store a secret when none exists", () => {
      const secret = getSecret();
      expect(secret).toBeTruthy();
      expect(secret.length).toBeGreaterThan(0);

      // Verify it was stored in the database
      const row = testDb
        .prepare("SELECT value FROM system_settings WHERE key = ?")
        .get("jwt_secret") as { value: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.value).toBe(secret);
    });

    it("should load existing secret from database", () => {
      // Pre-store a secret
      testDb
        .prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)")
        .run("jwt_secret", "stored-db-secret");

      const secret = getSecret();
      expect(secret).toBe("stored-db-secret");
    });
  });

  describe("generateAccessToken() / verifyAccessToken()", () => {
    it("should generate a valid JWT with correct claims", () => {
      process.env.JWT_SECRET = "test-secret-for-jwt";

      const payload = {
        userId: "user-123",
        username: "testuser",
        role: "admin" as const,
        groupId: null,
      };

      const token = generateAccessToken(payload);
      expect(token).toBeTruthy();

      // Decode without verification to check structure
      const decoded = jwt.decode(token, { complete: true });
      expect(decoded).not.toBeNull();
      expect(decoded!.header.alg).toBe("HS256");
      expect((decoded!.payload as Record<string, unknown>).userId).toBe("user-123");
      expect((decoded!.payload as Record<string, unknown>).username).toBe("testuser");
      expect((decoded!.payload as Record<string, unknown>).role).toBe("admin");
      expect((decoded!.payload as Record<string, unknown>).groupId).toBeNull();
    });

    it("should set 15-minute expiry (exp - iat = 900)", () => {
      process.env.JWT_SECRET = "test-secret-for-jwt";

      const payload = {
        userId: "user-123",
        username: "testuser",
        role: "user" as const,
        groupId: "group-1",
      };

      const token = generateAccessToken(payload);
      const decoded = jwt.decode(token) as { iat: number; exp: number };
      expect(decoded.exp - decoded.iat).toBe(900);
    });

    it("should verify a valid token and return payload", () => {
      process.env.JWT_SECRET = "test-secret-for-jwt";

      const payload = {
        userId: "user-456",
        username: "alice",
        role: "user" as const,
        groupId: "group-2",
      };

      const token = generateAccessToken(payload);
      const result = verifyAccessToken(token);

      expect(result.userId).toBe("user-456");
      expect(result.username).toBe("alice");
      expect(result.role).toBe("user");
      expect(result.groupId).toBe("group-2");
    });

    it("should throw on invalid token", () => {
      process.env.JWT_SECRET = "test-secret-for-jwt";
      expect(() => verifyAccessToken("invalid.token.here")).toThrow();
    });

    it("should throw on token signed with different secret", () => {
      const token = jwt.sign({ userId: "x" }, "wrong-secret", { algorithm: "HS256" });
      process.env.JWT_SECRET = "correct-secret";
      expect(() => verifyAccessToken(token)).toThrow();
    });
  });

  describe("generateRefreshToken() / validateRefreshToken()", () => {
    it("should generate a base64url-encoded token", () => {
      process.env.JWT_SECRET = "test-secret";
      // Need a user in the DB for the foreign key
      testDb
        .prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("user-1", "testuser", "hash", "admin", null, Date.now());

      const rawToken = generateRefreshToken("user-1");
      expect(rawToken).toBeTruthy();
      // base64url: only contains [A-Za-z0-9_-]
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should store the hash (not raw token) in the database", () => {
      process.env.JWT_SECRET = "test-secret";
      testDb
        .prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("user-1", "testuser", "hash", "admin", null, Date.now());

      const rawToken = generateRefreshToken("user-1");

      const row = testDb
        .prepare("SELECT token_hash FROM refresh_tokens WHERE user_id = ?")
        .get("user-1") as { token_hash: string };

      // Hash should not equal raw token
      expect(row.token_hash).not.toBe(rawToken);
      // Hash should be a valid hex SHA-256 (64 chars)
      expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should validate a valid refresh token", () => {
      process.env.JWT_SECRET = "test-secret";
      testDb
        .prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("user-1", "testuser", "hash", "admin", null, Date.now());

      const rawToken = generateRefreshToken("user-1");
      const record = validateRefreshToken(rawToken);

      expect(record).not.toBeNull();
      expect(record!.userId).toBe("user-1");
      expect(record!.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should return null for an invalid refresh token", () => {
      process.env.JWT_SECRET = "test-secret";
      const result = validateRefreshToken("nonexistent-token");
      expect(result).toBeNull();
    });

    it("should return null and clean up expired tokens", () => {
      process.env.JWT_SECRET = "test-secret";
      testDb
        .prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("user-1", "testuser", "hash", "admin", null, Date.now());

      // Manually insert an expired token
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      testDb
        .prepare("INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("tok-1", "user-1", tokenHash, Date.now() - 1000, Date.now() - 100000);

      const result = validateRefreshToken(rawToken);
      expect(result).toBeNull();

      // Verify it was cleaned up
      const row = testDb.prepare("SELECT id FROM refresh_tokens WHERE id = ?").get("tok-1");
      expect(row).toBeUndefined();
    });
  });

  describe("revokeRefreshToken()", () => {
    it("should delete the token by hash", () => {
      process.env.JWT_SECRET = "test-secret";
      testDb
        .prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("user-1", "testuser", "hash", "admin", null, Date.now());

      const rawToken = generateRefreshToken("user-1");

      // Verify it exists
      expect(validateRefreshToken(rawToken)).not.toBeNull();

      // Revoke
      revokeRefreshToken(rawToken);

      // Verify it's gone
      expect(validateRefreshToken(rawToken)).toBeNull();
    });
  });

  describe("revokeAllUserTokens()", () => {
    it("should delete all refresh tokens for a user", () => {
      process.env.JWT_SECRET = "test-secret";
      testDb
        .prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("user-1", "testuser", "hash", "admin", null, Date.now());

      // Generate multiple tokens
      generateRefreshToken("user-1");
      generateRefreshToken("user-1");
      generateRefreshToken("user-1");

      // Verify they exist
      const countBefore = testDb
        .prepare("SELECT COUNT(*) as count FROM refresh_tokens WHERE user_id = ?")
        .get("user-1") as { count: number };
      expect(countBefore.count).toBe(3);

      // Revoke all
      revokeAllUserTokens("user-1");

      // Verify all gone
      const countAfter = testDb
        .prepare("SELECT COUNT(*) as count FROM refresh_tokens WHERE user_id = ?")
        .get("user-1") as { count: number };
      expect(countAfter.count).toBe(0);
    });
  });
});
