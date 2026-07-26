// Feature: mqtt-device-provisioning, Property 7: Credential secrecy in list responses
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, vi, beforeEach, afterEach } from "vitest";
import { test, fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

// Mock child_process to prevent actual Docker calls
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => "mocked-user:$7$101$mockedhash"),
}));

// Mock logger
vi.mock("../logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the database module
vi.mock("../db/database.js", () => ({
  getDatabase: vi.fn(),
}));

import { getDatabase } from "../db/database.js";
import { createCredential, listCredentials } from "./mqtt-credential-service.js";

const mockedGetDatabase = vi.mocked(getDatabase);

// Arbitrary count of credentials to create (2-6)
const arbitraryCredentialCount = fc.integer({ min: 2, max: 6 });

function createTestDb(): DatabaseType {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS mqtt_credentials (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

describe("Feature: mqtt-device-provisioning — Property 7: Credential secrecy in list responses", () => {
  beforeEach(() => {
    // Cheap PBKDF2 + a throwaway password-file path keep the property run fast
    // and side-effect free without changing the credential format under test.
    process.env.MQTT_PBKDF2_ITERATIONS = "2";
    process.env.MQTT_PASSWORD_FILE = path.join(os.tmpdir(), `aeolus-pwfile-${crypto.randomUUID()}`);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MQTT_PBKDF2_ITERATIONS;
    delete process.env.MQTT_PASSWORD_FILE;
  });

  // Property 7: Credential secrecy in list responses
  // **Validates: Requirements 4.4, 4.7**
  test.prop([arbitraryCredentialCount], { numRuns: 100 })(
    "Property 7: listCredentials never exposes password or passwordHash; createCredential returns password exactly once",
    async (count) => {
      // Fresh database per iteration to avoid username conflicts
      const testDb = createTestDb();
      mockedGetDatabase.mockReturnValue(testDb);

      // Create credentials with unique device names per iteration
      const createdCredentials = [];
      for (let i = 0; i < count; i++) {
        const deviceName = `device-${crypto.randomUUID().slice(0, 8)}`;
        const credential = await createCredential(deviceName);
        createdCredentials.push(credential);

        // Assert: createCredential returns password field exactly once
        expect(credential).toHaveProperty("password");
        expect(typeof credential.password).toBe("string");
        expect(credential.password.length).toBeGreaterThan(0);
      }

      // List all credentials
      const listed = listCredentials();

      // Assert: list has the same count as created
      expect(listed.length).toBe(count);

      // Assert: each item in the list has required fields
      for (const item of listed) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("deviceName");
        expect(item).toHaveProperty("username");
        expect(item).toHaveProperty("createdAt");

        // Assert: each item does NOT have secret fields
        expect(item).not.toHaveProperty("password");
        expect(item).not.toHaveProperty("passwordHash");
        expect(item).not.toHaveProperty("password_hash");
      }

      testDb.close();
    }
  );
});
