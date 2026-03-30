// src/core/types.ts — Shared TypeScript interfaces for Aeolus

/** Valid device type categories */
export type DeviceType = "light" | "sensor" | "switch" | "climate";

/** Core domain entity representing any IoT device */
export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  capabilities: string[];
  state: Record<string, unknown>;
  integration: string;
  lastSeen: number;
}

/** Internal event emitted after MQTT message normalization */
export interface NormalizedEvent {
  deviceId: string;
  deviceType: DeviceType;
  state: Record<string, unknown>;
  topic: string;
  timestamp: number;
}

/** Automation rule registered in the Rule Registry */
export interface Rule {
  id: string;
  topic: string;
  condition?: (ctx: EventContext) => boolean;
  action: (ctx: EventContext) => void | Promise<void>;
  name?: string;
}

/** Context passed to rule condition and action functions */
export interface EventContext {
  topic: string;
  deviceId: string;
  state: Record<string, unknown>;
  timestamp: number;
}

/** Command sent to an integration to control a device */
export interface Action {
  type: string;
  deviceId: string;
  params: Record<string, unknown>;
}

/** Request body for POST /api/devices/:id/action */
export interface ActionRequest {
  type: string;
  params?: Record<string, unknown>;
}

/** Response shape for GET /api/health */
export interface HealthStatus {
  mqtt: "connected" | "disconnected";
  deviceCount: number;
  ruleCount: number;
  uptime: number;
  timestamp: string;
}

/** Standard API error response */
export interface ApiError {
  error: string;
  statusCode: number;
}

/** WebSocket message types (server → client) */
export type WsMessage =
  | { type: "snapshot"; data: Record<string, Device> }
  | {
      type: "state-change";
      data: { deviceId: string; state: Record<string, unknown>; timestamp: number };
    };
