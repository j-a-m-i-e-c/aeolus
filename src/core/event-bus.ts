// src/core/event-bus.ts — Internal pub/sub event bus

import { EventEmitter } from "node:events";

/** Event type constants */
export const DEVICE_STATE_CHANGE = "device:state-change" as const;
export const WS_STATE_CHANGE = "ws:state-change" as const;
export const MQTT_RAW_MESSAGE = "mqtt:raw-message" as const;
export const AUTOMATION_FIRED = "automation:fired" as const;
export const AUTOMATION_STATE_CHANGE = "automation:state-change" as const;
export const DATA_STORE_WRITE = "data-store:write" as const;
export const DATA_STORE_COLLECTION_DELETED = "data-store:collection-deleted" as const;
export const MQTT_CONNECTION_STATE = "mqtt:connection-state" as const;
export const AUTOMATION_EXECUTION_COMPLETE = "automation:execution-complete" as const;
export const AUTOMATION_RULE_REGISTERED = "automation:rule-registered" as const;
export const AUTOMATION_RULE_UNREGISTERED = "automation:rule-unregistered" as const;
export const MQTT_MESSAGE_PROCESSED = "mqtt:message-processed" as const;
export const CONNECTOR_POLL = "connector:poll" as const;
export const CONNECTOR_ERROR = "connector:error" as const;
export const DATA_STORE_QUERY = "data-store:query" as const;
export const WS_CLIENT_CONNECT = "ws:client-connect" as const;
export const WS_CLIENT_DISCONNECT = "ws:client-disconnect" as const;
export const WS_BROADCAST = "ws:broadcast" as const;
export const MQTT_MESSAGE_PUBLISHED = "mqtt:message-published" as const;

/** Typed event bus instance used across the application */
export const eventBus = new EventEmitter();
