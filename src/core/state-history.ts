// src/core/state-history.ts — Stores the last N state snapshots per device

import type { Database } from "sql.js";
import { persistDatabase } from "../db/database.js";
import logger from "../logger.js";

export interface HistoryEntry {
  deviceId: string;
  state: Record<string, unknown>;
  timestamp: number;
}

export class StateHistory {
  /** Tracks the last recorded timestamp per device for throttling */
  private lastRecordTime = new Map<string, number>();

  constructor(
    private db: Database,
    private maxEntriesPerDevice: number = 100,
    private recordInterval: number = 5000,
  ) {}

  /**
   * Record a state snapshot for a device.
   * Skips recording if less than `recordInterval` ms have passed since the
   * last record for this device (throttling for fast sensors).
   * Returns true if the entry was actually recorded, false if throttled.
   */
  record(deviceId: string, state: Record<string, unknown>, timestamp: number): boolean {
    const lastTime = this.lastRecordTime.get(deviceId);
    if (lastTime !== undefined && timestamp - lastTime < this.recordInterval) {
      return false;
    }

    try {
      this.db.run(
        "INSERT INTO device_history (device_id, state, timestamp) VALUES (?, ?, ?)",
        [deviceId, JSON.stringify(state), timestamp],
      );

      this.lastRecordTime.set(deviceId, timestamp);

      // Prune oldest entries if we exceed the cap
      this.prune(deviceId);

      persistDatabase();
      return true;
    } catch (err) {
      logger.error({ deviceId, error: (err as Error).message }, "Failed to record state history");
      return false;
    }
  }

  /** Get history for a device, newest first */
  getHistory(deviceId: string, limit?: number): HistoryEntry[] {
    const effectiveLimit = limit ?? 50;
    const results = this.db.exec(
      "SELECT device_id, state, timestamp FROM device_history WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?",
      [deviceId, effectiveLimit],
    );

    return this.parseResults(results);
  }

  /** Get history for a device within a time range, newest first */
  getHistoryRange(deviceId: string, from: number, to: number): HistoryEntry[] {
    const results = this.db.exec(
      "SELECT device_id, state, timestamp FROM device_history WHERE device_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC",
      [deviceId, from, to],
    );

    return this.parseResults(results);
  }

  /** Delete oldest entries for a device when count exceeds maxEntriesPerDevice */
  private prune(deviceId: string): void {
    this.db.run(
      `DELETE FROM device_history WHERE id IN (
        SELECT id FROM device_history
        WHERE device_id = ?
        ORDER BY timestamp DESC
        LIMIT -1 OFFSET ?
      )`,
      [deviceId, this.maxEntriesPerDevice],
    );
  }

  private parseResults(results: ReturnType<Database["exec"]>): HistoryEntry[] {
    if (results.length === 0) return [];

    const columns = results[0].columns;
    const deviceIdIdx = columns.indexOf("device_id");
    const stateIdx = columns.indexOf("state");
    const timestampIdx = columns.indexOf("timestamp");

    return results[0].values.map((row) => ({
      deviceId: row[deviceIdIdx] as string,
      state: JSON.parse(row[stateIdx] as string) as Record<string, unknown>,
      timestamp: row[timestampIdx] as number,
    }));
  }

  /** Clear all history for a specific device */
  clearDevice(deviceId: string): number {
    const countResult = this.db.exec(
      "SELECT COUNT(*) as cnt FROM device_history WHERE device_id = ?",
      [deviceId],
    );
    const deleted = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

    this.db.run("DELETE FROM device_history WHERE device_id = ?", [deviceId]);
    this.lastRecordTime.delete(deviceId);
    persistDatabase();
    return deleted;
  }

  /** Clear all history for all devices */
  clearAll(): number {
    const countResult = this.db.exec("SELECT COUNT(*) as cnt FROM device_history");
    const deleted = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;

    this.db.run("DELETE FROM device_history");
    this.lastRecordTime.clear();
    persistDatabase();
    return deleted;
  }
}
