// src/api/routes/mqtt.routes.test.ts — Unit tests for the confined MQTT publish route
// Feature: mqtt-publish-confinement

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { createMqttRoutes } from "./mqtt.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { PublishPolicyConfig } from "../../mqtt/publish-policy.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const POLICY: PublishPolicyConfig = {
  userNamespacePrefix: "aeolus/pub/",
  reservedSystemPrefixes: ["aeolus/acks/"],
  maxPayloadBytes: 64,
};

function createMockMqttService() {
  return {
    publish: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

/** Build an app that injects a req.user with the given role before the router. */
function buildApp(role: "admin" | "user", mqttService: ReturnType<typeof createMockMqttService>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { userId: `u-${role}`, username: role, role, groupId: null };
    next();
  });
  app.use("/api/mqtt", createMqttRoutes(mqttService as never, POLICY));
  app.use(errorHandler);
  return app;
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

describe("POST /api/mqtt/publish — confinement", () => {
  let mqttService: ReturnType<typeof createMockMqttService>;

  beforeEach(() => {
    mqttService = createMockMqttService();
  });

  describe("non-admin", () => {
    it("allows a publish inside the user namespace and publishes without retain", async () => {
      const app = buildApp("user", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "aeolus/pub/lights", payload: { on: true } });
      expect(res.status).toBe(200);
      expect(res.body.topic).toBe("aeolus/pub/lights");
      expect(mqttService.publish).toHaveBeenCalledWith("aeolus/pub/lights", '{"on":true}', { retain: false });
    });

    it("rejects a publish outside the user namespace with 403", async () => {
      const app = buildApp("user", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "home/lights/1", payload: "x" });
      expect(res.status).toBe(403);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });

    it("rejects a publish to the reserved ack namespace with 403", async () => {
      const app = buildApp("user", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "aeolus/acks/dev-1", payload: "{}" });
      expect(res.status).toBe(403);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });

    it("rejects retain=true with 403", async () => {
      const app = buildApp("user", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "aeolus/pub/x", payload: "x", retain: true });
      expect(res.status).toBe(403);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });
  });

  describe("admin", () => {
    it("allows a publish outside the user namespace", async () => {
      const app = buildApp("admin", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "home/lights/1", payload: "x" });
      expect(res.status).toBe(200);
      expect(mqttService.publish).toHaveBeenCalledWith("home/lights/1", "x", { retain: false });
    });

    it("still cannot publish to the reserved ack namespace (403)", async () => {
      const app = buildApp("admin", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "aeolus/acks/x", payload: "{}" });
      expect(res.status).toBe(403);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });

    it("publishes with retain when requested", async () => {
      const app = buildApp("admin", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "home/x", payload: "x", retain: true });
      expect(res.status).toBe(200);
      expect(mqttService.publish).toHaveBeenCalledWith("home/x", "x", { retain: true });
    });
  });

  describe("guardrails and validation", () => {
    it("returns 413 when the payload exceeds the size limit", async () => {
      const app = buildApp("admin", mqttService);
      const big = "a".repeat(POLICY.maxPayloadBytes + 1);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "home/x", payload: big });
      expect(res.status).toBe(413);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });

    it("returns 400 for a wildcard topic", async () => {
      const app = buildApp("admin", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "aeolus/pub/#", payload: "x" });
      expect(res.status).toBe(400);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });

    it("returns 400 when topic is missing", async () => {
      const app = buildApp("admin", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { payload: "x" });
      expect(res.status).toBe(400);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });

    it("returns 400 when topic is empty", async () => {
      const app = buildApp("admin", mqttService);
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "   ", payload: "x" });
      expect(res.status).toBe(400);
    });

    it("defaults role to 'user' when req.user is undefined", async () => {
      // Build app without injecting req.user to test the ?? fallback
      const app = express();
      app.use(express.json());
      app.use("/api/mqtt", createMqttRoutes(mqttService as never, POLICY));
      app.use(errorHandler);

      // Publish outside user namespace — should be denied as "user" role by default
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "home/x", payload: "x" });
      expect(res.status).toBe(403);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });
  });
});
