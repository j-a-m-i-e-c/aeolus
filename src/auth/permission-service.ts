// Permission Service — Tab-level access control evaluation
// Implements: getGroupPermissions, hasPermission, getUserTabPermission, getUserAccessibleTabs

import { getDatabase } from "../db/database.js";

export type PermissionLevel = "read" | "interact" | "write";

export interface TabAssignment {
  tabId: string;
  permission: PermissionLevel;
}

interface GroupTabRow {
  tab_id: string;
  permission: PermissionLevel;
}

interface UserRow {
  id: string;
  role: "admin" | "user";
  group_id: string | null;
}

/**
 * Permission hierarchy: write > interact > read
 * Higher numeric value = more permissive.
 */
const PERMISSION_RANK: Record<PermissionLevel, number> = {
  read: 1,
  interact: 2,
  write: 3,
};

/**
 * Get all tab assignments for a group.
 * Returns an empty array if the group has no assignments.
 */
export function getGroupPermissions(groupId: string): TabAssignment[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT tab_id, permission FROM group_tab_assignments WHERE group_id = ?",
    )
    .all(groupId) as GroupTabRow[];

  return rows.map((row) => ({
    tabId: row.tab_id,
    permission: row.permission,
  }));
}

/**
 * Check if a user has at least the required permission level on a tab.
 *
 * - Admin users always return true (bypass all checks).
 * - Users with no group (groupId is null) always return false.
 * - Otherwise, looks up the tab assignment for the user's group and
 *   compares against the permission hierarchy: write > interact > read.
 */
export function hasPermission(
  userId: string,
  tabId: string,
  required: PermissionLevel,
): boolean {
  const db = getDatabase();

  // Lookup user to get role and groupId
  const user = db
    .prepare("SELECT id, role, group_id FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;

  if (!user) {
    return false;
  }

  // Admin bypasses all permission checks
  if (user.role === "admin") {
    return true;
  }

  // No group = no access
  if (user.group_id === null) {
    return false;
  }

  // Lookup the tab assignment for this group and tab
  const assignment = db
    .prepare(
      "SELECT tab_id, permission FROM group_tab_assignments WHERE group_id = ? AND tab_id = ?",
    )
    .get(user.group_id, tabId) as GroupTabRow | undefined;

  if (!assignment) {
    return false;
  }

  // Check hierarchy: user's permission must be >= required
  return PERMISSION_RANK[assignment.permission] >= PERMISSION_RANK[required];
}

/**
 * Get the permission level a user has on a specific tab.
 * Returns null if the user has no access to the tab.
 *
 * - Admin users return "write" for any tab (full access).
 * - Users with no group return null.
 */
export function getUserTabPermission(
  userId: string,
  tabId: string,
): PermissionLevel | null {
  const db = getDatabase();

  const user = db
    .prepare("SELECT id, role, group_id FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;

  if (!user) {
    return null;
  }

  // Admin has write access to everything
  if (user.role === "admin") {
    return "write";
  }

  // No group = no access
  if (user.group_id === null) {
    return null;
  }

  const assignment = db
    .prepare(
      "SELECT tab_id, permission FROM group_tab_assignments WHERE group_id = ? AND tab_id = ?",
    )
    .get(user.group_id, tabId) as GroupTabRow | undefined;

  return assignment ? assignment.permission : null;
}

/**
 * Get all tabs accessible to a user with their permission levels.
 *
 * - Admin users get all tabs from the tabs table with "write" permission.
 * - Users with no group get an empty array.
 * - Otherwise, returns the group's tab assignments.
 */
export function getUserAccessibleTabs(userId: string): TabAssignment[] {
  const db = getDatabase();

  const user = db
    .prepare("SELECT id, role, group_id FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;

  if (!user) {
    return [];
  }

  // Admin gets all tabs with write permission
  if (user.role === "admin") {
    const tabs = db.prepare("SELECT id FROM tabs").all() as { id: string }[];
    return tabs.map((tab) => ({
      tabId: tab.id,
      permission: "write" as PermissionLevel,
    }));
  }

  // No group = no access
  if (user.group_id === null) {
    return [];
  }

  return getGroupPermissions(user.group_id);
}
