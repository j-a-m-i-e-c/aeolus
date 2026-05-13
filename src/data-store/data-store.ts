// src/data-store/data-store.ts — Persistent time-series and key-value storage on sql.js SQLite

import type { Database } from "sql.js";
import type { EventEmitter } from "node:events";
import { persistDatabase } from "../db/database.js";
import logger from "../logger.js";
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
    private readonly db: Database,
    private readonly eventBus: EventEmitter,
    config?: Partial<DataStoreConfig>,
  ) {
    this.initSchema();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadConfig();
  }

  // ─── Schema Initialization ───────────────────────────────────────────────

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ds_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ds_collections (
        name TEXT PRIMARY KEY,
        description TEXT,
        retention_days INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ds_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL REFERENCES ds_collections(name) ON DELETE CASCADE,
        payload TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL
      );
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ds_buckets (
        bucket TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (bucket, key)
      );
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_ds_records_collection_ts
        ON ds_records(collection, timestamp DESC);
    `);

    this.db.run(`
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
    const results = this.db.exec("SELECT key, value FROM ds_config");
    if (results.length === 0) return;

    const { columns, values } = results[0];
    const keyIdx = columns.indexOf("key");
    const valueIdx = columns.indexOf("value");

    for (const row of values) {
      const key = row[keyIdx] as string;
      const raw = row[valueIdx] as string;

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
    this.db.run(
      "INSERT OR REPLACE INTO ds_config (key, value) VALUES (?, ?)",
      [key, value],
    );
  }

  /** Persist the full in-memory config to the database. */
  private persistConfig(): void {
    this.saveConfigKey("enabled", String(this.config.enabled));
    this.saveConfigKey("maxStorageMb", String(this.config.maxStorageMb));
    this.saveConfigKey("maxRecordsPerCollection", String(this.config.maxRecordsPerCollection));
    this.saveConfigKey("maxCollections", String(this.config.maxCollections));
    persistDatabase();
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
    persistDatabase();
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
    const totalRecordsResult = this.db.exec("SELECT COUNT(*) FROM ds_records");
    const totalRecords = totalRecordsResult.length > 0
      ? (totalRecordsResult[0].values[0][0] as number)
      : 0;
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

    // Auto-create collection if it doesn't exist
    const existsResult = this.db.exec(
      "SELECT 1 FROM ds_collections WHERE name = ?",
      [collection],
    );
    if (existsResult.length === 0 || existsResult[0].values.length === 0) {
      const now = Date.now();
      this.db.run(
        "INSERT INTO ds_collections (name, description, retention_days, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?)",
        [collection, now, now],
      );
    }

    // FIFO eviction: if collection exceeds maxRecordsPerCollection, delete oldest
    const countResult = this.db.exec(
      "SELECT COUNT(*) FROM ds_records WHERE collection = ?",
      [collection],
    );
    const currentCount = countResult.length > 0
      ? (countResult[0].values[0][0] as number)
      : 0;

    if (currentCount >= this.config.maxRecordsPerCollection) {
      const excess = currentCount - this.config.maxRecordsPerCollection + 1; // +1 to make room for the new record
      this.db.run(
        `DELETE FROM ds_records WHERE id IN (
          SELECT id FROM ds_records WHERE collection = ? ORDER BY timestamp ASC LIMIT ?
        )`,
        [collection, excess],
      );
      logger.info(
        { collection, evicted: excess },
        "FIFO eviction: deleted oldest records to maintain collection size limit",
      );
    }

    // Prepare record fields
    const tags = options?.tags ?? {};
    const tagsJson = JSON.stringify(tags);
    const timestamp = options?.timestamp ?? Date.now();

    // Insert the record
    this.db.run(
      "INSERT INTO ds_records (collection, payload, tags, timestamp) VALUES (?, ?, ?, ?)",
      [collection, payloadJson, tagsJson, timestamp],
    );

    // Get the inserted record id
    const idResult = this.db.exec("SELECT last_insert_rowid()");
    const id = idResult.length > 0 ? (idResult[0].values[0][0] as number) : 0;

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

    // Persist database to disk
    persistDatabase();
  }

  query(collection: string, options?: QueryOptions): QueryResult {
    // Return empty result for non-existent collections (no error)
    const existsResult = this.db.exec(
      "SELECT 1 FROM ds_collections WHERE name = ?",
      [collection],
    );
    if (existsResult.length === 0 || existsResult[0].values.length === 0) {
      if (options?.aggregate) {
        return { value: 0 };
      }
      return { records: [], total: 0 };
    }

    // Resolve time range
    let fromTs: number | undefined;
    let toTs: number | undefined;

    if (options?.from !== undefined) {
      if (typeof options.from === "string") {
        const ms = parseDuration(options.from);
        fromTs = Date.now() - ms;
      } else {
        fromTs = options.from;
      }
    }

    toTs = options?.to ?? Date.now();

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

      const result = this.db.exec(sql, params as (string | number | null | Uint8Array)[]);
      const value = result.length > 0 && result[0].values.length > 0
        ? (result[0].values[0][0] as number) ?? 0
        : 0;

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
    const countSql = `SELECT COUNT(*) FROM ds_records WHERE ${whereStr}`;
    const countResult = this.db.exec(countSql, params as (string | number | null | Uint8Array)[]);
    const total = countResult.length > 0
      ? (countResult[0].values[0][0] as number)
      : 0;

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

    const result = this.db.exec(sql, queryParams as (string | number | null | Uint8Array)[]);

    if (result.length === 0) {
      return { records: [], total };
    }

    const { columns, values } = result[0];
    const idIdx = columns.indexOf("id");
    const collIdx = columns.indexOf("collection");
    const payloadIdx = columns.indexOf("payload");
    const tagsIdx = columns.indexOf("tags");
    const tsIdx = columns.indexOf("timestamp");

    const records: DataRecord[] = values.map((row) => ({
      id: row[idIdx] as number,
      collection: row[collIdx] as string,
      payload: JSON.parse(row[payloadIdx] as string) as Record<string, unknown>,
      tags: JSON.parse(row[tagsIdx] as string) as Record<string, string>,
      timestamp: row[tsIdx] as number,
    }));

    return { records, total };
  }

  // ─── Key-Value Bucket Operations ─────────────────────────────────────────

  get(bucket: string, key: string): unknown | undefined {
    const result = this.db.exec(
      "SELECT value FROM ds_buckets WHERE bucket = ? AND key = ?",
      [bucket, key],
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return undefined;
    }
    return JSON.parse(result[0].values[0][0] as string);
  }

  set(bucket: string, key: string, value: unknown): void {
    const valueJson = JSON.stringify(value);
    const now = Date.now();
    this.db.run(
      "INSERT OR REPLACE INTO ds_buckets (bucket, key, value, updated_at) VALUES (?, ?, ?, ?)",
      [bucket, key, valueJson, now],
    );
    persistDatabase();
  }

  delete(bucket: string, key: string): void {
    this.db.run(
      "DELETE FROM ds_buckets WHERE bucket = ? AND key = ?",
      [bucket, key],
    );
    persistDatabase();
  }

  listBucket(bucket: string): Array<{ key: string; value: unknown; updatedAt: number }> {
    const result = this.db.exec(
      "SELECT key, value, updated_at FROM ds_buckets WHERE bucket = ?",
      [bucket],
    );
    if (result.length === 0) {
      return [];
    }

    const { columns, values } = result[0];
    const keyIdx = columns.indexOf("key");
    const valueIdx = columns.indexOf("value");
    const updatedAtIdx = columns.indexOf("updated_at");

    return values.map((row) => ({
      key: row[keyIdx] as string,
      value: JSON.parse(row[valueIdx] as string),
      updatedAt: row[updatedAtIdx] as number,
    }));
  }

  listBuckets(): Array<{ bucket: string; keyCount: number }> {
    const result = this.db.exec(
      "SELECT bucket, COUNT(*) as key_count FROM ds_buckets GROUP BY bucket",
    );
    if (result.length === 0) {
      return [];
    }

    const { columns, values } = result[0];
    const bucketIdx = columns.indexOf("bucket");
    const countIdx = columns.indexOf("key_count");

    return values.map((row) => ({
      bucket: row[bucketIdx] as string,
      keyCount: row[countIdx] as number,
    }));
  }

  // ─── Collection Management ─────────────────────────────────────────────────

  createCollection(name: string, description?: string, retentionDays?: number | null): void {
    // Check maxCollections limit
    const countResult = this.db.exec("SELECT COUNT(*) FROM ds_collections");
    const currentCount = countResult.length > 0
      ? (countResult[0].values[0][0] as number)
      : 0;

    if (currentCount >= this.config.maxCollections) {
      throw new Error(
        `Maximum collections limit reached: ${currentCount} >= ${this.config.maxCollections}`,
      );
    }

    const now = Date.now();
    this.db.run(
      "INSERT INTO ds_collections (name, description, retention_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [name, description ?? null, retentionDays ?? null, now, now],
    );
    persistDatabase();
  }

  updateCollection(name: string, updates: { description?: string; retentionDays?: number | null }): void {
    // Check collection exists
    const existsResult = this.db.exec(
      "SELECT 1 FROM ds_collections WHERE name = ?",
      [name],
    );
    if (existsResult.length === 0 || existsResult[0].values.length === 0) {
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
    this.db.run(
      `UPDATE ds_collections SET ${setClauses.join(", ")} WHERE name = ?`,
      params as (string | number | null | Uint8Array)[],
    );
    persistDatabase();
  }

  deleteCollection(name: string): void {
    // Check collection exists
    const existsResult = this.db.exec(
      "SELECT 1 FROM ds_collections WHERE name = ?",
      [name],
    );
    if (existsResult.length === 0 || existsResult[0].values.length === 0) {
      throw new Error(`Collection not found: ${name}`);
    }

    // Delete records first (CASCADE may not be enforced by sql.js without PRAGMA foreign_keys)
    this.db.run("DELETE FROM ds_records WHERE collection = ?", [name]);
    this.db.run("DELETE FROM ds_collections WHERE name = ?", [name]);

    // Emit event
    this.eventBus.emit("data-store:collection-deleted", { collection: name });

    persistDatabase();
  }

  listCollections(): CollectionMetadata[] {
    const result = this.db.exec(`
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
    `);

    if (result.length === 0) {
      return [];
    }

    const { columns, values } = result[0];
    const nameIdx = columns.indexOf("name");
    const descIdx = columns.indexOf("description");
    const retIdx = columns.indexOf("retention_days");
    const createdIdx = columns.indexOf("created_at");
    const updatedIdx = columns.indexOf("updated_at");
    const countIdx = columns.indexOf("record_count");
    const oldestIdx = columns.indexOf("oldest_record");
    const newestIdx = columns.indexOf("newest_record");

    return values.map((row) => ({
      name: row[nameIdx] as string,
      description: (row[descIdx] as string) ?? null,
      retentionDays: (row[retIdx] as number) ?? null,
      recordCount: row[countIdx] as number,
      oldestRecord: (row[oldestIdx] as number) ?? null,
      newestRecord: (row[newestIdx] as number) ?? null,
      createdAt: row[createdIdx] as number,
      updatedAt: row[updatedIdx] as number,
    }));
  }

  getStats(): DataStoreStats {
    const recordsResult = this.db.exec("SELECT COUNT(*) FROM ds_records");
    const totalRecords = recordsResult.length > 0
      ? (recordsResult[0].values[0][0] as number)
      : 0;

    const bucketsResult = this.db.exec("SELECT COUNT(*) FROM ds_buckets");
    const totalBucketEntries = bucketsResult.length > 0
      ? (bucketsResult[0].values[0][0] as number)
      : 0;

    const collectionsResult = this.db.exec("SELECT COUNT(*) FROM ds_collections");
    const totalCollections = collectionsResult.length > 0
      ? (collectionsResult[0].values[0][0] as number)
      : 0;

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
    const result = this.db.exec(
      "SELECT name, retention_days FROM ds_collections WHERE retention_days IS NOT NULL",
    );

    if (result.length === 0) {
      return;
    }

    const { columns, values } = result[0];
    const nameIdx = columns.indexOf("name");
    const retIdx = columns.indexOf("retention_days");

    let totalPruned = 0;

    for (const row of values) {
      const collectionName = row[nameIdx] as string;
      const retentionDays = row[retIdx] as number;

      const cutoffMs = Date.now() - retentionDays * 86_400_000;

      // Count records to be pruned
      const countResult = this.db.exec(
        "SELECT COUNT(*) FROM ds_records WHERE collection = ? AND timestamp < ?",
        [collectionName, cutoffMs],
      );
      const prunedCount = countResult.length > 0
        ? (countResult[0].values[0][0] as number)
        : 0;

      if (prunedCount > 0) {
        this.db.run(
          "DELETE FROM ds_records WHERE collection = ? AND timestamp < ?",
          [collectionName, cutoffMs],
        );
        totalPruned += prunedCount;
        logger.info(
          { collection: collectionName, pruned: prunedCount, retentionDays },
          "Retention enforcement: pruned expired records",
        );
      }
    }

    if (totalPruned > 0) {
      persistDatabase();
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
