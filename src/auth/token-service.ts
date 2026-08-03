// Token Service — JWT signing/verification and refresh token lifecycle
// Implements: generateAccessToken, verifyAccessToken, generateRefreshToken,
//             validateRefreshToken, revokeRefreshToken, revokeAllUserTokens, getSecret

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { getDatabase } from "../db/database.js";
import logger from "../logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  userId: string;
  username: string;
  role: "admin" | "user";
  groupId: string | null;
  /**
   * Session kind. Absent ⇒ treated as "normal" everywhere (backward
   * compatible). "public-demo" sessions are constrained by the PublicDemoGuard
   * (public-demo-mode spec).
   */
  sessionType?: "normal" | "public-demo";
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCESS_TOKEN_EXPIRY = "15m"; // 15 minutes
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// ─── Secret Management ───────────────────────────────────────────────────────

let cachedSecret: string | null = null;

/**
 * Reset the cached secret. Used for testing only.
 * @internal
 */
export function _resetSecretCache(): void {
  cachedSecret = null;
}

/**
 * Get or generate the JWT signing secret.
 * Priority: JWT_SECRET env var → system_settings table → generate and store new key.
 */
export function getSecret(): string {
  if (cachedSecret) return cachedSecret;

  // 1. Check environment variable
  const envSecret = process.env.JWT_SECRET;
  if (envSecret) {
    cachedSecret = envSecret;
    logger.info("Using JWT secret from JWT_SECRET environment variable");
    return cachedSecret;
  }

  // 2. Check database
  const db = getDatabase();
  const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get("jwt_secret") as
    | { value: string }
    | undefined;

  if (row) {
    cachedSecret = row.value;
    logger.info("Loaded JWT secret from database");
    return cachedSecret;
  }

  // 3. Generate new 256-bit key and store it
  const newSecret = crypto.randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?)").run("jwt_secret", newSecret);
  cachedSecret = newSecret;
  logger.info("Generated and stored new JWT secret in database");
  return cachedSecret;
}

// ─── Access Token Operations ─────────────────────────────────────────────────

/**
 * Generate a signed JWT access token with HS256.
 * Payload includes userId, username, role, groupId and (when present)
 * sessionType claims. Expires in 15 minutes by default; `expiresInMinutes`
 * overrides this (used for longer-lived public-demo sessions).
 */
export function generateAccessToken(
  payload: AccessTokenPayload,
  options?: { expiresInMinutes?: number },
): string {
  const secret = getSecret();
  const claims: Record<string, unknown> = {
    userId: payload.userId,
    username: payload.username,
    role: payload.role,
    groupId: payload.groupId,
  };
  // Only include the claim when it is a demo session, so normal tokens are
  // byte-for-byte identical to the pre-feature output.
  if (payload.sessionType && payload.sessionType !== "normal") {
    claims.sessionType = payload.sessionType;
  }
  const expiresIn =
    options?.expiresInMinutes !== undefined ? `${options.expiresInMinutes}m` : ACCESS_TOKEN_EXPIRY;
  return jwt.sign(claims, secret, { algorithm: "HS256", expiresIn });
}

/**
 * Verify an access token's signature and expiry.
 * Returns the decoded payload or throws on invalid/expired tokens.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = getSecret();
  const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as AccessTokenPayload & {
    iat: number;
    exp: number;
  };
  return {
    userId: decoded.userId,
    username: decoded.username,
    role: decoded.role,
    groupId: decoded.groupId,
    sessionType: decoded.sessionType === "public-demo" ? "public-demo" : "normal",
  };
}

/**
 * Verify an access token and also return its expiry as epoch milliseconds.
 * Used by the WebSocket server to close a connection when its token expires
 * (the client reconnects with a freshly refreshed token).
 */
export function verifyAccessTokenWithExpiry(token: string): {
  payload: AccessTokenPayload;
  expiresAt: number;
} {
  const secret = getSecret();
  const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as AccessTokenPayload & {
    iat: number;
    exp: number;
  };
  return {
    payload: {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      groupId: decoded.groupId,
      sessionType: decoded.sessionType === "public-demo" ? "public-demo" : "normal",
    },
    expiresAt: decoded.exp * 1000,
  };
}

// ─── Refresh Token Operations ────────────────────────────────────────────────

/**
 * Hash a raw refresh token using SHA-256.
 */
function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generate an opaque refresh token (32 bytes, base64url encoded).
 * Stores the SHA-256 hash in the refresh_tokens table with 7-day expiry.
 * Returns the raw token (to be sent to the client).
 */
export function generateRefreshToken(userId: string): string {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = now + REFRESH_TOKEN_EXPIRY_MS;
  const id = crypto.randomUUID();

  const db = getDatabase();
  db.prepare(
    "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, tokenHash, expiresAt, now);

  return rawToken;
}

/**
 * Validate a refresh token by hashing it and looking up in the database.
 * Returns the token record if valid and not expired, or null otherwise.
 */
export function validateRefreshToken(token: string): RefreshTokenRecord | null {
  const tokenHash = hashToken(token);
  const db = getDatabase();

  const row = db
    .prepare("SELECT id, user_id, token_hash, expires_at, created_at FROM refresh_tokens WHERE token_hash = ?")
    .get(tokenHash) as
    | { id: string; user_id: string; token_hash: string; expires_at: number; created_at: number }
    | undefined;

  if (!row) return null;

  // Check expiry
  if (row.expires_at < Date.now()) {
    // Token expired — clean it up
    db.prepare("DELETE FROM refresh_tokens WHERE id = ?").run(row.id);
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/**
 * Revoke a specific refresh token by hashing and deleting from the database.
 */
export function revokeRefreshToken(token: string): void {
  const tokenHash = hashToken(token);
  const db = getDatabase();
  db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(tokenHash);
}

/**
 * Revoke all refresh tokens for a given user.
 */
export function revokeAllUserTokens(userId: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
}
