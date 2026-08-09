// src/core/event-metadata.ts
// phase-1-runtime-foundations Task 7 — factory for the additive EventMetadata
// envelope (Req 5). Central so device ingestion and Automation Events (Task 8)
// generate consistent identity/causation metadata. The first event in a chain
// establishes a traceId (its own eventId) at depth 0; descendants pass a traceId
// and an incremented depth.

import { randomUUID } from "node:crypto";
import type { EventMetadata, EventSourceKind } from "./types.js";

export interface EventMetadataOptions {
  causationId?: string;
  correlationId?: string;
  ruleId?: string;
  executionId?: string;
  /** Root-of-chain id; defaults to this event's own eventId when omitted. */
  traceId?: string;
  /** Causal hop count; defaults to 0. */
  depth?: number;
  /** Override the timestamp (defaults to now). */
  timestamp?: number;
}

/** Build an {@link EventMetadata} envelope for a newly originated event. */
export function newEventMetadata(
  source: { kind: EventSourceKind; id?: string },
  opts: EventMetadataOptions = {},
): EventMetadata {
  const eventId = randomUUID();
  return {
    eventId,
    timestamp: opts.timestamp ?? Date.now(),
    source,
    ...(opts.causationId ? { causationId: opts.causationId } : {}),
    ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
    ...(opts.ruleId ? { ruleId: opts.ruleId } : {}),
    ...(opts.executionId ? { executionId: opts.executionId } : {}),
    traceId: opts.traceId ?? eventId,
    depth: opts.depth ?? 0,
  };
}
