// src/api/routes/mqtt.routes.test.ts — Unit tests for MQTT publish route

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createMqttRoutes } from "./mqtt.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../auth/auth-middleware.js", () => ({
  requireTabPermission: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockMqttService() {
  return {
    publish: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

async function request(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") { server.close(); reject(new Error("No address")); return; }
      const options: RequestInit = {
        method: method.toUpperCase(),
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) options.body = JSON.stringify(body);
      fetch(`http://127.0.0.1:${addr.port}${path}`, options)
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

describe("mqtt.routes", () => {
  let app: express.Express;
  let mqttService: ReturnType<typeof createMockMqttService>;

  beforeEach(() => {
    mqttService = createMockMqttService();
    app = express();
    app.use(express.json());
    app.use("/api/mqtt", createMqttRoutes(mqttService as any));
    app.use(errorHandler);
  });

  describe("POST /api/mqtt/publish", () => {
    it("publishes a message and returns success", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        topic: "home/lights/1",
        payload: { state: "on" },
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.topic).toBe("home/lights/1");
      expect(mqttService.publish).toHaveBeenCalledWith("home/lights/1", '{"state":"on"}');
    });

    it("publishes string payload directly", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        topic: "test/topic",
        payload: "hello",
      });
      expect(res.status).toBe(200);
      expect(mqttService.publish).toHaveBeenCalledWith("test/topic", "hello");
    });

    it("publishes empty string when payload is undefined", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        topic: "test/topic",
      });
      expect(res.status).toBe(200);
      expect(mqttService.publish).toHaveBeenCalledWith("test/topic", '""');
    });

    it("trims whitespace from topic", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        topic: "  home/sensor  ",
        payload: "data",
      });
      expect(res.status).toBe(200);
      expect(res.body.topic).toBe("home/sensor");
      expect(mqttService.publish).toHaveBeenCalledWith("home/sensor", "data");
    });

    it("returns 400 when topic is missing", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        payload: "data",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("topic");
    });

    it("returns 400 when topic is empty string", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        topic: "",
        payload: "data",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when topic is whitespace only", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        topic: "   ",
        payload: "data",
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when topic is not a string", async () => {
      const res = await request(app, "POST", "/api/mqtt/publish", {
        topic: 123,
        payload: "data",
      });
      expect(res.status).toBe(400);
    });
  });
});
