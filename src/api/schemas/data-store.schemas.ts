import { z } from "zod";

export const collectionNameParamsSchema = z.object({
  name: z.string().min(1).max(200),
});

export const createCollectionBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional().nullable(),
});

export const updateCollectionBodySchema = z.object({
  description: z.string().max(1000).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional().nullable(),
});

export const writeRecordBodySchema = z.object({
  payload: z.record(z.string(), z.unknown()).refine((val) => !Array.isArray(val), {
    message: "Payload must be a JSON object, not an array",
  }),
  tags: z.record(z.string(), z.string().max(500)).optional(),
});

export const bucketKeyParamsSchema = z.object({
  bucket: z.string().min(1).max(200),
  key: z.string().min(1).max(200),
});

export const setBucketValueBodySchema = z.object({
  value: z.unknown(),
});

export const dataStoreConfigBodySchema = z.object({
  maxStorageMb: z.number().positive().max(10_000).optional(),
  maxRecordsPerCollection: z.number().int().positive().max(10_000_000).optional(),
  maxCollections: z.number().int().positive().max(1000).optional(),
});

export const enableDataStoreBodySchema = z.object({
  maxStorageMb: z.number().positive().max(10_000),
  maxRecordsPerCollection: z.number().int().positive().max(10_000_000),
  maxCollections: z.number().int().positive().max(1000),
});
