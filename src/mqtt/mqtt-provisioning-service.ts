// src/mqtt/mqtt-provisioning-service.ts — Core orchestrator for MQTT security level management
// Coordinates between MosquittoConfigWriter, MosquittoReloader, MqttService, and mqtt-credential-service
// Requirements: 1.1, 1.2, 1.3, 1.4, 10.1, 10.4, 10.5

import crypto from "node:crypto";
import { getDatabase } from "../db/database.js";
import {
  getPasswordFilePath,
  writePasswordFile,
  getDeviceCredentialLines,
  createCredential,
  deleteCredential,
  listCredentials,
  BACKEND_USERNAME,
  SETTING_BACKEND_PASSWORD,
  type MqttCredential,
  type MqttCredentialListItem,
} from "../auth/mqtt-credential-service.js";
import { buildPasswordLine } from "./mosquitto-password-hash.js";
import { BadRequestError, ConflictError, BrokerNotConfirmedError } from "../api/middleware/error-handler.js";
import type { MosquittoConfigWriter } from "./mosquitto-config-writer.js";
import type { MosquittoReloader } from "./mosquitto-reloader.js";
import type { MqttService } from "./mqtt-service.js";
import type { BrokerVerifier } from "./broker-verifier.js";
import logger from "../logger.js";

// --- Type Definitions ---

export type SecurityLevel = "open" | "shared_password" | "per_device";

export interface SecurityStatus {
  level: SecurityLevel;
  sharedCredential?: { username: string; password: string } | null;
  backendConnected: boolean;
}

// --- System Settings Keys ---

const SETTING_SECURITY_LEVEL = "mqtt_security_level";
const SETTING_SHARED_USERNAME = "mqtt_shared_username";
const SETTING_SHARED_PASSWORD = "mqtt_shared_password";

const PASSWORD_BYTES = 24;

/**
 * MqttProvisioningService is the central orchestrator for MQTT security level management.
 * It coordinates between the credential service, config writer, reloader, and MQTT service
 * to ensure the Mosquitto broker, password file, and backend connection are always in sync.
 */
export interface ProvisioningVerification {
  /** Confirms broker behaviour after a change. Omitted → verification disabled. */
  verifier?: BrokerVerifier;
  /** Guards whether verification runs at all (mirrors managed-provisioning gate). */
  enabled?: boolean;
}

export class MqttProvisioningService {
  private readonly configWriter: MosquittoConfigWriter;
  private readonly reloader: MosquittoReloader;
  private readonly mqttService: MqttService;
  private readonly verifier?: BrokerVerifier;
  private readonly verificationEnabled: boolean;

  constructor(
    mqttService: MqttService,
    configWriter: MosquittoConfigWriter,
    reloader: MosquittoReloader,
    verification: ProvisioningVerification = {},
  ) {
    this.mqttService = mqttService;
    this.configWriter = configWriter;
    this.reloader = reloader;
    this.verifier = verification.verifier;
    this.verificationEnabled = verification.enabled === true && verification.verifier !== undefined;
  }

  /**
   * Confirm the broker enforces the expected policy after a change was written
   * and a reload triggered. No-op when verification is disabled. Throws
   * {@link BrokerNotConfirmedError} when the broker does not converge in time —
   * the caller has already persisted the change, so this signals only that live
   * confirmation did not land, not that the change was lost.
   */
  private async verify(
    operation: string,
    checks: Array<{ description: string; run: () => Promise<boolean> }>,
  ): Promise<void> {
    if (!this.verificationEnabled || !this.verifier) return;

    for (const check of checks) {
      const ok = await check.run();
      if (!ok) {
        logger.error(
          { operation, check: check.description },
          "Broker did not confirm provisioning change within the verification window",
        );
        throw new BrokerNotConfirmedError(
          `Broker did not confirm '${operation}' (${check.description}) within the verification window. ` +
            "The change is saved and will apply on the broker's next reload or restart.",
        );
      }
    }
    logger.info({ operation }, "Broker confirmed provisioning change");
  }

  /**
   * Get the current security level and associated state.
   * Reads from the system_settings table and includes the backend MQTT connection state.
   * Satisfies Requirements 1.4, 10.3.
   */
  getStatus(): SecurityStatus {
    const level = this.readSetting(SETTING_SECURITY_LEVEL) as SecurityLevel | null ?? "open";

    let sharedCredential: { username: string; password: string } | null = null;

    if (level === "shared_password") {
      const username = this.readSetting(SETTING_SHARED_USERNAME);
      const password = this.readSetting(SETTING_SHARED_PASSWORD);
      if (username && password) {
        sharedCredential = { username, password };
      }
    }

    return {
      level: level as SecurityLevel,
      sharedCredential,
      backendConnected: this.mqttService.isConnected(),
    };
  }

  /**
   * Initialize the provisioning service on startup.
   * Reads the persisted security level, regenerates the password file and config to match,
   * ensures the backend credential exists if auth is active, and connects MQTT with correct credentials.
   * Satisfies Requirements 1.3, 10.4, 10.5.
   */
  async initialize(): Promise<void> {
    const level = (this.readSetting(SETTING_SECURITY_LEVEL) as SecurityLevel | null) ?? "open";

    logger.info({ level }, "Initializing MQTT provisioning service with persisted security level");

    if (level === "open") {
      // Open mode: write open config, no password file needed.
      this.configWriter.writeOpenConfig();
      this.mqttService.setCredentials(null);
      logger.info("Mosquitto configured for open mode (no authentication)");
      return;
    }

    // Authenticated mode (shared_password or per_device). Rebuild the password
    // file from persisted state so the broker sees the same credentials it had
    // before the restart.
    const backendPassword = this.ensureBackendPassword();
    const lines: string[] = [buildPasswordLine(BACKEND_USERNAME, backendPassword)];

    if (level === "shared_password") {
      const sharedUsername = this.readSetting(SETTING_SHARED_USERNAME);
      const sharedPassword = this.readSetting(SETTING_SHARED_PASSWORD);
      if (sharedUsername && sharedPassword) {
        lines.push(buildPasswordLine(sharedUsername, sharedPassword));
      }
    } else {
      // per_device: reinstate every stored device credential (from their `$7$`
      // hashes) so provisioned devices survive the restart, not just the backend.
      lines.push(...getDeviceCredentialLines());
    }

    this.configWriter.writeAuthenticatedConfig(getPasswordFilePath());
    writePasswordFile(lines);

    // Prime the initial connection with the backend credential and reload the
    // broker so it honours the freshly written config + password file.
    this.mqttService.setCredentials({ username: BACKEND_USERNAME, password: backendPassword });
    await this.reloader.reload();

    logger.info(
      { level, entryCount: lines.length },
      "Mosquitto configured for authenticated mode",
    );
  }

  /**
   * Regenerate the shared password in shared_password mode.
   * Generates a new random password, updates the password file with the new credential,
   * reloads the broker, and persists the new password to system_settings.
   * Throws ConflictError if the current mode is not "shared_password".
   * Satisfies Requirements 3.5, 9.3, 9.7.
   */
  async regenerateSharedPassword(): Promise<{ username: string; password: string }> {
    const level = this.readSetting(SETTING_SECURITY_LEVEL) as SecurityLevel | null ?? "open";

    if (level !== "shared_password") {
      throw new ConflictError("Operation requires shared_password security level");
    }

    // Generate a new random password (24 bytes, base64url)
    const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");

    // Read the existing shared username from system_settings
    const username = this.readSetting(SETTING_SHARED_USERNAME) ?? "aeolus-shared";

    // Read the backend password from system_settings
    const backendPassword = this.ensureBackendPassword();

    // Write password file: shared (new password) + backend. No device entries
    // in shared mode.
    writePasswordFile([
      buildPasswordLine(username, password),
      buildPasswordLine(BACKEND_USERNAME, backendPassword),
    ]);

    // Reload broker to pick up the new password file
    await this.reloader.reload();

    // Persist the new shared password to system_settings
    this.writeSetting(SETTING_SHARED_PASSWORD, password);

    // Confirm the broker accepts the freshly regenerated shared credential
    await this.verify("regenerate-shared-password", [
      {
        description: "new shared credential accepted",
        run: () => this.verifier!.waitForAccepted({ username, password }),
      },
    ]);

    logger.info({ username }, "Shared MQTT password regenerated");

    return { username, password };
  }

  /**
   * Change the security level, orchestrating all side effects.
   * Order: files → credentials → MQTT reconnect → broker reload → DB persist.
   * Satisfies Requirements 1.5, 1.6, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.6, 4.1, 4.8, 6.1, 6.2, 6.3, 6.4.
   */
  async setSecurityLevel(level: SecurityLevel): Promise<SecurityStatus> {
    // Validate level is one of the three valid values
    const validLevels: SecurityLevel[] = ["open", "shared_password", "per_device"];
    if (!validLevels.includes(level)) {
      throw new BadRequestError(`Invalid security level: "${level}". Must be one of: open, shared_password, per_device`);
    }

    if (level === "open") {
      return this.setOpenMode();
    } else if (level === "shared_password") {
      return this.setSharedPasswordMode();
    } else {
      return this.setPerDeviceMode();
    }
  }

  /**
   * Switch to open mode: no authentication required.
   * Writes open config, reloads broker, then reconnects MQTT without credentials.
   */
  private async setOpenMode(): Promise<SecurityStatus> {
    // 1. Write open config (files first)
    this.configWriter.writeOpenConfig();

    // 2. Reload broker (so it picks up the new config before we reconnect)
    await this.reloader.reload();

    // 3. Reconnect MQTT without credentials (broker now allows anonymous)
    await this.mqttService.reconnectWithCredentials(null);

    // 4. Persist level (before verify, so a delayed reload still converges)
    this.writeSetting(SETTING_SECURITY_LEVEL, "open");

    // 5. Confirm the broker now accepts anonymous connections
    await this.verify("set-open", [
      { description: "anonymous accepted", run: () => this.verifier!.waitForAccepted(null) },
    ]);

    logger.info("Security level changed to open");

    return this.getStatus();
  }

  /**
   * Switch to shared_password mode: single credential for all devices.
   * Generates shared + backend credentials, writes password file and authenticated config,
   * reconnects MQTT with backend credential, reloads broker, persists level + shared credential.
   */
  private async setSharedPasswordMode(): Promise<SecurityStatus> {
    // Generate shared credential
    const sharedUsername = "aeolus-shared";
    const sharedPassword = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");

    // Ensure backend password exists
    const backendPassword = this.ensureBackendPassword();

    // 1. Write password file (files first): [shared, backend]. No device entries.
    writePasswordFile([
      buildPasswordLine(sharedUsername, sharedPassword),
      buildPasswordLine(BACKEND_USERNAME, backendPassword),
    ]);

    // 2. Write authenticated config
    this.configWriter.writeAuthenticatedConfig(getPasswordFilePath());

    // 3. Reload broker (so it picks up new config + password file before we reconnect)
    await this.reloader.reload();

    // 4. Reconnect MQTT with backend credentials (broker now requires auth)
    await this.mqttService.reconnectWithCredentials({
      username: BACKEND_USERNAME,
      password: backendPassword,
    });

    // 5. Persist level + shared credential
    this.writeSetting(SETTING_SECURITY_LEVEL, "shared_password");
    this.writeSetting(SETTING_SHARED_USERNAME, sharedUsername);
    this.writeSetting(SETTING_SHARED_PASSWORD, sharedPassword);

    // 6. Confirm the broker now enforces auth: anonymous refused, backend accepted
    await this.verify("set-shared-password", [
      { description: "anonymous rejected", run: () => this.verifier!.waitForRejected(null) },
      {
        description: "backend credential accepted",
        run: () => this.verifier!.waitForAccepted({ username: BACKEND_USERNAME, password: backendPassword }),
      },
    ]);

    logger.info({ sharedUsername }, "Security level changed to shared_password");

    return this.getStatus();
  }

  /**
   * Switch to per_device mode: unique credentials per device.
   * Ensures backend credential, writes password file (backend only — device entries added via createDeviceCredential),
   * writes authenticated config, reconnects MQTT with backend credential, reloads broker, persists level.
   */
  private async setPerDeviceMode(): Promise<SecurityStatus> {
    // Ensure backend password exists
    const backendPassword = this.ensureBackendPassword();

    // 1. Write password file (files first): backend + any already-provisioned
    // device credentials (from their stored `$7$` hashes).
    writePasswordFile([
      buildPasswordLine(BACKEND_USERNAME, backendPassword),
      ...getDeviceCredentialLines(),
    ]);

    // 2. Write authenticated config
    this.configWriter.writeAuthenticatedConfig(getPasswordFilePath());

    // 3. Reload broker (so it picks up new config + password file before we reconnect)
    await this.reloader.reload();

    // 4. Reconnect MQTT with backend credentials (broker now requires auth)
    await this.mqttService.reconnectWithCredentials({
      username: BACKEND_USERNAME,
      password: backendPassword,
    });

    // 5. Persist level
    this.writeSetting(SETTING_SECURITY_LEVEL, "per_device");

    // 6. Confirm the broker now enforces auth: anonymous refused, backend accepted
    await this.verify("set-per-device", [
      { description: "anonymous rejected", run: () => this.verifier!.waitForRejected(null) },
      {
        description: "backend credential accepted",
        run: () => this.verifier!.waitForAccepted({ username: BACKEND_USERNAME, password: backendPassword }),
      },
    ]);

    logger.info("Security level changed to per_device");

    return this.getStatus();
  }

  // --- Per-Device Credential Delegation ---

  /**
   * Create a per-device MQTT credential.
   * Validates that the current mode is "per_device", then delegates to the credential service
   * which handles username generation, DB storage, password file regeneration, and broker reload.
   * Satisfies Requirements 4.2, 4.3, 4.4, 9.5, 9.7.
   */
  async createDeviceCredential(deviceName: string): Promise<MqttCredential> {
    const level = this.readSetting(SETTING_SECURITY_LEVEL) as SecurityLevel | null ?? "open";

    if (level !== "per_device") {
      throw new ConflictError("Operation requires per_device security level");
    }

    const credential = await createCredential(deviceName);

    // Confirm the broker accepts the newly provisioned device credential
    await this.verify("create-device-credential", [
      {
        description: "new device credential accepted",
        run: () => this.verifier!.waitForAccepted({
          username: credential.username,
          password: credential.password,
        }),
      },
    ]);

    logger.info(
      { id: credential.id, deviceName, username: credential.username },
      "Per-device MQTT credential created via provisioning service",
    );

    return credential;
  }

  /**
   * Revoke a per-device MQTT credential by ID.
   * Validates that the current mode is "per_device", then delegates to the credential service
   * which handles DB removal, password file regeneration, and broker reload.
   * Satisfies Requirements 4.5, 4.6, 9.6, 9.7.
   */
  async revokeDeviceCredential(id: string): Promise<void> {
    const level = this.readSetting(SETTING_SECURITY_LEVEL) as SecurityLevel | null ?? "open";

    if (level !== "per_device") {
      throw new ConflictError("Operation requires per_device security level");
    }

    // Capture the username before deletion so we can probe that it stops working.
    const revokedUsername = listCredentials().find((c) => c.id === id)?.username;

    deleteCredential(id);

    // Confirm the broker refuses the revoked credential while the backend still
    // connects — the backend positive-probe distinguishes a genuine revocation
    // from a transiently unreachable broker (which would also look "rejected").
    const backendPassword = this.ensureBackendPassword();
    await this.verify("revoke-device-credential", [
      ...(revokedUsername
        ? [{
            description: "revoked credential rejected",
            run: () => this.verifier!.waitForRejected({ username: revokedUsername, password: "revoked" }),
          }]
        : []),
      {
        description: "backend credential still accepted",
        run: () => this.verifier!.waitForAccepted({ username: BACKEND_USERNAME, password: backendPassword }),
      },
    ]);

    logger.info({ id }, "Per-device MQTT credential revoked via provisioning service");
  }

  /**
   * List all device credentials.
   * Delegates to the credential service which returns all credentials without exposing passwords.
   * Satisfies Requirements 4.7, 9.4.
   */
  listDeviceCredentials(): MqttCredentialListItem[] {
    return listCredentials();
  }

  // --- Private Helpers ---

  /**
   * Read a setting from the system_settings table.
   * Returns null if the key does not exist.
   */
  private readSetting(key: string): string | null {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  /**
   * Write a setting to the system_settings table (upsert).
   */
  private writeSetting(key: string, value: string): void {
    const db = getDatabase();
    db.prepare(
      "INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, value);
  }

  /**
   * Ensure the backend password exists in system_settings.
   * If not present, generates a new one and persists it.
   * Returns the plaintext backend password.
   */
  private ensureBackendPassword(): string {
    let password = this.readSetting(SETTING_BACKEND_PASSWORD);
    if (!password) {
      password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
      this.writeSetting(SETTING_BACKEND_PASSWORD, password);
      logger.info("Generated new backend MQTT password");
    }
    return password;
  }
}
