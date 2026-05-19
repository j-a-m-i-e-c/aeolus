import { describe, expect, vi } from "vitest";
import { test, fc } from "@fast-check/vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { errorHandler, AppError } from "../error-handler.js";

// Mock the logger
vi.mock("../../../logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config to production mode
vi.mock("../../../config.js", () => ({
  config: {
    nodeEnv: "production",
    logLevel: "silent",
  },
}));

/**
 * Property 6: Error Response Shape Consistency
 *
 * For any error thrown during request processing (whether AppError, validation error,
 * or unexpected error), the HTTP response body SHALL be valid JSON matching the shape
 * `{ error: string, details?: unknown }` and SHALL NOT include stack traces when
 * `NODE_ENV` is `production`.
 *
 * **Validates: Requirements 12.1, 12.2**
 */
describe("Property: Error Response Shape Consistency", () => {
  // Arbitrary for valid HTTP status codes used in AppError
  const statusCodeArb = fc.integer({ min: 400, max: 599 });
  // Arbitrary for error messages (non-empty strings)
  const messageArb = fc.string({ minLength: 1, maxLength: 200 });

  function createAppWithError(throwFn: (req: Request, res: Response, next: NextFunction) => void) {
    const app = express();
    app.get("/test", throwFn);
    app.use(errorHandler);
    return app;
  }

  test.prop(
    [statusCodeArb, messageArb],
    { numRuns: 100 },
  )(
    "AppError responses always have { error: string } shape",
    async (statusCode, message) => {
      const app = createAppWithError(() => {
        throw new AppError(statusCode, message);
      });

      const res = await request(app).get("/test");

      expect(res.status).toBe(statusCode);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      expect(res.body.error).toBe(message);
      // No stack trace in production
      expect(res.body).not.toHaveProperty("stack");
      expect(JSON.stringify(res.body)).not.toContain("at ");
    },
  );

  test.prop(
    [messageArb],
    { numRuns: 100 },
  )(
    "unexpected Error responses return 500 with generic message in production",
    async (message) => {
      const app = createAppWithError(() => {
        throw new Error(message);
      });

      const res = await request(app).get("/test");

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      // In production, the actual error message should NOT be exposed
      expect(res.body.error).toBe("Internal server error");
      // No stack trace in response
      expect(res.body).not.toHaveProperty("stack");
      // Response should only have the generic error field
      const keys = Object.keys(res.body);
      expect(keys).toContain("error");
      // No extra fields that could leak info
      for (const key of keys) {
        expect(["error", "details"]).toContain(key);
      }
    },
  );

  test.prop(
    [statusCodeArb, messageArb, fc.oneof(
      fc.string({ minLength: 1 }),
      fc.integer({ min: 1 }),
      fc.constant(true),
      fc.array(fc.integer(), { minLength: 1 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string(), { minKeys: 1 }),
    )],
    { numRuns: 100 },
  )(
    "AppError with truthy details includes details in response",
    async (statusCode, message, details) => {
      const app = createAppWithError(() => {
        const err = new AppError(statusCode, message);
        err.details = details;
        throw err;
      });

      const res = await request(app).get("/test");

      expect(res.status).toBe(statusCode);
      expect(res.body).toHaveProperty("error", message);
      // Details should be present since we only generate truthy values
      expect(res.body).toHaveProperty("details");
      // No stack trace
      expect(res.body).not.toHaveProperty("stack");
    },
  );
});
