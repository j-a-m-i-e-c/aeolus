import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { validate } from "../validate.js";
import { errorHandler, AppError } from "../error-handler.js";
import { z } from "zod";

// Mock the logger to avoid pino output during tests
vi.mock("../../../logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the config for rate limiter tests
vi.mock("../../../config.js", () => ({
  config: {
    rateLimitRpm: 5, // Low limit for testing
    corsOrigins: [],
    nodeEnv: "production",
    logLevel: "silent",
  },
}));

describe("Middleware Integration Tests", () => {
  describe("Rate Limiter", () => {
    it("returns 429 after exceeding the configured limit", async () => {
      // Import rate limiter after mocking config
      const { apiRateLimiter } = await import("../rate-limiter.js");

      const app = express();
      app.use(apiRateLimiter);
      app.get("/test", (_req: Request, res: Response) => {
        res.json({ ok: true });
      });

      const agent = request(app);

      // Send requests up to the limit (5)
      for (let i = 0; i < 5; i++) {
        const res = await agent.get("/test");
        expect(res.status).toBe(200);
      }

      // The 6th request should be rate limited
      const limited = await agent.get("/test");
      expect(limited.status).toBe(429);
      expect(limited.body).toHaveProperty("error");
      expect(limited.body.error).toContain("Too many requests");
    });
  });

  describe("Validation Middleware", () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it("returns 400 with proper error shape for invalid body", async () => {
      const schema = z.object({
        name: z.string().min(1).max(50),
        age: z.number().int().min(0),
      });

      app.post("/test", validate({ body: schema }), (_req: Request, res: Response) => {
        res.json({ ok: true });
      });

      const res = await request(app)
        .post("/test")
        .send({ name: "", age: -1 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Validation failed");
      expect(res.body).toHaveProperty("details");
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it("passes through valid bodies", async () => {
      const schema = z.object({
        name: z.string().min(1).max(50),
      });

      app.post("/test", validate({ body: schema }), (_req: Request, res: Response) => {
        res.json({ ok: true });
      });

      const res = await request(app)
        .post("/test")
        .send({ name: "valid" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("strips unknown fields from validated body", async () => {
      const schema = z.object({
        name: z.string(),
      });

      app.post("/test", validate({ body: schema }), (req: Request, res: Response) => {
        res.json(req.body);
      });

      const res = await request(app)
        .post("/test")
        .send({ name: "hello", extra: "field" });

      expect(res.status).toBe(200);
      // Zod strips unknown keys by default
      expect(res.body).not.toHaveProperty("extra");
    });
  });

  describe("Error Handler", () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it("returns consistent error shape for AppError", async () => {
      app.get("/test", () => {
        throw new AppError(422, "Custom error");
      });
      app.use(errorHandler);

      const res = await request(app).get("/test");

      expect(res.status).toBe(422);
      expect(res.body).toHaveProperty("error", "Custom error");
      expect(res.body).not.toHaveProperty("stack");
    });

    it("returns 500 with generic message in production for unexpected errors", async () => {
      app.get("/test", () => {
        throw new Error("secret internal details");
      });
      app.use(errorHandler);

      const res = await request(app).get("/test");

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty("error", "Internal server error");
      expect(res.body.error).not.toContain("secret");
      expect(res.body).not.toHaveProperty("stack");
    });

    it("returns AppError details when present", async () => {
      app.get("/test", () => {
        const err = new AppError(400, "Bad input");
        err.details = { field: "name", issue: "too long" };
        throw err;
      });
      app.use(errorHandler);

      const res = await request(app).get("/test");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error", "Bad input");
      expect(res.body).toHaveProperty("details");
      expect(res.body.details).toEqual({ field: "name", issue: "too long" });
    });

    it("returns 500 with structured JSON error for unhandled route handler errors", async () => {
      app.get("/explode", (_req: Request, _res: Response) => {
        throw new Error("unexpected failure");
      });
      app.use(errorHandler);

      const res = await request(app).get("/explode");

      // Verify status code
      expect(res.status).toBe(500);
      // Verify response is JSON with structured error shape
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toBeTypeOf("object");
      expect(res.body).toHaveProperty("error");
      expect(typeof res.body.error).toBe("string");
      // In production mode (mocked above), internal details are suppressed
      expect(res.body.error).toBe("Internal server error");
      // No stack trace or other sensitive info leaked
      expect(res.body).not.toHaveProperty("stack");
      expect(res.body).not.toHaveProperty("details");
    });
  });
});
