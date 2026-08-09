// src/__integration__/mqtt-command-profile.integration.test.ts
// phase-1-runtime-foundations Task 6 — MQTT command profile REST API.

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

function insertDevice(db: DatabaseType, id: string, integration: string): void {
  db.prepare(
    "INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen, topic, command_topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, id, "switch", '["on/off"]', "{}", integration, Date.now(), `${id}/state`, `${id}/set`);
}

describe("MQTT command profile API", () => {
  let db: DatabaseType;
  let eventBus: EventEmitter;
  let app: Express;
  const adminToken = () => createAuthToken();
  const userToken = () => createAuthToken({ role: "user", groupId: null, userId: "u2", username: "plain" });

  beforeEach(() => {
    db = createTestDatabase();
    testDb = db;
    insertDevice(db, "esp32-relay", "mqtt");
    insertDevice(db, "hue-1", "hue");
    eventBus = new EventEmitter();
    app = createTestApp(db, eventBus);
  });

  afterEach(() => cleanup({ databases: [db] }));

  it("returns null before any profile is set", async () => {
    const res = await request(app)
      .get("/api/devices/esp32-relay/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(200);
    expect(res.body).toBeNull();
  });

  it("creates, reads back, and persists a profile across a reload", async () => {
    const profile = {
      qos: 1,
      acknowledgement: { supported: true, responseTopic: "aeolus/acks/esp32-relay", ackIndicatorValues: ["ok"] },
    };
    const put = await request(app)
      .put("/api/devices/esp32-relay/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send(profile)
      .expect(200);
    expect(put.body).toEqual(profile);

    const get = await request(app)
      .get("/api/devices/esp32-relay/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(200);
    expect(get.body).toEqual(profile);

    // Restart persistence: a fresh app over the same DB loads the profile.
    const app2 = createTestApp(db, eventBus);
    const afterRestart = await request(app2)
      .get("/api/devices/esp32-relay/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(200);
    expect(afterRestart.body).toEqual(profile);
  });

  it("rejects an invalid profile (bad qos) with 400", async () => {
    await request(app)
      .put("/api/devices/esp32-relay/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ qos: 5 })
      .expect(400);
  });

  it("rejects a wildcard response topic with 400", async () => {
    await request(app)
      .put("/api/devices/esp32-relay/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ acknowledgement: { supported: true, responseTopic: "aeolus/acks/+" } })
      .expect(400);
  });

  it("rejects a profile write for a non-MQTT device with 400", async () => {
    await request(app)
      .put("/api/devices/hue-1/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ qos: 1 })
      .expect(400);
  });

  it("returns 404 for an unknown device", async () => {
    await request(app)
      .get("/api/devices/ghost/mqtt-command-profile")
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(404);
  });

  it("denies a non-admin without write permission (403)", async () => {
    await request(app)
      .put("/api/devices/esp32-relay/mqtt-command-profile")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ qos: 1 })
      .expect(403);
  });
});
