// src/mqtt/mqtt-provisioning-service.verification.test.ts
//
// Verifies that each provisioning operation confirms the broker actually
// enforces the change (via an injected BrokerVerifier) before reporting
// success, that verification failure surfaces BrokerNotConfirmedError without
// losing the written state, and that verification is skipped when disabled.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

vi.mock("../logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db/database.js", () => ({ getDatabase: vi.fn() }));

const mockWritePasswordFile = vi.fn();
const mockGetPasswordFilePath = vi.fn(() => "/mock/mosquitto/password_file");
const mockGetDeviceCredentialLines = vi.fn(() => [] as string[]);
const mockCreateCredential = vi.fn();
const mockDeleteCredential = vi.fn();
const mockListCredentials = vi.fn(() => [] as Array<{ id: string; username: string }>);

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
import { MqttProvisioningService } from "./mqtt-provisioning-service.js";
import { BrokerNotConfirmedError } from "../api/middleware/error-handler.js";
import type { MosquittoConfigWriter } from "./mosquitto-config-writer.js";
import type { MosquittoReloader } from "./mosquitto-reloader.js";
import type { MqttService } from "./mqtt-service.js";
import type { BrokerVerifier } from "./broker-verifier.js";

const mockedGetDatabase = vi.mocked(getDatabase);

function createTestDb(): DatabaseType {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mqtt_credentials (
      id TEXT PRIMARY KEY, device_name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function seedSetting(db: DatabaseType, key: string, value: string): void {
  db.prepare(
    "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

const mockConfigWriter = (): MosquittoConfigWriter =>
  ({ writeOpenConfig: vi.fn(), writeAuthenticatedConfig: vi.fn() }) as unknown as MosquittoConfigWriter;

const mockReloader = (): MosquittoReloader =>
  ({ reload: vi.fn().mockResolvedValue(true) }) as unknown as MosquittoReloader;

const mockMqttService = (): MqttService =>
  ({
    isConnected: vi.fn().mockReturnValue(true),
    reconnectWithCredentials: vi.fn().mockResolvedValue(undefined),
    setCredentials: vi.fn(),
  }) as unknown as MqttService;

/** A fake verifier whose probes all succeed by default; override per test. */
function fakeVerifier() {
  return {
    waitForAccepted: vi.fn().mockResolvedValue(true),
    waitForRejected: vi.fn().mockResolvedValue(true),
    probe: vi.fn(),
  } as unknown as BrokerVerifier & {
    waitForAccepted: ReturnType<typeof vi.fn>;
    waitForRejected: ReturnType<typeof vi.fn>;
  };
}

describe("MqttProvisioningService — broker verification", () => {
  let testDb: DatabaseType;
  let verifier: ReturnType<typeof fakeVerifier>;

  beforeEach(() => {
    process.env.MQTT_PBKDF2_ITERATIONS = "2";
    testDb = createTestDb();
    mockedGetDatabase.mockReturnValue(testDb);
    mockGetDeviceCredentialLines.mockReturnValue([]);
    mockListCredentials.mockReturnValue([]);
    verifier = fakeVerifier();
  });

  afterEach(() => {
    testDb.close();
    delete process.env.MQTT_PBKDF2_ITERATIONS;
    vi.clearAllMocks();
  });

  function makeService(enabled = true): MqttProvisioningService {
    return new MqttProvisioningService(mockMqttService(), mockConfigWriter(), mockReloader(), {
      verifier,
      enabled,
    });
  }

  describe("security-level transitions", () => {
    it("open mode confirms anonymous access is accepted", async () => {
      const service = makeService();
      await service.setSecurityLevel("open");

      expect(verifier.waitForAccepted).toHaveBeenCalledWith(null);
      expect(verifier.waitForRejected).not.toHaveBeenCalled();
    });

    it("shared-password mode confirms anonymous rejected AND backend accepted", async () => {
      const service = makeService();
      await service.setSecurityLevel("shared_password");

      expect(verifier.waitForRejected).toHaveBeenCalledWith(null);
      expect(verifier.waitForAccepted).toHaveBeenCalledWith(
        expect.objectContaining({ username: "aeolus-backend" }),
      );
    });

    it("per-device mode confirms anonymous rejected AND backend accepted", async () => {
      const service = makeService();
      await service.setSecurityLevel("per_device");

      expect(verifier.waitForRejected).toHaveBeenCalledWith(null);
      expect(verifier.waitForAccepted).toHaveBeenCalledWith(
        expect.objectContaining({ username: "aeolus-backend" }),
      );
    });

    it("throws BrokerNotConfirmedError but still persists the level when verification fails", async () => {
      verifier.waitForRejected.mockResolvedValue(false); // anonymous still accepted → not enforced
      const service = makeService();

      await expect(service.setSecurityLevel("shared_password")).rejects.toBeInstanceOf(
        BrokerNotConfirmedError,
      );

      // Change was persisted despite the verification failure (converges on next reload).
      const row = testDb
        .prepare("SELECT value FROM system_settings WHERE key = ?")
        .get("mqtt_security_level") as { value: string } | undefined;
      expect(row?.value).toBe("shared_password");
      expect(mockWritePasswordFile).toHaveBeenCalled();
    });
  });

  describe("regenerate shared password", () => {
    it("confirms the new shared credential is accepted", async () => {
      seedSetting(testDb, "mqtt_security_level", "shared_password");
      seedSetting(testDb, "mqtt_shared_username", "aeolus-shared");
      const service = makeService();

      const { username, password } = await service.regenerateSharedPassword();

      expect(verifier.waitForAccepted).toHaveBeenCalledWith({ username, password });
    });
  });

  describe("device credential lifecycle", () => {
    it("create confirms the new credential is accepted", async () => {
      seedSetting(testDb, "mqtt_security_level", "per_device");
      mockCreateCredential.mockResolvedValue({
        id: "cred-1",
        deviceName: "Sensor",
        username: "sensor",
        password: "sensor-pass",
      });
      const service = makeService();

      await service.createDeviceCredential("Sensor");

      expect(verifier.waitForAccepted).toHaveBeenCalledWith({
        username: "sensor",
        password: "sensor-pass",
      });
    });

    it("revoke confirms the credential is rejected AND backend still accepted", async () => {
      seedSetting(testDb, "mqtt_security_level", "per_device");
      mockListCredentials.mockReturnValue([{ id: "cred-1", username: "sensor" }]);
      const service = makeService();

      await service.revokeDeviceCredential("cred-1");

      expect(mockDeleteCredential).toHaveBeenCalledWith("cred-1");
      expect(verifier.waitForRejected).toHaveBeenCalledWith(
        expect.objectContaining({ username: "sensor" }),
      );
      expect(verifier.waitForAccepted).toHaveBeenCalledWith(
        expect.objectContaining({ username: "aeolus-backend" }),
      );
    });

    it("revoke throws BrokerNotConfirmedError but still deletes the credential when the broker keeps accepting it", async () => {
      seedSetting(testDb, "mqtt_security_level", "per_device");
      mockListCredentials.mockReturnValue([{ id: "cred-1", username: "sensor" }]);
      verifier.waitForRejected.mockResolvedValue(false); // broker still accepts it
      const service = makeService();

      await expect(service.revokeDeviceCredential("cred-1")).rejects.toBeInstanceOf(
        BrokerNotConfirmedError,
      );
      expect(mockDeleteCredential).toHaveBeenCalledWith("cred-1");
    });
  });

  describe("verification disabled", () => {
    it("runs no probes and still succeeds when verification is disabled", async () => {
      const service = makeService(false);

      const status = await service.setSecurityLevel("shared_password");

      expect(status.level).toBe("shared_password");
      expect(verifier.waitForAccepted).not.toHaveBeenCalled();
      expect(verifier.waitForRejected).not.toHaveBeenCalled();
    });
  });
});
