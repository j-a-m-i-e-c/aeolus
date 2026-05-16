// Group Service — CRUD operations for user groups
// Implements: createGroup, getGroup, listGroups, updateGroup, deleteGroup

import crypto from "node:crypto";
import { getDatabase } from "../db/database.js";
import {
  ConflictError,
  NotFoundError,
} from "../api/middleware/error-handler.js";

export interface TabAssignment {
  tabId: string;
  permission: "read" | "interact" | "write";
}

export interface Group {
  id: string;
  name: string;
  tabAssignments: TabAssignment[];
  createdAt: number;
}

interface GroupRow {
  id: string;
  name: string;
  created_at: number;
}

interface TabAssignmentRow {
  group_id: string;
  tab_id: string;
  permission: "read" | "interact" | "write";
}

function getTabAssignments(groupId: string): TabAssignment[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT tab_id, permission FROM group_tab_assignments WHERE group_id = ?")
    .all(groupId) as TabAssignmentRow[];
  return rows.map((row) => ({
    tabId: row.tab_id,
    permission: row.permission,
  }));
}

function rowToGroup(row: GroupRow, tabAssignments: TabAssignment[]): Group {
  return {
    id: row.id,
    name: row.name,
    tabAssignments,
    createdAt: row.created_at,
  };
}

/**
 * Create a new group with tab assignments.
 * Throws ConflictError if group name already exists.
 * Uses a transaction to insert into both groups and group_tab_assignments.
 */
export function createGroup(name: string, tabAssignments: TabAssignment[]): Group {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  const insertGroup = db.prepare(
    "INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)",
  );
  const insertAssignment = db.prepare(
    "INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)",
  );

  const transaction = db.transaction(() => {
    try {
      insertGroup.run(id, name, createdAt);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new ConflictError("Group name already exists");
      }
      throw err;
    }

    for (const assignment of tabAssignments) {
      insertAssignment.run(id, assignment.tabId, assignment.permission);
    }
  });

  transaction();

  return {
    id,
    name,
    tabAssignments,
    createdAt,
  };
}

/**
 * Get a group by ID with its tab assignments.
 * Returns null if not found.
 */
export function getGroup(id: string): Group | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM groups WHERE id = ?")
    .get(id) as GroupRow | undefined;

  if (!row) return null;

  const tabAssignments = getTabAssignments(id);
  return rowToGroup(row, tabAssignments);
}

/**
 * List all groups with their tab assignments.
 */
export function listGroups(): Group[] {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM groups").all() as GroupRow[];

  return rows.map((row) => {
    const tabAssignments = getTabAssignments(row.id);
    return rowToGroup(row, tabAssignments);
  });
}

/**
 * Update a group's name and tab assignments.
 * Throws NotFoundError if group doesn't exist.
 * Throws ConflictError if new name conflicts with another group.
 * Uses a transaction to update name, delete old assignments, and insert new ones.
 */
export function updateGroup(
  id: string,
  name: string,
  tabAssignments: TabAssignment[],
): Group {
  const db = getDatabase();

  const existing = db
    .prepare("SELECT * FROM groups WHERE id = ?")
    .get(id) as GroupRow | undefined;

  if (!existing) {
    throw new NotFoundError("Group not found");
  }

  const updateName = db.prepare("UPDATE groups SET name = ? WHERE id = ?");
  const deleteAssignments = db.prepare(
    "DELETE FROM group_tab_assignments WHERE group_id = ?",
  );
  const insertAssignment = db.prepare(
    "INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)",
  );

  const transaction = db.transaction(() => {
    try {
      updateName.run(name, id);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new ConflictError("Group name already exists");
      }
      throw err;
    }

    deleteAssignments.run(id);

    for (const assignment of tabAssignments) {
      insertAssignment.run(id, assignment.tabId, assignment.permission);
    }
  });

  transaction();

  return {
    id,
    name,
    tabAssignments,
    createdAt: existing.created_at,
  };
}

/**
 * Delete a group by ID.
 * Throws NotFoundError if group doesn't exist.
 * The foreign key ON DELETE CASCADE removes group_tab_assignments.
 * The foreign key ON DELETE SET NULL on users.group_id handles setting affected users' groupId to null.
 */
export function deleteGroup(id: string): void {
  const db = getDatabase();

  const existing = db
    .prepare("SELECT * FROM groups WHERE id = ?")
    .get(id) as GroupRow | undefined;

  if (!existing) {
    throw new NotFoundError("Group not found");
  }

  db.prepare("DELETE FROM groups WHERE id = ?").run(id);
}
