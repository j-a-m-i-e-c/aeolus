// User Service — CRUD operations for users
// Implements: createUser, getUser, getUserByUsername, listUsers,
//             updateUser, deleteUser, changePassword, verifyPassword

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { getDatabase } from "../db/database.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../api/middleware/error-handler.js";

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 8;

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
  groupId: string | null;
  createdAt: number;
}

export interface UserListItem {
  id: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
  createdAt: number;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: "admin" | "user";
  group_id: string | null;
  created_at: number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    groupId: row.group_id,
    createdAt: row.created_at,
  };
}

function rowToListItem(row: UserRow): UserListItem {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    groupId: row.group_id,
    createdAt: row.created_at,
  };
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/**
 * Create a new user with hashed password.
 * Throws ConflictError if username already exists.
 * Throws BadRequestError if password is too short.
 */
export async function createUser(
  username: string,
  password: string,
  groupId: string | null,
  role: "admin" | "user" = "user",
): Promise<User> {
  validatePassword(password);

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const createdAt = Date.now();

  const db = getDatabase();
  try {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, username, passwordHash, role, groupId, createdAt);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed")
    ) {
      throw new ConflictError("Username already exists");
    }
    throw err;
  }

  return {
    id,
    username,
    passwordHash,
    role,
    groupId,
    createdAt,
  };
}

/**
 * Throw ConflictError if the system currently has only one admin. Shared by the
 * demotion path (updateUser) and the deletion path (deleteUser) so the two
 * cannot diverge. The count is evaluated at call time.
 */
function assertNotLastAdmin(): void {
  const db = getDatabase();
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .get() as { count: number };
  if (count <= 1) {
    throw new ConflictError("Cannot remove the last admin user");
  }
}

/**
 * Get a user by ID. Returns null if not found.
 */
export function getUser(id: string): User | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * Get a user by username. Returns null if not found.
 */
export function getUserByUsername(username: string): User | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * List all users without exposing password hashes.
 */
export function listUsers(): UserListItem[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT id, username, role, group_id, created_at FROM users")
    .all() as UserRow[];
  return rows.map(rowToListItem);
}

/**
 * Update a user's groupId and/or password.
 * Throws NotFoundError if user doesn't exist.
 * Throws BadRequestError if new password is too short.
 */
export async function updateUser(
  id: string,
  updates: {
    groupId?: string | null;
    password?: string;
    role?: "admin" | "user";
  },
): Promise<User> {
  const db = getDatabase();

  const existing = getUser(id);
  if (!existing) {
    throw new NotFoundError("User not found");
  }

  // Role change (only when it actually differs). Demotion of the final admin is
  // refused before any write so the system can never be left without an admin.
  if (updates.role !== undefined && updates.role !== existing.role) {
    if (existing.role === "admin" && updates.role === "user") {
      assertNotLastAdmin();
    }
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(updates.role, id);
  }

  if (updates.password !== undefined) {
    validatePassword(updates.password);
    const passwordHash = await bcrypt.hash(updates.password, BCRYPT_COST);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      passwordHash,
      id,
    );
    // Revoke all existing refresh tokens so a stolen/old session cannot keep
    // minting access tokens after an admin resets the password (audit High 2).
    // Mirrors the self-service `changePassword` revocation.
    db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(id);
  }

  if (updates.groupId !== undefined) {
    db.prepare("UPDATE users SET group_id = ? WHERE id = ?").run(
      updates.groupId,
      id,
    );
  }

  return getUser(id)!;
}

/**
 * Delete a user by ID.
 * Throws ConflictError if this is the last admin user.
 * Throws NotFoundError if user doesn't exist.
 * Cascades deletion to refresh_tokens via ON DELETE CASCADE.
 */
export function deleteUser(id: string): void {
  const db = getDatabase();

  const user = getUser(id);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  // Prevent deleting the last admin
  if (user.role === "admin") {
    assertNotLastAdmin();
  }

  // Delete user — refresh_tokens cascade via ON DELETE CASCADE
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

/**
 * Change a user's password after verifying the current password.
 * Throws UnauthorizedError if current password is incorrect.
 * Throws BadRequestError if new password is too short.
 * Revokes all refresh tokens for the user after successful change.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = getUser(userId);
  if (!user) {
    throw new NotFoundError("User not found");
  }

  const isValid = await verifyPassword(user, currentPassword);
  if (!isValid) {
    throw new UnauthorizedError("Current password is incorrect");
  }

  validatePassword(newPassword);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const db = getDatabase();
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    passwordHash,
    userId,
  );

  // Revoke all refresh tokens for this user
  db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
}

/**
 * Verify a password against a user's stored hash.
 * Uses bcrypt.compare which provides timing-safe comparison.
 */
export async function verifyPassword(
  user: User,
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}
