import { z } from "zod";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from "../../core/retention-settings.js";

/** Whole days, or null for "keep forever". */
const retentionDays = z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).nullable();

/** PUT /api/system/retention. Either field may be omitted; at least one is required. */
export const retentionSettingsBodySchema = z
  .object({
    executionHistoryDays: retentionDays.optional(),
    commandHistoryDays: retentionDays.optional(),
  })
  .strict()
  .refine((body) => body.executionHistoryDays !== undefined || body.commandHistoryDays !== undefined, {
    message: "Provide executionHistoryDays, commandHistoryDays, or both",
  });
