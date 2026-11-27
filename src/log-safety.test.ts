// src/log-safety.test.ts — the log-safety helpers and the error handler's body-parser path.
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as unknown[][]);
vi.mock("./logger.js", () => {
  const record = (...args: unknown[]) => { logged.push(args); };
  return { default: { info: record, warn: record, error: record, debug: record } };
});

import { isBodyParserError, loggableTarget, loggableUrl, maskCredentialSegments, scrubLogLine, serializeError } from "./log-safety.js";
import { errorHandler } from "./api/middleware/error-handler.js";

const KEY = "aeo_0123456789abcdef_" + "k".repeat(43);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlc2lnbmF0dXJl";

describe("scrubLogLine", () => {
  it("masks API keys, JWTs and bearer tokens anywhere in a line", () => {
    const line = JSON.stringify({ msg: `called with ${KEY}`, h: `Bearer ${JWT}`, other: "Bearer abcdefgh12345678" });
    const safe = scrubLogLine(line);
    expect(safe.includes(KEY.slice(21)) || safe.includes(JWT.split(".")[1]!) || safe.includes("abcdefgh12345678")).toBe(false);
    expect(safe).toContain("aeo_[redacted]");
    expect(safe).toContain("Bearer [redacted]");
  });

  it("leaves ordinary text alone", () => {
    expect(scrubLogLine('{"msg":"GET /api/devices 200 3ms"}')).toBe('{"msg":"GET /api/devices 200 3ms"}');
    expect(maskCredentialSegments("/api/exposed/v1/site-a/x")).toBe("/api/exposed/v1/site-a/x");
  });
});

describe("serializeError", () => {
  it("keeps type, message, stack and scalar codes, and nothing an error carries besides", () => {
    const error = Object.assign(new TypeError("boom"), { code: "E_X", status: 502, body: { password: "p" }, config: { apiKey: KEY } });
    const out = serializeError(error);
    expect(out).toEqual({ type: "TypeError", message: "boom", stack: expect.any(String), code: "E_X", status: 502 });
  });

  it("follows an Error cause and describes non-errors", () => {
    const out = serializeError(new Error("outer", { cause: Object.assign(new Error("inner"), { body: "secret" }) }));
    expect(out.cause).toEqual({ type: "Error", message: "inner", stack: expect.any(String) });
    expect(serializeError("plain")).toEqual({ type: "string", message: "plain" });
  });
});

describe("loggableUrl and loggableTarget", () => {
  it("drops userinfo, query and fragment, and masks credential segments", () => {
    expect(loggableUrl("https://user:pw@api.example.com:8443/v1/x?token=abc#f")).toBe("https://api.example.com:8443/v1/x");
    expect(loggableUrl(`https://api.example.com/hooks/${KEY}`)).toBe("https://api.example.com/hooks/aeo_[redacted]");
    expect(loggableUrl("not a url")).toBe("[invalid URL]");
  });

  it("treats only http(s) targets as URLs", () => {
    expect(loggableTarget("https://hooks.example.com/x?sig=1")).toBe("https://hooks.example.com/x");
    expect(loggableTarget("living-room-light")).toBe("living-room-light");
  });
});

describe("isBodyParserError", () => {
  it("recognises body-parser errors only", () => {
    expect(isBodyParserError(Object.assign(new SyntaxError("x"), { type: "entity.parse.failed", status: 400 }))).toBe(true);
    expect(isBodyParserError(Object.assign(new Error("x"), { type: "entity.too.large", status: 413 }))).toBe(true);
    expect(isBodyParserError(Object.assign(new Error("x"), { type: "entity.parse.failed", status: 500 }))).toBe(false);
    expect(isBodyParserError(Object.assign(new Error("x"), { type: "something.else", status: 400 }))).toBe(false);
    expect(isBodyParserError({ type: "entity.parse.failed", status: 400 })).toBe(false);
  });
});

describe("errorHandler with body-parser failures", () => {
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.post("/x", (_req, res) => { res.json({ ok: true }); });
  app.use(errorHandler);

  it("answers malformed JSON with a fixed 400 and logs only metadata", async () => {
    logged.length = 0;
    const res = await request(app).post("/x?password=q").set("Content-Type", "application/json").send(`{"password":"${KEY}",}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "The request body is not valid JSON", requestId: expect.any(String) });
    expect(JSON.stringify(logged).includes(KEY.slice(21))).toBe(false);
    expect(logged[0]).toEqual([{ requestId: res.body.requestId, category: "entity.parse.failed", status: 400, method: "POST", path: "/x" }, "Request body refused"]);
  });

  it("answers an oversized body with 413", async () => {
    const res = await request(app).post("/x").set("Content-Type", "application/json").send(JSON.stringify({ pad: "x".repeat(2000) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("The request body is too large");
  });

  it("uses a generic message for a parser category it does not name", async () => {
    const odd = express();
    odd.post("/y", (_req, _res, next) => next(Object.assign(new Error(`raw ${KEY}`), { type: "stream.not.readable", status: 400 })));
    odd.use(errorHandler);
    const res = await request(odd).post("/y");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("The request body could not be read");
    expect(JSON.stringify(res.body).includes(KEY.slice(21))).toBe(false);
  });
});
