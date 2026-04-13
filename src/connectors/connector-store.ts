// src/connectors/connector-store.ts — SQLite persistence layer for connector records

import type { Database } from "sql.js";
import type { ConnectorRecord } from "./connector.interface.js";
import { persistDatabase } from "../db/database.js";
import logger from "../logger.js";

/**
 * Thin persistence layer over the SQLite `connectors` table.
 *
 * Handles CRUD operations for {@link ConnectorRecord} objects and
 * ensures changes are flushed to disk via `persistDatabase()`.
 */
export class ConnectorStore {
  constructor(private readonly db: Database) {}

  /** Save or update a connector record. */
  save(record: ConnectorRecord): void {
    this.db.run(
      `INSERT OR REPLACE INTO connectors (id, connector_type, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.connectorType,
        record.enabled ? 1 : 0,
        JSON.stringify(record.config),
        record.createdAt,
        record.updatedAt,
      ],
    );
    persistDatabase();
  }

  /** Mark a connector as disabled (sets enabled = 0, preserves config). */
  disable(instanceId: string): void {
    this.db.run(
      `UPDATE connectors SET enabled = 0, updated_at = ? WHERE id = ?`,
      [Date.now(), instanceId],
    );
    persistDatabase();
  }

  /** Delete a connector record entirely. */
  delete(instanceId: string): void {
    this.db.run(`DELETE FROM connectors WHERE id = ?`, [instanceId]);
    persistDatabase();
  }

  /** Load all connector records. */
  loadAll(): ConnectorRecord[] {
    const results = this.db.exec("SELECT * FROM connectors");
    return this.rowsToRecords(results);
  }

  /** Load only enabled connector records. */
  loadEnabled(): ConnectorRecord[] {
    const results = this.db.exec(
      "SELECT * FROM connectors WHERE enabled = 1",
    );
    return this.rowsToRecords(results);
  }

  /** Convert sql.js exec results into ConnectorRecord[], skipping malformed rows. */
  private rowsToRecords(
    results: ReturnType<Database["exec"]>,
  ): ConnectorRecord[] {
    if (results.length === 0) return [];
    const { columns, values } = results[0];
    const records: ConnectorRecord[] = [];

    for (const row of values) {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });

      let config: Record<string, unknown>;
      try {
        config = JSON.parse(obj.config as string);
      } catch {
        logger.warn(
          { id: obj.id, raw: obj.config },
          "Malformed JSON in connector config column, skipping record",
        );
        continue;
      }

      records.push({
        id: obj.id as string,
        connectorType: obj.connector_type as string,
        enabled: obj.enabled === 1,
        config,
        createdAt: obj.created_at as number,
        updatedAt: obj.updated_at as number,
      });
    }

    return records;
  }
}
