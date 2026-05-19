// src/api/middleware/error-handler.test.ts — Unit tests for error handler middleware

import { describe, it, expect, vi } from "vitest";
import express from "express";
import { ZodError, z } from "zod";
import {
  errorHandler,
  AppError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from "./error-handler.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function request(
  app: express.Express,
  path: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

function createApp(errorToThrow: Error): express.Express {
  const app = express();
  app.get("/test", (_req, _res, next) => {
    next(errorToThrow);
  });
  app.use(errorHandler);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("error-handler", () => {
  describe("AppError subclasses", () => {
    it("NotFoundError has status 404", () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe("Resource not found");
    });

    it("NotFoundError accepts custom message", () => {
      const err = new NotFoundError("Device not found");
      expect(err.message).toBe("Device not found");
    });

    it("BadRequestError has status 400", () => {
      const err = new BadRequestError();
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("Bad request");
    });

    it("UnauthorizedError has status 401", () => {
      const err = new UnauthorizedError();
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Unauthorized");
    });

    it("ForbiddenError has status 403", () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.message).toBe("Forbidden");
    });

    it("ConflictError has status 409", () => {
      const err = new ConflictError("Already exists");
      expect(err.statusCode).toBe(409);
      expect(err.message).toBe("Already exists");
    });

    it("AppError supports details property", () => {
      const err = new AppError(422, "Validation failed");
      err.details = { field: "name", issue: "required" };
      expect(err.details).toEqual({ field: "name", issue: "required" });
    });
  });

  describe("errorHandler middleware", () => {
    it("handles ZodError with 400 and validation details", async () => {
      const schema = z.object({ name: z.string() });
      let zodError: ZodError;
      try {
        schema.parse({ name: 123 });
      } catch (e) {
        zodError = e as ZodError;
      }
      const app = createApp(zodError!);
      const res = await request(app, "/test");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details).toBeDefined();
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it("handles AppError with correct status code", async () => {
      const app = createApp(new NotFoundError("Item not found"));
      const res = await request(app, "/test");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Item not found");
    });

    it("handles AppError with details", async () => {
      const err = new AppError(422, "Validation error");
      err.details = { fields: ["name"] };
      const app = createApp(err);
      const res = await request(app, "/test");
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("Validation error");
      expect(res.body.details).toEqual({ fields: ["name"] });
    });

    it("handles BadRequestError", async () => {
      const app = createApp(new BadRequestError("Invalid input"));
      const res = await request(app, "/test");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid input");
    });

    it("handles UnauthorizedError", async () => {
      const app = createApp(new UnauthorizedError("Token expired"));
      const res = await request(app, "/test");
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Token expired");
    });

    it("handles ForbiddenError", async () => {
      const app = createApp(new ForbiddenError("Access denied"));
      const res = await request(app, "/test");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Access denied");
    });

    it("handles ConflictError", async () => {
      const app = createApp(new ConflictError("Resource conflict"));
      const res = await request(app, "/test");
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Resource conflict");
    });

    it("handles unexpected errors with 500 in development", async () => {
      const app = createApp(new Error("Something broke"));
      const res = await request(app, "/test");
      expect(res.status).toBe(500);
      // In development mode, error message is exposed
      expect(res.body.error).toBe("Something broke");
    });

    it("handles unexpected errors with generic message in production", async () => {
      // Temporarily set NODE_ENV to production
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      // Need to re-import to pick up new config
      vi.resetModules();
      const { errorHandler: prodHandler } = await import("./error-handler.js");

      const app = express();
      app.get("/test", (_req, _res, next) => {
        next(new Error("Secret internal error"));
      });
      app.use(prodHandler);

      const res = await request(app, "/test");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");

      process.env.NODE_ENV = originalEnv;
    });
  });
});
