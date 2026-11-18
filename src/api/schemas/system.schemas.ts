import { z } from "zod";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS } from "../../core/retention-settings.js";
const retentionDays = z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).nullable();
/** Only automation execution logs have configurable retention. Command evidence never expires. */
export const retentionSettingsBodySchema = z.object({ executionHistoryDays: retentionDays }).strict();
