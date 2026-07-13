// src/api/routes/health.routes.test.ts — Tests for health routes branches

import { describe, it, expect, vi } from "vitest";
import express from "express";
import { createHealthRoutes } from "./health.routes.js";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function request(app: express.Express, path: string): Promise<{ status: number; body: any }> {
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

describe("health.routes", () => {
  it("returns 'connected' when mqtt is connected", async () => {
    const app = express();
    app.use("/api/health", createHealthRoutes(
      { isConnected: () => true } as any,
      { size: 5 } as any,
      { ruleCount: 3 } as any,
      Date.now() - 10000,
    ));

    const res = await request(app, "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.mqtt).toBe("connected");
    expect(res.body.deviceCount).toBe(5);
    expect(res.body.ruleCount).toBe(3);
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("returns 'disconnected' when mqtt is not connected", async () => {
    const app = express();
    app.use("/api/health", createHealthRoutes(
      { isConnected: () => false } as any,
      { size: 0 } as any,
      { ruleCount: 0 } as any,
      Date.now(),
    ));

    const res = await request(app, "/api/health");
    expect(res.status).toBe(200);
    expect(res.body.mqtt).toBe("disconnected");
  });
});
