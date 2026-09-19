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
  private readonly pendingWrites = new Map<string, Device>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly flushDelayMs: number;

  constructor(db: DatabaseType, eventBus: EventEmitter, flushDelayMs = 100) {
    this.db = db;
    this.eventBus = eventBus;
    this.flushDelayMs = flushDelayMs;
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
    this.schedulePersist(device);

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
      this.pendingWrites.delete(id);
      this.db.prepare("DELETE FROM devices WHERE id = ?").run(id);
    }
    return existed;
  }

  registerDevice(device: Device): void {
    this.devices.set(device.id, device);
    if (device.integration === "mqtt" && device.topic) {
      this.mqttDeviceIdsByTopic.set(device.topic, device.id);
    }
    this.persistNow(device);
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
    this.persistNow(updated);
    return updated;
  }

  private schedulePersist(device: Device): void {
    if (this.disposed) return;
    this.pendingWrites.set(device.id, device);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingWrites();
    }, this.flushDelayMs);
  }

  /**
   * Persist a configuration change before returning to the caller.
   *
   * Only telemetry is safe to batch. A device re-publishes its state, so losing
   * the last few milliseconds of it costs nothing and the next message repairs
   * it. Registration and command-profile writes are operator intent that nothing
   * will ever send again, and `setMqttCommandProfile` promises the profile
   * survives a restart — so these cannot be left sitting in the batch window
   * where a crash or a restart would silently discard them.
   */
  private persistNow(device: Device): void {
    this.schedulePersist(device);
    this.flushPendingWrites();
  }

  /**
   * Persist the newest snapshot for every dirty device in one SQLite
   * transaction. High-rate telemetry can update memory and WebSocket clients
   * immediately without forcing one synchronous SQLite write per message.
   */
  flushPendingWrites(): void {
    if (this.pendingWrites.size === 0) return;

    // A batched write is the one write that can outlive the thing it writes to:
    // the timer may fire after the connection has been closed. There is nothing
    // to retry into once that happens, and re-arming the timer would log a
    // failure every flushDelayMs for the life of the process, so the batch is
    // dropped rather than retried.
    if (!this.db.open) {
      this.pendingWrites.clear();
      return;
    }

    const batch = Array.from(this.pendingWrites.values());
    this.pendingWrites.clear();

    try {
      // Statement preparation belongs inside the try with the write it serves.
      // `prepare` throws on a closed or broken connection, and this runs from a
      // timer, so anything thrown here escapes as an unhandled exception rather
      // than reaching the caller.
      const upsert = this.db.prepare(
        `INSERT INTO devices (id, name, type, capabilities, state, integration, last_seen, topic, command_topic, connector_instance_id, mqtt_command_profile)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, type=excluded.type, capabilities=excluded.capabilities,
           state=excluded.state, integration=excluded.integration, last_seen=excluded.last_seen,
           topic=excluded.topic, command_topic=excluded.command_topic,
           connector_instance_id=excluded.connector_instance_id,
           mqtt_command_profile=excluded.mqtt_command_profile`,
      );

      const writeBatch = this.db.transaction((devices: Device[]) => {
        for (const device of devices) {
          const s = serializeDevice(device);
          upsert.run(
            s.id, s.name, s.type, s.capabilities, s.state, s.integration, s.last_seen,
            s.topic, s.command_topic, s.connector_instance_id, s.mqtt_command_profile,
          );
        }
      });

      writeBatch(batch);
    } catch (err) {
      logger.error({ count: batch.length, error: (err as Error).message }, "Failed to persist device batch");
      // Keep the newest in-memory state dirty so a later flush can retry it.
      if (!this.disposed) {
        for (const device of batch) {
          if (!this.pendingWrites.has(device.id)) this.pendingWrites.set(device.id, device);
        }
        if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flushPendingWrites();
          }, this.flushDelayMs);
        }
      }
    }
  }

  /** Flush pending state once and prevent any future write scheduling. */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Mark disposed before the final flush so its error path cannot schedule a
    // retry timer during shutdown. flushPendingWrites itself still performs the
    // write; disposed only suppresses future scheduling.
    this.disposed = true;
    this.flushPendingWrites();
    this.pendingWrites.clear();
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
