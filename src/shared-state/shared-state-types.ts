// src/shared-state/shared-state-types.ts — Shared State contracts (ADR-0016)

/**
 * Who wrote a Shared State value.
 *
 * Recorded so a change can be attributed without inferring authorship from the
 * bucket name. An `automation` write carries the rule id (and its execution when
 * one is active) so a reactive consumer's causation chain stays readable.
 */
export type SharedStateSource =
  | { kind: "automation"; id: string; executionId?: string }
  | { kind: "api"; userId?: string }
  | { kind: "system"; id: string };

/** One stored Shared State entry within a bucket. */
export interface SharedStateEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** Summary of one Shared State bucket (namespace). */
export interface SharedStateBucketMetadata {
  bucket: string;
  keyCount: number;
}

/**
 * The internal notification emitted when a Shared State value actually changed.
 *
 * Deliberately NOT an Automation Event: it answers "this is true now", not "this
 * happened". It never reaches MQTT, and pending work derived from it may be
 * coalesced per bucket/key because the durable store already holds the newest
 * value.
 */
export interface SharedStateChange {
  bucket: string;
  key: string;
  /** The new value. Absent on a deletion. */
  value?: unknown;
  /**
   * True when the key was removed.
   *
   * Carried explicitly rather than signalled by `value === null`, because `null`
   * is a legitimate thing to store in Shared State and a consumer must be able
   * to tell "set to null" from "no longer present".
   */
  deleted: boolean;
  timestamp: number;
  source: SharedStateSource;
  /** Correlation id threaded from the writing execution, when there was one. */
  traceId?: string;
  /** The event/execution that caused this write, when known. */
  causationId?: string;
  /** Causal depth, used to stop Shared State trigger loops running forever. */
  depth?: number;
}

/**
 * Optional provenance supplied by a caller performing a write.
 *
 * Separate from the value itself so the stored representation stays exactly the
 * author's JSON — provenance travels with the change notification, not into the
 * durable row.
 */
export interface SharedStateWriteContext {
  source?: SharedStateSource;
  traceId?: string;
  causationId?: string;
  depth?: number;
}

/**
 * Durable current values intentionally shared between automations.
 *
 * Latest-value semantics, reactive, bounded, and internal. It is NOT historical
 * storage: overwriting a key replaces its previous value and no history is kept.
 * An automation that needs the history writes a Data Store Collection record
 * alongside.
 */
export interface SharedStateStoreContract {
  get(bucket: string, key: string): unknown | undefined;
  /** @returns whether observable state actually changed. */
  set(bucket: string, key: string, value: unknown, context?: SharedStateWriteContext): boolean;
  /** @returns whether an entry was actually removed. */
  delete(bucket: string, key: string, context?: SharedStateWriteContext): boolean;
  listBucket(bucket: string): SharedStateEntry[];
  listBuckets(): SharedStateBucketMetadata[];
}
