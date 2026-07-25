// src/api/routes/mqtt.routes.test.ts — Unit tests for the confined MQTT publish route
// Feature: mqtt-publish-confinement

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import Database from "better-sqlite3";
import { createMqttRoutes } from "./mqtt.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { initSchema } from "../../db/database.js";
import { createPrivateTopicStore, type PrivateTopicStore } from "../../mqtt/private-topic-store.js";
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

/** Create a real PrivateTopicStore backed by an in-memory database. */
function createTestPrivateTopicStore(): { store: PrivateTopicStore; close: () => void } {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return { store: createPrivateTopicStore(db), close: () => db.close() };
}

/** Build an app that injects a req.user with the given role before the router. */
function buildApp(
  role: "admin" | "user",
  mqttService: ReturnType<typeof createMockMqttService>,
  privateTopicStore: PrivateTopicStore = createTestPrivateTopicStore().store,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { userId: `u-${role}`, username: role, role, groupId: null };
    next();
  });
  app.use("/api/mqtt", createMqttRoutes(mqttService as never, POLICY, privateTopicStore));
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
      app.use("/api/mqtt", createMqttRoutes(mqttService as never, POLICY, createTestPrivateTopicStore().store));
      app.use(errorHandler);

      // Publish outside user namespace — should be denied as "user" role by default
      const res = await request(app, "POST", "/api/mqtt/publish", { topic: "home/x", payload: "x" });
      expect(res.status).toBe(403);
      expect(mqttService.publish).not.toHaveBeenCalled();
    });
  });
});

describe("Private topic filters — /api/mqtt/private-topics", () => {
  let mqttService: ReturnType<typeof createMockMqttService>;
  let storeHandle: { store: PrivateTopicStore; close: () => void };

  beforeEach(() => {
    mqttService = createMockMqttService();
    storeHandle = createTestPrivateTopicStore();
  });

  afterEach(() => {
    storeHandle.close();
  });

  describe("admin", () => {
    it("adds, lists, and removes a private topic filter", async () => {
      const app = buildApp("admin", mqttService, storeHandle.store);

      const created = await request(app, "POST", "/api/mqtt/private-topics", { pattern: "home/locks/#" });
      expect(created.status).toBe(201);
      expect(created.body.topic.pattern).toBe("home/locks/#");
      const id = created.body.topic.id as string;
      expect(storeHandle.store.isPrivate("home/locks/front")).toBe(true);

      const listed = await request(app, "GET", "/api/mqtt/private-topics");
      expect(listed.status).toBe(200);
      expect(listed.body.topics).toHaveLength(1);
      expect(listed.body.topics[0].id).toBe(id);

      const removed = await request(app, "DELETE", `/api/mqtt/private-topics/${id}`);
      expect(removed.status).toBe(200);
      expect(storeHandle.store.isPrivate("home/locks/front")).toBe(false);
    });

    it("trims the pattern and rejects a blank one with 400", async () => {
      const app = buildApp("admin", mqttService, storeHandle.store);
      const res = await request(app, "POST", "/api/mqtt/private-topics", { pattern: "   " });
      expect(res.status).toBe(400);
    });

    it("returns 400 when removing an unknown filter", async () => {
      const app = buildApp("admin", mqttService, storeHandle.store);
      const res = await request(app, "DELETE", "/api/mqtt/private-topics/does-not-exist");
      expect(res.status).toBe(400);
    });

    it("rejects a malformed topic filter with 400", async () => {
      const app = buildApp("admin", mqttService, storeHandle.store);
      expect((await request(app, "POST", "/api/mqtt/private-topics", { pattern: "sport/#/x" })).status).toBe(400);
      expect((await request(app, "POST", "/api/mqtt/private-topics", { pattern: "bad+level" })).status).toBe(400);
      expect(storeHandle.store.list()).toHaveLength(0);
    });
  });

  describe("non-admin", () => {
    it("can list and add filters (marking private only hides data)", async () => {
      const app = buildApp("user", mqttService, storeHandle.store);

      const added = await request(app, "POST", "/api/mqtt/private-topics", { pattern: "home/locks/#" });
      expect(added.status).toBe(201);
      expect(storeHandle.store.isPrivate("home/locks/front")).toBe(true);

      const listed = await request(app, "GET", "/api/mqtt/private-topics");
      expect(listed.status).toBe(200);
      expect(listed.body.topics).toHaveLength(1);
    });

    it("cannot remove a filter (403) — re-exposing is admin-only", async () => {
      const app = buildApp("user", mqttService, storeHandle.store);
      const added = storeHandle.store.add("home/locks/#");

      const res = await request(app, "DELETE", `/api/mqtt/private-topics/${added.id}`);
      expect(res.status).toBe(403);
      // Filter is untouched, topic still private.
      expect(storeHandle.store.isPrivate("home/locks/front")).toBe(true);
    });

    it("still cannot add a malformed filter (400)", async () => {
      const app = buildApp("user", mqttService, storeHandle.store);
      const res = await request(app, "POST", "/api/mqtt/private-topics", { pattern: "a/#/b" });
      expect(res.status).toBe(400);
    });
  });
});
