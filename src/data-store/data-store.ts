// src/data-store/data-store.ts — Persistent time-series and key-value storage on better-sqlite3

import type { Database as DatabaseType } from "better-sqlite3";
import type { EventEmitter } from "node:events";
import logger from "../logger.js";
import { DATA_STORE_QUERY } from "../core/event-bus.js";
import { parseDuration } from "./duration.js";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface DataStoreConfig {
  enabled: boolean;
  maxStorageMb: number;
  maxRecordsPerCollection: number;
  maxCollections: number;
}

export interface WriteOptions {
  tags?: Record<string, string>;
  timestamp?: number;
}

export interface QueryOptions {
  from?: string | number;
  to?: number;
  limit?: number;
  offset?: number;
  tags?: Record<string, string>;
  aggregate?: "sum" | "avg" | "min" | "max" | "count";
  field?: string;
}

export type QueryResult =
  | { records: DataRecord[]; total: number }
  | { value: number };

export interface DataRecord {
  id: number;
  collection: string;
  payload: Record<string, unknown>;
  tags: Record<string, string>;
  timestamp: number;
}

export interface CollectionMetadata {
  name: string;
  description: string | null;
  retentionDays: number | null;
  recordCount: number;
  oldestRecord: number | null;
  newestRecord: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface DataStoreStats {
  totalRecords: number;
  totalBucketEntries: number;
  totalCollections: number;
  estimatedStorageMb: number;
  maxStorageMb: number;
  storagePercent: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DataStoreConfig = {
  enabled: false,
  maxStorageMb: 500,
  maxRecordsPerCollection: 100_000,
  maxCollections: 50,
};

// ─── DataStore Class ─────────────────────────────────────────────────────────

export class DataStore {
  private config: DataStoreConfig;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DatabaseType,
    private readonly eventBus: EventEmitter,
    config?: Partial<DataStoreConfig>,
  ) {
    this.initSchema();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadConfig();
  }

  // ─── Schema Initialization ───────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ds_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ds_collections (
        name TEXT PRIMARY KEY,
        description TEXT,
        retention_days INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ds_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL REFERENCES ds_collections(name) ON DELETE CASCADE,
        payload TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ds_buckets (
        bucket TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (bucket, key)
      );
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ds_records_collection_ts
        ON ds_records(collection, timestamp DESC);
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ds_records_collection_tags
        ON ds_records(collection, tags);
    `);
  }

  // ─── Config Management ───────────────────────────────────────────────────

  /**
   * Load config from the ds_config table into memory.
   * Missing keys fall back to the defaults (or constructor overrides).
   */
  private loadConfig(): void {
    const rows = this.db.prepare("SELECT key, value FROM ds_config").all() as Array<{ key: string; value: string }>;

    for (const row of rows) {
      const key = row.key;
      const raw = row.value;

      switch (key) {
        case "enabled":
          this.config.enabled = raw === "true";
          break;
        case "maxStorageMb":
          this.config.maxStorageMb = Number(raw);
          break;
        case "maxRecordsPerCollection":
          this.config.maxRecordsPerCollection = Number(raw);
          break;
        case "maxCollections":
          this.config.maxCollections = Number(raw);
          break;
      }
    }
  }

  /** Persist a single config key to the ds_config table. */
  private saveConfigKey(key: string, value: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO ds_config (key, value) VALUES (?, ?)"
    ).run(key, value);
  }

  /** Persist the full in-memory config to the database. */
  private persistConfig(): void {
    this.saveConfigKey("enabled", String(this.config.enabled));
    this.saveConfigKey("maxStorageMb", String(this.config.maxStorageMb));
    this.saveConfigKey("maxRecordsPerCollection", String(this.config.maxRecordsPerCollection));
    this.saveConfigKey("maxCollections", String(this.config.maxCollections));
  }

  /** Returns whether the Data Store is currently enabled. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Enable the Data Store with the provided configuration. */
  enable(config: DataStoreConfig): void {
    this.config = { ...config, enabled: true };
    this.persistConfig();
    logger.info("Data Store enabled");
  }

  /** Disable the Data Store. Existing data is preserved. */
  disable(): void {
    this.config.enabled = false;
    this.saveConfigKey("enabled", "false");
    logger.info("Data Store disabled");
  }

  /** Return the current configuration. */
  getConfig(): DataStoreConfig {
    return { ...this.config };
  }

  /** Update one or more config fields and persist. */
  updateConfig(partial: Partial<DataStoreConfig>): void {
    this.config = { ...this.config, ...partial };
    this.persistConfig();
    logger.info({ config: this.config }, "Data Store config updated");
  }

  // ─── Time-Series Operations ────────────────────────────────────────────────

  write(collection: string, payload: Record<string, unknown>, options?: WriteOptions): void {
    // Guard: DataStore must be enabled
    if (!this.config.enabled) {
      throw new Error("Data Store is not enabled");
    }

    // Validate payload is JSON-serializable
    let payloadJson: string;
    try {
      payloadJson = JSON.stringify(payload);
    } catch (err) {
      throw new Error(
        `Invalid payload: could not serialize to JSON — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Check storage limit before write (rough heuristic: ~200 bytes per record)
    const countRow = this.db.prepare("SELECT COUNT(*) as cnt FROM ds_records").get() as { cnt: number };
    const totalRecords = countRow.cnt;
    const estimatedStorageMb = (totalRecords * 200) / (1024 * 1024);
    if (estimatedStorageMb >= this.config.maxStorageMb) {
      logger.warn(
        { estimatedStorageMb, maxStorageMb: this.config.maxStorageMb },
        "Data Store storage limit exceeded — rejecting write",
      );
      throw new Error(
        `Data Store storage limit exceeded: estimated ${estimatedStorageMb.toFixed(1)} MB >= ${this.config.maxStorageMb} MB limit`,
      );
    }

    // Auto-create collection if it doesn't exist. The auto-create path enforces
    // maxCollections too, so a write to a brand-new collection cannot bypass the
    // limit that explicit createCollection() enforces.
    const existsRow = this.db.prepare(
      "SELECT 1 as exists_flag FROM ds_collections WHERE name = ?"
    ).get(collection) as { exists_flag: number } | undefined;
    if (!existsRow) {
      const collCountRow = this.db.prepare("SELECT COUNT(*) as cnt FROM ds_collections").get() as { cnt: number };
      if (collCountRow.cnt >= this.config.maxCollections) {
        logger.warn(
          { collection, maxCollections: this.config.maxCollections },
          "Data Store collection limit reached — rejecting auto-create write",
        );
        throw new Error(
          `Maximum collections limit reached: ${collCountRow.cnt} >= ${this.config.maxCollections}`,
        );
      }
      const now = Date.now();
      this.db.prepare(
        "INSERT INTO ds_collections (name, description, retention_days, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?)"
      ).run(collection, now, now);
    }

    // FIFO eviction: if collection exceeds maxRecordsPerCollection, delete oldest
    const collCountRow = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM ds_records WHERE collection = ?"
    ).get(collection) as { cnt: number };
    const currentCount = collCountRow.cnt;

    if (currentCount >= this.config.maxRecordsPerCollection) {
      const excess = currentCount - this.config.maxRecordsPerCollection + 1; // +1 to make room for the new record
      this.db.prepare(
        `DELETE FROM ds_records WHERE id IN (
          SELECT id FROM ds_records WHERE collection = ? ORDER BY timestamp ASC LIMIT ?
        )`
      ).run(collection, excess);
      logger.info(
        { collection, evicted: excess },
        "FIFO eviction: deleted oldest records to maintain collection size limit",
      );
    }

    // Prepare record fields
    const tags = options?.tags ?? {};
    const tagsJson = JSON.stringify(tags);
    const timestamp = options?.timestamp ?? Date.now();

    // Insert the record and get the id
    const result = this.db.prepare(
      "INSERT INTO ds_records (collection, payload, tags, timestamp) VALUES (?, ?, ?, ?)"
    ).run(collection, payloadJson, tagsJson, timestamp);
    const id = Number(result.lastInsertRowid);

    // Build the record object for the event
    const record: DataRecord = {
      id,
      collection,
      payload,
      tags,
      timestamp,
    };

    // Emit event on eventBus
    this.eventBus.emit("data-store:write", { collection, record });
  }

  query(collection: string, options?: QueryOptions): QueryResult {
    const start = Date.now();

    // Return empty result for non-existent collections (no error)
    const existsRow = this.db.prepare(
      "SELECT 1 as exists_flag FROM ds_collections WHERE name = ?"
    ).get(collection) as { exists_flag: number } | undefined;
    if (!existsRow) {
      if (options?.aggregate) {
        const durationMs = Date.now() - start;
        this.eventBus.emit(DATA_STORE_QUERY, { collection, durationMs });
        return { value: 0 };
      }
      const durationMs = Date.now() - start;
      this.eventBus.emit(DATA_STORE_QUERY, { collection, durationMs });
      return { records: [], total: 0 };
    }

    // Resolve time range
    let fromTs: number | undefined;

    if (options?.from !== undefined) {
      if (typeof options.from === "string") {
        const ms = parseDuration(options.from);
        fromTs = Date.now() - ms;
      } else {
        fromTs = options.from;
      }
    }

    const toTs = options?.to ?? Date.now();

    // Handle aggregation queries
    if (options?.aggregate) {
      const field = options.field;
      if (!field) {
        throw new Error("Aggregation requires a 'field' parameter");
      }

      const aggFn = options.aggregate.toUpperCase();
      const whereClauses: string[] = ["collection = ?"];
      const params: unknown[] = [collection];

      if (fromTs !== undefined) {
        whereClauses.push("timestamp >= ?");
        params.push(fromTs);
      }
      if (toTs !== undefined) {
        whereClauses.push("timestamp <= ?");
        params.push(toTs);
      }

      // Tag filtering for aggregation
      if (options.tags) {
        for (const [key, value] of Object.entries(options.tags)) {
          whereClauses.push(`json_extract(tags, '$.' || ?) = ?`);
          params.push(key, value);
        }
      }

      const whereStr = whereClauses.join(" AND ");

      let sql: string;
      if (aggFn === "COUNT") {
        sql = `SELECT COUNT(*) as agg_value FROM ds_records WHERE ${whereStr}`;
      } else {
        sql = `SELECT ${aggFn}(json_extract(payload, '$.' || ?)) as agg_value FROM ds_records WHERE ${whereStr}`;
        params.unshift(field);
      }

      const row = this.db.prepare(sql).get(...params) as { agg_value: number | null } | undefined;
      const value = row?.agg_value ?? 0;

      const durationMs = Date.now() - start;
      this.eventBus.emit(DATA_STORE_QUERY, { collection, durationMs });
      return { value };
    }

    // Normal query: build WHERE clause
    const whereClauses: string[] = ["collection = ?"];
    const params: unknown[] = [collection];

    if (fromTs !== undefined) {
      whereClauses.push("timestamp >= ?");
      params.push(fromTs);
    }
    if (toTs !== undefined) {
      whereClauses.push("timestamp <= ?");
      params.push(toTs);
    }

    // Tag filtering
    if (options?.tags) {
      for (const [key, value] of Object.entries(options.tags)) {
        whereClauses.push(`json_extract(tags, '$.' || ?) = ?`);
        params.push(key, value);
      }
    }

    const whereStr = whereClauses.join(" AND ");

    // Get total count (before limit/offset)
    const countSql = `SELECT COUNT(*) as cnt FROM ds_records WHERE ${whereStr}`;
    const countRow = this.db.prepare(countSql).get(...params) as { cnt: number };
    const total = countRow.cnt;

    // Build the main query with ordering and pagination
    let sql = `SELECT id, collection, payload, tags, timestamp FROM ds_records WHERE ${whereStr} ORDER BY timestamp DESC`;
    const queryParams = [...params];

    if (options?.limit !== undefined) {
      sql += " LIMIT ?";
      queryParams.push(options.limit);
    }
    if (options?.offset !== undefined) {
      if (options?.limit === undefined) {
        // SQLite requires LIMIT before OFFSET
        sql += " LIMIT -1";
      }
      sql += " OFFSET ?";
      queryParams.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...queryParams) as Array<{
      id: number;
      collection: string;
      payload: string;
      tags: string;
      timestamp: number;
    }>;

    const records: DataRecord[] = rows.map((row) => ({
      id: row.id,
      collection: row.collection,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      tags: JSON.parse(row.tags) as Record<string, string>,
      timestamp: row.timestamp,
    }));

    const durationMs = Date.now() - start;
    this.eventBus.emit(DATA_STORE_QUERY, { collection, durationMs });
    return { records, total };
  }

  // ─── Key-Value Bucket Operations ─────────────────────────────────────────

  get(bucket: string, key: string): unknown | undefined {
    const row = this.db.prepare(
      "SELECT value FROM ds_buckets WHERE bucket = ? AND key = ?"
    ).get(bucket, key) as { value: string } | undefined;
    if (!row) {
      return undefined;
    }
    return JSON.parse(row.value);
  }

  set(bucket: string, key: string, value: unknown): void {
    const valueJson = JSON.stringify(value);
    const now = Date.now();
    this.db.prepare(
      "INSERT OR REPLACE INTO ds_buckets (bucket, key, value, updated_at) VALUES (?, ?, ?, ?)"
    ).run(bucket, key, valueJson, now);
  }

  delete(bucket: string, key: string): void {
    this.db.prepare(
      "DELETE FROM ds_buckets WHERE bucket = ? AND key = ?"
    ).run(bucket, key);
  }

  listBucket(bucket: string): Array<{ key: string; value: unknown; updatedAt: number }> {
    const rows = this.db.prepare(
      "SELECT key, value, updated_at FROM ds_buckets WHERE bucket = ?"
    ).all(bucket) as Array<{ key: string; value: string; updated_at: number }>;

    return rows.map((row) => ({
      key: row.key,
      value: JSON.parse(row.value),
      updatedAt: row.updated_at,
    }));
  }

  listBuckets(): Array<{ bucket: string; keyCount: number }> {
    const rows = this.db.prepare(
      "SELECT bucket, COUNT(*) as key_count FROM ds_buckets GROUP BY bucket"
    ).all() as Array<{ bucket: string; key_count: number }>;

    return rows.map((row) => ({
      bucket: row.bucket,
      keyCount: row.key_count,
    }));
  }

  // ─── Collection Management ─────────────────────────────────────────────────

  createCollection(name: string, description?: string, retentionDays?: number | null): void {
    // Check maxCollections limit
    const countRow = this.db.prepare("SELECT COUNT(*) as cnt FROM ds_collections").get() as { cnt: number };
    const currentCount = countRow.cnt;

    if (currentCount >= this.config.maxCollections) {
      throw new Error(
        `Maximum collections limit reached: ${currentCount} >= ${this.config.maxCollections}`,
      );
    }

    const now = Date.now();
    this.db.prepare(
      "INSERT INTO ds_collections (name, description, retention_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(name, description ?? null, retentionDays ?? null, now, now);
  }

  updateCollection(name: string, updates: { description?: string; retentionDays?: number | null }): void {
    // Check collection exists
    const existsRow = this.db.prepare(
      "SELECT 1 as exists_flag FROM ds_collections WHERE name = ?"
    ).get(name) as { exists_flag: number } | undefined;
    if (!existsRow) {
      throw new Error(`Collection not found: ${name}`);
    }

    const now = Date.now();
    const setClauses: string[] = ["updated_at = ?"];
    const params: unknown[] = [now];

    if (updates.description !== undefined) {
      setClauses.push("description = ?");
      params.push(updates.description);
    }
    if ("retentionDays" in updates) {
      setClauses.push("retention_days = ?");
      params.push(updates.retentionDays ?? null);
    }

    params.push(name);
    this.db.prepare(
      `UPDATE ds_collections SET ${setClauses.join(", ")} WHERE name = ?`
    ).run(...params);
  }

  deleteCollection(name: string): void {
    // Check collection exists
    const existsRow = this.db.prepare(
      "SELECT 1 as exists_flag FROM ds_collections WHERE name = ?"
    ).get(name) as { exists_flag: number } | undefined;
    if (!existsRow) {
      throw new Error(`Collection not found: ${name}`);
    }

    // Delete records first (CASCADE may not be enforced without PRAGMA foreign_keys)
    this.db.prepare("DELETE FROM ds_records WHERE collection = ?").run(name);
    this.db.prepare("DELETE FROM ds_collections WHERE name = ?").run(name);

    // Emit event
    this.eventBus.emit("data-store:collection-deleted", { collection: name });
  }

  listCollections(): CollectionMetadata[] {
    const rows = this.db.prepare(`
      SELECT
        c.name,
        c.description,
        c.retention_days,
        c.created_at,
        c.updated_at,
        COALESCE(r.record_count, 0) AS record_count,
        r.oldest_record,
        r.newest_record
      FROM ds_collections c
      LEFT JOIN (
        SELECT
          collection,
          COUNT(*) AS record_count,
          MIN(timestamp) AS oldest_record,
          MAX(timestamp) AS newest_record
        FROM ds_records
        GROUP BY collection
      ) r ON c.name = r.collection
    `).all() as Array<{
      name: string;
      description: string | null;
      retention_days: number | null;
      created_at: number;
      updated_at: number;
      record_count: number;
      oldest_record: number | null;
      newest_record: number | null;
    }>;

    return rows.map((row) => ({
      name: row.name,
      description: row.description ?? null,
      retentionDays: row.retention_days ?? null,
      recordCount: row.record_count,
      oldestRecord: row.oldest_record ?? null,
      newestRecord: row.newest_record ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getStats(): DataStoreStats {
    const recordsRow = this.db.prepare("SELECT COUNT(*) as cnt FROM ds_records").get() as { cnt: number };
    const totalRecords = recordsRow.cnt;

    const bucketsRow = this.db.prepare("SELECT COUNT(*) as cnt FROM ds_buckets").get() as { cnt: number };
    const totalBucketEntries = bucketsRow.cnt;

    const collectionsRow = this.db.prepare("SELECT COUNT(*) as cnt FROM ds_collections").get() as { cnt: number };
    const totalCollections = collectionsRow.cnt;

    const estimatedStorageMb = (totalRecords * 200) / (1024 * 1024);
    const storagePercent = this.config.maxStorageMb > 0
      ? (estimatedStorageMb / this.config.maxStorageMb) * 100
      : 0;

    return {
      totalRecords,
      totalBucketEntries,
      totalCollections,
      estimatedStorageMb,
      maxStorageMb: this.config.maxStorageMb,
      storagePercent,
    };
  }

  // ─── Retention Enforcement ───────────────────────────────────────────────

  enforceRetention(): void {
    // Get all collections with a retention policy
    const rows = this.db.prepare(
      "SELECT name, retention_days FROM ds_collections WHERE retention_days IS NOT NULL"
    ).all() as Array<{ name: string; retention_days: number }>;

    if (rows.length === 0) {
      return;
    }

    let _totalPruned = 0;

    for (const row of rows) {
      const collectionName = row.name;
      const retentionDays = row.retention_days;

      const cutoffMs = Date.now() - retentionDays * 86_400_000;

      // Count records to be pruned
      const countRow = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM ds_records WHERE collection = ? AND timestamp < ?"
      ).get(collectionName, cutoffMs) as { cnt: number };
      const prunedCount = countRow.cnt;

      if (prunedCount > 0) {
        this.db.prepare(
          "DELETE FROM ds_records WHERE collection = ? AND timestamp < ?"
        ).run(collectionName, cutoffMs);
        _totalPruned += prunedCount;
        logger.info(
          { collection: collectionName, pruned: prunedCount, retentionDays },
          "Retention enforcement: pruned expired records",
        );
      }
    }
  }

  startRetentionTimer(): void {
    // Run retention enforcement every hour (3_600_000 ms)
    this.retentionTimer = setInterval(() => {
      try {
        this.enforceRetention();
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Retention enforcement failed",
        );
      }
    }, 3_600_000);
  }

  stopRetentionTimer(): void {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  dispose(): void {
    this.stopRetentionTimer();
  }
}
