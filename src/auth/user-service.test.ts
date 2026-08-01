import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// Import after mock setup
const {
  createUser,
  getUser,
  getUserByUsername,
  listUsers,
  updateUser,
  deleteUser,
  changePassword,
  verifyPassword,
} = await import("./user-service.js");

function createTestGroup(id: string, name: string): void {
  testDb
    .prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)")
    .run(id, name, Date.now());
}

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  initSchema(testDb);
  // Create test groups that users can reference
  createTestGroup("g1", "Group 1");
  createTestGroup("g2", "Group 2");
});

afterEach(() => {
  testDb.close();
});

describe("user-service", () => {
  describe("createUser", () => {
    it("creates a user with hashed password", async () => {
      const user = await createUser("testuser", "password123", "g1");

      expect(user.username).toBe("testuser");
      expect(user.role).toBe("user");
      expect(user.groupId).toBe("g1");
      expect(user.passwordHash).not.toBe("password123");
      expect(user.id).toBeDefined();
      expect(user.createdAt).toBeGreaterThan(0);
    });

    it("rejects passwords shorter than 8 characters", async () => {
      await expect(createUser("user", "short", "g1")).rejects.toThrow(
        "Password must be at least 8 characters",
      );
    });

    it("rejects duplicate usernames", async () => {
      await createUser("duplicate", "password123", "g1");
      await expect(
        createUser("duplicate", "password456", "g2"),
      ).rejects.toThrow("Username already exists");
    });

    it("defaults to the user role when role is omitted", async () => {
      const user = await createUser("defaultrole", "password123", null);
      expect(user.role).toBe("user");
    });

    it("creates an admin when role is 'admin'", async () => {
      const user = await createUser("newadmin", "password123", null, "admin");
      expect(user.role).toBe("admin");
      expect(getUser(user.id)!.role).toBe("admin");
    });
  });

  describe("getUser", () => {
    it("returns user by ID", async () => {
      const created = await createUser("findme", "password123", "g1");
      const found = getUser(created.id);

      expect(found).not.toBeNull();
      expect(found!.username).toBe("findme");
    });

    it("returns null for non-existent ID", () => {
      expect(getUser("non-existent")).toBeNull();
    });
  });

  describe("getUserByUsername", () => {
    it("returns user by username", async () => {
      await createUser("byname", "password123", "g1");
      const found = getUserByUsername("byname");

      expect(found).not.toBeNull();
      expect(found!.username).toBe("byname");
    });

    it("returns null for non-existent username", () => {
      expect(getUserByUsername("nobody")).toBeNull();
    });
  });

  describe("listUsers", () => {
    it("returns users without password hashes", async () => {
      await createUser("user1", "password123", "g1");
      await createUser("user2", "password456", "g2");

      const users = listUsers();
      expect(users).toHaveLength(2);
      expect(users[0]).not.toHaveProperty("passwordHash");
      expect(users[1]).not.toHaveProperty("passwordHash");
      expect(users[0]).toHaveProperty("username");
      expect(users[0]).toHaveProperty("role");
    });
  });

  describe("updateUser", () => {
    it("updates groupId", async () => {
      const user = await createUser("updatable", "password123", "g1");
      const updated = await updateUser(user.id, { groupId: "g2" });

      expect(updated.groupId).toBe("g2");
    });

    it("updates password", async () => {
      const user = await createUser("pwchange", "password123", "g1");
      const updated = await updateUser(user.id, { password: "newpassword123" });

      const isValid = await verifyPassword(updated, "newpassword123");
      expect(isValid).toBe(true);
    });

    it("rejects short passwords", async () => {
      const user = await createUser("shortpw", "password123", "g1");
      await expect(updateUser(user.id, { password: "short" })).rejects.toThrow(
        "Password must be at least 8 characters",
      );
    });

    it("throws NotFoundError for non-existent user", async () => {
      await expect(
        updateUser("non-existent", { groupId: "g1" }),
      ).rejects.toThrow("User not found");
    });

    it("promotes a user to admin", async () => {
      const user = await createUser("promoteme", "password123", "g1");
      const updated = await updateUser(user.id, { role: "admin" });
      expect(updated.role).toBe("admin");
    });

    it("demotes an admin to user when another admin exists", async () => {
      const now = Date.now();
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
           VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-keep", "adminkeep", "hash", now);
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
           VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-demote", "admindemote", "hash", now);

      const updated = await updateUser("admin-demote", { role: "user" });
      expect(updated.role).toBe("user");
    });

    it("refuses to demote the last admin and leaves the role unchanged", async () => {
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
           VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-solo", "adminsolo", "hash", Date.now());

      await expect(
        updateUser("admin-solo", { role: "user" }),
      ).rejects.toThrow("Cannot remove the last admin user");
      expect(getUser("admin-solo")!.role).toBe("admin");
    });

    it("leaves role unchanged when role is omitted and still applies group", async () => {
      const now = Date.now();
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
           VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-x", "adminx", "hash", now);
      // Second admin so the guard would not fire even if it were consulted.
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
           VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-y", "adminy", "hash", now);

      const updated = await updateUser("admin-x", { groupId: "g1" });
      expect(updated.role).toBe("admin");
      expect(updated.groupId).toBe("g1");
    });
  });

  describe("deleteUser", () => {
    it("deletes a user", async () => {
      const user = await createUser("deleteme", "password123", "g1");
      deleteUser(user.id);

      expect(getUser(user.id)).toBeNull();
    });

    it("throws NotFoundError for non-existent user", () => {
      expect(() => deleteUser("non-existent")).toThrow("User not found");
    });

    it("prevents deleting the last admin", () => {
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
         VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-1", "admin", "hash", Date.now());

      expect(() => deleteUser("admin-1")).toThrow(
        "Cannot remove the last admin user",
      );
    });

    it("allows deleting an admin when another admin exists", () => {
      const now = Date.now();
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
         VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-1", "admin1", "hash", now);
      testDb
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
         VALUES (?, ?, ?, 'admin', NULL, ?)`,
        )
        .run("admin-2", "admin2", "hash", now);

      deleteUser("admin-1");
      expect(getUser("admin-1")).toBeNull();
      expect(getUser("admin-2")).not.toBeNull();
    });
  });

  describe("changePassword", () => {
    it("changes password when current password is correct", async () => {
      const user = await createUser("changepw", "oldpassword1", "g1");

      await changePassword(user.id, "oldpassword1", "newpassword1");

      const updated = getUser(user.id)!;
      const isValid = await verifyPassword(updated, "newpassword1");
      expect(isValid).toBe(true);
    });

    it("rejects when current password is incorrect", async () => {
      const user = await createUser("wrongpw", "correctpass1", "g1");

      await expect(
        changePassword(user.id, "wrongpass", "newpassword1"),
      ).rejects.toThrow("Current password is incorrect");
    });

    it("rejects when new password is too short", async () => {
      const user = await createUser("shortpw2", "password123", "g1");

      await expect(
        changePassword(user.id, "password123", "short"),
      ).rejects.toThrow("Password must be at least 8 characters");
    });

    it("revokes refresh tokens after password change", async () => {
      const user = await createUser("revoketokens", "password123", "g1");

      // Insert a refresh token for this user
      testDb
        .prepare(
          `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run("token-1", user.id, "somehash", Date.now() + 86400000, Date.now());

      await changePassword(user.id, "password123", "newpassword1");

      const tokens = testDb
        .prepare("SELECT * FROM refresh_tokens WHERE user_id = ?")
        .all(user.id);
      expect(tokens).toHaveLength(0);
    });
  });

  describe("verifyPassword", () => {
    it("returns true for correct password", async () => {
      const user = await createUser("verify", "mypassword1", "g1");
      const result = await verifyPassword(user, "mypassword1");
      expect(result).toBe(true);
    });

    it("returns false for incorrect password", async () => {
      const user = await createUser("verify2", "mypassword1", "g1");
      const result = await verifyPassword(user, "wrongpassword");
      expect(result).toBe(false);
    });
  });
});
