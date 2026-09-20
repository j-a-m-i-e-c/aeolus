// src/api/schemas/shared-state.schemas.ts — Shared State REST validation (ADR-0016)

import { z } from "zod";
import { MAX_SHARED_STATE_NAME_LENGTH } from "../../shared-state/shared-state-limits.js";

/**
 * A bucket or key name in a path parameter.
 *
 * The character rules are enforced in `SharedStateStore` rather than duplicated
 * here, so one authority decides what a valid Shared State name is and the REST
 * layer cannot drift from the sandbox. This schema bounds length only, which is
 * what protects the route itself from an absurd URL.
 */
const nameSegment = z.string().min(1).max(MAX_SHARED_STATE_NAME_LENGTH);

export const sharedStateBucketParamsSchema = z.object({
  bucket: nameSegment,
});

export const sharedStateKeyParamsSchema = z.object({
  bucket: nameSegment,
  key: nameSegment,
});

/**
 * Body for a Shared State write.
 *
 * `value` is `unknown` because any JSON value is legitimate current state,
 * including `null` and `false`. The size bound is applied to the serialized text
 * in `SharedStateStore`, which is the only place that knows what will actually
 * reach the disk.
 */
export const setSharedStateValueBodySchema = z.object({
  value: z.unknown(),
});
