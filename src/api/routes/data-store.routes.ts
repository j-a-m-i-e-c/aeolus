// src/api/routes/data-store.routes.ts — Data Store REST API

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { DataStore } from "../../data-store/data-store.js";
import type { QueryOptions } from "../../data-store/data-store.js";
import type { PermissionResolver } from "../../auth/permission-resolver.js";
import type { CollectionOwnershipStore } from "../../auth/collection-ownership-store.js";
import { requireAdmin } from "../../auth/auth-middleware.js";
import { BadRequestError, NotFoundError, ConflictError, AppError } from "../middleware/error-handler.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { validate } from "../middleware/validate.js";
import { collectionNameParamsSchema, createCollectionBodySchema, updateCollectionBodySchema, writeRecordBodySchema, bucketKeyParamsSchema, setBucketValueBodySchema, dataStoreConfigBodySchema, enableDataStoreBodySchema } from "../schemas/data-store.schemas.js";

/**
 * Escape a value for CSV output.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
function escapeCsvValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Parse and validate the query string for GET /collections/:name/records.
 * Throws BadRequestError on malformed params. Kept in one place rather than
 * inline so the handler stays small.
 */
function parseRecordQueryOptions(query: Request["query"]): QueryOptions {
  const { from, to, limit, offset, tags, aggregate, field } = query;
  const options: QueryOptions = {};

  // 'from' — duration string (e.g. "1h") or epoch ms (numeric)
  if (from !== undefined) {
    const fromStr = from as string;
    const fromNum = Number(fromStr);
    options.from = !isNaN(fromNum) && fromStr.trim() !== "" ? fromNum : fromStr;
  }

  // 'to' — numeric epoch ms
  if (to !== undefined) {
    const toNum = Number(to);
    if (isNaN(toNum)) {
      throw new BadRequestError(`Invalid 'to' parameter: must be a numeric timestamp, got "${to}"`);
    }
    options.to = toNum;
  }

  if (limit !== undefined) {
    const limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum)) {
      throw new BadRequestError(`Invalid 'limit' parameter: must be a number, got "${limit}"`);
    }
    options.limit = limitNum;
  }

  if (offset !== undefined) {
    const offsetNum = parseInt(offset as string, 10);
    if (isNaN(offsetNum)) {
      throw new BadRequestError(`Invalid 'offset' parameter: must be a number, got "${offset}"`);
    }
    options.offset = offsetNum;
  }

  if (tags !== undefined) {
    try {
      options.tags = JSON.parse(tags as string);
    } catch {
      throw new BadRequestError(`Invalid 'tags' parameter: must be a valid JSON string, got "${tags}"`);
    }
  }

  if (aggregate !== undefined) {
    const validAggregates = ["sum", "avg", "min", "max", "count"];
    if (!validAggregates.includes(aggregate as string)) {
      throw new BadRequestError(`Invalid 'aggregate' parameter: must be one of ${validAggregates.join(", ")}, got "${aggregate}"`);
    }
    options.aggregate = aggregate as QueryOptions["aggregate"];
  }

  if (field !== undefined) {
    options.field = field as string;
  }

  return options;
}

/**
 * Router-level error mapper: translates DataStore's domain error messages into
 * typed HTTP errors in one place, so individual handlers don't repeat the
 * string-matching. Anything unrecognised is forwarded unchanged.
 */
function dataStoreErrorMapper(err: unknown, _req: Request, _res: Response, next: NextFunction): void {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("Data Store is not enabled")) {
      next(new AppError(503, "Data Store is not enabled"));
      return;
    }
    if (msg.includes("UNIQUE constraint failed")) {
      next(new ConflictError("Collection already exists"));
      return;
    }
    if (msg.includes("Collection not found")) {
      next(new NotFoundError(msg));
      return;
    }
    if (msg.includes("Invalid duration")) {
      next(new BadRequestError(msg));
      return;
    }
  }
  next(err);
}

/**
 * Create Express router for Data Store endpoints.
 *
 * Provides REST endpoints for managing collections, records, buckets,
 * configuration, and lifecycle operations.
 */
export function createDataStoreRoutes(
  dataStore: DataStore,
  resolver: PermissionResolver,
  collectionOwnership: CollectionOwnershipStore,
): Router {
  const router = Router();

  /**
   * True when the requesting user may read the named collection. Admins always
   * may. A non-admin may iff the collection is surfaced by a tab their group can
   * reach. A collection surfaced by no tab (or one that does not exist) resolves
   * to no tabs → false, so non-admins fail closed and cannot probe existence.
   */
  function canReadCollection(req: Request, name: string): boolean {
    if (req.user?.role === "admin") {
      return true;
    }
    const accessible = new Set(resolver.accessibleTabIds(req.user?.userId ?? ""));
    return collectionOwnership.getExposingTabs(name).some((tabId) => accessible.has(tabId));
  }

  // ─── Collection Endpoints ────────────────────────────────────────────────

  /**
   * GET /collections — list collections with metadata. Admins see all;
   * non-admins see only collections surfaced by a tab their group can reach.
   */
  router.get("/collections", (req, res) => {
    const collections = dataStore.listCollections();
    if (req.user?.role === "admin") {
      res.json(collections);
      return;
    }
    const accessible = new Set(resolver.accessibleTabIds(req.user?.userId ?? ""));
    res.json(
      collections.filter((c) =>
        collectionOwnership.getExposingTabs(c.name).some((tabId) => accessible.has(tabId)),
      ),
    );
  });

  /** POST /collections — create a new collection (admin-only) */
  router.post("/collections", requireAdmin, validate({ body: createCollectionBodySchema }), asyncHandler((req, res) => {
    const { name, description, retentionDays } = req.body;
    dataStore.createCollection(name.trim(), description, retentionDays);
    res.status(201).json({ success: true });
  }));

  /** PATCH /collections/:name — update collection description/retentionDays (admin-only) */
  router.patch("/collections/:name", requireAdmin, validate({ body: updateCollectionBodySchema, params: collectionNameParamsSchema }), asyncHandler((req, res) => {
    const name = req.params.name as string;
    const { description, retentionDays } = req.body;

    const updates: { description?: string; retentionDays?: number | null } = {};
    if (description !== undefined) updates.description = description;
    if (retentionDays !== undefined) updates.retentionDays = retentionDays;

    dataStore.updateCollection(name, updates);
    res.json({ success: true });
  }));

  /** DELETE /collections/:name — delete collection and all its records (admin-only) */
  router.delete("/collections/:name", requireAdmin, asyncHandler((req, res) => {
    const name = req.params.name as string;
    dataStore.deleteCollection(name);
    res.json({ success: true });
  }));

  // ─── Record Endpoints ──────────────────────────────────────────────────────

  /** POST /collections/:name/records — write a record to a collection (admin-only) */
  router.post("/collections/:name/records", requireAdmin, validate({ body: writeRecordBodySchema, params: collectionNameParamsSchema }), asyncHandler((req, res) => {
    const name = req.params.name as string;
    const { payload, tags, timestamp } = req.body;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadRequestError("Payload is required and must be a JSON object");
    }

    dataStore.write(name, payload, { tags, timestamp });
    res.status(201).json({ success: true });
  }));

  /** GET /collections/:name/records — query records (requires collection read access) */
  router.get("/collections/:name/records", asyncHandler((req, res) => {
    const name = req.params.name as string;
    if (!canReadCollection(req, name)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const options = parseRecordQueryOptions(req.query);
    const result = dataStore.query(name, options);
    res.json(result);
  }));

  // ─── Bucket Endpoints ──────────────────────────────────────────────────────

  // Shared key/value buckets have no tab-ownership mapping, so they are treated
  // as admin/trusted state (admin-only) until a bucket→tab model exists.

  /** GET /buckets — list all buckets with key counts (admin-only) */
  router.get("/buckets", requireAdmin, (_req, res) => {
    const buckets = dataStore.listBuckets();
    res.json(buckets);
  });

  /** GET /buckets/:bucket — list all entries in a bucket (admin-only) */
  router.get("/buckets/:bucket", requireAdmin, (req, res) => {
    const bucket = req.params.bucket as string;
    const entries = dataStore.listBucket(bucket);
    res.json(entries);
  });

  /** PUT /buckets/:bucket/:key — set a key-value pair (admin-only) */
  router.put("/buckets/:bucket/:key", requireAdmin, validate({ body: setBucketValueBodySchema, params: bucketKeyParamsSchema }), asyncHandler((req, res) => {
    const bucket = req.params.bucket as string;
    const key = req.params.key as string;
    const { value } = req.body;

    if (!("value" in req.body)) {
      throw new BadRequestError("Request body must include a 'value' field");
    }

    dataStore.set(bucket, key, value);
    res.json({ success: true });
  }));

  /** DELETE /buckets/:bucket/:key — delete a key from a bucket (admin-only) */
  router.delete("/buckets/:bucket/:key", requireAdmin, asyncHandler((req, res) => {
    const bucket = req.params.bucket as string;
    const key = req.params.key as string;
    dataStore.delete(bucket, key);
    res.json({ success: true });
  }));

  // ─── Config, Stats, Enable/Disable Endpoints ────────────────────────────────

  /** GET /config — return current DataStoreConfig (admin-only) */
  router.get("/config", requireAdmin, (_req, res) => {
    const config = dataStore.getConfig();
    res.json(config);
  });

  /** PUT /config — update config (admin-only; positive-number constraints enforced by the schema) */
  router.put("/config", requireAdmin, validate({ body: dataStoreConfigBodySchema }), asyncHandler((req, res) => {
    dataStore.updateConfig(req.body);
    res.json({ success: true });
  }));

  /** GET /stats — return DataStoreStats (admin-only) */
  router.get("/stats", requireAdmin, (_req, res) => {
    const stats = dataStore.getStats();
    res.json(stats);
  });

  /** POST /enable — enable DataStore with provided config (admin-only; constraints enforced by the schema) */
  router.post("/enable", requireAdmin, validate({ body: enableDataStoreBodySchema }), asyncHandler((req, res) => {
    const { maxStorageMb, maxRecordsPerCollection, maxCollections } = req.body;
    dataStore.enable({
      enabled: true,
      maxStorageMb,
      maxRecordsPerCollection,
      maxCollections,
    });
    res.json({ success: true });
  }));

  /** POST /disable — disable DataStore (admin-only) */
  router.post("/disable", requireAdmin, (_req, res) => {
    dataStore.disable();
    res.json({ success: true });
  });

  // ─── Export Endpoints ──────────────────────────────────────────────────────

  /** GET /collections/:name/export — export all records as CSV (requires collection read access) */
  router.get("/collections/:name/export", asyncHandler((req, res) => {
    const name = req.params.name as string;
    if (!canReadCollection(req, name)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Query all records (no limit)
    const result = dataStore.query(name, {});

    // Extract records from the result
    const records = "records" in result ? result.records : [];

    if (records.length === 0) {
      // Return empty CSV with just a timestamp header
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
      res.send("timestamp\n");
      return;
    }

    // Collect all unique payload field names and tag field names
    const payloadFields = new Set<string>();
    const tagFields = new Set<string>();

    for (const record of records) {
      for (const key of Object.keys(record.payload)) {
        payloadFields.add(key);
      }
      for (const key of Object.keys(record.tags)) {
        tagFields.add(key);
      }
    }

    const payloadFieldsArr = Array.from(payloadFields);
    const tagFieldsArr = Array.from(tagFields).map((t) => `tag:${t}`);

    // Build CSV header
    const headers = ["timestamp", ...payloadFieldsArr, ...tagFieldsArr];
    const csvLines: string[] = [headers.join(",")];

    // Build CSV rows
    for (const record of records) {
      const row: string[] = [
        String(record.timestamp),
        ...payloadFieldsArr.map((f) => escapeCsvValue(record.payload[f])),
        ...Array.from(tagFields).map((t) => escapeCsvValue(record.tags[t])),
      ];
      csvLines.push(row.join(","));
    }

    const csv = csvLines.join("\n") + "\n";

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
    res.send(csv);
  }));

  // Translate DataStore domain errors → typed HTTP errors in one place.
  router.use(dataStoreErrorMapper);

  return router;
}
