// src/core/device-registry.ts — In-memory device cache backed by SQLite

import type { Database as DatabaseType } from "better-sqlite3";
import type { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { Device, NormalizedEvent, MqttCommandProfile } from "./types.js";
import { WS_STATE_CHANGE } from "./event-bus.js";
import logger from "../logger.js";

interface DeviceRow {
  id: string;
  name: string;
  type: string;
  capabilities: string;
  state: string;
  integration: string;
  last_seen: number;
  topic?: string | null;
  command_topic?: string | null;
  connector_instance_id?: string | null;
  mqtt_command_profile?: string | null;
}

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
    topic: device.topic ?? null,
    command_topic: device.commandTopic ?? null,
    connector_instance_id: device.connectorInstanceId ?? null,
    mqtt_command_profile: device.mqttCommandProfile
      ? JSON.stringify(device.mqttCommandProfile)
      : null,
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
      ...(typeof row.topic === "string" ? { topic: row.topic } : {}),
      ...(typeof row.command_topic === "string" ? { commandTopic: row.command_topic } : {}),
      ...(typeof row.connector_instance_id === "string" ? { connectorInstanceId: row.connector_instance_id } : {}),
      ...(typeof row.mqtt_command_profile === "string" && row.mqtt_command_profile.length > 0
        ? { mqttCommandProfile: JSON.parse(row.mqtt_command_profile as string) as Device["mqttCommandProfile"] }
        : {}),
    };
  } catch (err) {
    logger.warn({ row, error: (err as Error).message }, "Malformed device row, skipping");
    return null;
  }
}

export class DeviceRegistry {
  private devices = new Map<string, Device>();
  /** Exact MQTT state topic → device ID. Unlike the legacy slug, this is lossless. */
  private mqttDeviceIdsByTopic = new Map<string, string>();
  private db: DatabaseType;
  private eventBus: EventEmitter;

  constructor(db: DatabaseType, eventBus: EventEmitter) {
    this.db = db;
    this.eventBus = eventBus;
  }

  /** Load all persisted devices into memory on startup */
  loadFromDb(): void {
    const rows = this.db.prepare("SELECT * FROM devices").all() as DeviceRow[];
    let loaded = 0;
    for (const row of rows) {
      const device = deserializeDevice(row as unknown as Record<string, unknown>);
      if (device) {
        this.devices.set(device.id, device);
        if (device.integration === "mqtt" && device.topic) {
          this.mqttDeviceIdsByTopic.set(device.topic, device.id);
        }
        loaded++;
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

  /** Return the MQTT device registered for this exact state topic, if any. */
  getByMqttTopic(topic: string): Device | undefined {
    const id = this.mqttDeviceIdsByTopic.get(topic);
    return id ? this.devices.get(id) : undefined;
  }

  /**
   * Resolve a device ID for an MQTT state topic without losing the topic as the
   * source identity. Existing legacy devices retain their readable IDs when
   * first associated with a source topic; only genuine slug collisions receive
   * a deterministic hash suffix.
   */
  resolveMqttDeviceId(topic: string, legacyDeviceId: string): string {
    const existingForTopic = this.getByMqttTopic(topic);
    if (existingForTopic) return existingForTopic.id;

    const legacyDevice = this.devices.get(legacyDeviceId);
    if (!legacyDevice || (legacyDevice.integration === "mqtt" && !legacyDevice.topic)) {
      return legacyDeviceId;
    }

    const hash = createHash("sha256").update(topic).digest("hex");
    for (const length of [12, 16, 20, 24, 32, 64]) {
      const candidate = `mqtt-${legacyDeviceId}-${hash.slice(0, length)}`;
      const existing = this.devices.get(candidate);
      if (!existing || existing.topic === topic) return candidate;
    }

    throw new Error(`Unable to allocate a collision-safe MQTT device ID for topic '${topic}'`);
  }

  get size(): number {
    return this.devices.size;
  }

  upsert(event: NormalizedEvent): Device {
    const integration = event.integration || "mqtt";
    const deviceId = integration === "mqtt"
      ? this.resolveMqttDeviceId(event.topic, event.deviceId)
      : event.deviceId;
    const existing = this.devices.get(deviceId);

    const device: Device = existing
      ? {
          ...existing,
          state: { ...existing.state, ...event.state },
          capabilities: event.capabilities ?? existing.capabilities,
          lastSeen: event.timestamp,
          ...(integration === "mqtt" ? { topic: event.topic } : {}),
          ...(event.commandTopic ? { commandTopic: event.commandTopic } : {}),
          ...(event.connectorInstanceId ? { connectorInstanceId: event.connectorInstanceId } : {}),
        }
      : {
          id: deviceId,
          name: event.name ?? this.deriveNameFromId(deviceId),
          type: event.deviceType,
          capabilities: event.capabilities ?? this.inferCapabilities(event.deviceType),
          state: event.state,
          integration,
          lastSeen: event.timestamp,
          ...(integration === "mqtt" ? { topic: event.topic } : {}),
          ...(event.commandTopic ? { commandTopic: event.commandTopic } : {}),
          ...(event.connectorInstanceId ? { connectorInstanceId: event.connectorInstanceId } : {}),
        };

    this.devices.set(device.id, device);
    if (device.integration === "mqtt" && device.topic) {
      this.mqttDeviceIdsByTopic.set(device.topic, device.id);
    }
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
    const device = this.devices.get(id);
    const existed = this.devices.delete(id);
    if (existed) {
      if (device?.integration === "mqtt" && device.topic) {
        this.mqttDeviceIdsByTopic.delete(device.topic);
      }
      this.db.prepare("DELETE FROM devices WHERE id = ?").run(id);
    }
    return existed;
  }

  registerDevice(device: Device): void {
    this.devices.set(device.id, device);
    if (device.integration === "mqtt" && device.topic) {
      this.mqttDeviceIdsByTopic.set(device.topic, device.id);
    }
    this.persistDevice(device, false);
  }

  /**
   * Set (or clear, when `profile` is undefined) a device's generic MQTT command
   * profile and persist it (phase-1 Req 2.1, 2.9). Returns the updated device,
   * or undefined when the device does not exist. In-memory and SQLite stay in
   * sync so the profile survives restart.
   */
  setMqttCommandProfile(id: string, profile: MqttCommandProfile | undefined): Device | undefined {
    const existing = this.devices.get(id);
    if (!existing) return undefined;

    const updated: Device = { ...existing };
    if (profile) {
      updated.mqttCommandProfile = profile;
    } else {
      delete updated.mqttCommandProfile;
    }

    this.devices.set(id, updated);
    this.persistDevice(updated, true);
    return updated;
  }

  private persistDevice(device: Device, isUpdate: boolean): void {
    try {
      const s = serializeDevice(device);
      if (isUpdate) {
        this.db.prepare(
          "UPDATE devices SET name=?, type=?, capabilities=?, state=?, integration=?, last_seen=?, topic=?, command_topic=?, connector_instance_id=?, mqtt_command_profile=? WHERE id=?"
        ).run(s.name, s.type, s.capabilities, s.state, s.integration, s.last_seen, s.topic, s.command_topic, s.connector_instance_id, s.mqtt_command_profile, s.id);
      } else {
        this.db.prepare(
          "INSERT OR REPLACE INTO devices (id, name, type, capabilities, state, integration, last_seen, topic, command_topic, connector_instance_id, mqtt_command_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(s.id, s.name, s.type, s.capabilities, s.state, s.integration, s.last_seen, s.topic, s.command_topic, s.connector_instance_id, s.mqtt_command_profile);
      }
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
