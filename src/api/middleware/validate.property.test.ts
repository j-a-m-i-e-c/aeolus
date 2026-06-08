import { describe, expect, vi } from "vitest";
import { test, fc } from "@fast-check/vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { validate } from "./validate.js";
import {
  createAutomationBodySchema,
} from "../schemas/automation.schemas.js";
import {
  createCollectionBodySchema,
} from "../schemas/data-store.schemas.js";

// Mock the logger
vi.mock("../../logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Property 1: Validation Constraint Enforcement
 *
 * For any Zod schema field with a defined constraint (max string length,
 * numeric range, or required presence), and for any input value that violates
 * that constraint, the validation middleware SHALL reject the request with HTTP 400.
 *
 * **Validates: Requirements 2.3, 2.4, 2.7**
 */
describe("Property: Validation Constraint Enforcement", () => {
  function createApp(schema: Parameters<typeof validate>[0]["body"]) {
    const app = express();
    app.use(express.json());
    app.post("/test", validate({ body: schema }), (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  test.prop(
    [fc.string({ minLength: 201, maxLength: 1000 })],
    { numRuns: 100 },
  )(
    "rejects automation names exceeding max length (200 chars)",
    async (longName) => {
      const app = createApp(createAutomationBodySchema);

      const res = await request(app)
        .post("/test")
        .send({ name: longName });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
      expect(res.body).toHaveProperty("details");
    },
  );

  test.prop(
    [fc.string({ minLength: 1, maxLength: 200 })],
    { numRuns: 100 },
  )(
    "accepts automation names within valid length (1-200 chars)",
    async (validName) => {
      const app = createApp(createAutomationBodySchema);

      const res = await request(app)
        .post("/test")
        .send({ name: validName });

      expect(res.status).toBe(200);
    },
  );

  test.prop(
    [fc.string({ minLength: 201, maxLength: 500 })],
    { numRuns: 100 },
  )(
    "rejects collection names exceeding max length (200 chars)",
    async (longName) => {
      const app = createApp(createCollectionBodySchema);

      const res = await request(app)
        .post("/test")
        .send({ name: longName });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
    },
  );

  test.prop(
    [fc.string({ minLength: 1, maxLength: 200 })],
    { numRuns: 100 },
  )(
    "accepts collection names within valid length (1-200 chars)",
    async (validName) => {
      const app = createApp(createCollectionBodySchema);

      const res = await request(app)
        .post("/test")
        .send({ name: validName });

      expect(res.status).toBe(200);
    },
  );

  test.prop(
    [fc.integer({ min: -100, max: -1 }).map(n => n), fc.string({ minLength: 1, maxLength: 200 })],
    { numRuns: 100 },
  )(
    "rejects collection retentionDays below minimum (< 1)",
    async (invalidDays, validName) => {
      const app = createApp(createCollectionBodySchema);

      const res = await request(app)
        .post("/test")
        .send({ name: validName, retentionDays: invalidDays });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
    },
  );

  test.prop(
    [fc.integer({ min: 3651, max: 10000 }), fc.string({ minLength: 1, maxLength: 200 })],
    { numRuns: 100 },
  )(
    "rejects collection retentionDays above maximum (> 3650)",
    async (invalidDays, validName) => {
      const app = createApp(createCollectionBodySchema);

      const res = await request(app)
        .post("/test")
        .send({ name: validName, retentionDays: invalidDays });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
    },
  );

  test.prop(
    [fc.constant(undefined)],
    { numRuns: 1 },
  )(
    "rejects missing required fields (name is required for automation)",
    async () => {
      const app = createApp(createAutomationBodySchema);

      const res = await request(app)
        .post("/test")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
      expect(res.body).toHaveProperty("details");
    },
  );
});
