// Auth Service — Central orchestrator for authentication operations
// Implements: setupAdmin, login, refresh, logout, needsSetup

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { getDatabase } from "../db/database.js";
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
} from "../api/middleware/error-handler.js";
import {
  generateAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
} from "./token-service.js";
import { getUserByUsername, getUser, verifyPassword } from "./user-service.js";
import type { User } from "./user-service.js";
import logger from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; username: string; role: string };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 8;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Dummy bcrypt hash used for timing-safe comparison when user is not found.
 * Pre-computed so we don't reveal whether a username exists via response time.
 */
const DUMMY_HASH =
  "$2b$12$LJ3m4sMKfRzlTfMNpCz0OOKbGnGZfOGzRqQoXoFNT.VYj5L1IpDKi";

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Check if the system needs initial admin setup.
 * Returns true if no admin user exists in the database.
 */
export function needsSetup(): boolean {
  const db = getDatabase();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .get() as { count: number };
  return row.count === 0;
}

/**
 * First-run admin creation.
 *
 * - Validates that no admin exists (throws ConflictError if setup already done)
 * - Validates username is non-empty and password is ≥ 8 characters
 * - Creates the admin user with role "admin" and null groupId
 * - Auto-logs in: generates access + refresh tokens
 * - Returns LoginResult
 */
export async function setupAdmin(
  username: string,
  password: string,
): Promise<LoginResult> {
  // Check no admin exists
  if (!needsSetup()) {
    throw new ConflictError("Setup already completed");
  }

  // Validate inputs
  if (!username || username.trim().length === 0) {
    throw new BadRequestError("Username must not be empty");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }

  // Hash password with bcrypt cost 12
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Create admin user
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const db = getDatabase();

  try {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, group_id, created_at)
       VALUES (?, ?, ?, 'admin', NULL, ?)`,
    ).run(id, username.trim(), passwordHash, createdAt);
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed")
    ) {
      throw new ConflictError("Username already exists");
    }
    throw err;
  }

  logger.info({ username: username.trim() }, "Admin user created during setup");

  // Auto-login: generate tokens
  const accessToken = generateAccessToken({
    userId: id,
    username: username.trim(),
    role: "admin",
    groupId: null,
  });
  const refreshToken = generateRefreshToken(id);

  return {
    accessToken,
    refreshToken,
    user: { id, username: username.trim(), role: "admin" },
  };
}

/**
 * Authenticate a user with username and password.
 *
 * - Looks up user by username
 * - If not found, performs a dummy bcrypt compare (timing-safe, prevents user enumeration)
 * - If password is invalid, throws UnauthorizedError
 * - Generates access + refresh tokens
 * - Returns LoginResult
 */
export async function login(
  username: string,
  password: string,
): Promise<LoginResult> {
  const user = getUserByUsername(username);

  if (!user) {
    // Timing-safe: still do a bcrypt compare so response time is similar
    await bcrypt.compare(password, DUMMY_HASH);
    throw new UnauthorizedError("Invalid username or password");
  }

  const isValid = await verifyPassword(user, password);
  if (!isValid) {
    throw new UnauthorizedError("Invalid username or password");
  }

  // Generate tokens
  const accessToken = generateAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    groupId: user.groupId,
  });
  const refreshToken = generateRefreshToken(user.id);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, username: user.username, role: user.role },
  };
}

/**
 * Issue a new access token from a valid refresh token.
 *
 * - Validates the refresh token via TokenService
 * - If invalid/expired, throws UnauthorizedError
 * - Looks up the user to get current role/groupId (fresh data for new access token)
 * - Generates and returns a new access token string
 */
export function refresh(refreshToken: string): string {
  const tokenRecord = validateRefreshToken(refreshToken);
  if (!tokenRecord) {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  // Lookup user to get current role and groupId
  const user = getUser(tokenRecord.userId);
  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  // Generate new access token with current user data
  const accessToken = generateAccessToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    groupId: user.groupId,
  });

  return accessToken;
}

/**
 * Revoke a refresh token (logout).
 * Delegates to TokenService.revokeRefreshToken.
 */
export function logout(refreshToken: string): void {
  revokeRefreshToken(refreshToken);
}
