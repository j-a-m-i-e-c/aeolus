import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { metricsMiddleware, normalizeRoutePath } from "./metrics-middleware.js";

// Mock the metrics service to capture recordHttpRequest calls
vi.mock("./metrics-service.js", () => ({
  metricsService: {
    recordHttpRequest: vi.fn(),
  },
}));

// Mock the logger to suppress output during tests
vi.mock("../logger.js", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { metricsService } from "./metrics-service.js";

/** Create a mock Express Request with the given path and method */
function createMockRequest(path: string, method = "GET"): Partial<Request> {
  return { path, method };
}

/** Create a mock Express Response that supports the 'finish' event */
function createMockResponse(statusCode = 200): Partial<Response> & {
  emit: (event: string) => void;
} {
  const listeners: Record<string, Array<() => void>> = {};

  return {
    statusCode,
    on(event: string, handler: () => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
      return this as unknown as Response;
    },
    emit(event: string) {
      for (const handler of listeners[event] ?? []) {
        handler();
      }
    },
  } as Partial<Response> & { emit: (event: string) => void };
}

describe("metricsMiddleware", () => {
  const middleware = metricsMiddleware();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should call next() to pass control to the next middleware", () => {
    const req = createMockRequest("/api/devices");
    const res = createMockResponse(200);
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    middleware(req as Request, res as unknown as Response, next);

    expect(nextCalled).toBe(true);
  });

  it("should record request duration and status code on response finish", () => {
    const req = createMockRequest("/api/devices", "GET");
    const res = createMockResponse(200);
    const next: NextFunction = () => {};

    middleware(req as Request, res as unknown as Response, next);

    // Simulate the response finishing
    res.emit("finish");

    expect(metricsService.recordHttpRequest).toHaveBeenCalledTimes(1);
    const [method, route, statusCode, duration] =
      (metricsService.recordHttpRequest as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(method).toBe("GET");
    expect(route).toBe("/api/devices");
    expect(statusCode).toBe(200);
    expect(typeof duration).toBe("number");
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("should record the correct status code for error responses", () => {
    const req = createMockRequest("/api/automations", "POST");
    const res = createMockResponse(500);
    const next: NextFunction = () => {};

    middleware(req as Request, res as unknown as Response, next);
    res.emit("finish");

    expect(metricsService.recordHttpRequest).toHaveBeenCalledTimes(1);
    const [method, _route, statusCode] =
      (metricsService.recordHttpRequest as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(method).toBe("POST");
    expect(statusCode).toBe(500);
  });

  it("should record the correct status code for 404 responses", () => {
    const req = createMockRequest("/api/unknown", "GET");
    const res = createMockResponse(404);
    const next: NextFunction = () => {};

    middleware(req as Request, res as unknown as Response, next);
    res.emit("finish");

    expect(metricsService.recordHttpRequest).toHaveBeenCalledTimes(1);
    const [, , statusCode] =
      (metricsService.recordHttpRequest as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(statusCode).toBe(404);
  });

  it("should skip recording metrics for the /metrics endpoint", () => {
    const req = createMockRequest("/metrics", "GET");
    const res = createMockResponse(200);
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    middleware(req as Request, res as unknown as Response, next);
    res.emit("finish");

    expect(nextCalled).toBe(true);
    expect(metricsService.recordHttpRequest).not.toHaveBeenCalled();
  });

  it("should normalize route paths with UUIDs to :id", () => {
    const req = createMockRequest(
      "/api/devices/550e8400-e29b-41d4-a716-446655440000",
      "GET",
    );
    const res = createMockResponse(200);
    const next: NextFunction = () => {};

    middleware(req as Request, res as unknown as Response, next);
    res.emit("finish");

    const [, route] =
      (metricsService.recordHttpRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(route).toBe("/api/devices/:id");
  });

  it("should normalize route paths with numeric segments to :id", () => {
    const req = createMockRequest("/api/devices/12345", "GET");
    const res = createMockResponse(200);
    const next: NextFunction = () => {};

    middleware(req as Request, res as unknown as Response, next);
    res.emit("finish");

    const [, route] =
      (metricsService.recordHttpRequest as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(route).toBe("/api/devices/:id");
  });

  it("should not record metrics if response never finishes", () => {
    const req = createMockRequest("/api/devices", "GET");
    const res = createMockResponse(200);
    const next: NextFunction = () => {};

    middleware(req as Request, res as unknown as Response, next);
    // Do NOT emit 'finish'

    expect(metricsService.recordHttpRequest).not.toHaveBeenCalled();
  });

  it("should still call next() even if an internal error occurs during setup", () => {
    // Create a response that throws when .on() is called
    const req = createMockRequest("/api/devices", "GET");
    const badRes = {
      statusCode: 200,
      on() {
        throw new Error("Simulated internal error");
      },
    };
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    middleware(req as Request, badRes as unknown as Response, next);

    expect(nextCalled).toBe(true);
  });
});

describe("normalizeRoutePath", () => {
  it("should replace UUID segments with :id", () => {
    const result = normalizeRoutePath(
      "/api/devices/550e8400-e29b-41d4-a716-446655440000",
      "GET",
    );
    expect(result).toBe("/api/devices/:id");
  });

  it("should replace numeric segments with :id", () => {
    const result = normalizeRoutePath("/api/devices/12345", "GET");
    expect(result).toBe("/api/devices/:id");
  });

  it("should replace segments after known resource paths with :id", () => {
    const result = normalizeRoutePath("/api/automations/my-rule-name", "GET");
    expect(result).toBe("/api/automations/:id");
  });

  it("should preserve already-normalized placeholders", () => {
    const result = normalizeRoutePath("/api/devices/:id/state", "GET");
    expect(result).toBe("/api/devices/:id/state");
  });

  it("should handle paths without dynamic segments", () => {
    const result = normalizeRoutePath("/api/health", "GET");
    expect(result).toBe("/api/health");
  });

  it("should handle root path", () => {
    const result = normalizeRoutePath("/", "GET");
    expect(result).toBe("/");
  });

  it("should handle multiple dynamic segments", () => {
    const result = normalizeRoutePath(
      "/api/devices/550e8400-e29b-41d4-a716-446655440000/state",
      "GET",
    );
    expect(result).toBe("/api/devices/:id/state");
  });
});
