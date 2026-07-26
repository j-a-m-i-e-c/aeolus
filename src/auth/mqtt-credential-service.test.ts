// src/auth/mqtt-credential-service.test.ts — Unit tests for MQTT credential service

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock child_process so the reloader never shells out during tests.
vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
}));

// Mock fs to prevent file system writes
vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ""),
    renameSync: vi.fn(),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => ""),
  renameSync: vi.fn(),
}));

// Import after mocks
const {
  sanitizeUsername,
  getPasswordFilePath,
  createCredential,
  listCredentials,
  deleteCredential,
  ensureBackendCredential,
  getDeviceCredentialLines,
  writePasswordFile,
  regeneratePasswordFile,
} = await import("./mqtt-credential-service.js");

beforeEach(() => {
  // Keep PBKDF2 cheap so the suite stays fast; the format is unaffected.
  process.env.MQTT_PBKDF2_ITERATIONS = "2";
  testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  initSchema(testDb);
  vi.clearAllMocks();
});

afterEach(() => {
  testDb.close();
  delete process.env.MQTT_PBKDF2_ITERATIONS;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("mqtt-credential-service", () => {
  describe("sanitizeUsername", () => {
    it("converts device name to mqtt- prefixed lowercase", () => {
      expect(sanitizeUsername("My Sensor")).toBe("mqtt-my-sensor");
    });

    it("replaces special characters with hyphens", () => {
      expect(sanitizeUsername("sensor@home#1")).toBe("mqtt-sensor-home-1");
    });

    it("collapses multiple hyphens", () => {
      expect(sanitizeUsername("sensor---test")).toBe("mqtt-sensor-test");
    });

    it("trims leading/trailing hyphens after sanitization", () => {
      expect(sanitizeUsername("--sensor--")).toBe("mqtt-sensor");
    });

    it("handles already clean names", () => {
      expect(sanitizeUsername("temperature-1")).toBe("mqtt-temperature-1");
    });
  });

  describe("getPasswordFilePath", () => {
    it("returns env var path when MQTT_PASSWORD_FILE is set", () => {
      const original = process.env.MQTT_PASSWORD_FILE;
      process.env.MQTT_PASSWORD_FILE = "/custom/path/password_file";
      expect(getPasswordFilePath()).toBe("/custom/path/password_file");
      if (original) process.env.MQTT_PASSWORD_FILE = original;
      else delete process.env.MQTT_PASSWORD_FILE;
    });

    it("returns default path when env var is not set", () => {
      const original = process.env.MQTT_PASSWORD_FILE;
      delete process.env.MQTT_PASSWORD_FILE;
      const path = getPasswordFilePath();
      expect(path).toContain("mosquitto");
      expect(path).toContain("password_file");
      if (original) process.env.MQTT_PASSWORD_FILE = original;
    });
  });

  describe("createCredential", () => {
    it("creates a credential with generated username and password", async () => {
      const cred = await createCredential("Living Room Sensor");
      expect(cred.id).toBeDefined();
      expect(cred.deviceName).toBe("Living Room Sensor");
      expect(cred.username).toBe("mqtt-living-room-sensor");
      expect(cred.password).toBeDefined();
      expect(cred.password.length).toBeGreaterThan(10);
    });

    it("throws ConflictError when username already exists", async () => {
      await createCredential("sensor-1");
      await expect(createCredential("sensor-1")).rejects.toThrow("already exists");
    });

    it("stores credential in database", async () => {
      await createCredential("test-device");
      const list = listCredentials();
      expect(list).toHaveLength(1);
      expect(list[0].deviceName).toBe("test-device");
      expect(list[0].username).toBe("mqtt-test-device");
    });
  });

  describe("listCredentials", () => {
    it("returns empty array when no credentials exist", () => {
      expect(listCredentials()).toEqual([]);
    });

    it("returns credentials without passwords", async () => {
      await createCredential("sensor-a");
      await createCredential("sensor-b");

      const list = listCredentials();
      expect(list).toHaveLength(2);
      expect((list[0] as any).password).toBeUndefined();
      expect((list[0] as any).password_hash).toBeUndefined();
      expect(list[0].deviceName).toBeDefined();
      expect(list[0].username).toBeDefined();
      expect(list[0].createdAt).toBeGreaterThan(0);
    });

    it("returns credentials ordered by createdAt DESC", async () => {
      await createCredential("first");
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await createCredential("second");

      const list = listCredentials();
      expect(list[0].deviceName).toBe("second");
      expect(list[1].deviceName).toBe("first");
    });
  });

  describe("deleteCredential", () => {
    it("deletes an existing credential", async () => {
      const cred = await createCredential("to-delete");
      deleteCredential(cred.id);
      expect(listCredentials()).toHaveLength(0);
    });

    it("throws NotFoundError when credential does not exist", () => {
      expect(() => deleteCredential("nonexistent-id")).toThrow("not found");
    });
  });

  describe("ensureBackendCredential", () => {
    it("creates backend credential on first call", async () => {
      const cred = await ensureBackendCredential();
      expect(cred.deviceName).toBe("aeolus-backend");
      expect(cred.username).toBe("aeolus-backend");
      expect(cred.password).toBeDefined();
    });

    it("regenerates password on subsequent calls", async () => {
      const first = await ensureBackendCredential();
      const second = await ensureBackendCredential();
      expect(second.id).toBe(first.id);
      expect(second.password).not.toBe(first.password);
    });
  });

  describe("credential hashing (Mosquitto $7$ format)", () => {
    it("stores a Mosquitto $7$ hash (never bcrypt) in the database", async () => {
      const cred = await createCredential("hash-device");
      const row = testDb
        .prepare("SELECT password_hash FROM mqtt_credentials WHERE id = ?")
        .get(cred.id) as { password_hash: string };
      expect(row.password_hash.startsWith("$7$")).toBe(true);
      expect(row.password_hash.startsWith("$2b$")).toBe(false);
    });
  });

  describe("getDeviceCredentialLines", () => {
    it("returns username:$7$ lines for device credentials", async () => {
      await createCredential("sensor-x");
      const lines = getDeviceCredentialLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].startsWith("mqtt-sensor-x:$7$")).toBe(true);
    });

    it("excludes the backend credential", async () => {
      await ensureBackendCredential();
      await createCredential("sensor-y");
      const lines = getDeviceCredentialLines();
      expect(lines.some((l) => l.startsWith("aeolus-backend:"))).toBe(false);
      expect(lines.some((l) => l.startsWith("mqtt-sensor-y:"))).toBe(true);
    });
  });

  describe("writePasswordFile", () => {
    it("writes atomically (temp file then rename)", async () => {
      const fsModule = await import("node:fs");
      writePasswordFile(["mqtt-a:$7$1$salt$hash"]);
      expect(fsModule.default.mkdirSync).toHaveBeenCalled();
      expect(fsModule.default.writeFileSync).toHaveBeenCalled();
      expect(fsModule.default.renameSync).toHaveBeenCalled();
    });
  });

  describe("regeneratePasswordFile", () => {
    it("writes the password file from stored credentials", async () => {
      const fsModule = await import("node:fs");
      await createCredential("test-device");
      vi.mocked(fsModule.default.writeFileSync).mockClear();

      regeneratePasswordFile();

      expect(fsModule.default.writeFileSync).toHaveBeenCalled();
      expect(fsModule.default.mkdirSync).toHaveBeenCalled();
    });

    it("does not throw when the broker reload is unavailable", async () => {
      await createCredential("reload-test");
      // Reload strategy defaults to 'none' (no-op); must never throw.
      expect(() => regeneratePasswordFile()).not.toThrow();
    });
  });
});
