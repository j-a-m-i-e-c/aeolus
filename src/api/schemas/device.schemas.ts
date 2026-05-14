import { z } from "zod";

export const deviceIdParamsSchema = z.object({
  id: z.string().min(1).max(200),
});

export const deviceActionBodySchema = z.object({
  type: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).optional(),
});
