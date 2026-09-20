// src/shared-state/shared-state-store.ts — Durable current values shared between automations

import type { Database as DatabaseType } from "better-sqlite3";
import type { EventEmitter } from "node:events";
import { SHARED_STATE_CHANGE } from "../core/event-bus.js";
import { safeJsonParse } from "../core/safe-json.js";
import logger from "../logger.js";
import {
  MAX_SHARED_STATE_ENTRIES,
  validateSharedStateName,
  validateSharedStateValue,
} from "./shared-state-limits.js";
import type {
  SharedStateBucketMetadata,
  SharedStateChange,
  SharedStateEntry,
  SharedStateSource,
  SharedStateStoreContract,
  SharedStateWriteContext,
} from "./shared-state-types.js";

/** Raised when a write is refused for exceeding a Shared State bound. */
export class SharedStateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedStateLimitError";
  }
}

const DEFAULT_SOURCE: SharedStateSource = { kind: "system", id: "aeolus" };

/**
 * Shared State: durable current values that automations intentionally share.
 *
 * This is the promotion of Build 48's key/value Buckets into a first-class state
 * facility (ADR-0016). Three properties distinguish it from the historical Data
 * Store it used to live inside:
 *
 * 1. It is always available. Shared State is core, so it does not wait for an
 *    operator to configure historical storage limits before an automation can
 *    keep a handful of durable shared values.
 * 2. Writes are idempotent. Setting the value a key already holds performs no
 *    SQLite write, does not move `updated_at`, and emits nothing — which is what
 *    makes a projection that recomputes the same snapshot every tick free.
 * 3. Changes are reactive and internal. A real change emits
 *    {@link SHARED_STATE_CHANGE} on the internal event bus so interested
 *    automations can run. It is never published to MQTT under any namespace;
 *    this class holds no MQTT dependency, so that is structural rather than a
 *    convention.
 *
 * It is NOT historical storage. Writing 72, then 73, then 74 leaves 74 and no
 * record of the others. An automation that needs the history writes a Data Store
 * Collection record alongside.
 *
 * Physical storage remains the existing `ds_buckets` table. Renaming it would add
 * migration risk without changing runtime behaviour, and a storage schema name is
 * an implementation detail rather than the product model.
 */
export class SharedStateStore implements SharedStateStoreContract {
  constructor(
    private readonly db: DatabaseType,
    private readonly eventBus?: EventEmitter,
  ) {
    this.initSchema();
  }

  /**
   * Create the durable table if it is absent.
   *
   * Idempotent and unconditional: Shared State does not depend on historical Data
   * Store enablement, so its storage cannot either. `DataStore` also creates this
   * table, and both are `CREATE TABLE IF NOT EXISTS`, so construction order
   * between them does not matter.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ds_buckets (
        bucket TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (bucket, key)
      );
    `);
  }

  /** Read one current shared value, or `undefined` when the key is not set. */
  get(bucket: string, key: string): unknown | undefined {
    const row = this.db
      .prepare("SELECT value FROM ds_buckets WHERE bucket = ? AND key = ?")
      .get(bucket, key) as { value: string } | undefined;
    if (!row) return undefined;

    // A malformed row is skipped rather than thrown, matching how private
    // automation state handles the same corruption. One unreadable key must not
    // break the automation that asked for it.
    return safeJsonParse(
      row.value,
      { bucket, key },
      "Malformed JSON in Shared State, ignoring entry",
    );
  }

  /**
   * Write one current shared value.
   *
   * @returns `true` when observable state changed, `false` when the value
   * serialized identically to what is already stored — in which case NO SQLite
   * write is performed, `updated_at` does not move, and no change is emitted.
   *
   * @throws {SharedStateLimitError} when a bound is exceeded. A refused write is
   * loud rather than silent: dropping it quietly would leave a consumer reading a
   * stale value with no indication the producer had tried to update it.
   */
  set(bucket: string, key: string, value: unknown, context?: SharedStateWriteContext): boolean {
    this.assertValidName("bucket", bucket);
    this.assertValidName("key", key);

    let valueJson: string;
    try {
      valueJson = JSON.stringify(value);
    } catch (err) {
      throw new SharedStateLimitError(
        `value is not JSON-serializable — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // `undefined`, a function or a bare symbol have no JSON representation.
    // Storing the literal text "undefined" would make the row unparseable, so it
    // is refused instead of corrupting the key.
    if (valueJson === undefined) {
      throw new SharedStateLimitError("value has no JSON representation");
    }

    const oversized = validateSharedStateValue(valueJson);
    if (oversized) throw new SharedStateLimitError(oversized);

    // Read the current text rather than consulting an in-memory cache. Shared
    // State is written by automations AND by the admin REST API, so a cache would
    // need invalidating across both paths to stay correct; one indexed primary-key
    // read is the cheaper way to be right.
    const current = this.db
      .prepare("SELECT value FROM ds_buckets WHERE bucket = ? AND key = ?")
      .get(bucket, key) as { value: string } | undefined;

    if (current?.value === valueJson) {
      return false;
    }

    // Only a genuinely new key grows the store, so the entry cap is checked on
    // that path alone — replacing a value must never start failing because the
    // store is near its limit.
    if (!current) {
      this.assertRoomForNewEntry(bucket, key);
    }

    const timestamp = Date.now();
    this.db
      .prepare(
        "INSERT OR REPLACE INTO ds_buckets (bucket, key, value, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(bucket, key, valueJson, timestamp);

    this.emitChange({
      bucket,
      key,
      value,
      deleted: false,
      timestamp,
      source: context?.source ?? DEFAULT_SOURCE,
      ...(context?.traceId ? { traceId: context.traceId } : {}),
      ...(context?.causationId ? { causationId: context.causationId } : {}),
      ...(context?.depth !== undefined ? { depth: context.depth } : {}),
    });

    return true;
  }

  /**
   * Remove one current shared value.
   *
   * @returns `true` when an entry was actually removed. Deleting a key that is
   * not set is a no-op and emits nothing.
   */
  delete(bucket: string, key: string, context?: SharedStateWriteContext): boolean {
    const result = this.db
      .prepare("DELETE FROM ds_buckets WHERE bucket = ? AND key = ?")
      .run(bucket, key);

    if (result.changes === 0) {
      return false;
    }

    this.emitChange({
      bucket,
      key,
      // `deleted: true` and no `value`. A consumer must be able to tell a removed
      // key from one deliberately holding null.
      deleted: true,
      timestamp: Date.now(),
      source: context?.source ?? DEFAULT_SOURCE,
      ...(context?.traceId ? { traceId: context.traceId } : {}),
      ...(context?.causationId ? { causationId: context.causationId } : {}),
      ...(context?.depth !== undefined ? { depth: context.depth } : {}),
    });

    return true;
  }

  /** Every entry in one bucket, oldest key first for a stable presentation order. */
  listBucket(bucket: string): SharedStateEntry[] {
    const rows = this.db
      .prepare("SELECT key, value, updated_at FROM ds_buckets WHERE bucket = ? ORDER BY key")
      .all(bucket) as Array<{ key: string; value: string; updated_at: number }>;

    return rows.map((row) => ({
      key: row.key,
      value: safeJsonParse(
        row.value,
        { bucket, key: row.key },
        "Malformed JSON in Shared State, listing entry as undefined",
      ),
      updatedAt: row.updated_at,
    }));
  }

  /** Every bucket that currently holds at least one entry. */
  listBuckets(): SharedStateBucketMetadata[] {
    const rows = this.db
      .prepare("SELECT bucket, COUNT(*) as key_count FROM ds_buckets GROUP BY bucket ORDER BY bucket")
      .all() as Array<{ bucket: string; key_count: number }>;

    return rows.map((row) => ({ bucket: row.bucket, keyCount: row.key_count }));
  }

  /** Total number of entries held, for stats and bound reporting. */
  countEntries(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM ds_buckets").get() as { cnt: number };
    return row.cnt;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private assertValidName(label: string, name: string): void {
    const rejection = validateSharedStateName(label, name);
    if (rejection) throw new SharedStateLimitError(rejection);
  }

  private assertRoomForNewEntry(bucket: string, key: string): void {
    const total = this.countEntries();
    if (total >= MAX_SHARED_STATE_ENTRIES) {
      throw new SharedStateLimitError(
        `Shared State is full: ${total} entries reaches the ${MAX_SHARED_STATE_ENTRIES} entry limit`
          + ` (refused ${bucket}/${key}). Shared State holds small current values;`
          + " accumulating records belong in a Data Store Collection.",
      );
    }
  }

  /**
   * Announce a real change on the INTERNAL event bus.
   *
   * There is deliberately no MQTT path here, and this class takes no MQTT
   * dependency. Shared State answers "what is true now" for other automations;
   * republishing it to the broker would recreate the snapshot spam that motivated
   * ADR-0016 under a different topic prefix.
   */
  private emitChange(change: SharedStateChange): void {
    if (!this.eventBus) return;
    this.eventBus.emit(SHARED_STATE_CHANGE, change);
    logger.debug(
      { bucket: change.bucket, key: change.key, deleted: change.deleted },
      "Shared State changed",
    );
  }
}

/** The canonical reactive path for one Shared State value. */
export function sharedStatePath(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}
