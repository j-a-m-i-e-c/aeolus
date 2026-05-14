// src/core/device-registry.ts — In-memory device cache backed by SQLite

import type { Database } from "sql.js";
import type { EventEmitter } from "node:events";
import type { Device, NormalizedEvent } from "./types.js";
import { WS_STATE_CHANGE } from "./event-bus.js";
import logger from "../logger.js";
import { persistDatabase } from "../db/database.js";

/** Serialize a Device to JSON-safe values for SQLite */
export function serializeDevice(device: Device): Record<string, unknown> {
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    capabilities: JSON.stringify(device.capabilities),
    state: JSON.stringify(device.state),
    integration: device.integration,
    last_seen: device.lastSeen,
  };
}

/** Deserialize a SQLite row back into a Device */
export function deserializeDevice(row: Record<string, unknown>): Device | null {
  try {
    if (!row || typeof row.id !== "string" || typeof row.name !== "string") {
      return null;
    }
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as Device["type"],
      capabilities: JSON.parse(row.capabilities as string),
      state: JSON.parse(row.state as string),
      integration: (row.integration as string) || "mqtt",
      lastSeen: row.last_seen as number,
    };
  } catch (err) {
    logger.warn({ row, error: (err as Error).message }, "Malformed device row, skipping");
    return null;
  }
}

export class DeviceRegistry {
  private devices = new Map<string, Device>();
  private db: Database;
  private eventBus: EventEmitter;

  constructor(db: Database, eventBus: EventEmitter) {
    this.db = db;
    this.eventBus = eventBus;
  }

  /** Load all persisted devices into memory on startup */
  loadFromDb(): void {
    const results = this.db.exec("SELECT * FROM devices");
    let loaded = 0;
    if (results.length > 0) {
      const columns = results[0].columns;
      for (const values of results[0].values) {
        const row: Record<string, unknown> = {};
        columns.forEach((col: string, i: number) => { row[col] = values[i]; });
        const device = deserializeDevice(row);
        if (device) {
          this.devices.set(device.id, device);
          loaded++;
        }
      }
    }
    logger.info({ loaded }, "Loaded devices from database");
  }

  getAll(): Device[] {
    return Array.from(this.devices.values());
  }

  getById(id: string): Device | undefined {
    return this.devices.get(id);
  }

  get size(): number {
    return this.devices.size;
  }

  upsert(event: NormalizedEvent): Device {
    const existing = this.devices.get(event.deviceId);

    const device: Device = existing
      ? {
          ...existing,
          state: { ...existing.state, ...event.state },
          capabilities: event.capabilities ?? existing.capabilities,
          lastSeen: event.timestamp,
        }
      : {
          id: event.deviceId,
          name: event.name ?? this.deriveNameFromId(event.deviceId),
          type: event.deviceType,
          capabilities: event.capabilities ?? this.inferCapabilities(event.deviceType),
          state: event.state,
          integration: event.integration || "mqtt",
          lastSeen: event.timestamp,
        };

    this.devices.set(device.id, device);
    this.persistDevice(device, !!existing);

    this.eventBus.emit(WS_STATE_CHANGE, {
      deviceId: device.id,
      state: device.state,
      timestamp: device.lastSeen,
      // Include full device info for new devices so the frontend can add them
      ...(!existing && { device }),
    });

    return device;
  }

  remove(id: string): boolean {
    const existed = this.devices.delete(id);
    if (existed) {
      this.db.run("DELETE FROM devices WHERE id = ?", [id]);
      persistDatabase();
    }
    return existed;
  }

  registerDevice(device: Device): void {
    this.devices.set(device.id, device);
    this.persistDevice(device, false);
  }

  private persistDevice(device: Device, isUpdate: boolean): void {
    try {
      const s = serializeDevice(device);
      if (isUpdate) {
        this.db.run(
          "UPDATE devices SET name=?, type=?, capabilities=?, state=?, integration=?, last_seen=? WHERE id=?",
          [s.name, s.type, s.capabilities, s.state, s.integration, s.last_seen, s.id]
        );
      } else {
        this.db.run(
          "INSERT OR REPLACE INTO devices (id, name, type, capabilities, state, integration, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [s.id, s.name, s.type, s.capabilities, s.state, s.integration, s.last_seen]
        );
      }
      persistDatabase();
    } catch (err) {
      logger.error({ deviceId: device.id, error: (err as Error).message }, "Failed to persist device");
    }
  }

  /** Derive a human-readable name from a hyphen-separated device ID.
   *  Strips the first segment (assumed to be the type) and title-cases the rest.
   *  Falls back to the raw deviceId if nothing remains after stripping. */
  private deriveNameFromId(deviceId: string): string {
    return deviceId.split("-").slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") || deviceId;
  }

  private inferCapabilities(type: string): string[] {
    switch (type) {
      case "light": return ["on/off", "brightness"];
      case "switch": return ["on/off"];
      case "sensor": return ["temperature"];
      case "climate": return ["temperature", "humidity"];
      case "plug": return ["on/off", "energy-monitoring"];
      case "valve": return ["on/off"];
      case "pump": return ["on/off"];
      case "fan": return ["on/off", "speed"];
      case "lock": return ["lock/unlock"];
      case "motion": return ["motion-detection"];
      default: return [];
    }
  }
}