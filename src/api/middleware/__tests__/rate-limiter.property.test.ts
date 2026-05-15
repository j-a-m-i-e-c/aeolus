import { describe, expect, vi } from "vitest";
import { test, fc } from "@fast-check/vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";

// Mock the logger
vi.mock("../../../logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Property 3: Rate Limiter Threshold Enforcement
 *
 * For any sequence of N HTTP requests from the same source IP within a 1-minute window
 * where N exceeds the configured limit, the (limit + 1)th and subsequent requests
 * SHALL receive HTTP 429 responses.
 *
 * **Validates: Requirements 3.1**
 */
describe("Property: Rate Limiter Threshold Enforcement", () => {
  function createAppWithLimit(limit: number) {
    const app = express();
    app.use(
      rateLimit({
        windowMs: 60_000,
        max: limit,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many requests, please try again later" },
      }),
    );
    app.get("/test", (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
    return app;
  }

  test.prop(
    [fc.integer({ min: 3, max: 20 })],
    { numRuns: 30 },
  )(
    "first N requests return 200, request N+1 returns 429",
    async (limit) => {
      const app = createAppWithLimit(limit);
      const agent = request(app);

      // Send exactly `limit` requests — all should succeed
      for (let i = 0; i < limit; i++) {
        const res = await agent.get("/test");
        expect(res.status).toBe(200);
      }

      // The (limit + 1)th request should be rate limited
      const limited = await agent.get("/test");
      expect(limited.status).toBe(429);
      expect(limited.body).toHaveProperty("error");
    },
  );

  test.prop(
    [fc.integer({ min: 3, max: 15 }), fc.integer({ min: 1, max: 5 })],
    { numRuns: 20 },
  )(
    "all requests beyond the limit return 429",
    async (limit, extraRequests) => {
      const app = createAppWithLimit(limit);
      const agent = request(app);

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        await agent.get("/test");
      }

      // All subsequent requests should be 429
      for (let i = 0; i < extraRequests; i++) {
        const res = await agent.get("/test");
        expect(res.status).toBe(429);
        expect(res.body.error).toContain("Too many requests");
      }
    },
  );
});
