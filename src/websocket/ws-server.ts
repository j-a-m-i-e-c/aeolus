// src/websocket/ws-server.ts — WebSocket server for real-time state updates

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import { WS_STATE_CHANGE, MQTT_RAW_MESSAGE, AUTOMATION_FIRED } from "../core/event-bus.js";
import logger from "../logger.js";

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server, registry: DeviceRegistry, eventBus: EventEmitter) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      logger.debug({ clientCount: this.clients.size }, "WebSocket client connected");

      // Send initial snapshot
      const devices = registry.getAll();
      const snapshot: Record<string, Device> = {};
      for (const d of devices) {
        snapshot[d.id] = d;
      }
      this.send(ws, { type: "snapshot", data: snapshot });

      ws.on("close", () => {
        this.clients.delete(ws);
        logger.debug({ clientCount: this.clients.size }, "WebSocket client disconnected");
      });

      ws.on("error", (err) => {
        logger.error({ error: err.message }, "WebSocket client error");
        this.clients.delete(ws);
      });
    });

    // Broadcast state changes
    eventBus.on(WS_STATE_CHANGE, (data: { deviceId: string; state: Record<string, unknown>; timestamp: number }) => {
      this.broadcast({ type: "state-change", data });
    });

    // Broadcast raw MQTT messages for inspector
    eventBus.on(MQTT_RAW_MESSAGE, (data: { topic: string; payload: string; timestamp: number }) => {
      this.broadcast({ type: "mqtt-message", data });
    });

    // Broadcast automation fired events
    eventBus.on(AUTOMATION_FIRED, (data: { ruleId: string; ruleName: string; topic: string; deviceId: string; timestamp: number }) => {
      this.broadcast({ type: "automation-fired", data });
    });
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: unknown): void {
    const json = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(json);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}