// src/services/service-store.ts — SQLite persistence layer for service records

import type { Database } from "sql.js";
import type { ServiceRecord } from "./service.interface.js";
import { persistDatabase } from "../db/database.js";
import logger from "../logger.js";

/**
 * Thin persistence layer over the SQLite `services` table.
 *
 * Handles CRUD operations for {@link ServiceRecord} objects and
 * ensures changes are flushed to disk via `persistDatabase()`.
 */
export class ServiceStore {
  constructor(private readonly db: Database) {}

  /** Save or update a service record. */
  save(record: ServiceRecord): void {
    this.db.run(
      `INSERT OR REPLACE INTO services (id, service_type, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.serviceType,
        record.enabled ? 1 : 0,
        JSON.stringify(record.config),
        record.createdAt,
        record.updatedAt,
      ],
    );
    persistDatabase();
  }

  /** Mark a service as disabled (sets enabled = 0, preserves config). */
  disable(instanceId: string): void {
    this.db.run(
      `UPDATE services SET enabled = 0, updated_at = ? WHERE id = ?`,
      [Date.now(), instanceId],
    );
    persistDatabase();
  }

  /** Load only enabled service records. */
  loadEnabled(): ServiceRecord[] {
    const results = this.db.exec(
      "SELECT * FROM services WHERE enabled = 1",
    );
    return this.rowsToRecords(results);
  }

  /** Load all service records. */
  loadAll(): ServiceRecord[] {
    const results = this.db.exec("SELECT * FROM services");
    return this.rowsToRecords(results);
  }

  /** Convert sql.js exec results into ServiceRecord[], skipping malformed rows. */
  private rowsToRecords(
    results: ReturnType<Database["exec"]>,
  ): ServiceRecord[] {
    if (results.length === 0) return [];
    const { columns, values } = results[0];
    const records: ServiceRecord[] = [];

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
          "Malformed JSON in service config column, skipping record",
        );
        continue;
      }

      records.push({
        id: obj.id as string,
        serviceType: obj.service_type as string,
        enabled: obj.enabled === 1,
        config,
        createdAt: obj.created_at as number,
        updatedAt: obj.updated_at as number,
      });
    }

    return records;
  }
}
