// src/services/service-store.ts — SQLite persistence layer for service records

import type { Database as DatabaseType } from "better-sqlite3";
import type { ServiceRecord } from "./service.interface.js";
import logger from "../logger.js";

interface ServiceRow {
  id: string;
  service_type: string;
  enabled: number;
  config: string;
  created_at: number;
  updated_at: number;
}

/**
 * Thin persistence layer over the SQLite `services` table.
 *
 * Handles CRUD operations for {@link ServiceRecord} objects.
 * Writes go to disk automatically via WAL — no manual persist needed.
 */
export class ServiceStore {
  constructor(private readonly db: DatabaseType) {}

  /** Save or update a service record. */
  save(record: ServiceRecord): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO services (id, service_type, enabled, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.serviceType,
      record.enabled ? 1 : 0,
      JSON.stringify(record.config),
      record.createdAt,
      record.updatedAt,
    );
  }

  /** Mark a service as disabled (sets enabled = 0, preserves config). */
  disable(instanceId: string): void {
    this.db.prepare(
      `UPDATE services SET enabled = 0, updated_at = ? WHERE id = ?`
    ).run(Date.now(), instanceId);
  }

  /** Load only enabled service records. */
  loadEnabled(): ServiceRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM services WHERE enabled = 1"
    ).all() as ServiceRow[];
    return this.rowsToRecords(rows);
  }

  /** Load all service records. */
  loadAll(): ServiceRecord[] {
    const rows = this.db.prepare("SELECT * FROM services").all() as ServiceRow[];
    return this.rowsToRecords(rows);
  }

  /** Convert better-sqlite3 row objects into ServiceRecord[], skipping malformed rows. */
  private rowsToRecords(rows: ServiceRow[]): ServiceRecord[] {
    const records: ServiceRecord[] = [];

    for (const row of rows) {
      let config: Record<string, unknown>;
      try {
        config = JSON.parse(row.config);
      } catch {
        logger.warn(
          { id: row.id, raw: row.config },
          "Malformed JSON in service config column, skipping record",
        );
        continue;
      }

      records.push({
        id: row.id,
        serviceType: row.service_type,
        enabled: row.enabled === 1,
        config,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }

    return records;
  }
}
