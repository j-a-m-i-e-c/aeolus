// src/__integration__/api-routes.integration.test.ts — Integration tests for API routes
// Tests the full Express stack: auth middleware, Zod validation, route handlers, error handler
// Uses real in-memory SQLite database and real middleware (no mocks)
// Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import request from "supertest";
import type { Express } from "express";
import {
  createTestDatabase,
  createTestApp,
  createAuthToken,
  cleanup,
} from "../__test-helpers__/index.js";

// Mock getDatabase to return our test database for auth service calls.
// We must keep the real initSchema since createTestDatabase() uses it.
vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

// This variable is set in beforeEach before createTestApp is called.
// The mock closure captures it by reference.
let testDb: DatabaseType;

// Mock the logger to suppress output during tests
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

describe("API Routes Integration", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let app: Express;

  beforeEach(() => {
    db = createTestDatabase();
    testDb = db;
    eventBus = new EventEmitter();
    app = createTestApp(db, eventBus);
  });

  afterEach(() => {
    cleanup({ databases: [db] });
  });

  // ─── Requirement 5.1: Authenticated request to data-store route ──────────

  describe("Authenticated data-store requests (Req 5.1)", () => {
    it("returns correctly formatted data from real DataStore", async () => {
      const token = createAuthToken();

      // Enable the DataStore first
      await request(app)
        .post("/api/data-store/enable")
        .set("Authorization", `Bearer ${token}`)
        .send({ maxStorageMb: 100, maxRecordsPerCollection: 10000, maxCollections: 50 })
        .expect(200);

      // Create a collection
      await request(app)
        .post("/api/data-store/collections")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "sensors", description: "Sensor data" })
        .expect(201);

      // Write a record
      await request(app)
        .post("/api/data-store/collections/sensors/records")
        .set("Authorization", `Bearer ${token}`)
        .send({ payload: { temperature: 22.5, humidity: 60 } })
        .expect(201);

      // Query the collection
      const res = await request(app)
        .get("/api/data-store/collections/sensors/records")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty("records");
      expect(res.body).toHaveProperty("total");
      expect(res.body.total).toBe(1);
      expect(res.body.records).toHaveLength(1);
      expect(res.body.records[0].payload).toEqual({
        temperature: 22.5,
        humidity: 60,
      });
      expect(res.body.records[0]).toHaveProperty("timestamp");
      expect(typeof res.body.records[0].timestamp).toBe("number");
    });
  });

  // ─── Requirement 5.2: Unauthenticated request to protected route ─────────

  describe("Unauthenticated requests to protected routes (Req 5.2)", () => {
    it("returns 401 when no token is provided", async () => {
      const res = await request(app)
        .get("/api/data-store/collections")
        .expect(401);

      expect(res.body).toHaveProperty("error");
    });

    it("returns 401 when an invalid token is provided", async () => {
      const res = await request(app)
        .get("/api/data-store/collections")
        .set("Authorization", "Bearer invalid-token-here")
        .expect(401);

      expect(res.body).toHaveProperty("error");
    });

    it("returns 401 for automation routes without auth", async () => {
      const res = await request(app)
        .get("/api/automations")
        .expect(401);

      expect(res.body).toHaveProperty("error");
    });
  });

  // ─── Requirement 5.3: Invalid body with Zod validation ───────────────────

  describe("Invalid request body with Zod validation (Req 5.3)", () => {
    it("returns 400 with descriptive error for invalid collection creation body", async () => {
      const token = createAuthToken();

      // Send a body missing the required 'name' field
      const res = await request(app)
        .post("/api/data-store/collections")
        .set("Authorization", `Bearer ${token}`)
        .send({ description: "Missing name field" })
        .expect(400);

      expect(res.body).toHaveProperty("error", "Validation failed");
      expect(res.body).toHaveProperty("details");
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it("returns 400 with descriptive error for invalid automation body", async () => {
      const token = createAuthToken();

      // Send a body with name too long (over 200 chars)
      const res = await request(app)
        .post("/api/automations")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "x".repeat(201), actionType: "publish", actionTarget: "test/topic" })
        .expect(400);

      expect(res.body).toHaveProperty("error", "Validation failed");
      expect(res.body).toHaveProperty("details");
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it("returns 400 for invalid data-store record payload (array instead of object)", async () => {
      const token = createAuthToken();

      // First create the collection
      await request(app)
        .post("/api/data-store/collections")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "test-col" })
        .expect(201);

      // Send an array as payload (should fail Zod validation)
      const res = await request(app)
        .post("/api/data-store/collections/test-col/records")
        .set("Authorization", `Bearer ${token}`)
        .send({ payload: [1, 2, 3] })
        .expect(400);

      expect(res.body).toHaveProperty("error");
      expect(res.body).toHaveProperty("details");
    });
  });

  // ─── Requirement 5.4: Valid request to automation route persists ──────────

  describe("Automation creation and persistence (Req 5.4)", () => {
    it("creates and persists a form automation in the database", async () => {
      const token = createAuthToken();

      const res = await request(app)
        .post("/api/automations")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Automation",
          triggerTopic: "sensors/temperature",
          ruleType: "form",
          actionType: "publish",
          actionTarget: "alerts/high-temp",
          actionParams: { message: "Temperature too high" },
        })
        .expect(200);

      expect(res.body).toHaveProperty("success", true);
      expect(res.body).toHaveProperty("id");
      expect(typeof res.body.id).toBe("string");

      // Verify it's persisted in the database
      const row = db
        .prepare("SELECT * FROM automation_rules WHERE id = ?")
        .get(res.body.id) as Record<string, unknown> | undefined;

      expect(row).toBeDefined();
      expect(row!.name).toBe("Test Automation");
      expect(row!.trigger_topic).toBe("sensors/temperature");
      expect(row!.action_type).toBe("publish");
      expect(row!.action_target).toBe("alerts/high-temp");
      expect(row!.enabled).toBe(1);
    });

    it("persisted automation appears in the list endpoint", async () => {
      const token = createAuthToken();

      // Create an automation
      const createRes = await request(app)
        .post("/api/automations")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Listed Automation",
          triggerTopic: "devices/+/state",
          ruleType: "form",
          actionType: "log",
          actionTarget: "console",
          actionParams: {},
        })
        .expect(200);

      // List automations
      const listRes = await request(app)
        .get("/api/automations")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const found = (listRes.body as unknown[]).find(
        (r: any) => r.id === createRes.body.id,
      );
      expect(found).toBeDefined();
    });
  });

  // ─── Requirement 5.5: Health route without authentication ────────────────

  describe("Health route without authentication (Req 5.5)", () => {
    it("returns 200 with system status without requiring auth", async () => {
      const res = await request(app).get("/api/health").expect(200);

      expect(res.body).toHaveProperty("mqtt");
      expect(res.body).toHaveProperty("deviceCount");
      expect(res.body).toHaveProperty("ruleCount");
      expect(res.body).toHaveProperty("uptime");
      expect(res.body).toHaveProperty("timestamp");
      expect(typeof res.body.uptime).toBe("number");
      expect(typeof res.body.timestamp).toBe("string");
    });
  });

  // ─── Requirement 5.6: Auth login with valid credentials ──────────────────

  describe("Auth login with valid credentials (Req 5.6)", () => {
    it("returns a JWT token after setup and login", async () => {
      // First, set up the admin user (since no admin exists yet)
      const setupRes = await request(app)
        .post("/api/auth/setup")
        .send({ username: "admin", password: "securepassword123" })
        .expect(201);

      expect(setupRes.body).toHaveProperty("accessToken");
      expect(typeof setupRes.body.accessToken).toBe("string");
      expect(setupRes.body.accessToken.length).toBeGreaterThan(0);
      expect(setupRes.body).toHaveProperty("user");
      expect(setupRes.body.user.username).toBe("admin");
      expect(setupRes.body.user.role).toBe("admin");

      // Now login with the same credentials
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ username: "admin", password: "securepassword123" })
        .expect(200);

      expect(loginRes.body).toHaveProperty("accessToken");
      expect(typeof loginRes.body.accessToken).toBe("string");
      expect(loginRes.body.accessToken.length).toBeGreaterThan(0);
      expect(loginRes.body).toHaveProperty("user");
      expect(loginRes.body.user.username).toBe("admin");

      // Verify the returned token is a valid JWT that can be used for authenticated requests
      const token = loginRes.body.accessToken;
      const protectedRes = await request(app)
        .get("/api/data-store/collections")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(protectedRes.body)).toBe(true);
    });
  });
});
