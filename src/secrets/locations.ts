// src/secrets/locations.ts — where secrets are stored, read without decrypting (H2b).
//
// Shared by the startup decision, the migration and `aeolus-secrets verify`, so the
// three agree on what a secret location is: the SECRET_SETTINGS rows, and each
// password field (by schema) of each connector instance of a registered type.

import type { Database as DatabaseType } from "better-sqlite3";
import { connectorContext, ENVELOPE_PREFIX, isEnvelope, settingContext, type SecretPurpose } from "./envelope.js";
import { SecretsUnavailableError } from "./errors.js";
import { isStoredSecretValue, SECRET_SETTINGS, type SecretFieldLookup, type SecretSettingKey } from "./secret-store.js";

export type SecretLocation =
  | { kind: "setting"; key: SecretSettingKey }
  | { kind: "connector"; instanceId: string; connectorType: string; field: string };

export interface LocatedValue {
  location: SecretLocation;
  value: string;
}

export interface SecretInventory {
  /** Every non-empty stored value in a secret location: envelopes and plaintext. */
  values: LocatedValue[];
  /** Connector instances whose type is not registered: their fields cannot be classified. */
  unknownTypes: Array<{ instanceId: string; connectorType: string }>;
  /** Envelope-looking strings in the config of a connector of an unknown type. */
  unknownTypeEnvelopes: string[];
  /** Connector rows whose config is not a JSON object; they are skipped everywhere. */
  malformedConnectors: string[];
}

export function describeLocation(location: SecretLocation): string {
  return location.kind === "setting" ? `setting ${location.key}` : `connector ${location.instanceId} field ${location.field}`;
}

/** A stable identity for a location (used as the side-table key during migration). */
export function locationId(location: SecretLocation): string {
  return location.kind === "setting" ? settingContext(location.key) : connectorContext(location.instanceId, location.field);
}

export function purposeOf(location: SecretLocation): SecretPurpose {
  return location.kind === "setting" ? "setting-secret" : "connector-secret";
}

function parseConfig(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Read every secret location. Read-only; works on a read-only connection. */
export function collectSecretValues(db: DatabaseType, lookup: SecretFieldLookup): SecretInventory {
  const inventory: SecretInventory = { values: [], unknownTypes: [], unknownTypeEnvelopes: [], malformedConnectors: [] };
  const hasTable = (name: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  if (!hasTable("system_settings") || !hasTable("connectors")) {
    throw new SecretsUnavailableError("This database has no system_settings or connectors table; it is not an Aeolus database, or its schema has not been created");
  }
  const setting = db.prepare("SELECT value FROM system_settings WHERE key = ?");
  for (const key of SECRET_SETTINGS) {
    const row = setting.get(key) as { value: unknown } | undefined;
    if (row && isStoredSecretValue(row.value)) inventory.values.push({ location: { kind: "setting", key }, value: row.value });
  }
  const rows = db.prepare("SELECT id, connector_type, config FROM connectors ORDER BY id").all() as Array<{ id: string; connector_type: string; config: string }>;
  for (const row of rows) {
    const config = parseConfig(row.config);
    if (!config) {
      inventory.malformedConnectors.push(row.id);
      continue;
    }
    const fields = lookup(row.connector_type);
    if (!fields) {
      inventory.unknownTypes.push({ instanceId: row.id, connectorType: row.connector_type });
      for (const value of Object.values(config)) if (isEnvelope(value)) inventory.unknownTypeEnvelopes.push(value);
      continue;
    }
    for (const field of fields) {
      const value = config[field];
      if (isStoredSecretValue(value)) {
        inventory.values.push({ location: { kind: "connector", instanceId: row.id, connectorType: row.connector_type, field }, value });
      }
    }
  }
  return inventory;
}

const KEY_ID_IN_ENVELOPE = new RegExp(`^${ENVELOPE_PREFIX}[^:]+:([A-Za-z0-9_-]{1,32}):`);

/** Envelopes in secret locations (and in unknown connector types), with the key ids they name. */
export function summariseEnvelopes(inventory: SecretInventory): { count: number; keyIds: string[] } {
  const ids = new Set<string>();
  let count = 0;
  const add = (value: string) => {
    count += 1;
    const match = KEY_ID_IN_ENVELOPE.exec(value);
    if (match) ids.add(match[1]!);
  };
  for (const { value } of inventory.values) if (isEnvelope(value)) add(value);
  for (const value of inventory.unknownTypeEnvelopes) add(value);
  return { count, keyIds: [...ids].sort() };
}
