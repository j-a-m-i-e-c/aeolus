// src/api/routes/state.routes.test.ts — Unit tests for state routes

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import { EventEmitter } from "node:events";
import { createStateRoutes } from "./state.routes.js";
import { createTestDatabase } from "../../__test-helpers__/index.js";
import { DeviceRegistry } from "../../core/device-registry.js";
import type { Database as DatabaseType } from "better-sqlite3";

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function request(
  app: express.Express,
  method: string,
  path: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      fetch(`http://127.0.0.1:${addr.port}${path}`, { method })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          server.close();
          resolve({ status: res.status, body: json });
        })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("state.routes", () => {
  let app: express.Express;
  let db: DatabaseType;
  let registry: DeviceRegistry;
  let eventBus: EventEmitter;

  beforeEach(() => {
    db = createTestDatabase();
    eventBus = new EventEmitter();
    registry = new DeviceRegistry(db, eventBus);
    registry.loadFromDb();

    app = express();
    app.use(express.json());
    app.use("/api/state", createStateRoutes(registry));
  });

  afterEach(() => {
    db.close();
  });

  describe("GET /api/state", () => {
    it("returns empty object when no devices exist", async () => {
      const res = await request(app, "GET", "/api/state");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it("returns all devices keyed by ID", async () => {
      // Register some devices
      registry.upsert({
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 22 },
        topic: "home/sensor-1",
        timestamp: Date.now(),
        name: "Living Room Sensor",
      });
      registry.upsert({
        deviceId: "light-1",
        deviceType: "light",
        state: { on: true, brightness: 100 },
        topic: "home/light-1",
        timestamp: Date.now(),
        name: "Kitchen Light",
      });

      const res = await request(app, "GET", "/api/state");
      expect(res.status).toBe(200);
      expect(res.body["sensor-1"]).toBeDefined();
      expect(res.body["sensor-1"].name).toBe("Living Room Sensor");
      expect(res.body["sensor-1"].state.temperature).toBe(22);
      expect(res.body["light-1"]).toBeDefined();
      expect(res.body["light-1"].state.on).toBe(true);
    });

    it("returns updated state after device update", async () => {
      registry.upsert({
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 20 },
        topic: "home/sensor-1",
        timestamp: Date.now(),
        name: "Sensor",
      });
      registry.upsert({
        deviceId: "sensor-1",
        deviceType: "sensor",
        state: { temperature: 25 },
        topic: "home/sensor-1",
        timestamp: Date.now(),
        name: "Sensor",
      });

      const res = await request(app, "GET", "/api/state");
      expect(res.body["sensor-1"].state.temperature).toBe(25);
    });
  });
});
