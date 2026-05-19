// src/api/routes/data-store.routes.test.ts — Unit tests for Data Store REST API routes

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createDataStoreRoutes } from "./data-store.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { DataStore } from "../../data-store/data-store.js";

// Mock auth middleware to pass through — these tests focus on route logic, not auth
vi.mock("../../auth/auth-middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

/** Minimal HTTP helper — sends a request to an Express app and returns status + body */
async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to get server address"));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}${path}`;
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(url, options)
        .then(async (res) => {
          const contentType = res.headers.get("content-type") || "";
          let responseBody: unknown;
          if (contentType.includes("application/json")) {
            responseBody = await res.json();
          } else {
            responseBody = await res.text();
          }
          const headers: Record<string, string> = {};
          res.headers.forEach((value, key) => {
            headers[key] = value;
          });
          server.close();
          resolve({ status: res.status, body: responseBody, headers });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

function createMockDataStore(): Record<string, any> {
  return {
    listCollections: vi.fn().mockReturnValue([]),
    createCollection: vi.fn(),
    updateCollection: vi.fn(),
    deleteCollection: vi.fn(),
    write: vi.fn(),
    query: vi.fn().mockReturnValue({ records: [], total: 0 }),
    listBuckets: vi.fn().mockReturnValue([]),
    listBucket: vi.fn().mockReturnValue([]),
    set: vi.fn(),
    delete: vi.fn(),
    getConfig: vi.fn().mockReturnValue({
      enabled: true,
      maxStorageMb: 100,
      maxRecordsPerCollection: 10000,
      maxCollections: 50,
    }),
    updateConfig: vi.fn(),
    getStats: vi.fn().mockReturnValue({
      totalRecords: 0,
      totalCollections: 0,
      totalBuckets: 0,
      storageMb: 0,
    }),
    enable: vi.fn(),
    disable: vi.fn(),
  };
}

describe("data-store.routes", () => {
  let app: express.Express;
  let mockDataStore: Record<string, any>;

  beforeEach(() => {
    mockDataStore = createMockDataStore();

    app = express();
    app.use(express.json());
    app.use("/api/data-store", createDataStoreRoutes(mockDataStore as unknown as DataStore));
    app.use(errorHandler);
  });

  // ─── Collection Endpoints ──────────────────────────────────────────────────

  describe("GET /api/data-store/collections", () => {
    it("should return 200 with empty array when no collections exist", async () => {
      const res = await request(app, "GET", "/api/data-store/collections");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return 200 with collection metadata", async () => {
      mockDataStore.listCollections.mockReturnValue([
        { name: "sensors", description: "Sensor data", recordCount: 42, retentionDays: 30 },
      ]);
      const res = await request(app, "GET", "/api/data-store/collections");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("sensors");
    });
  });

  describe("POST /api/data-store/collections", () => {
    it("should return 201 on successful collection creation", async () => {
      const res = await request(app, "POST", "/api/data-store/collections", {
        name: "temperatures",
        description: "Temperature readings",
        retentionDays: 30,
      });
      expect(res.status).toBe(201);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.createCollection).toHaveBeenCalledWith("temperatures", "Temperature readings", 30);
    });

    it("should return 400 when name is missing", async () => {
      const res = await request(app, "POST", "/api/data-store/collections", {
        description: "No name",
      });
      expect(res.status).toBe(400);
    });

    it("should return 409 when collection already exists", async () => {
      mockDataStore.createCollection.mockImplementation(() => {
        throw new Error("UNIQUE constraint failed");
      });
      const res = await request(app, "POST", "/api/data-store/collections", {
        name: "existing",
      });
      expect(res.status).toBe(409);
    });
  });

  describe("PATCH /api/data-store/collections/:name", () => {
    it("should return 200 on successful update", async () => {
      const res = await request(app, "PATCH", "/api/data-store/collections/sensors", {
        description: "Updated description",
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.updateCollection).toHaveBeenCalledWith("sensors", { description: "Updated description" });
    });

    it("should return 404 when collection not found", async () => {
      mockDataStore.updateCollection.mockImplementation(() => {
        throw new Error("Collection not found");
      });
      const res = await request(app, "PATCH", "/api/data-store/collections/nonexistent", {
        description: "test",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/data-store/collections/:name", () => {
    it("should return 200 on successful deletion", async () => {
      const res = await request(app, "DELETE", "/api/data-store/collections/sensors");
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.deleteCollection).toHaveBeenCalledWith("sensors");
    });

    it("should return 404 when collection not found", async () => {
      mockDataStore.deleteCollection.mockImplementation(() => {
        throw new Error("Collection not found");
      });
      const res = await request(app, "DELETE", "/api/data-store/collections/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  // ─── Record Endpoints ──────────────────────────────────────────────────────

  describe("POST /api/data-store/collections/:name/records", () => {
    it("should return 201 on successful record write", async () => {
      const res = await request(app, "POST", "/api/data-store/collections/sensors/records", {
        payload: { temperature: 22.5, humidity: 60 },
        tags: { location: "office" },
      });
      expect(res.status).toBe(201);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.write).toHaveBeenCalledWith("sensors", { temperature: 22.5, humidity: 60 }, { tags: { location: "office" } });
    });

    it("should return 503 when data store is not enabled", async () => {
      mockDataStore.write.mockImplementation(() => {
        throw new Error("Data Store is not enabled");
      });
      const res = await request(app, "POST", "/api/data-store/collections/sensors/records", {
        payload: { value: 1 },
      });
      expect(res.status).toBe(503);
    });

    it("should return 404 when collection not found", async () => {
      mockDataStore.write.mockImplementation(() => {
        throw new Error("Collection not found");
      });
      const res = await request(app, "POST", "/api/data-store/collections/missing/records", {
        payload: { value: 1 },
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/data-store/collections/:name/records", () => {
    it("should return 200 with records", async () => {
      mockDataStore.query.mockReturnValue({
        records: [{ id: "1", payload: { temp: 22 }, tags: {}, timestamp: 1000 }],
        total: 1,
      });
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.records).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it("should pass query parameters to dataStore.query", async () => {
      await request(app, "GET", "/api/data-store/collections/sensors/records?from=1000&to=2000&limit=10&offset=5");
      expect(mockDataStore.query).toHaveBeenCalledWith("sensors", expect.objectContaining({
        from: 1000,
        to: 2000,
        limit: 10,
        offset: 5,
      }));
    });

    it("should return aggregation result", async () => {
      mockDataStore.query.mockReturnValue({ value: 25.5 });
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records?aggregate=avg&field=temperature");
      expect(res.status).toBe(200);
      expect((res.body as any).value).toBe(25.5);
    });

    it("should return 400 for invalid aggregate parameter", async () => {
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records?aggregate=invalid");
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid to parameter", async () => {
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records?to=notanumber");
      expect(res.status).toBe(400);
    });

    it("should pass duration string as from parameter", async () => {
      await request(app, "GET", "/api/data-store/collections/sensors/records?from=1h");
      expect(mockDataStore.query).toHaveBeenCalledWith("sensors", expect.objectContaining({
        from: "1h",
      }));
    });

    it("should pass tags as parsed JSON", async () => {
      await request(app, "GET", '/api/data-store/collections/sensors/records?tags={"location":"office"}');
      expect(mockDataStore.query).toHaveBeenCalledWith("sensors", expect.objectContaining({
        tags: { location: "office" },
      }));
    });

    it("should return 400 for invalid tags JSON", async () => {
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records?tags=notjson");
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid limit parameter", async () => {
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records?limit=abc");
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid offset parameter", async () => {
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records?offset=xyz");
      expect(res.status).toBe(400);
    });

    it("should handle invalid duration error from dataStore", async () => {
      mockDataStore.query.mockImplementation(() => {
        throw new Error("Invalid duration format: 'abc'");
      });
      const res = await request(app, "GET", "/api/data-store/collections/sensors/records?from=abc");
      expect(res.status).toBe(400);
    });
  });

  // ─── Bucket Endpoints ──────────────────────────────────────────────────────

  describe("GET /api/data-store/buckets", () => {
    it("should return 200 with bucket list", async () => {
      mockDataStore.listBuckets.mockReturnValue([
        { bucket: "settings", keyCount: 5 },
      ]);
      const res = await request(app, "GET", "/api/data-store/buckets");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].bucket).toBe("settings");
    });
  });

  describe("GET /api/data-store/buckets/:bucket", () => {
    it("should return 200 with bucket entries", async () => {
      mockDataStore.listBucket.mockReturnValue([
        { key: "theme", value: "dark", updatedAt: 1000 },
      ]);
      const res = await request(app, "GET", "/api/data-store/buckets/settings");
      expect(res.status).toBe(200);
      const body = res.body as any[];
      expect(body).toHaveLength(1);
      expect(body[0].key).toBe("theme");
    });
  });

  describe("PUT /api/data-store/buckets/:bucket/:key", () => {
    it("should return 200 on successful set", async () => {
      const res = await request(app, "PUT", "/api/data-store/buckets/settings/theme", {
        value: "dark",
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.set).toHaveBeenCalledWith("settings", "theme", "dark");
    });

    it("should return 503 when data store is not enabled", async () => {
      mockDataStore.set.mockImplementation(() => {
        throw new Error("Data Store is not enabled");
      });
      const res = await request(app, "PUT", "/api/data-store/buckets/settings/theme", {
        value: "dark",
      });
      expect(res.status).toBe(503);
    });
  });

  describe("DELETE /api/data-store/buckets/:bucket/:key", () => {
    it("should return 200 on successful delete", async () => {
      const res = await request(app, "DELETE", "/api/data-store/buckets/settings/theme");
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.delete).toHaveBeenCalledWith("settings", "theme");
    });

    it("should return 503 when data store is not enabled", async () => {
      mockDataStore.delete.mockImplementation(() => {
        throw new Error("Data Store is not enabled");
      });
      const res = await request(app, "DELETE", "/api/data-store/buckets/settings/theme");
      expect(res.status).toBe(503);
    });
  });

  // ─── Config, Stats, Enable/Disable Endpoints ──────────────────────────────

  describe("GET /api/data-store/config", () => {
    it("should return 200 with current config", async () => {
      const res = await request(app, "GET", "/api/data-store/config");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body.enabled).toBe(true);
      expect(body.maxStorageMb).toBe(100);
    });
  });

  describe("PUT /api/data-store/config", () => {
    it("should return 200 on successful config update", async () => {
      const res = await request(app, "PUT", "/api/data-store/config", {
        maxStorageMb: 200,
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.updateConfig).toHaveBeenCalledWith({ maxStorageMb: 200 });
    });

    it("should return 400 for invalid config values", async () => {
      const res = await request(app, "PUT", "/api/data-store/config", {
        maxStorageMb: -5,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/data-store/stats", () => {
    it("should return 200 with stats", async () => {
      const res = await request(app, "GET", "/api/data-store/stats");
      expect(res.status).toBe(200);
      const body = res.body as any;
      expect(body).toHaveProperty("totalRecords");
      expect(body).toHaveProperty("totalCollections");
    });
  });

  describe("POST /api/data-store/enable", () => {
    it("should return 200 on successful enable", async () => {
      const res = await request(app, "POST", "/api/data-store/enable", {
        maxStorageMb: 100,
        maxRecordsPerCollection: 10000,
        maxCollections: 50,
      });
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.enable).toHaveBeenCalledWith({
        enabled: true,
        maxStorageMb: 100,
        maxRecordsPerCollection: 10000,
        maxCollections: 50,
      });
    });

    it("should return 400 when required fields are missing", async () => {
      const res = await request(app, "POST", "/api/data-store/enable", {
        maxStorageMb: 100,
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/data-store/disable", () => {
    it("should return 200 on successful disable", async () => {
      const res = await request(app, "POST", "/api/data-store/disable");
      expect(res.status).toBe(200);
      expect((res.body as any).success).toBe(true);
      expect(mockDataStore.disable).toHaveBeenCalled();
    });
  });

  // ─── Export Endpoint ───────────────────────────────────────────────────────

  describe("GET /api/data-store/collections/:name/export", () => {
    it("should return CSV with headers only when collection is empty", async () => {
      mockDataStore.query.mockReturnValue({ records: [], total: 0 });
      const res = await request(app, "GET", "/api/data-store/collections/sensors/export");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("sensors.csv");
      expect(res.body).toBe("timestamp\n");
    });

    it("should return CSV with data rows when records exist", async () => {
      mockDataStore.query.mockReturnValue({
        records: [
          { payload: { temp: 22.5 }, tags: { location: "office" }, timestamp: 1000 },
          { payload: { temp: 23.0 }, tags: { location: "lab" }, timestamp: 2000 },
        ],
        total: 2,
      });
      const res = await request(app, "GET", "/api/data-store/collections/sensors/export");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      const csv = res.body as string;
      const lines = csv.trim().split("\n");
      expect(lines[0]).toBe("timestamp,temp,tag:location");
      expect(lines[1]).toBe("1000,22.5,office");
      expect(lines[2]).toBe("2000,23,lab");
    });
  });
});
