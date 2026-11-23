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
