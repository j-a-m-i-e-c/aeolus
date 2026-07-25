import { z } from "zod";
import { isValidTopicFilter } from "../../mqtt/topic-filter.js";

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

/**
 * Body schema for POST /api/mqtt/private-topics. `pattern` is an MQTT topic
 * filter (may contain `+`/`#`). It must be non-empty after trimming and a
 * well-formed filter (correct `+`/`#` placement); the same matcher used for
 * evaluation validates the syntax here so the two never diverge.
 */
export const privateTopicBodySchema = z.object({
  pattern: z
    .string()
    .trim()
    .min(1)
    .refine(isValidTopicFilter, {
      message: "Invalid MQTT topic filter: '+' must be a whole level and '#' must be the last level",
    }),
});
