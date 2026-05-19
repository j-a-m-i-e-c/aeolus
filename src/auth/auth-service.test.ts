// src/auth/auth-service.test.ts — Unit tests for auth service

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { initSchema } from "../db/database.js";

// Mock the database module to use our test database
let testDb: DatabaseType;

vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("auth-service", () => {
  beforeEach(() => {
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    testDb.pragma("foreign_keys = ON");
    initSchema(testDb);

    // Set JWT secret for token generation
    process.env.JWT_SECRET = "test-secret-for-auth-service-tests";
  });

  afterEach(() => {
    testDb.close();
    delete process.env.JWT_SECRET;
  });

  // We import dynamically to ensure the mock is active
  async function getAuthService() {
    // Reset token service cache so it picks up new JWT_SECRET
    const { _resetSecretCache } = await import("./token-service.js");
    _resetSecretCache();
    return await import("./auth-service.js");
  }

  describe("needsSetup", () => {
    it("returns true when no admin exists", async () => {
      const { needsSetup } = await getAuthService();
      expect(needsSetup()).toBe(true);
    });

    it("returns false when admin exists", async () => {
      const { needsSetup, setupAdmin } = await getAuthService();
      await setupAdmin("admin", "password123");
      expect(needsSetup()).toBe(false);
    });
  });

  describe("setupAdmin", () => {
    it("creates admin user and returns tokens", async () => {
      const { setupAdmin } = await getAuthService();
      const result = await setupAdmin("admin", "securepass123");
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.username).toBe("admin");
      expect(result.user.role).toBe("admin");
      expect(result.user.id).toBeDefined();
    });

    it("trims username whitespace", async () => {
      const { setupAdmin } = await getAuthService();
      const result = await setupAdmin("  admin  ", "securepass123");
      expect(result.user.username).toBe("admin");
    });

    it("throws ConflictError if setup already completed", async () => {
      const { setupAdmin } = await getAuthService();
      await setupAdmin("admin", "securepass123");
      await expect(setupAdmin("admin2", "securepass456")).rejects.toThrow("Setup already completed");
    });

    it("throws BadRequestError for empty username", async () => {
      const { setupAdmin } = await getAuthService();
      await expect(setupAdmin("", "securepass123")).rejects.toThrow("Username must not be empty");
    });

    it("throws BadRequestError for whitespace-only username", async () => {
      const { setupAdmin } = await getAuthService();
      await expect(setupAdmin("   ", "securepass123")).rejects.toThrow("Username must not be empty");
    });

    it("throws BadRequestError for short password", async () => {
      const { setupAdmin } = await getAuthService();
      await expect(setupAdmin("admin", "short")).rejects.toThrow("at least 8 characters");
    });

    it("throws ConflictError for duplicate username", async () => {
      const { setupAdmin } = await getAuthService();
      // Manually insert a non-admin user with same username
      testDb.prepare(
        "INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, 'user', NULL, ?)"
      ).run("existing-id", "admin", "$2b$12$LJ3m4sMKfRzlTfMNpCz0OOKbGnGZfOGzRqQoXoFNT.VYj5L1IpDKi", Date.now());
      await expect(setupAdmin("admin", "securepass123")).rejects.toThrow("Username already exists");
    });
  });

  describe("login", () => {
    it("returns tokens on valid credentials", async () => {
      const { setupAdmin, login } = await getAuthService();
      await setupAdmin("admin", "securepass123");
      const result = await login("admin", "securepass123");
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.user.username).toBe("admin");
    });

    it("throws UnauthorizedError for non-existent user", async () => {
      const { login } = await getAuthService();
      await expect(login("nonexistent", "password123")).rejects.toThrow("Invalid username or password");
    });

    it("throws UnauthorizedError for wrong password", async () => {
      const { setupAdmin, login } = await getAuthService();
      await setupAdmin("admin", "securepass123");
      await expect(login("admin", "wrongpassword")).rejects.toThrow("Invalid username or password");
    });
  });

  describe("refresh", () => {
    it("returns new access token for valid refresh token", async () => {
      const { setupAdmin, refresh } = await getAuthService();
      const setupResult = await setupAdmin("admin", "securepass123");
      const newAccessToken = refresh(setupResult.refreshToken);
      expect(newAccessToken).toBeDefined();
      expect(typeof newAccessToken).toBe("string");
    });

    it("throws UnauthorizedError for invalid refresh token", async () => {
      const { refresh } = await getAuthService();
      expect(() => refresh("invalid-token")).toThrow("Invalid or expired refresh token");
    });

    it("throws UnauthorizedError when user no longer exists", async () => {
      const { setupAdmin, refresh } = await getAuthService();
      const result = await setupAdmin("admin", "securepass123");
      const refreshToken = result.refreshToken;
      // Disable foreign keys temporarily to allow orphaned token
      testDb.pragma("foreign_keys = OFF");
      testDb.prepare("DELETE FROM users WHERE id = ?").run(result.user.id);
      testDb.pragma("foreign_keys = ON");
      expect(() => refresh(refreshToken)).toThrow("User not found");
    });
  });

  describe("logout", () => {
    it("revokes the refresh token", async () => {
      const { setupAdmin, logout, refresh } = await getAuthService();
      const result = await setupAdmin("admin", "securepass123");
      logout(result.refreshToken);
      // Token should now be invalid
      expect(() => refresh(result.refreshToken)).toThrow("Invalid or expired refresh token");
    });

    it("does not throw for non-existent token", async () => {
      const { logout } = await getAuthService();
      expect(() => logout("non-existent-token")).not.toThrow();
    });
  });
});
