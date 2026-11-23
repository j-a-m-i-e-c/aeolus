// src/api/middleware/request-logger.test.ts — a secret in a URL never reaches the logs.
//
// Request logs go to stdout, container logs and the admin-visible log buffer. The
// logger used to record req.originalUrl, query string included, before any route had
// a chance to reject the request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import logger from "../../logger.js";
import { metricsService } from "../../metrics/metrics-service.js";
import { metricsMiddleware } from "../../metrics/metrics-middleware.js";
import { errorHandler, NotFoundError } from "./error-handler.js";
import { loggablePath, requestLogger } from "./request-logger.js";
import { CREDENTIAL_QUERY_PARAMS, urlCarriesCredential, urlCredentialGuard } from "./url-credential-guard.js";

const SECRET = "fake-secret-9f8e7d6c5b4a";
const API_KEY = "aeo_0123456789abcdef_" + "s".repeat(43);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJlLXZhbHVl";

let captured: string[];

function app() {
  const server = express();
  server.use(metricsMiddleware());
  server.use(requestLogger);
  server.use(urlCredentialGuard);
  server.get("/api/things", (_req, res) => { res.json({ ok: true }); });
  server.get("/api/things/missing", () => { throw new NotFoundError("Thing not found"); });
  server.get("/api/things/broken", () => { throw new Error("boom"); });
  server.use(errorHandler);
  return server;
}

async function get(path: string): Promise<{ status: number; text: string }> {
  const server = app().listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, text: await res.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const everything = () => captured.join("\n");

beforeEach(() => {
  captured = [];
  const capture = (...args: unknown[]) => { captured.push(JSON.stringify(args, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v))); };
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
    vi.spyOn(logger, level).mockImplementation(capture as never);
  }
  vi.spyOn(metricsService, "recordHttpRequest").mockImplementation((...args: unknown[]) => { captured.push(JSON.stringify(args)); });
});
afterEach(() => vi.restoreAllMocks());

describe("request logging", () => {
  it("logs the path without the query string", async () => {
    const res = await get(`/api/things?filter=${SECRET}`);
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(captured.some((line) => line.includes("GET /api/things 200"))).toBe(true));
    expect(everything()).not.toContain(SECRET);
    expect(everything()).not.toContain("filter=");
  });

  it.each(CREDENTIAL_QUERY_PARAMS)("refuses ?%s= with 400, and logs neither the value nor the query", async (name) => {
    const res = await get(`/api/things?${name}=${SECRET}`);
    expect(res.status).toBe(400);
    expect(res.text).not.toContain(SECRET);
    await vi.waitFor(() => expect(captured.some((line) => line.includes("GET /api/things 400"))).toBe(true));
    expect(everything()).not.toContain(SECRET);
  });

  it("refuses an API key or a JWT under any parameter name", async () => {
    for (const value of [API_KEY, JWT]) {
      captured = [];
      const res = await get(`/api/things?q=${encodeURIComponent(value)}`);
      expect(res.status).toBe(400);
      await vi.waitFor(() => expect(captured.some((line) => line.includes("400"))).toBe(true));
      expect(everything()).not.toContain(value);
    }
  });

  it("refuses a credential parameter however its name is cased or encoded", async () => {
    for (const query of [`ACCESS_TOKEN=${SECRET}`, `Api%5FKey=${SECRET}`, `%74oken=${SECRET}`, `a=1&token=${SECRET}`, `token`]) {
      expect(await get(`/api/things?${query}`)).toMatchObject({ status: 400 });
    }
    expect(everything()).not.toContain(SECRET);
  });

  it("masks a credential pasted into the path itself", async () => {
    await get(`/api/things/${API_KEY}`);
    await get(`/api/things/${JWT}`);
    await vi.waitFor(() => expect(captured.filter((line) => line.includes("404")).length).toBeGreaterThanOrEqual(2));
    expect(everything()).not.toContain(API_KEY.slice(4));
    expect(everything()).not.toContain(JWT);
    expect(everything()).toContain("aeo_[redacted]");
  });

  it("keeps the query out of error logging, for client and server errors", async () => {
    expect((await get(`/api/things/missing?filter=${SECRET}`)).status).toBe(404);
    expect((await get(`/api/things/broken?filter=${SECRET}`)).status).toBe(500);
    await vi.waitFor(() => expect(captured.some((line) => line.includes("boom"))).toBe(true));
    expect(everything()).not.toContain(SECRET);
  });

  it("never records the Authorization header or cookies", async () => {
    const server = app().listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      await fetch(`http://127.0.0.1:${port}/api/things`, { headers: { Authorization: `Bearer ${SECRET}`, Cookie: `refresh=${SECRET}` } });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    await vi.waitFor(() => expect(captured.some((line) => line.includes("GET /api/things 200"))).toBe(true));
    expect(everything()).not.toContain(SECRET);
  });

  it("leaves ordinary query parameters working", async () => {
    for (const query of ["limit=50", "from=1&to=2", "state=OBSERVED", "key=level", "tokens=3", "mode=x"]) {
      expect(await get(`/api/things?${query}`)).toMatchObject({ status: 200 });
    }
  });
});

describe("loggablePath", () => {
  it.each([
    ["/api/a?token=x", "/api/a"],
    ["/api/a#frag", "/api/a"],
    ["/api/a?b=1#c", "/api/a"],
    ["/api/a", "/api/a"],
  ])("%s logs as %s", (url, expected) => {
    expect(loggablePath({ originalUrl: url, url })).toBe(expected);
  });

  it("caps very long paths", () => {
    expect(loggablePath({ originalUrl: "/" + "a".repeat(2000), url: "" }).length).toBeLessThanOrEqual(513);
  });
});

describe("urlCarriesCredential", () => {
  it("ignores URLs without a query and tolerates malformed encoding", () => {
    expect(urlCarriesCredential("/api/a")).toBe(false);
    expect(urlCarriesCredential("/api/a?x=%E0%A4%A")).toBe(false);
    expect(urlCarriesCredential("/api/a?%E0%A4%A=1")).toBe(false);
    expect(urlCarriesCredential("/api/a?token=%E0%A4%A")).toBe(true);
  });
});
