// src/connectors/connector-store.ts — SQLite persistence layer for connector records
//
// Secret fields (the schema's `password` fields) are encrypted on every save and
// decrypted on every load (H2b, src/secrets/secret-store.ts). Records in memory hold
// plaintext; the database never does. A plaintext value found in a secret field, or
// an envelope that does not decrypt, stops the load: there is no plaintext fallback.

import type { Database as DatabaseType } from "better-sqlite3";
import type { ConnectorRecord } from "./connector.interface.js";
import { safeJsonParse } from "../core/safe-json.js";
import { openConnectorConfig, sealConnectorConfig, type SecretFieldLookup } from "../secrets/secret-store.js";

interface ConnectorRow {
  id: string;
  connector_type: string;
  enabled: number;
  config: string;
  created_at: number;
  updated_at: number;
}

/**
 * Thin persistence layer over the SQLite `connectors` table.
 *
 * Handles CRUD operations for {@link ConnectorRecord} objects.
 * Writes go to disk automatically via WAL — no manual persist needed.
 */
export class ConnectorStore {
  constructor(
    private readonly db: DatabaseType,
    /** Which config fields of a connector type are secrets. */
    private readonly secretFields: SecretFieldLookup,
  ) {}

  /** Save or update a connector record. */
  save(record: ConnectorRecord): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO connectors (id, connector_type, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.connectorType,
      record.enabled ? 1 : 0,
      JSON.stringify(sealConnectorConfig(record.id, record.connectorType, record.config, this.secretFields)),
      record.createdAt,
      record.updatedAt,
    );
  }

  /** Mark a connector as disabled (sets enabled = 0, preserves config). */
  disable(instanceId: string): void {
    this.db.prepare(
      `UPDATE connectors SET enabled = 0, updated_at = ? WHERE id = ?`
    ).run(Date.now(), instanceId);
  }

  /** Delete a connector record entirely. */
  delete(instanceId: string): void {
    this.db.prepare(`DELETE FROM connectors WHERE id = ?`).run(instanceId);
  }

  /** Load all connector records. */
  loadAll(): ConnectorRecord[] {
    const rows = this.db.prepare("SELECT * FROM connectors").all() as ConnectorRow[];
    return this.rowsToRecords(rows);
  }

  /** Load only enabled connector records. */
  loadEnabled(): ConnectorRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM connectors WHERE enabled = 1"
    ).all() as ConnectorRow[];
    return this.rowsToRecords(rows);
  }

  /** Convert better-sqlite3 row objects into ConnectorRecord[], skipping malformed rows. */
  private rowsToRecords(rows: ConnectorRow[]): ConnectorRecord[] {
    const records: ConnectorRecord[] = [];

    for (const row of rows) {
      const config = safeJsonParse<Record<string, unknown>>(
        row.config,
        { id: row.id },
        "Malformed JSON in connector config column, skipping record",
      );
      if (config === undefined) continue;

      records.push({
        id: row.id,
        connectorType: row.connector_type,
        enabled: row.enabled === 1,
        config: openConnectorConfig(row.id, row.connector_type, config, this.secretFields),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return records;
  }
}
