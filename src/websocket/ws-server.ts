// src/websocket/ws-server.ts — WebSocket server for real-time state updates
// Enhanced with JWT authentication and tab-based event filtering

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import { verifyAccessToken } from "../auth/token-service.js";
import { getUserAccessibleTabs } from "../auth/permission-service.js";
import logger from "../logger.js";

/** Maps an internal event bus event to a WebSocket message type string */
export interface WsEventMapping {
  eventName: string;
  messageType: string;
}

/** Authenticated WebSocket client with user context */
export interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
  role: "admin" | "user";
  groupId: string | null;
  accessibleTabIds: Set<string>;
}

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, AuthenticatedClient>();

  constructor(server: Server, registry: DeviceRegistry, eventBus: EventEmitter, mappings: WsEventMapping[]) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws, req) => {
      // Parse token from query parameter
      const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const token = url.searchParams.get("token");

      // Reject if no token provided
      if (!token) {
        logger.debug("WebSocket connection rejected: no token provided");
        ws.close(4001, "Authentication required");
        return;
      }

      // Verify the token
      let payload: ReturnType<typeof verifyAccessToken>;
      try {
        payload = verifyAccessToken(token);
      } catch {
        logger.debug("WebSocket connection rejected: invalid or expired token");
        ws.close(4001, "Invalid token");
        return;
      }

      // Get user's accessible tabs
      let accessibleTabIds: Set<string>;
      try {
        const tabs = getUserAccessibleTabs(payload.userId);
        accessibleTabIds = new Set(tabs.map((t) => t.tabId));
      } catch (err) {
        logger.error({ error: (err as Error).message }, "WebSocket auth error: failed to get user tabs");
        ws.close(4002, "Authentication error");
        return;
      }

      // Store authenticated client context
      const client: AuthenticatedClient = {
        ws,
        userId: payload.userId,
        role: payload.role,
        groupId: payload.groupId,
        accessibleTabIds,
      };
      this.clients.set(ws, client);

      logger.debug(
        { userId: payload.userId, role: payload.role, clientCount: this.clients.size },
        "WebSocket client connected (authenticated)",
      );

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

    // Extract tabId from message data for filtering
    const msgData = (message as { data?: unknown })?.data;
    const tabId =
      msgData && typeof msgData === "object" && "tabId" in msgData
        ? (msgData as { tabId: string }).tabId
        : null;

    for (const [, client] of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      // Admin users receive all messages
      if (client.role === "admin") {
        client.ws.send(json);
        continue;
      }

      // If message has a tabId, only send to clients with access to that tab
      if (tabId) {
        if (client.accessibleTabIds.has(tabId)) {
          client.ws.send(json);
        }
        // Skip clients without access to this tab
        continue;
      }

      // Messages without a tabId are sent to all authenticated clients
      client.ws.send(json);
    }
  }

  /** Send close frames to all connected clients and close the WebSocket server */
  closeAll(): void {
    for (const [, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(1001, "Server shutting down");
      }
    }
    this.clients.clear();
    this.wss.close();
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
