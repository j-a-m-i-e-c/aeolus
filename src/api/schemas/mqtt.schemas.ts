import { z } from "zod";

/**
 * Body schema for POST /api/mqtt/publish. Topic-shape rules beyond "non-empty
 * string" (wildcard rejection, namespace confinement) are enforced by the
 * publish policy, not the schema, so all topic decisions live in one place.
 */
export const publishBodySchema = z.object({
  topic: z.string().trim().min(1),
  payload: z.unknown().optional(),
  retain: z.boolean().optional(),
});
