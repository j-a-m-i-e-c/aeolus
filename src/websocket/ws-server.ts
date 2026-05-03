// src/websocket/ws-server.ts — WebSocket server for real-time state updates

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import logger from "../logger.js";

/** Maps an internal event bus event to a WebSocket message type string */
export interface WsEventMapping {
  eventName: string;
  messageType: string;
}

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server, registry: DeviceRegistry, eventBus: EventEmitter, mappings: WsEventMapping[]) {
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

    // Data-driven broadcast registration
    for (const { eventName, messageType } of mappings) {
      eventBus.on(eventName, (data: unknown) => {
        this.broadcast({ type: messageType, data });
      });
    }
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