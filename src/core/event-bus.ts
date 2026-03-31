// src/core/event-bus.ts — Internal pub/sub event bus

import { EventEmitter } from "node:events";

/** Event type constants */
export const DEVICE_STATE_CHANGE = "device:state-change" as const;
export const WS_STATE_CHANGE = "ws:state-change" as const;
export const MQTT_RAW_MESSAGE = "mqtt:raw-message" as const;
export const AUTOMATION_FIRED = "automation:fired" as const;

/** Typed event bus instance used across the application */
export const eventBus = new EventEmitter();
