// src/websocket/ws-server.branches.test.ts — Additional tests for uncovered WsServer branches

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

const { WsServer } = await import("./ws-server.js");
const { generateAccessToken, _resetSecretCache } = await import("../auth/token-service.js");

function createMockRegistry() {
  return { getAll: () => [] } as any;
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
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

function collectMessages(ws: WebSocket) {
  const messages: unknown[] = [];
  ws.on("message", (data) => { messages.push(JSON.parse(data.toString())); });
  return {
    messages,
    waitForCount: (count: number, timeoutMs = 3000) =>
      new Promise<unknown[]>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (messages.length >= count) { resolve(messages.slice(0, count)); return; }
          if (Date.now() - start > timeoutMs) { reject(new Error(`Timed out waiting for ${count} messages, got ${messages.length}`)); return; }
          setTimeout(check, 10);
        };
        check();
      }),
  };
}

describe("WsServer — branch coverage", () => {
  let httpServer: Server;
  let wsServer: InstanceType<typeof WsServer>;
  let eventBus: EventEmitter;
  let port: number;

  beforeEach(async () => {
    testDb = new Database(":memory:");
    testDb.pragma("journal_mode = WAL");
    testDb.pragma("foreign_keys = ON");
    initSchema(testDb);

    process.env.JWT_SECRET = "test-ws-branch-secret";
    _resetSecretCache();

    testDb.prepare("INSERT INTO tabs (id, name, icon, \"order\", pinned, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("tab-1", "Tab 1", "home", 0, 0, Date.now());
    testDb.prepare("INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)").run("group-1", "Group 1", Date.now());
    testDb.prepare("INSERT INTO group_tab_assignments (group_id, tab_id, permission) VALUES (?, ?, ?)").run("group-1", "tab-1", "read");
    testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("admin-1", "admin", "hash", "admin", null, Date.now());
    testDb.prepare("INSERT INTO users (id, username, password_hash, role, group_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("user-1", "user1", "hash", "user", "group-1", Date.now());

    eventBus = new EventEmitter();
    httpServer = createServer();
    await new Promise<void>((resolve) => { httpServer.listen(0, "127.0.0.1", () => resolve()); });
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

  it("handles WebSocket error event on client", async () => {
    const token = generateAccessToken({
      userId: "admin-1",
      username: "admin",
      role: "admin",
      groupId: null,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await waitForOpen(ws);
    expect(wsServer.clientCount).toBe(1);

    // Simulate an error by terminating the underlying socket abruptly
    ws.terminate();

    // Wait for the server to clean up
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(wsServer.clientCount).toBe(0);
  });

  it("broadcast skips clients that have closed (readyState check)", async () => {
    // Connect two clients
    const token = generateAccessToken({
      userId: "admin-1",
      username: "admin",
      role: "admin",
      groupId: null,
    });
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const collector1 = collectMessages(ws1);
    const collector2 = collectMessages(ws2);
    await waitForOpen(ws1);
    await waitForOpen(ws2);
    await collector1.waitForCount(1); // snapshot
    await collector2.waitForCount(1); // snapshot

    // Terminate ws1 abruptly — sets its readyState to CLOSED immediately
    ws1.terminate();
    // Wait for server to notice the close
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Broadcast event — ws2 should receive it, ws1 should not (already terminated)
    eventBus.emit("test-event", { foo: "bar" });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // ws2 should have received snapshot + event = 2 messages
    expect(collector2.messages.length).toBe(2);
    expect((collector2.messages[1] as any).type).toBe("test");

    ws2.close();
  });

  it("correctly handles short-lived token that expires while connected", async () => {
    // Token expires in ~500ms - server should auto-close
    const jwt = await import("jsonwebtoken");
    const shortToken = jwt.default.sign(
      { userId: "admin-1", username: "admin", role: "admin", groupId: null },
      "test-ws-branch-secret",
      { algorithm: "HS256", expiresIn: "1s" },
    );

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${shortToken}`);
    await waitForOpen(ws);
    expect(wsServer.clientCount).toBe(1);

    const { code } = await waitForClose(ws);
    expect(code).toBe(4003);
  }, 10000);

  it("emits WS_CLIENT_CONNECT and WS_CLIENT_DISCONNECT events", async () => {
    const connectEvents: unknown[] = [];
    const disconnectEvents: unknown[] = [];
    eventBus.on("ws:client-connect", (data) => connectEvents.push(data));
    eventBus.on("ws:client-disconnect", (data) => disconnectEvents.push(data));

    const token = generateAccessToken({
      userId: "admin-1",
      username: "admin",
      role: "admin",
      groupId: null,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await waitForOpen(ws);

    expect(connectEvents.length).toBe(1);

    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(disconnectEvents.length).toBe(1);
  });
});
