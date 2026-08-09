// src/__integration__/command-history-api.integration.test.ts
// phase-1-runtime-foundations Task 9 — /api/commands observability surfaces.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventEmitter } from "node:events";
import request from "supertest";
import type { Express } from "express";
import { createTestDatabase, createTestApp, createAuthToken, cleanup } from "../__test-helpers__/index.js";

vi.mock("../db/database.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../db/database.js")>();
  return { ...original, getDatabase: () => testDb };
});

let testDb: DatabaseType;

vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn() }),
  },
}));

function insertMqttDevice(db: DatabaseType, id: string): void {
  db.prepare(
    "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen, topic, command_topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, id, "switch", '["on/off"]', "{}", "mqtt", Date.now(), `${id}/state`, `${id}/set`);
}

/** Issue a device action, which durably records a command (regardless of outcome). */
async function seedCommand(app: Express, token: string, deviceId: string): Promise<void> {
  await request(app)
    .post(`/api/devices/${deviceId}/action`)
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "toggle" });
}

describe("Command history API", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let app: Express;

  beforeEach(() => {
    db = createTestDatabase();
    testDb = db;
    insertMqttDevice(db, "relay-1");
    insertMqttDevice(db, "relay-2");
    eventBus = new EventEmitter();
    app = createTestApp(db, eventBus);
  });

  afterEach(() => cleanup({ databases: [db] }));

  it("lists recorded commands newest-first and filters by device", async () => {
    const token = createAuthToken();
    await seedCommand(app, token, "relay-1");
    await seedCommand(app, token, "relay-2");

    const all = await request(app).get("/api/commands").set("Authorization", `Bearer ${token}`).expect(200);
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.length).toBe(2);
    expect(all.body.every((c: { commandId?: string }) => typeof c.commandId === "string")).toBe(true);
    // Newest first — relay-2 was recorded last.
    expect(all.body[0].targetDeviceId).toBe("relay-2");

    const filtered = await request(app)
      .get("/api/commands?deviceId=relay-1")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(filtered.body).toHaveLength(1);
    expect(filtered.body[0].targetDeviceId).toBe("relay-1");
  });

  it("clamps the limit to the maximum", async () => {
    const token = createAuthToken();
    await seedCommand(app, token, "relay-1");
    const res = await request(app)
      .get("/api/commands?limit=99999")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.length).toBeLessThanOrEqual(200);
  });

  it("returns a single command with its transition timeline", async () => {
    const token = createAuthToken();
    await seedCommand(app, token, "relay-1");

    const list = await request(app).get("/api/commands").set("Authorization", `Bearer ${token}`).expect(200);
    const id = list.body[0].commandId as string;
    expect(id).toBeDefined();

    const res = await request(app)
      .get(`/api/commands/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.command.commandId).toBe(id);
    expect(Array.isArray(res.body.transitions)).toBe(true);
    // At least REQUESTED was recorded.
    expect(res.body.transitions[0].toState).toBe("REQUESTED");
  });

  it("returns 404 for an unknown command id", async () => {
    const token = createAuthToken();
    await request(app).get("/api/commands/ghost").set("Authorization", `Bearer ${token}`).expect(404);
  });

  it("denies a non-admin (403)", async () => {
    const token = createAuthToken({ role: "user", groupId: null, userId: "u2", username: "plain" });
    await request(app).get("/api/commands").set("Authorization", `Bearer ${token}`).expect(403);
  });
});
