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
const { createDeviceExposureResolver } = await import("../auth/device-exposure-resolver.js");

// Minimal DeviceRegistry mock
function createMockRegistry() {
  return {
    getAll: () => [],
  } as any;
}

// Minimal Device_Exposure_Resolver mock (no devices → empty exposure)
function createMockDeviceExposureResolver() {
  return {
    getExposingTabs: () => [],
    getExposingTabsBatch: (ids: string[]) => new Map(ids.map((id) => [id, [] as string[]])),
    getExposedDeviceIds: () => [],
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
      // No visibility resolver → unscoped → admin-only (fail-closed default).
      { eventName: "unscoped-event", messageType: "unscoped" },
      // Explicitly public → all authenticated clients.
      { eventName: "public-event", messageType: "public", visibility: () => ({ visibility: "public" }) },
      // Tab-scoped → derived from the payload's `tabs` array (server-side here).
      {
        eventName: "scoped-event",
        messageType: "scoped",
        visibility: (data) => ({
          visibility: "tabs",
          tabIds: Array.isArray((data as { tabs?: unknown })?.tabs)
            ? ((data as { tabs: string[] }).tabs)
            : [],
        }),
      },
    ], createMockDeviceExposureResolver());
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
      // Sign a token that is valid now but expires shortly.
      //
      // `exp` only has whole-second resolution, so `expiresIn: "1s"` produces a
      // real TTL of `1000 - (Date.now() % 1000)` ms — anywhere from 1ms to 1s
      // depending on where in the wall-clock second the test happens to run.
      // At the low end the server closed the socket before the assertions below
      // could observe it, which made this test fail intermittently under the
      // full suite. Pinning `exp` to two seconds past the current second
      // boundary keeps the wait short while guaranteeing at least ~1s of open
      // connection to assert against.
      const jwt = await import("jsonwebtoken");
      const nowSeconds = Math.floor(Date.now() / 1000);
      const shortToken = jwt.default.sign(
        {
          userId: "admin-1",
          username: "admin",
          role: "admin",
          groupId: null,
          iat: nowSeconds,
          exp: nowSeconds + 2,
        },
        "test-ws-secret-key-for-testing",
        { algorithm: "HS256" },
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${shortToken}`);
      // Subscribe to `close` before awaiting `open` so an early expiry cannot
      // fire in the gap between the two and strand the promise.
      const closed = waitForClose(ws);
      await waitForOpen(ws);
      expect(wsServer.clientCount).toBe(1);

      // The server should close the socket at the token's expiry.
      const { code, reason } = await closed;
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

  describe("Event Filtering (fail-closed)", () => {
    it("does NOT deliver unscoped events to non-admins, but does to admins", async () => {
      // "unscoped-event" has no visibility resolver → admin-only by default.
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

      // Unscoped event: no tabId decoration anywhere. Fail-closed => admin only.
      eventBus.emit("unscoped-event", { deviceId: "dev-1", state: { on: true } });

      const adminMsgs = await adminCollector.waitForCount(2);
      expect(adminMsgs[1]).toEqual({ type: "unscoped", data: { deviceId: "dev-1", state: { on: true } } });

      // Give the non-admin ample time; it must NOT receive the unscoped event.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(userCollector.messages.length).toBe(1); // snapshot only

      adminWs.close();
      userWs.close();
    });

    it("delivers public events to every authenticated client", async () => {
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

      eventBus.emit("public-event", { hello: "world" });
      const msgs = await userCollector.waitForCount(2);
      expect(msgs[1]).toEqual({ type: "public", data: { hello: "world" } });

      userWs.close();
    });

    it("delivers a tab-scoped event only to clients with access to a listed tab", async () => {
      // user-1 (group-1) can access tab-1 and tab-2, but NOT tab-3.
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

      // Scoped to tab-1 (accessible) — should arrive.
      eventBus.emit("scoped-event", { resource: "r1", tabs: ["tab-1"] });
      const msgs = await userCollector.waitForCount(2);
      expect(msgs[1]).toEqual({ type: "scoped", data: { resource: "r1", tabs: ["tab-1"] } });

      // Scoped to tab-3 (not accessible) — must NOT arrive.
      eventBus.emit("scoped-event", { resource: "r2", tabs: ["tab-3"] });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(userCollector.messages.length).toBe(2);

      // Empty scope — reaches admins only, so this non-admin must NOT get it.
      eventBus.emit("scoped-event", { resource: "r3", tabs: [] });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(userCollector.messages.length).toBe(2);

      userWs.close();
    });

    it("delivers every event to admins regardless of scope", async () => {
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

      // Scoped to a tab the admin has no explicit group assignment for — still delivered.
      eventBus.emit("scoped-event", { resource: "r4", tabs: ["tab-3"] });
      const msgs = await adminCollector.waitForCount(2);
      expect(msgs[1]).toEqual({ type: "scoped", data: { resource: "r4", tabs: ["tab-3"] } });

      adminWs.close();
    });
  });
});

// ─── Initial snapshot is scoped to the client's observable devices ────────────

describe("WsServer initial snapshot scoping", () => {
  let httpServer: Server;
  let wsServer: InstanceType<typeof WsServer>;
  let eventBus: EventEmitter;
  let port: number;

  // dev-hue is exposed by a hue-control pane on tab-1 (user-1 has read on tab-1);
  // dev-kasa is exposed by a kasa-control pane on tab-3 (user-1 has NO access).
  const devices = [
    { id: "dev-hue", name: "Hue", type: "light", capabilities: [], state: {}, integration: "hue", lastSeen: 0 },
    { id: "dev-kasa", name: "Kasa", type: "plug", capabilities: [], state: {}, integration: "kasa", lastSeen: 0 },
  ];

  beforeEach(async () => {
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    testDb.pragma("foreign_keys = ON");
    initSchema(testDb);

    process.env.JWT_SECRET = "test-ws-snapshot-secret";
    _resetSecretCache();

    const now = Date.now();
    const insertTab = testDb.prepare('INSERT INTO tabs (id, name, icon, "order", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insertTab.run("tab-1", "Tab 1", "home", 0, 0, now);
    insertTab.run("tab-3", "Tab 3", "data", 1, 0, now);
    testDb.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("group-1", "Group 1", now);
    testDb.prepare("INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)").run("group-1", "tab-1", "read");
    testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("admin-1", "admin", "hash", "admin", null, now);
    testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("user-1", "user1", "hash", "user", "group-1", now);
    const insertPane = testDb.prepare("INSERT INTO panes (id, tab_id, pane_type, config, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insertPane.run("pane-1", "tab-1", "hue-control", "{}", 0, 0, 6, 4, now);
    insertPane.run("pane-3", "tab-3", "kasa-control", "{}", 0, 0, 6, 4, now);

    const registry = {
      getAll: () => devices,
      getById: (id: string) => devices.find((d) => d.id === id),
    } as never;
    const exposureResolver = createDeviceExposureResolver(registry, testDb);

    eventBus = new EventEmitter();
    httpServer = createServer();
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
    port = (httpServer.address() as any).port;
    wsServer = new WsServer(httpServer, registry, eventBus, [], exposureResolver);
  });

  afterEach(async () => {
    wsServer.closeAll();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    testDb.close();
    delete process.env.JWT_SECRET;
    _resetSecretCache();
  });

  it("sends only the devices a non-admin may observe", async () => {
    const token = generateAccessToken({ userId: "user-1", username: "user1", role: "user", groupId: "group-1" });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const collector = collectMessages(ws);
    await waitForOpen(ws);

    const msgs = await collector.waitForCount(1);
    const snapshot = (msgs[0] as { type: string; data: Record<string, unknown> });
    expect(snapshot.type).toBe("snapshot");
    expect(Object.keys(snapshot.data)).toEqual(["dev-hue"]);
    ws.close();
  });

  it("sends every device to an admin", async () => {
    const token = generateAccessToken({ userId: "admin-1", username: "admin", role: "admin", groupId: null });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const collector = collectMessages(ws);
    await waitForOpen(ws);

    const msgs = await collector.waitForCount(1);
    const snapshot = (msgs[0] as { type: string; data: Record<string, unknown> });
    expect(Object.keys(snapshot.data).sort()).toEqual(["dev-hue", "dev-kasa"]);
    ws.close();
  });
});
