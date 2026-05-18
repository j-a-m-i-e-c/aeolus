// src/api/routes/data-store.routes.ts — Data Store REST API

import { Router } from "express";
import type { DataStore } from "../../data-store/data-store.js";
import type { QueryOptions } from "../../data-store/data-store.js";
import { BadRequestError, NotFoundError, AppError } from "../middleware/error-handler.js";
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
 * Create Express router for Data Store endpoints.
 *
 * Provides REST endpoints for managing collections, records, buckets,
 * configuration, and lifecycle operations.
 */
export function createDataStoreRoutes(dataStore: DataStore): Router {
  const router = Router();

  // ─── Collection Endpoints ────────────────────────────────────────────────

  /** GET /collections — list all collections with metadata */
  router.get("/collections", (_req, res) => {
    const collections = dataStore.listCollections();
    res.json(collections);
  });

  /** POST /collections — create a new collection */
  router.post("/collections", validate({ body: createCollectionBodySchema }), (req, res, next) => {
    try {
      const { name, description, retentionDays } = req.body;

      if (!name || typeof name !== "string" || name.trim() === "") {
        throw new BadRequestError("Collection name is required");
      }

      dataStore.createCollection(name.trim(), description, retentionDays);
      res.status(201).json({ success: true });
    } catch (err) {
      // Handle SQLite unique constraint violation (duplicate collection name)
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        next(new AppError(409, `Collection '${req.body.name}' already exists`));
        return;
      }
      next(err);
    }
  });

  /** PATCH /collections/:name — update collection description/retentionDays */
  router.patch("/collections/:name", validate({ body: updateCollectionBodySchema, params: collectionNameParamsSchema }), (req, res, next) => {
    try {
      const name = req.params.name as string;
      const { description, retentionDays } = req.body;

      const updates: { description?: string; retentionDays?: number | null } = {};
      if (description !== undefined) updates.description = description;
      if (retentionDays !== undefined) updates.retentionDays = retentionDays;

      dataStore.updateCollection(name, updates);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Collection not found")) {
        next(new NotFoundError(`Collection '${req.params.name}' not found`));
        return;
      }
      next(err);
    }
  });

  /** DELETE /collections/:name — delete collection and all its records */
  router.delete("/collections/:name", (req, res, next) => {
    try {
      const { name } = req.params;
      dataStore.deleteCollection(name);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Collection not found")) {
        next(new NotFoundError(`Collection '${req.params.name}' not found`));
        return;
      }
      next(err);
    }
  });

  // ─── Record Endpoints ──────────────────────────────────────────────────────

  /** POST /collections/:name/records — write a record to a collection */
  router.post("/collections/:name/records", validate({ body: writeRecordBodySchema, params: collectionNameParamsSchema }), (req, res, next) => {
    try {
      const name = req.params.name as string;
      const { payload, tags } = req.body;

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new BadRequestError("Payload is required and must be a JSON object");
      }

      dataStore.write(name, payload, { tags });
      res.status(201).json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Data Store is not enabled")) {
        next(new AppError(503, "Data Store is not enabled"));
        return;
      }
      if (err instanceof Error && err.message.includes("Collection not found")) {
        next(new NotFoundError(`Collection '${req.params.name}' not found`));
        return;
      }
      next(err);
    }
  });

  /** GET /collections/:name/records — query records with filtering and aggregation */
  router.get("/collections/:name/records", (req, res, next) => {
    try {
      const { name } = req.params;
      const { from, to, limit, offset, tags, aggregate, field } = req.query;

      const options: QueryOptions = {};

      // Parse 'from' — can be a duration string (e.g. "1h") or epoch ms (numeric)
      if (from !== undefined) {
        const fromStr = from as string;
        const fromNum = Number(fromStr);
        // If it's a valid number, treat as epoch ms; otherwise pass as duration string
        options.from = !isNaN(fromNum) && fromStr.trim() !== "" ? fromNum : fromStr;
      }

      // Parse 'to' — must be numeric (epoch ms)
      if (to !== undefined) {
        const toNum = Number(to);
        if (isNaN(toNum)) {
          throw new BadRequestError(`Invalid 'to' parameter: must be a numeric timestamp, got "${to}"`);
        }
        options.to = toNum;
      }

      // Parse 'limit' — must be numeric
      if (limit !== undefined) {
        const limitNum = parseInt(limit as string, 10);
        if (isNaN(limitNum)) {
          throw new BadRequestError(`Invalid 'limit' parameter: must be a number, got "${limit}"`);
        }
        options.limit = limitNum;
      }

      // Parse 'offset' — must be numeric
      if (offset !== undefined) {
        const offsetNum = parseInt(offset as string, 10);
        if (isNaN(offsetNum)) {
          throw new BadRequestError(`Invalid 'offset' parameter: must be a number, got "${offset}"`);
        }
        options.offset = offsetNum;
      }

      // Parse 'tags' — JSON string
      if (tags !== undefined) {
        try {
          options.tags = JSON.parse(tags as string);
        } catch {
          throw new BadRequestError(`Invalid 'tags' parameter: must be a valid JSON string, got "${tags}"`);
        }
      }

      // Parse 'aggregate'
      if (aggregate !== undefined) {
        const validAggregates = ["sum", "avg", "min", "max", "count"];
        if (!validAggregates.includes(aggregate as string)) {
          throw new BadRequestError(`Invalid 'aggregate' parameter: must be one of ${validAggregates.join(", ")}, got "${aggregate}"`);
        }
        options.aggregate = aggregate as QueryOptions["aggregate"];
      }

      // Parse 'field'
      if (field !== undefined) {
        options.field = field as string;
      }

      const result = dataStore.query(name, options);
      res.json(result);
    } catch (err) {
      if (err instanceof BadRequestError || err instanceof AppError) {
        next(err);
        return;
      }
      if (err instanceof Error && err.message.includes("Invalid duration")) {
        next(new BadRequestError(err.message));
        return;
      }
      next(err);
    }
  });

  // ─── Bucket Endpoints ──────────────────────────────────────────────────────

  /** GET /buckets — list all buckets with key counts */
  router.get("/buckets", (_req, res) => {
    const buckets = dataStore.listBuckets();
    res.json(buckets);
  });

  /** GET /buckets/:bucket — list all entries in a bucket */
  router.get("/buckets/:bucket", (req, res) => {
    const { bucket } = req.params;
    const entries = dataStore.listBucket(bucket);
    res.json(entries);
  });

  /** PUT /buckets/:bucket/:key — set a key-value pair */
  router.put("/buckets/:bucket/:key", validate({ body: setBucketValueBodySchema, params: bucketKeyParamsSchema }), (req, res, next) => {
    try {
      const bucket = req.params.bucket as string;
      const key = req.params.key as string;
      const { value } = req.body;

      if (!("value" in req.body)) {
        throw new BadRequestError("Request body must include a 'value' field");
      }

      dataStore.set(bucket, key, value);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Data Store is not enabled")) {
        next(new AppError(503, "Data Store is not enabled"));
        return;
      }
      next(err);
    }
  });

  /** DELETE /buckets/:bucket/:key — delete a key from a bucket */
  router.delete("/buckets/:bucket/:key", (req, res, next) => {
    try {
      const { bucket, key } = req.params;
      dataStore.delete(bucket, key);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Data Store is not enabled")) {
        next(new AppError(503, "Data Store is not enabled"));
        return;
      }
      next(err);
    }
  });

  // ─── Config, Stats, Enable/Disable Endpoints ────────────────────────────────

  /** GET /config — return current DataStoreConfig */
  router.get("/config", (_req, res) => {
    const config = dataStore.getConfig();
    res.json(config);
  });

  /** PUT /config — update config (validate values) */
  router.put("/config", validate({ body: dataStoreConfigBodySchema }), (req, res, next) => {
    try {
      const body = req.body;

      // Validate numeric fields are positive numbers if provided
      if (body.maxStorageMb !== undefined) {
        if (typeof body.maxStorageMb !== "number" || body.maxStorageMb <= 0) {
          throw new BadRequestError("maxStorageMb must be a positive number");
        }
      }
      if (body.maxRecordsPerCollection !== undefined) {
        if (typeof body.maxRecordsPerCollection !== "number" || body.maxRecordsPerCollection <= 0) {
          throw new BadRequestError("maxRecordsPerCollection must be a positive number");
        }
      }
      if (body.maxCollections !== undefined) {
        if (typeof body.maxCollections !== "number" || body.maxCollections <= 0) {
          throw new BadRequestError("maxCollections must be a positive number");
        }
      }

      dataStore.updateConfig(body);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** GET /stats — return DataStoreStats */
  router.get("/stats", (_req, res) => {
    const stats = dataStore.getStats();
    res.json(stats);
  });

  /** POST /enable — enable DataStore with provided config */
  router.post("/enable", validate({ body: enableDataStoreBodySchema }), (req, res, next) => {
    try {
      const { maxStorageMb, maxRecordsPerCollection, maxCollections } = req.body;

      // Validate required fields are positive numbers
      if (typeof maxStorageMb !== "number" || maxStorageMb <= 0) {
        throw new BadRequestError("maxStorageMb is required and must be a positive number");
      }
      if (typeof maxRecordsPerCollection !== "number" || maxRecordsPerCollection <= 0) {
        throw new BadRequestError("maxRecordsPerCollection is required and must be a positive number");
      }
      if (typeof maxCollections !== "number" || maxCollections <= 0) {
        throw new BadRequestError("maxCollections is required and must be a positive number");
      }

      dataStore.enable({
        enabled: true,
        maxStorageMb,
        maxRecordsPerCollection,
        maxCollections,
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /** POST /disable — disable DataStore */
  router.post("/disable", (_req, res) => {
    dataStore.disable();
    res.json({ success: true });
  });

  // ─── Export Endpoints ──────────────────────────────────────────────────────

  /** GET /collections/:name/export — export all records as CSV */
  router.get("/collections/:name/export", (req, res, next) => {
    try {
      const { name } = req.params;

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
    } catch (err) {
      next(err);
    }
  });

  return router;
}
