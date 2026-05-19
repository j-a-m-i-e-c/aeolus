// src/auth/group-service.test.ts — Unit tests for group CRUD operations

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
const { createGroup, getGroup, listGroups, updateGroup, deleteGroup } = await import("./group-service.js");

beforeEach(() => {
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("group-service", () => {
  describe("createGroup", () => {
    it("creates a group with tab assignments", () => {
      const group = createGroup("Viewers", [
        { tabId: "tab-1", permission: "read" },
        { tabId: "tab-2", permission: "interact" },
      ]);

      expect(group.id).toBeDefined();
      expect(group.name).toBe("Viewers");
      expect(group.tabAssignments).toHaveLength(2);
      expect(group.tabAssignments[0]).toEqual({ tabId: "tab-1", permission: "read" });
      expect(group.createdAt).toBeGreaterThan(0);
    });

    it("creates a group with empty tab assignments", () => {
      const group = createGroup("Empty Group", []);
      expect(group.name).toBe("Empty Group");
      expect(group.tabAssignments).toHaveLength(0);
    });

    it("throws ConflictError when group name already exists", () => {
      createGroup("Duplicate", []);
      expect(() => createGroup("Duplicate", [])).toThrow("Group name already exists");
    });
  });

  describe("getGroup", () => {
    it("returns group with tab assignments by ID", () => {
      const created = createGroup("Test Group", [{ tabId: "tab-1", permission: "write" }]);
      const found = getGroup(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("Test Group");
      expect(found!.tabAssignments).toEqual([{ tabId: "tab-1", permission: "write" }]);
    });

    it("returns null for non-existent group", () => {
      const found = getGroup("nonexistent-id");
      expect(found).toBeNull();
    });
  });

  describe("listGroups", () => {
    it("returns empty array when no groups exist", () => {
      expect(listGroups()).toEqual([]);
    });

    it("returns all groups with their tab assignments", () => {
      createGroup("Group A", [{ tabId: "tab-1", permission: "read" }]);
      createGroup("Group B", [{ tabId: "tab-2", permission: "write" }]);

      const groups = listGroups();
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.name).sort()).toEqual(["Group A", "Group B"]);
    });
  });

  describe("updateGroup", () => {
    it("updates group name and tab assignments", () => {
      const created = createGroup("Original", [{ tabId: "tab-1", permission: "read" }]);

      const updated = updateGroup(created.id, "Updated", [
        { tabId: "tab-2", permission: "write" },
        { tabId: "tab-3", permission: "interact" },
      ]);

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe("Updated");
      expect(updated.tabAssignments).toHaveLength(2);
      expect(updated.tabAssignments[0]).toEqual({ tabId: "tab-2", permission: "write" });
    });

    it("throws NotFoundError when group does not exist", () => {
      expect(() => updateGroup("nonexistent", "Name", [])).toThrow("Group not found");
    });

    it("throws ConflictError when new name conflicts with another group", () => {
      createGroup("Existing", []);
      const other = createGroup("Other", []);

      expect(() => updateGroup(other.id, "Existing", [])).toThrow("Group name already exists");
    });
  });

  describe("deleteGroup", () => {
    it("deletes an existing group", () => {
      const created = createGroup("To Delete", [{ tabId: "tab-1", permission: "read" }]);
      deleteGroup(created.id);

      expect(getGroup(created.id)).toBeNull();
    });

    it("throws NotFoundError when group does not exist", () => {
      expect(() => deleteGroup("nonexistent")).toThrow("Group not found");
    });

    it("removes tab assignments when group is deleted", () => {
      const created = createGroup("With Tabs", [
        { tabId: "tab-1", permission: "read" },
        { tabId: "tab-2", permission: "write" },
      ]);
      deleteGroup(created.id);
      expect(getGroup(created.id)).toBeNull();
    });
  });
});
