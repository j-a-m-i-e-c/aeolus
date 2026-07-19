// src/websocket/ws-server.ts — WebSocket server for real-time state updates
// Enhanced with JWT authentication and tab-based event filtering

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import { verifyAccessTokenWithExpiry } from "../auth/token-service.js";
import { getUserAccessibleTabs } from "../auth/permission-service.js";
import { WS_CLIENT_CONNECT, WS_CLIENT_DISCONNECT, WS_BROADCAST } from "../core/event-bus.js";
import logger from "../logger.js";

/** Time (ms) a client has to send a valid auth message before disconnection */
const AUTH_TIMEOUT_MS = 5000;

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
  private eventBus: EventEmitter;

  constructor(server: Server, registry: DeviceRegistry, eventBus: EventEmitter, mappings: WsEventMapping[]) {
    this.eventBus = eventBus;
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws, req) => {
      // --- Backward-compatibility: accept token in query string (deprecation path) ---
      // This allows rolling deploys where the frontend still sends ?token=...
      // Remove once all clients are updated to first-message auth.
      const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      const queryToken = url.searchParams.get("token");

      if (queryToken) {
        this.authenticateAndSetup(ws, queryToken, registry);
        return;
      }

      // --- First-message authentication (preferred) ---
      // Client connects without a token in the URL, then sends
      // { type: "auth", token: "..." } as its first message.
      const authTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(4001, "Authentication timeout");
        }
      }, AUTH_TIMEOUT_MS);

      const onAuthMessage = (data: Buffer | string) => {
        let msg: { type?: string; token?: string };
        try {
          msg = JSON.parse(typeof data === "string" ? data : data.toString());
        } catch {
          clearTimeout(authTimer);
          ws.close(4001, "Invalid auth message");
          return;
        }

        if (msg.type !== "auth" || typeof msg.token !== "string") {
          clearTimeout(authTimer);
          ws.close(4001, "Authentication required");
          return;
        }

        clearTimeout(authTimer);
        ws.removeListener("message", onAuthMessage);
        this.authenticateAndSetup(ws, msg.token, registry);
      };

      ws.on("message", onAuthMessage);

      ws.on("close", () => {
        clearTimeout(authTimer);
        ws.removeListener("message", onAuthMessage);
      });
    });

    // Data-driven broadcast registration
    for (const { eventName, messageType } of mappings) {
      eventBus.on(eventName, (data: unknown) => {
        this.broadcast({ type: messageType, data });
      });
    }
  }

  /** Verify token and set up an authenticated client connection */
  private authenticateAndSetup(ws: WebSocket, token: string, registry: DeviceRegistry): void {
    // Verify the token
    let payload: ReturnType<typeof verifyAccessTokenWithExpiry>["payload"];
    let expiresAt: number;
    try {
      const verified = verifyAccessTokenWithExpiry(token);
      payload = verified.payload;
      expiresAt = verified.expiresAt;
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

    this.eventBus.emit(WS_CLIENT_CONNECT, { userId: payload.userId, clientCount: this.clients.size });

    // Send initial snapshot
    const devices = registry.getAll();
    const snapshot: Record<string, Device> = {};
    for (const d of devices) {
      snapshot[d.id] = d;
    }
    this.send(ws, { type: "snapshot", data: snapshot });

    // Close the socket when the access token expires; the client reconnects
    // with a freshly refreshed token. This bounds how long a connection can
    // outlive its token (and how stale its tab permissions can get).
    const ttl = expiresAt - Date.now();
    const expiryTimer: ReturnType<typeof setTimeout> | null =
      ttl > 0
        ? setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(4003, "Token expired");
            }
          }, ttl)
        : null;

    ws.on("close", () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      this.clients.delete(ws);
      this.eventBus.emit(WS_CLIENT_DISCONNECT, { clientCount: this.clients.size });
      logger.debug({ clientCount: this.clients.size }, "WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      if (expiryTimer) clearTimeout(expiryTimer);
      logger.error({ error: err.message }, "WebSocket client error");
      this.clients.delete(ws);
    });
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

    const msgType = (message as { type?: string })?.type || "unknown";
    this.eventBus.emit(WS_BROADCAST, { messageType: msgType, clientCount: this.clients.size });
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
