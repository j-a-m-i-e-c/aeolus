// src/secrets/secret-store.ts — the only read and write path for stored secrets (H2b).
//
// Every secret-bearing value is stored as an H2a envelope, bound to its location:
//
//   system_settings  jwt_secret, mqtt_backend_password, mqtt_shared_password
//                    → purpose "setting-secret", context `setting:<key>`
//   connectors       each `password` field of the connector type's schema
//                    → purpose "connector-secret", context `connector:<instanceId>:<fieldId>`
//
// The codec is installed once at startup, after the keyring is loaded and existing
// plaintext has been migrated (see migration.ts). From then on there is no plaintext
// fallback: a plaintext value found in one of these locations is refused, and so is
// every read or write before a codec is installed. Errors name the location, never
// the value.

import type { Database as DatabaseType } from "better-sqlite3";
import { connectorContext, isEnvelope, openSecret, sealSecret, settingContext, EnvelopeError } from "./envelope.js";
import { SecretsUnavailableError } from "./errors.js";
import { activeKey, keyById, type Keyring } from "./keyring.js";

/** The system settings that hold secrets. Other settings are not secret and stay as they are. */
export const SECRET_SETTINGS = ["jwt_secret", "mqtt_backend_password", "mqtt_shared_password"] as const;
export type SecretSettingKey = (typeof SECRET_SETTINGS)[number];

export function isSecretSetting(key: string): key is SecretSettingKey {
  return (SECRET_SETTINGS as readonly string[]).includes(key);
}

/**
 * The password fields of a connector type, from its schema. Undefined when the type
 * is unknown: then its fields cannot be classified, and a save is refused.
 */
export type SecretFieldLookup = (connectorType: string) => readonly string[] | undefined;

/** A connector field value that holds a secret: a non-empty string. */
export function isStoredSecretValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export interface SecretCodec {
  keyring: Keyring;
  sealSetting(key: SecretSettingKey, plaintext: string): string;
  openSetting(key: SecretSettingKey, stored: string): string;
  sealConnectorField(instanceId: string, fieldId: string, plaintext: string): string;
  openConnectorField(instanceId: string, fieldId: string, stored: string): string;
}

export function createSecretCodec(keyring: Keyring): SecretCodec {
  const keyFor = (id: string) => keyById(keyring, id);
  const open = (stored: string, purpose: "setting-secret" | "connector-secret", context: string, where: string): string => {
    if (!isEnvelope(stored)) {
      throw new SecretsUnavailableError(`${where} holds an unencrypted value, but stored secrets are encrypted; refusing to use it. If this is a deliberate recovery, run: aeolus-secrets migrate --db <path> --reencrypt-plaintext`);
    }
    try {
      return openSecret(stored, keyFor, purpose, context);
    } catch (error) {
      const reason = error instanceof EnvelopeError ? error.message : "it could not be decrypted";
      throw new SecretsUnavailableError(`${where} cannot be decrypted: ${reason}`);
    }
  };
  return {
    keyring,
    sealSetting: (key, plaintext) => sealSecret(plaintext, activeKey(keyring), "setting-secret", settingContext(key)),
    openSetting: (key, stored) => open(stored, "setting-secret", settingContext(key), `Setting ${key}`),
    sealConnectorField: (instanceId, fieldId, plaintext) =>
      sealSecret(plaintext, activeKey(keyring), "connector-secret", connectorContext(instanceId, fieldId)),
    openConnectorField: (instanceId, fieldId, stored) =>
      open(stored, "connector-secret", connectorContext(instanceId, fieldId), `Connector ${instanceId} field ${fieldId}`),
  };
}

let installed: SecretCodec | null = null;

/** Install the codec for this process (startup), or remove it (null). */
export function installSecretCodec(codec: SecretCodec | null): void {
  installed = codec;
}

/** The installed codec. Throws when secrets are not ready, so nothing falls back to plaintext. */
export function secretCodec(): SecretCodec {
  if (!installed) throw new SecretsUnavailableError("Stored secrets are not available: the keyring has not been loaded");
  return installed;
}

// ─── Settings ───────────────────────────────────────────────────────────────

/** Read and decrypt a secret setting. Null when the setting is absent. */
export function readSecretSetting(db: DatabaseType, key: SecretSettingKey): string | null {
  const codec = secretCodec();
  const row = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  return codec.openSetting(key, row.value);
}

/** Encrypt and store (insert or replace) a secret setting. */
export function writeSecretSetting(db: DatabaseType, key: SecretSettingKey, plaintext: string): void {
  const sealed = secretCodec().sealSetting(key, plaintext);
  db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, sealed);
}

/** Encrypt and insert a secret setting only if absent. Returns false when one already exists. */
export function insertSecretSettingIfAbsent(db: DatabaseType, key: SecretSettingKey, plaintext: string): boolean {
  const sealed = secretCodec().sealSetting(key, plaintext);
  return db.prepare("INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING").run(key, sealed).changes === 1;
}

// ─── Connector configuration ────────────────────────────────────────────────

function fieldsOrRefuse(lookup: SecretFieldLookup, connectorType: string, instanceId: string): readonly string[] {
  const fields = lookup(connectorType);
  if (!fields) {
    throw new SecretsUnavailableError(`Connector ${instanceId} has type ${connectorType}, which is not registered; its secret fields are unknown, so it is not saved`);
  }
  return fields;
}

/** The config as stored: every secret field sealed. The input is not modified. */
export function sealConnectorConfig(
  instanceId: string,
  connectorType: string,
  config: Record<string, unknown>,
  lookup: SecretFieldLookup,
): Record<string, unknown> {
  const codec = secretCodec();
  const stored = { ...config };
  for (const field of fieldsOrRefuse(lookup, connectorType, instanceId)) {
    const value = stored[field];
    // Always sealed, even if the value happens to look like an envelope: a posted
    // envelope is never stored as if it were one.
    if (isStoredSecretValue(value)) stored[field] = codec.sealConnectorField(instanceId, field, value);
  }
  return stored;
}

/**
 * The config for use: every secret field decrypted. A plaintext value in a secret
 * field is refused. A connector type that is not registered keeps its stored values
 * (they are never used, because no connector can be created for it).
 */
export function openConnectorConfig(
  instanceId: string,
  connectorType: string,
  config: Record<string, unknown>,
  lookup: SecretFieldLookup,
): Record<string, unknown> {
  const fields = lookup(connectorType);
  if (!fields) return { ...config };
  const codec = secretCodec();
  const opened = { ...config };
  for (const field of fields) {
    const value = opened[field];
    if (isStoredSecretValue(value)) opened[field] = codec.openConnectorField(instanceId, field, value);
  }
  return opened;
}
