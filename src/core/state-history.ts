// src/core/state-history.ts — Stores the last N state snapshots per device

import type { Database as DatabaseType } from "better-sqlite3";
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
    private db: DatabaseType,
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
      this.db.prepare(
        "INSERT INTO device_history (device_id, state, timestamp) VALUES (?, ?, ?)"
      ).run(deviceId, JSON.stringify(state), timestamp);

      this.lastRecordTime.set(deviceId, timestamp);

      // Prune oldest entries if we exceed the cap
      this.prune(deviceId);

      return true;
    } catch (err) {
      logger.error({ deviceId, error: (err as Error).message }, "Failed to record state history");
      return false;
    }
  }

  /** Get history for a device, newest first */
  getHistory(deviceId: string, limit?: number): HistoryEntry[] {
    const effectiveLimit = limit ?? 50;
    const rows = this.db.prepare(
      "SELECT device_id, state, timestamp FROM device_history WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?"
    ).all(deviceId, effectiveLimit) as Array<{ device_id: string; state: string; timestamp: number }>;

    return rows.map((row) => ({
      deviceId: row.device_id,
      state: JSON.parse(row.state) as Record<string, unknown>,
      timestamp: row.timestamp,
    }));
  }

  /** Get history for a device within a time range, newest first */
  getHistoryRange(deviceId: string, from: number, to: number): HistoryEntry[] {
    const rows = this.db.prepare(
      "SELECT device_id, state, timestamp FROM device_history WHERE device_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC"
    ).all(deviceId, from, to) as Array<{ device_id: string; state: string; timestamp: number }>;

    return rows.map((row) => ({
      deviceId: row.device_id,
      state: JSON.parse(row.state) as Record<string, unknown>,
      timestamp: row.timestamp,
    }));
  }

  /** Delete oldest entries for a device when count exceeds maxEntriesPerDevice */
  private prune(deviceId: string): void {
    this.db.prepare(
      `DELETE FROM device_history WHERE id IN (
        SELECT id FROM device_history
        WHERE device_id = ?
        ORDER BY timestamp DESC
        LIMIT -1 OFFSET ?
      )`
    ).run(deviceId, this.maxEntriesPerDevice);
  }

  /** Clear all history for a specific device */
  clearDevice(deviceId: string): number {
    const countRow = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM device_history WHERE device_id = ?"
    ).get(deviceId) as { cnt: number };
    const deleted = countRow.cnt;

    this.db.prepare("DELETE FROM device_history WHERE device_id = ?").run(deviceId);
    this.lastRecordTime.delete(deviceId);
    return deleted;
  }

  /** Clear all history for all devices */
  clearAll(): number {
    const countRow = this.db.prepare("SELECT COUNT(*) as cnt FROM device_history").get() as { cnt: number };
    const deleted = countRow.cnt;

    this.db.prepare("DELETE FROM device_history").run();
    this.lastRecordTime.clear();
    return deleted;
  }
}
