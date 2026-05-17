import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { metricsAuthGuard } from "./metrics-auth.js";

function createMockRequest(authHeader?: string): Partial<Request> {
  const headers: Record<string, string | undefined> = {};
  if (authHeader !== undefined) {
    headers.authorization = authHeader;
  }
  return { headers } as Partial<Request>;
}

function createMockResponse(): Partial<Response> & {
  statusCode: number | null;
  body: unknown;
} {
  const response = {
    statusCode: null as number | null,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(data: unknown) {
      response.body = data;
      return response;
    },
  };
  return response as Partial<Response> & {
    statusCode: number | null;
    body: unknown;
  };
}

describe("metricsAuthGuard", () => {
  const originalEnv = process.env.METRICS_TOKEN;

  beforeEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.METRICS_TOKEN = originalEnv;
    } else {
      delete process.env.METRICS_TOKEN;
    }
  });

  describe("when METRICS_TOKEN is not set", () => {
    it("should call next() and allow the request", () => {
      const request = createMockRequest();
      const response = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => {
        nextCalled = true;
      };

      metricsAuthGuard(
        request as Request,
        response as unknown as Response,
        next,
      );

      expect(nextCalled).toBe(true);
      expect(response.statusCode).toBeNull();
    });

    it("should allow requests even without Authorization header", () => {
      const request = createMockRequest();
      const response = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => {
        nextCalled = true;
      };

      metricsAuthGuard(
        request as Request,
        response as unknown as Response,
        next,
      );

      expect(nextCalled).toBe(true);
    });
  });

  describe("when METRICS_TOKEN is set to empty string", () => {
    it("should allow all requests (empty string is falsy)", () => {
      process.env.METRICS_TOKEN = "";
      const request = createMockRequest();
      const response = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => {
        nextCalled = true;
      };

      metricsAuthGuard(
        request as Request,
        response as unknown as Response,
        next,
      );

      expect(nextCalled).toBe(true);
      expect(response.statusCode).toBeNull();
    });
  });

  describe("when METRICS_TOKEN is set", () => {
    beforeEach(() => {
      process.env.METRICS_TOKEN = "my-secret-token";
    });

    it("should return 401 when Authorization header is missing", () => {
      const request = createMockRequest();
      const response = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => {
        nextCalled = true;
      };

      metricsAuthGuard(
        request as Request,
        response as unknown as Response,
        next,
      );

      expect(nextCalled).toBe(false);
      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when Authorization header does not start with Bearer", () => {
      const request = createMockRequest("Basic abc123");
      const response = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => {
        nextCalled = true;
      };

      metricsAuthGuard(
        request as Request,
        response as unknown as Response,
        next,
      );

      expect(nextCalled).toBe(false);
      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when token does not match METRICS_TOKEN", () => {
      const request = createMockRequest("Bearer wrong-token");
      const response = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => {
        nextCalled = true;
      };

      metricsAuthGuard(
        request as Request,
        response as unknown as Response,
        next,
      );

      expect(nextCalled).toBe(false);
      expect(response.statusCode).toBe(401);
      expect(response.body).toEqual({ error: "Unauthorized" });
    });

    it("should call next() when token matches METRICS_TOKEN exactly", () => {
      const request = createMockRequest("Bearer my-secret-token");
      const response = createMockResponse();
      let nextCalled = false;
      const next: NextFunction = () => {
        nextCalled = true;
      };

      metricsAuthGuard(
        request as Request,
        response as unknown as Response,
        next,
      );

      expect(nextCalled).toBe(true);
      expect(response.statusCode).toBeNull();
    });

    it("should read METRICS_TOKEN on each request (runtime changes)", () => {
      // First request with original token
      const request1 = createMockRequest("Bearer my-secret-token");
      const response1 = createMockResponse();
      let next1Called = false;
      metricsAuthGuard(
        request1 as Request,
        response1 as unknown as Response,
        () => {
          next1Called = true;
        },
      );
      expect(next1Called).toBe(true);

      // Change token at runtime
      process.env.METRICS_TOKEN = "new-token";

      // Second request with old token should fail
      const request2 = createMockRequest("Bearer my-secret-token");
      const response2 = createMockResponse();
      let next2Called = false;
      metricsAuthGuard(
        request2 as Request,
        response2 as unknown as Response,
        () => {
          next2Called = true;
        },
      );
      expect(next2Called).toBe(false);
      expect(response2.statusCode).toBe(401);

      // Third request with new token should succeed
      const request3 = createMockRequest("Bearer new-token");
      const response3 = createMockResponse();
      let next3Called = false;
      metricsAuthGuard(
        request3 as Request,
        response3 as unknown as Response,
        () => {
          next3Called = true;
        },
      );
      expect(next3Called).toBe(true);
    });
  });
});
