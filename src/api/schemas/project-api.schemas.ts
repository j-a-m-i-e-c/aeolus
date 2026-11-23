import { z } from "zod";

/** The format is checked again by the store; this bounds the input. */
export const slugBodySchema = z.object({
  slug: z.string().min(3).max(48),
  reclaim: z.boolean().optional(),
}).strict();

export const publishBodySchema = z.object({
  contentHash: z.string().regex(/^[0-9a-f]{64}$/, "contentHash must be the SHA-256 hex digest returned by GET"),
}).strict();

export const auditQuerySchema = z.object({
  apiId: z.string().min(1).max(64).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
}).strict();

export const clientBodySchema = z.object({ name: z.string().min(1).max(100) }).strict();

/** Expiry as a millisecond timestamp, or null/absent for a key that does not expire. */
export const issueKeyBodySchema = z.object({ expiresAt: z.number().int().positive().nullable().optional() }).strict();

/** 0 revokes the old key at once; otherwise it keeps working for this many seconds. */
export const rotateKeyBodySchema = z.object({ overlapSeconds: z.number().int().min(0).max(7 * 24 * 3600).optional() }).strict();

export const grantBodySchema = z.object({
  clientId: z.string().min(1).max(64),
  routeId: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
}).strict();