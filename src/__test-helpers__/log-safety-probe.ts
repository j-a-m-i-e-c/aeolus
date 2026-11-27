// src/__test-helpers__/log-safety-probe.ts — run by log-safety.integration.test.ts in
// a child process, with the real logger (no mocks), the real middleware stack and a
// throwaway database. It sends requests carrying sentinel secrets, then prints every
// HTTP response and the admin log buffer. The parent scans this process's entire
// stdout and stderr, which includes the real pino output.
//
// Sentinels come from the parent through the environment; nothing secret is committed.

import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import { getDatabase } from "../db/database.js";
import { createTestApp } from "./app-factory.js";
import { getRecentLogs } from "../log-buffer.js";
import logger from "../logger.js";

const PASSWORD = process.env.SENTINEL_PASSWORD!;
const KEY = process.env.SENTINEL_KEY!;
const JWT = process.env.SENTINEL_JWT!;

async function main(): Promise<void> {
  const app = createTestApp(getDatabase(), new EventEmitter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const responses: Array<{ name: string; status: number; body: string }> = [];
  const send = async (name: string, path: string, init: RequestInit) => {
    const res = await fetch(`${base}${path}`, init);
    responses.push({ name, status: res.status, body: await res.text() });
  };
  const json = { "Content-Type": "application/json" };

  // Malformed JSON: the parser's error carries the body and quotes it in its message.
  await send("login-malformed", "/api/auth/login", { method: "POST", headers: json, body: `{"username":"admin","password":"${PASSWORD}",}` });
  await send("setup-malformed", "/api/auth/setup", { method: "POST", headers: json, body: `{"username":"admin","password":"${PASSWORD}"` });
  await send("automation-malformed", "/api/automations", { method: "POST", headers: { ...json, Authorization: "Bearer x" }, body: `{"config":{"apiKey":"${KEY}"},}` });
  // Over the 1 MB limit, with the secret at the start.
  await send("too-large", "/api/auth/login", { method: "POST", headers: json, body: `{"password":"${PASSWORD}","pad":"${"x".repeat(1_100_000)}"}` });
  // Valid JSON the schema refuses, and a well-formed failed login.
  await send("login-invalid-shape", "/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: 42, password: PASSWORD, apiKey: KEY }) });
  await send("login-wrong-password", "/api/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "nobody", password: PASSWORD }) });
  // Credentials in a query string, a path and an Authorization header.
  await send("query-token", `/api/devices?token=${KEY}&password=${encodeURIComponent(PASSWORD)}`, { headers: { Authorization: `Bearer ${JWT}` } });
  await send("path-key", `/api/automations/${KEY}`, { headers: { Authorization: `Bearer ${KEY}` } });

  // A direct log call carrying secrets in named fields and in an error's extra fields.
  const error = Object.assign(new Error("upstream failed"), { body: { password: PASSWORD }, config: { apiKey: KEY }, headers: { authorization: `Bearer ${JWT}` } });
  logger.error({ err: error, password: PASSWORD, apiKey: KEY, nested: { token: JWT } }, "probe log call");

  server.close();
  process.stdout.write(`PROBE_RESPONSES ${JSON.stringify(responses)}\n`);
  process.stdout.write(`PROBE_BUFFER ${JSON.stringify(getRecentLogs(200))}\n`);
  logger.flush(() => process.exit(0));
}

main().catch((error: unknown) => {
  process.stderr.write(`probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
