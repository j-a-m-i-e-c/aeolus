// Feature: mqtt-device-provisioning — Property tests for MqttProvisioningService
// Properties 1, 2, 5, 6, 8, 9, 10, 11, 12

import { describe, expect, vi, beforeEach, afterEach } from "vitest";
import { test, fc } from "@fast-check/vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock child_process to prevent Docker calls
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

// Mock the credential service. writePasswordFile receives the fully-composed
// Mosquitto password-file lines the provisioning service produced.
const mockWritePasswordFile = vi.fn();
const mockGetPasswordFilePath = vi.fn(() => "/mock/mosquitto/password_file");
const mockGetDeviceCredentialLines = vi.fn(() => [] as string[]);
const mockCreateCredential = vi.fn();
const mockDeleteCredential = vi.fn();
const mockListCredentials = vi.fn(() => []);

vi.mock("../auth/mqtt-credential-service.js", () => ({
  writePasswordFile: (...args: unknown[]) => mockWritePasswordFile(...args),
  getPasswordFilePath: () => mockGetPasswordFilePath(),
  getDeviceCredentialLines: () => mockGetDeviceCredentialLines(),
  createCredential: (...args: unknown[]) => mockCreateCredential(...args),
  deleteCredential: (...args: unknown[]) => mockDeleteCredential(...args),
  listCredentials: () => mockListCredentials(),
  BACKEND_USERNAME: "aeolus-backend",
  SETTING_BACKEND_PASSWORD: "mqtt_backend_password",
}));

import { getDatabase } from "../db/database.js";
import { MqttProvisioningService, type SecurityLevel } from "./mqtt-provisioning-service.js";
import { BadRequestError, ConflictError } from "../api/middleware/error-handler.js";
import type { MosquittoConfigWriter } from "./mosquitto-config-writer.js";
import type { MosquittoReloader } from "./mosquitto-reloader.js";
import type { MqttService } from "./mqtt-service.js";

const mockedGetDatabase = vi.mocked(getDatabase);

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestDb(): DatabaseType {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mqtt_credentials (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function createMockConfigWriter(): MosquittoConfigWriter {
  return {
    writeOpenConfig: vi.fn(),
    writeAuthenticatedConfig: vi.fn(),
  } as unknown as MosquittoConfigWriter;
}

function createMockReloader(): MosquittoReloader {
  return {
    reload: vi.fn().mockResolvedValue(true),
  } as unknown as MosquittoReloader;
}

function createMockMqttService(): MqttService {
  return {
    isConnected: vi.fn().mockReturnValue(true),
    reconnectWithCredentials: vi.fn().mockResolvedValue(undefined),
    setCredentials: vi.fn(),
  } as unknown as MqttService;
}

/** Flatten the last writePasswordFile call's lines into usernames. */
function lastWrittenUsernames(): string[] {
  const calls = mockWritePasswordFile.mock.calls;
  const lines = (calls[calls.length - 1]?.[0] ?? []) as string[];
  return lines.map((line) => line.split(":")[0]);
}

// ─── Generators ──────────────────────────────────────────────────────────────

const validLevels: SecurityLevel[] = ["open", "shared_password", "per_device"];

const arbitraryValidLevel = fc.constantFrom<SecurityLevel>(...validLevels);

// Generate strings that are NOT valid security levels
const arbitraryInvalidLevel = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !validLevels.includes(s as SecurityLevel));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Feature: mqtt-device-provisioning — MqttProvisioningService Property Tests", () => {
  let testDb: DatabaseType;
  let configWriter: MosquittoConfigWriter;
  let reloader: MosquittoReloader;
  let mqttService: MqttService;
  let service: MqttProvisioningService;

  beforeEach(() => {
    process.env.MQTT_PBKDF2_ITERATIONS = "2";
    testDb = createTestDb();
    mockedGetDatabase.mockReturnValue(testDb);
    configWriter = createMockConfigWriter();
    reloader = createMockReloader();
    mqttService = createMockMqttService();
    service = new MqttProvisioningService(mqttService, configWriter, reloader);
    vi.clearAllMocks();
    mockGetDeviceCredentialLines.mockReturnValue([]);
    mockedGetDatabase.mockReturnValue(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.MQTT_PBKDF2_ITERATIONS;
  });

  // ─── Property 1: Security level validation ─────────────────────────────────
  // **Validates: Requirements 1.1, 9.8**

  describe("Property 1: Security level validation", () => {
    test.prop([arbitraryInvalidLevel], { numRuns: 100 })(
      "rejects any string that is not open, shared_password, or per_device",
      async (invalidLevel) => {
        await expect(
          service.setSecurityLevel(invalidLevel as SecurityLevel),
        ).rejects.toThrow(BadRequestError);
      },
    );

    test.prop([arbitraryValidLevel], { numRuns: 100 })(
      "accepts valid security levels without throwing",
      async (level) => {
        // Should not throw — valid levels are accepted
        const status = await service.setSecurityLevel(level);
        expect(status).toBeDefined();
        expect(status.level).toBe(level);
      },
    );
  });

  // ─── Property 2: Security level persistence round-trip ─────────────────────
  // **Validates: Requirements 1.2, 10.1**

  describe("Property 2: Security level persistence round-trip", () => {
    test.prop([arbitraryValidLevel], { numRuns: 100 })(
      "after setSecurityLevel(level), getStatus().level returns the same value",
      async (level) => {
        await service.setSecurityLevel(level);
        const status = service.getStatus();
        expect(status.level).toBe(level);
      },
    );

    test.prop([arbitraryValidLevel], { numRuns: 100 })(
      "after setSecurityLevel(level), the DB system_settings row matches",
      async (level) => {
        await service.setSecurityLevel(level);
        const row = testDb
          .prepare("SELECT value FROM system_settings WHERE key = ?")
          .get("mqtt_security_level") as { value: string } | undefined;
        expect(row?.value).toBe(level);
      },
    );
  });

  // ─── Property 5: Password file entry invariant (simplified) ────────────────
  // **Validates: Requirements 4.3, 5.2, 5.5, 10.2**

  describe("Property 5: Password file entry invariant (simplified)", () => {
    test.prop([fc.constant("shared_password" as SecurityLevel)], { numRuns: 100 })(
      "shared_password mode writes exactly 2 password file lines (shared + backend)",
      async () => {
        mockWritePasswordFile.mockClear();
        await service.setSecurityLevel("shared_password");

        expect(mockWritePasswordFile).toHaveBeenCalled();
        const usernames = lastWrittenUsernames();
        expect(usernames).toHaveLength(2);
        expect(usernames).toContain("aeolus-shared");
        expect(usernames).toContain("aeolus-backend");
      },
    );

    test.prop([fc.constant("per_device" as SecurityLevel)], { numRuns: 100 })(
      "per_device mode writes exactly 1 password file line (backend only, no devices yet)",
      async () => {
        mockWritePasswordFile.mockClear();
        mockGetDeviceCredentialLines.mockReturnValue([]);
        await service.setSecurityLevel("per_device");

        expect(mockWritePasswordFile).toHaveBeenCalled();
        const usernames = lastWrittenUsernames();
        expect(usernames).toHaveLength(1);
        expect(usernames[0]).toBe("aeolus-backend");
      },
    );

    test.prop([fc.constant("per_device" as SecurityLevel)], { numRuns: 50 })(
      "per_device mode reinstates already-provisioned device credentials in the file",
      async () => {
        mockWritePasswordFile.mockClear();
        mockGetDeviceCredentialLines.mockReturnValue([
          "mqtt-existing:$7$2$salt$hash",
        ]);
        await service.setSecurityLevel("per_device");

        const usernames = lastWrittenUsernames();
        expect(usernames).toContain("aeolus-backend");
        expect(usernames).toContain("mqtt-existing");
      },
    );
  });

  // ─── Property 6: Backend credential presence in authenticated modes ────────
  // **Validates: Requirements 3.2, 4.8, 6.1**

  describe("Property 6: Backend credential presence in authenticated modes", () => {
    const authenticatedLevels = fc.constantFrom<SecurityLevel>("shared_password", "per_device");

    test.prop([authenticatedLevels], { numRuns: 100 })(
      "authenticated modes include aeolus-backend in the password file",
      async (level) => {
        mockWritePasswordFile.mockClear();
        await service.setSecurityLevel(level);

        expect(mockWritePasswordFile).toHaveBeenCalled();
        expect(lastWrittenUsernames()).toContain("aeolus-backend");
      },
    );

    test.prop([fc.constant("open" as SecurityLevel)], { numRuns: 100 })(
      "open mode does not write a password file",
      async () => {
        mockWritePasswordFile.mockClear();
        await service.setSecurityLevel("open");
        expect(mockWritePasswordFile).not.toHaveBeenCalled();
      },
    );
  });

  // ─── Property 8: Credential revocation removes from database and password file (simplified) ─
  // **Validates: Requirements 4.5**

  describe("Property 8: Credential revocation removes from database and password file (simplified)", () => {
    test.prop(
      [fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-z0-9-]+$/.test(s))],
      { numRuns: 100 },
    )(
      "revokeDeviceCredential calls deleteCredential with the correct ID",
      async (credentialId) => {
        // Set up per_device mode in DB so revocation is allowed
        testDb
          .prepare(
            "INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
          )
          .run("mqtt_security_level", "per_device");

        mockDeleteCredential.mockClear();
        await service.revokeDeviceCredential(credentialId);
        expect(mockDeleteCredential).toHaveBeenCalledWith(credentialId);
      },
    );
  });

  // ─── Property 9: Shared password regeneration produces a distinct value ────
  // **Validates: Requirements 3.5**

  describe("Property 9: Shared password regeneration produces a distinct value", () => {
    test.prop([fc.integer({ min: 1, max: 5 })], { numRuns: 100 })(
      "consecutive regenerations produce different passwords",
      async () => {
        // Set up shared_password mode
        await service.setSecurityLevel("shared_password");

        const result1 = await service.regenerateSharedPassword();
        const result2 = await service.regenerateSharedPassword();

        // Passwords should be different (crypto.randomBytes produces unique values)
        expect(result1.password).not.toBe(result2.password);
        expect(result1.username).toBe(result2.username); // Username stays the same
      },
    );
  });

  // ─── Property 10: Mode-mismatch operations return errors (service level) ──
  // **Validates: Requirements 9.7**

  describe("Property 10: Mode-mismatch operations return errors", () => {
    const nonPerDeviceLevels = fc.constantFrom<SecurityLevel>("open", "shared_password");
    const nonSharedLevels = fc.constantFrom<SecurityLevel>("open", "per_device");

    test.prop([nonPerDeviceLevels], { numRuns: 100 })(
      "createDeviceCredential throws ConflictError when not in per_device mode",
      async (level) => {
        await service.setSecurityLevel(level);
        await expect(
          service.createDeviceCredential("test-device"),
        ).rejects.toThrow(ConflictError);
      },
    );

    test.prop([nonSharedLevels], { numRuns: 100 })(
      "regenerateSharedPassword throws ConflictError when not in shared_password mode",
      async (level) => {
        await service.setSecurityLevel(level);
        await expect(service.regenerateSharedPassword()).rejects.toThrow(
          ConflictError,
        );
      },
    );
  });

  // ─── Property 11: Status endpoint reflects current state ───────────────────
  // **Validates: Requirements 1.4, 10.3**

  describe("Property 11: Status endpoint reflects current state", () => {
    test.prop([arbitraryValidLevel], { numRuns: 100 })(
      "getStatus().level matches the level that was set",
      async (level) => {
        await service.setSecurityLevel(level);
        const status = service.getStatus();
        expect(status.level).toBe(level);
      },
    );

    test.prop([fc.constant("shared_password" as SecurityLevel)], { numRuns: 100 })(
      "shared_password mode includes sharedCredential in status",
      async () => {
        await service.setSecurityLevel("shared_password");
        const status = service.getStatus();
        expect(status.sharedCredential).not.toBeNull();
        expect(status.sharedCredential?.username).toBe("aeolus-shared");
        expect(status.sharedCredential?.password).toBeDefined();
        expect(typeof status.sharedCredential?.password).toBe("string");
        expect(status.sharedCredential!.password.length).toBeGreaterThan(0);
      },
    );

    test.prop(
      [fc.constantFrom<SecurityLevel>("open", "per_device")],
      { numRuns: 100 },
    )(
      "open and per_device modes have null sharedCredential in status",
      async (level) => {
        await service.setSecurityLevel(level);
        const status = service.getStatus();
        expect(status.sharedCredential).toBeNull();
      },
    );
  });

  // ─── Property 12: Startup state reconstruction ─────────────────────────────
  // **Validates: Requirements 10.4, 10.5**

  describe("Property 12: Startup state reconstruction", () => {
    test.prop([arbitraryValidLevel], { numRuns: 100 })(
      "initialize() configures the system based on persisted level",
      async (level) => {
        // Persist level directly to DB (simulating a previous run)
        testDb
          .prepare(
            "INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
          )
          .run("mqtt_security_level", level);

        // For shared_password mode, also persist the shared credential
        if (level === "shared_password") {
          testDb
            .prepare(
              "INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
            )
            .run("mqtt_shared_username", "aeolus-shared");
          testDb
            .prepare(
              "INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
            )
            .run("mqtt_shared_password", "test-password-123");
        }

        // Clear mocks before initialize
        (configWriter.writeOpenConfig as ReturnType<typeof vi.fn>).mockClear();
        (configWriter.writeAuthenticatedConfig as ReturnType<typeof vi.fn>).mockClear();
        mockWritePasswordFile.mockClear();

        await service.initialize();

        if (level === "open") {
          expect(configWriter.writeOpenConfig).toHaveBeenCalled();
          expect(configWriter.writeAuthenticatedConfig).not.toHaveBeenCalled();
        } else {
          expect(configWriter.writeAuthenticatedConfig).toHaveBeenCalled();
          // Backend credential should be present in the written password file
          expect(mockWritePasswordFile).toHaveBeenCalled();
          expect(lastWrittenUsernames()).toContain("aeolus-backend");
        }
      },
    );
  });
});
