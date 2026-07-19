import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import Database from "better-sqlite3";
import { initSchema } from "../db/database.js";

let testDb: InstanceType<typeof Database>;

vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

// Import after mock setup
const { WsServer } = await import("./ws-server.js");
const { generateAccessToken, _resetSecretCache } = await import("../auth/token-service.js");

// Minimal DeviceRegistry mock
function createMockRegistry() {
  return {
    getAll: () => [],
  } as any;
}

/** Collect messages from a WebSocket into an array, returns helpers */
function collectMessages(ws: WebSocket) {
  const messages: unknown[] = [];
  ws.on("message", (data) => {
    messages.push(JSON.parse(data.toString()));
  });
  return {
    messages,
    waitForCount: (count: number, timeoutMs = 3000) =>
      new Promise<unknown[]>((resolve, reject) => {
        const check = () => {
          if (messages.length >= count) {
            resolve(messages.slice(0, count));
            return;
          }
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`Timed out waiting for ${count} messages, got ${messages.length}`));
            return;
          }
          setTimeout(check, 10);
        };
        const start = Date.now();
        check();
      }),
  };
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    ws.on("open", resolve);
    ws.on("error", reject);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

describe("WsServer Authentication", () => {
  let httpServer: Server;
  let wsServer: InstanceType<typeof WsServer>;
  let eventBus: EventEmitter;
  let port: number;

  beforeEach(async () => {
    // Fresh in-memory database
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    testDb.pragma("foreign_keys = ON");
    initSchema(testDb);

    // Set a known JWT secret
    process.env.JWT_SECRET = "test-ws-secret-key-for-testing";
    _resetSecretCache();

    // Create test users, groups, and tabs
    testDb.prepare("INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("tab-1", "Tab 1", "home", 0, 0, Date.now());
    testDb.prepare("INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("tab-2", "Tab 2", "settings", 1, 0, Date.now());
    testDb.prepare("INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("tab-3", "Tab 3", "data", 2, 0, Date.now());

    testDb.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("group-1", "Group 1", Date.now());
    testDb.prepare("INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)").run("group-1", "tab-1", "read");
    testDb.prepare("INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)").run("group-1", "tab-2", "write");

    testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("admin-1", "admin", "hash", "admin", null, Date.now());
    testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("user-1", "user1", "hash", "user", "group-1", Date.now());

    eventBus = new EventEmitter();
    httpServer = createServer();

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (httpServer.address() as any).port;

    wsServer = new WsServer(httpServer, createMockRegistry(), eventBus, [
      { eventName: "test-event", messageType: "test" },
    ]);
  });

  afterEach(async () => {
    wsServer.closeAll();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    testDb.close();
    delete process.env.JWT_SECRET;
    _resetSecretCache();
  });

  describe("Connection Authentication", () => {
    it("should reject connection with no token (close code 4001)", async () => {
      // Without a query-string token, the server waits for a first-message auth.
      // Sending a non-auth message triggers immediate rejection.
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await waitForOpen(ws);
      ws.send(JSON.stringify({ type: "not-auth" }));
      const { code, reason } = await waitForClose(ws);
      expect(code).toBe(4001);
      expect(reason).toBe("Authentication required");
    });

    it("should reject connection with invalid token (close code 4001)", async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=invalid-token`);
      const { code, reason } = await waitForClose(ws);
      expect(code).toBe(4001);
      expect(reason).toBe("Invalid token");
    });

    it("should reject connection with expired token (close code 4001)", async () => {
      const jwt = await import("jsonwebtoken");
      const expiredToken = jwt.default.sign(
        { userId: "user-1", username: "user1", role: "user", groupId: "group-1" },
        "test-ws-secret-key-for-testing",
        { algorithm: "HS256", expiresIn: "-1s" },
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${expiredToken}`);
      const { code, reason } = await waitForClose(ws);
      expect(code).toBe(4001);
      expect(reason).toBe("Invalid token");
    });

    it("should accept connection with valid token and send snapshot", async () => {
      const token = generateAccessToken({
        userId: "admin-1",
        username: "admin",
        role: "admin",
        groupId: null,
      });
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
      const collector = collectMessages(ws);
      await waitForOpen(ws);

      // Should receive initial snapshot
      const msgs = await collector.waitForCount(1);
      expect(msgs[0]).toEqual({ type: "snapshot", data: {} });
      expect(wsServer.clientCount).toBe(1);
      ws.close();
    });

    it("should close the connection when the token expires (close code 4003)", async () => {
      // Sign a token that is valid now but expires in ~1 second.
      const jwt = await import("jsonwebtoken");
      const shortToken = jwt.default.sign(
        { userId: "admin-1", username: "admin", role: "admin", groupId: null },
        "test-ws-secret-key-for-testing",
        { algorithm: "HS256", expiresIn: "1s" },
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${shortToken}`);
      await waitForOpen(ws);
      expect(wsServer.clientCount).toBe(1);

      // The server should close the socket at the token's expiry.
      const { code, reason } = await waitForClose(ws);
      expect(code).toBe(4003);
      expect(reason).toBe("Token expired");
    });

    it("should store authenticated client context", async () => {
      const token = generateAccessToken({
        userId: "user-1",
        username: "user1",
        role: "user",
        groupId: "group-1",
      });
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
      const collector = collectMessages(ws);
      await waitForOpen(ws);
      await collector.waitForCount(1); // consume snapshot

      expect(wsServer.clientCount).toBe(1);
      ws.close();
    });
  });

  describe("Event Filtering", () => {
    it("should send messages without tabId to all authenticated clients", async () => {
      // Connect admin
      const adminToken = generateAccessToken({
        userId: "admin-1",
        username: "admin",
        role: "admin",
        groupId: null,
      });
      const adminWs = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${adminToken}`);
      const adminCollector = collectMessages(adminWs);
      await waitForOpen(adminWs);
      await adminCollector.waitForCount(1); // snapshot

      // Connect regular user
      const userToken = generateAccessToken({
        userId: "user-1",
        username: "user1",
        role: "user",
        groupId: "group-1",
      });
      const userWs = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${userToken}`);
      const userCollector = collectMessages(userWs);
      await waitForOpen(userWs);
      await userCollector.waitForCount(1); // snapshot

      // Emit event without tabId
      eventBus.emit("test-event", { deviceId: "dev-1", state: { on: true } });

      // Both should receive (snapshot + event = 2 messages each)
      const adminMsgs = await adminCollector.waitForCount(2);
      const userMsgs = await userCollector.waitForCount(2);

      expect(adminMsgs[1]).toEqual({ type: "test", data: { deviceId: "dev-1", state: { on: true } } });
      expect(userMsgs[1]).toEqual({ type: "test", data: { deviceId: "dev-1", state: { on: true } } });

      adminWs.close();
      userWs.close();
    });

    it("should filter messages with tabId for non-admin users", async () => {
      // Connect regular user (has access to tab-1 and tab-2 only)
      const userToken = generateAccessToken({
        userId: "user-1",
        username: "user1",
        role: "user",
        groupId: "group-1",
      });
      const userWs = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${userToken}`);
      const userCollector = collectMessages(userWs);
      await waitForOpen(userWs);
      await userCollector.waitForCount(1); // snapshot

      // Emit event for tab-1 (user has access)
      eventBus.emit("test-event", { tabId: "tab-1", someData: "hello" });
      const msgs = await userCollector.waitForCount(2);
      expect(msgs[1]).toEqual({ type: "test", data: { tabId: "tab-1", someData: "hello" } });

      // Emit event for tab-3 (user does NOT have access)
      eventBus.emit("test-event", { tabId: "tab-3", someData: "secret" });

      // Wait a bit and verify no additional message arrived
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(userCollector.messages.length).toBe(2); // still only snapshot + tab-1 event

      userWs.close();
    });

    it("should send all messages to admin regardless of tabId", async () => {
      const adminToken = generateAccessToken({
        userId: "admin-1",
        username: "admin",
        role: "admin",
        groupId: null,
      });
      const adminWs = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${adminToken}`);
      const adminCollector = collectMessages(adminWs);
      await waitForOpen(adminWs);
      await adminCollector.waitForCount(1); // snapshot

      // Emit event for tab-3 — admin should receive it
      eventBus.emit("test-event", { tabId: "tab-3", someData: "admin-sees-all" });
      const msgs = await adminCollector.waitForCount(2);
      expect(msgs[1]).toEqual({ type: "test", data: { tabId: "tab-3", someData: "admin-sees-all" } });

      adminWs.close();
    });
  });
});
