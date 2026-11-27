// src/__integration__/log-safety.integration.test.ts — secrets sent to the real
// middleware stack never reach stdout, the admin log buffer or an HTTP response.
//
// The probe (src/__test-helpers__/log-safety-probe.ts) runs in a child process so
// nothing is mocked: the real pino logger writes to the child's real stdout, which
// this test captures whole. Sentinels are random per run and never committed.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASSWORD = `Sentinel-Pw-${randomBytes(9).toString("hex")}`;
const KEY = `aeo_${randomBytes(8).toString("hex")}_${randomBytes(32).toString("base64url")}`;
const JWT = `eyJ${randomBytes(12).toString("base64url")}.${randomBytes(24).toString("base64url")}.${randomBytes(24).toString("base64url")}`;
// The distinctive parts: what must never appear, in whole or as the secret half.
const FORBIDDEN = [PASSWORD, KEY, KEY.slice(21), JWT, JWT.split(".")[1]!];

let output = "";
let dir = "";

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aeolus-log-safety-"));
  const run = spawnSync(process.execPath, ["--no-node-snapshot", "--import", "tsx", "src/__test-helpers__/log-safety-probe.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH: path.join(dir, "aeolus.db"),
      // Development mode returns unexpected error messages to the caller: the worst case.
      NODE_ENV: "development",
      LOG_LEVEL: "debug",
      SENTINEL_PASSWORD: PASSWORD,
      SENTINEL_KEY: KEY,
      SENTINEL_JWT: JWT,
    },
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  expect(run.status, `probe exited ${run.status}: ${(run.stderr ?? "").slice(0, 400)}`).toBe(0);
}, 90_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function section(marker: string): unknown {
  const line = output.split("\n").find((candidate) => candidate.startsWith(`${marker} `));
  expect(line, `${marker} line`).toBeTruthy();
  return JSON.parse(line!.slice(marker.length + 1));
}

describe("credentials sent to the real stack", () => {
  it("appear nowhere in stdout, stderr, the log buffer or any response", () => {
    // Boolean, so a failure cannot print the secret it found.
    for (const secret of FORBIDDEN) expect(output.includes(secret), "a sentinel reached the output").toBe(false);
  });

  it("refuses malformed and oversized bodies with fixed messages and a request id", () => {
    const responses = section("PROBE_RESPONSES") as Array<{ name: string; status: number; body: string }>;
    const byName = new Map(responses.map((response) => [response.name, response]));
    for (const name of ["login-malformed", "setup-malformed", "automation-malformed"]) {
      expect(byName.get(name)?.status, name).toBe(400);
      expect(JSON.parse(byName.get(name)!.body)).toMatchObject({ error: "The request body is not valid JSON", requestId: expect.any(String) });
    }
    expect(byName.get("too-large")?.status).toBe(413);
    expect(JSON.parse(byName.get("too-large")!.body).error).toBe("The request body is too large");
  });

  it("keeps useful diagnostics: category, method, path and the same request id", () => {
    const responses = section("PROBE_RESPONSES") as Array<{ name: string; body: string }>;
    const requestId = JSON.parse(responses.find((response) => response.name === "login-malformed")!.body).requestId as string;
    const buffer = section("PROBE_BUFFER") as Array<Record<string, unknown>>;
    expect(buffer.find((entry) => entry.requestId === requestId)).toMatchObject({
      msg: "Request body refused", category: "entity.parse.failed", status: 400, method: "POST", path: "/api/auth/login",
    });
    const probe = buffer.find((entry) => entry.msg === "probe log call") as Record<string, unknown>;
    // The error keeps its type and message; its extra fields are dropped, named secrets censored.
    expect(probe.err).toEqual({ type: "Error", message: "upstream failed", stack: expect.any(String) });
    expect(probe).toMatchObject({ password: "[redacted]", apiKey: "[redacted]", nested: { token: "[redacted]" } });
  });

  it("logs request paths without query strings and with credential segments masked", () => {
    const buffer = section("PROBE_BUFFER") as Array<{ path?: string }>;
    const paths = buffer.map((entry) => entry.path).filter((value): value is string => typeof value === "string");
    expect(paths).toContain("/api/devices");
    expect(paths).toContain("/api/automations/aeo_[redacted]");
  });
});
