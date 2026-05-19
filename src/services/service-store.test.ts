// src/services/service-store.test.ts — Unit tests for ServiceStore persistence

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase } from "../__test-helpers__/index.js";
import { ServiceStore } from "./service-store.js";
import type { Database as DatabaseType } from "better-sqlite3";
import type { ServiceRecord } from "./service.interface.js";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("ServiceStore", () => {
  let db: DatabaseType;
  let store: ServiceStore;

  beforeEach(() => {
    db = createTestDatabase();
    store = new ServiceStore(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeRecord(overrides?: Partial<ServiceRecord>): ServiceRecord {
    return {
      id: "svc-1",
      serviceType: "cron",
      enabled: true,
      config: { schedules: "[]" },
      createdAt: 1000,
      updatedAt: 2000,
      ...overrides,
    };
  }

  describe("save", () => {
    it("inserts a new service record", () => {
      store.save(makeRecord());
      const records = store.loadAll();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe("svc-1");
      expect(records[0].serviceType).toBe("cron");
      expect(records[0].enabled).toBe(true);
      expect(records[0].config).toEqual({ schedules: "[]" });
    });

    it("updates an existing record (upsert)", () => {
      store.save(makeRecord());
      store.save(makeRecord({ config: { schedules: '[{"name":"test"}]' }, updatedAt: 3000 }));

      const records = store.loadAll();
      expect(records).toHaveLength(1);
      expect(records[0].config).toEqual({ schedules: '[{"name":"test"}]' });
      expect(records[0].updatedAt).toBe(3000);
    });

    it("handles complex config objects", () => {
      store.save(makeRecord({
        config: { nested: { deep: true }, array: [1, 2, 3] },
      }));
      const records = store.loadAll();
      expect(records[0].config).toEqual({ nested: { deep: true }, array: [1, 2, 3] });
    });
  });

  describe("disable", () => {
    it("marks a service as disabled", () => {
      store.save(makeRecord());
      store.disable("svc-1");

      const all = store.loadAll();
      expect(all[0].enabled).toBe(false);
    });

    it("preserves config when disabling", () => {
      store.save(makeRecord({ config: { key: "value" } }));
      store.disable("svc-1");

      const all = store.loadAll();
      expect(all[0].config).toEqual({ key: "value" });
    });
  });

  describe("loadEnabled", () => {
    it("returns only enabled records", () => {
      store.save(makeRecord({ id: "svc-1", enabled: true }));
      store.save(makeRecord({ id: "svc-2", enabled: false }));
      store.save(makeRecord({ id: "svc-3", enabled: true }));

      const enabled = store.loadEnabled();
      expect(enabled).toHaveLength(2);
      expect(enabled.map((r) => r.id).sort()).toEqual(["svc-1", "svc-3"]);
    });

    it("returns empty array when no enabled records exist", () => {
      store.save(makeRecord({ enabled: false }));
      expect(store.loadEnabled()).toEqual([]);
    });
  });

  describe("loadAll", () => {
    it("returns all records regardless of enabled state", () => {
      store.save(makeRecord({ id: "svc-1", enabled: true }));
      store.save(makeRecord({ id: "svc-2", enabled: false }));

      const all = store.loadAll();
      expect(all).toHaveLength(2);
    });

    it("returns empty array when no records exist", () => {
      expect(store.loadAll()).toEqual([]);
    });

    it("skips records with malformed JSON config", () => {
      // Insert a record with invalid JSON directly
      db.prepare(
        `INSERT INTO services (id, service_type, enabled, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run("bad-1", "cron", 1, "not-valid-json{", 1000, 2000);

      store.save(makeRecord({ id: "good-1" }));

      const all = store.loadAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("good-1");
    });
  });
});
