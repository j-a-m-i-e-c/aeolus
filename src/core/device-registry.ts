// src/core/device-registry.ts — In-memory device cache backed by SQLite

import type Database from "better-sqlite3";
import type { EventEmitter } from "node:events";
import type { Device, NormalizedEvent } from "./types.js";
import { WS_STATE_CHANGE } from "./event-bus.js";
import logger from "../logger.js";

/** Serialize a Device to JSON-safe row for SQLite */
export function serializeDevice(device: Device): {
  id: string;
  name: string;
  type: string;
  capabilities: string;
  state: string;
  integration: string;
  last_seen: number;
} {
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
  private db: Database.Database;
  private eventBus: EventEmitter;

  private insertStmt: Database.Statement;
  private updateStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(db: Database.Database, eventBus: EventEmitter) {
    this.db = db;
    this.eventBus = eventBus;

    this.insertStmt = db.prepare(`
      INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen)
      VALUES (@id, @name, @type, @capabilities, @state, @integration, @last_seen)
    `);

    this.updateStmt = db.prepare(`
      UPDATE devices SET name = @name, type = @type, capabilities = @capabilities,
        state = @state, integration = @integration, last_seen = @last_seen
      WHERE id = @id
    `);

    this.deleteStmt = db.prepare(`DELETE FROM devices WHERE id = @id`);
  }

  /** Load all persisted devices into memory on startup */
  loadFromDb(): void {
    const rows = this.db.prepare("SELECT * FROM devices").all() as Record<string, unknown>[];
    let loaded = 0;
    for (const row of rows) {
      const device = deserializeDevice(row);
      if (device) {
        this.devices.set(device.id, device);
        loaded++;
      }
    }
    logger.info({ loaded, total: rows.length }, "Loaded devices from database");
  }

  /** Get all devices */
  getAll(): Device[] {
    return Array.from(this.devices.values());
  }

  /** Get a device by ID */
  getById(id: string): Device | undefined {
    return this.devices.get(id);
  }

  /** Get device count */
  get size(): number {
    return this.devices.size;
  }

  /** Create or update a device from a normalized MQTT event */
  upsert(event: NormalizedEvent): Device {
    const existing = this.devices.get(event.deviceId);

    const device: Device = existing
      ? {
          ...existing,
          state: { ...existing.state, ...event.state },
          lastSeen: event.timestamp,
        }
      : {
          id: event.deviceId,
          name: event.deviceId.split("-").slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ") || event.deviceId,
          type: event.deviceType,
          capabilities: this.inferCapabilities(event.deviceType),
          state: event.state,
          integration: "mqtt",
          lastSeen: event.timestamp,
        };

    this.devices.set(device.id, device);
    this.persistDevice(device, !!existing);

    // Emit state change for WebSocket broadcast
    this.eventBus.emit(WS_STATE_CHANGE, {
      deviceId: device.id,
      state: device.state,
      timestamp: device.lastSeen,
    });

    return device;
  }

  /** Remove a device */
  remove(id: string): boolean {
    const existed = this.devices.delete(id);
    if (existed) {
      this.deleteStmt.run({ id });
    }
    return existed;
  }

  /** Register a device directly (e.g. from an integration) */
  registerDevice(device: Device): void {
    this.devices.set(device.id, device);
    this.persistDevice(device, this.devices.has(device.id));
  }

  private persistDevice(device: Device, isUpdate: boolean): void {
    try {
      const row = serializeDevice(device);
      if (isUpdate) {
        this.updateStmt.run(row);
      } else {
        this.insertStmt.run(row);
      }
    } catch (err) {
      logger.error({ deviceId: device.id, error: (err as Error).message }, "Failed to persist device");
    }
  }

  private inferCapabilities(type: Device["type"]): string[] {
    switch (type) {
      case "light": return ["on/off", "brightness"];
      case "switch": return ["on/off"];
      case "sensor": return ["temperature"];
      case "climate": return ["temperature", "humidity"];
      default: return [];
    }
  }
}