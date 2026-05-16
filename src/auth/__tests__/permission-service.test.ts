import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { initSchema } from "../../db/database.js";

let testDb: InstanceType<typeof Database>;

vi.mock("../../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../db/database.js")>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

const {
  getGroupPermissions,
  hasPermission,
  getUserTabPermission,
  getUserAccessibleTabs,
} = await import("../permission-service.js");

function createGroup(id: string, name: string): void {
  testDb
    .prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)")
    .run(id, name, Date.now());
}

function createTab(id: string, name: string, order: number): void {
  testDb
    .prepare(
      'INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    )
    .run(id, name, "layout", order, Date.now());
}

function createUser(
  id: string,
  username: string,
  role: "admin" | "user",
  groupId: string | null,
): void {
  testDb
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, username, "hash", role, groupId, Date.now());
}

function assignTab(
  groupId: string,
  tabId: string,
  permission: "read" | "interact" | "write",
): void {
  testDb
    .prepare(
      "INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)",
    )
    .run(groupId, tabId, permission);
}

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  initSchema(testDb);

  // Set up test data
  createGroup("g1", "Viewers");
  createGroup("g2", "Operators");
  createTab("tab-1", "Living Room", 1);
  createTab("tab-2", "Kitchen", 2);
  createTab("tab-3", "Bedroom", 3);

  // g1 has read on tab-1, interact on tab-2
  assignTab("g1", "tab-1", "read");
  assignTab("g1", "tab-2", "interact");

  // g2 has write on tab-1, read on tab-3
  assignTab("g2", "tab-1", "write");
  assignTab("g2", "tab-3", "read");

  // Users
  createUser("admin-1", "admin", "admin", null);
  createUser("user-1", "viewer", "user", "g1");
  createUser("user-2", "operator", "user", "g2");
  createUser("user-3", "unassigned", "user", null);
});

afterEach(() => {
  testDb.close();
});

describe("permission-service", () => {
  describe("getGroupPermissions", () => {
    it("returns all tab assignments for a group", () => {
      const perms = getGroupPermissions("g1");
      expect(perms).toHaveLength(2);
      expect(perms).toContainEqual({ tabId: "tab-1", permission: "read" });
      expect(perms).toContainEqual({ tabId: "tab-2", permission: "interact" });
    });

    it("returns empty array for group with no assignments", () => {
      createGroup("g-empty", "Empty Group");
      const perms = getGroupPermissions("g-empty");
      expect(perms).toHaveLength(0);
    });

    it("returns empty array for non-existent group", () => {
      const perms = getGroupPermissions("non-existent");
      expect(perms).toHaveLength(0);
    });
  });

  describe("hasPermission", () => {
    it("returns true for admin regardless of tab or level", () => {
      expect(hasPermission("admin-1", "tab-1", "write")).toBe(true);
      expect(hasPermission("admin-1", "tab-2", "write")).toBe(true);
      expect(hasPermission("admin-1", "non-existent-tab", "write")).toBe(true);
    });

    it("returns false for non-existent user", () => {
      expect(hasPermission("no-user", "tab-1", "read")).toBe(false);
    });

    it("returns false for user with no group", () => {
      expect(hasPermission("user-3", "tab-1", "read")).toBe(false);
    });

    it("returns false for tab not in group assignment", () => {
      // user-1 is in g1, which has no assignment for tab-3
      expect(hasPermission("user-1", "tab-3", "read")).toBe(false);
    });

    describe("permission hierarchy", () => {
      it("read permission satisfies read requirement", () => {
        // user-1 has read on tab-1
        expect(hasPermission("user-1", "tab-1", "read")).toBe(true);
      });

      it("read permission does not satisfy interact requirement", () => {
        expect(hasPermission("user-1", "tab-1", "interact")).toBe(false);
      });

      it("read permission does not satisfy write requirement", () => {
        expect(hasPermission("user-1", "tab-1", "write")).toBe(false);
      });

      it("interact permission satisfies read requirement", () => {
        // user-1 has interact on tab-2
        expect(hasPermission("user-1", "tab-2", "read")).toBe(true);
      });

      it("interact permission satisfies interact requirement", () => {
        expect(hasPermission("user-1", "tab-2", "interact")).toBe(true);
      });

      it("interact permission does not satisfy write requirement", () => {
        expect(hasPermission("user-1", "tab-2", "write")).toBe(false);
      });

      it("write permission satisfies all requirements", () => {
        // user-2 has write on tab-1
        expect(hasPermission("user-2", "tab-1", "read")).toBe(true);
        expect(hasPermission("user-2", "tab-1", "interact")).toBe(true);
        expect(hasPermission("user-2", "tab-1", "write")).toBe(true);
      });
    });
  });

  describe("getUserTabPermission", () => {
    it("returns write for admin on any tab", () => {
      expect(getUserTabPermission("admin-1", "tab-1")).toBe("write");
      expect(getUserTabPermission("admin-1", "tab-2")).toBe("write");
      expect(getUserTabPermission("admin-1", "non-existent")).toBe("write");
    });

    it("returns null for non-existent user", () => {
      expect(getUserTabPermission("no-user", "tab-1")).toBeNull();
    });

    it("returns null for user with no group", () => {
      expect(getUserTabPermission("user-3", "tab-1")).toBeNull();
    });

    it("returns the assigned permission level", () => {
      expect(getUserTabPermission("user-1", "tab-1")).toBe("read");
      expect(getUserTabPermission("user-1", "tab-2")).toBe("interact");
      expect(getUserTabPermission("user-2", "tab-1")).toBe("write");
    });

    it("returns null for tab not in group assignment", () => {
      expect(getUserTabPermission("user-1", "tab-3")).toBeNull();
    });
  });

  describe("getUserAccessibleTabs", () => {
    it("returns all tabs with write for admin", () => {
      const tabs = getUserAccessibleTabs("admin-1");
      expect(tabs).toHaveLength(3);
      expect(tabs).toContainEqual({ tabId: "tab-1", permission: "write" });
      expect(tabs).toContainEqual({ tabId: "tab-2", permission: "write" });
      expect(tabs).toContainEqual({ tabId: "tab-3", permission: "write" });
    });

    it("returns empty array for non-existent user", () => {
      expect(getUserAccessibleTabs("no-user")).toHaveLength(0);
    });

    it("returns empty array for user with no group", () => {
      expect(getUserAccessibleTabs("user-3")).toHaveLength(0);
    });

    it("returns group tab assignments for regular user", () => {
      const tabs = getUserAccessibleTabs("user-1");
      expect(tabs).toHaveLength(2);
      expect(tabs).toContainEqual({ tabId: "tab-1", permission: "read" });
      expect(tabs).toContainEqual({ tabId: "tab-2", permission: "interact" });
    });

    it("returns correct assignments for different groups", () => {
      const tabs = getUserAccessibleTabs("user-2");
      expect(tabs).toHaveLength(2);
      expect(tabs).toContainEqual({ tabId: "tab-1", permission: "write" });
      expect(tabs).toContainEqual({ tabId: "tab-3", permission: "read" });
    });
  });
});
