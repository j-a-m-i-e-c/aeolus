// src/websocket/ws-server.ts — WebSocket server for real-time state updates
// Enhanced with JWT authentication and tab-based event filtering

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { EventEmitter } from "node:events";
import type { DeviceRegistry } from "../core/device-registry.js";
import type { Device } from "../core/types.js";
import type { DeviceExposureResolver } from "../auth/device-exposure-resolver.js";
import { verifyAccessTokenWithExpiry } from "../auth/token-service.js";
import { getUserAccessibleTabs } from "../auth/permission-service.js";
import { WS_CLIENT_CONNECT, WS_CLIENT_DISCONNECT, WS_BROADCAST } from "../core/event-bus.js";
import logger from "../logger.js";

/** Time (ms) a client has to send a valid auth message before disconnection */
const AUTH_TIMEOUT_MS = 5000;

/**
 * Server-derived authorization scope for a broadcast. This is the single source
 * of truth for who may observe an event; it is computed on the server from the
 * event's resource identity and is NEVER read from the (untrusted) payload.
 *
 * Fail-closed model:
 *  - `public` — every authenticated client may observe it.
 *  - `admin`  — only admins may observe it (the default for unscoped events).
 *  - `tabs`   — non-admins may observe it iff they can access one of `tabIds`.
 *               An empty `tabIds` therefore reaches admins only.
 */
export type BroadcastEnvelope =
  | { visibility: "public" }
  | { visibility: "admin" }
  | { visibility: "tabs"; tabIds: string[] };

/** Maps an internal event bus event to a WebSocket message type string */
export interface WsEventMapping {
  eventName: string;
  messageType: string;
  /**
   * Computes the server-derived visibility for an event of this type from its
   * payload. Producers do not decorate events with a visibility field; this
   * resolver derives it from resource identity (e.g. a device's exposing tabs).
   * Omit to treat the event as unscoped — admin-only.
   */
  visibility?: (data: unknown) => BroadcastEnvelope;
}

/** Unscoped events are admin-only by default (fail-closed). */
const ADMIN_ONLY: BroadcastEnvelope = { visibility: "admin" };

/** Authenticated WebSocket client with user context */
export interface AuthenticatedClient {
  ws: WebSocket;
  userId: string;
  role: "admin" | "user";
  groupId: string | null;
  accessibleTabIds: Set<string>;
}

/**
 * Decide whether a client may observe an event given its server-derived
 * visibility. Fail-closed: a client only receives an event when a rule
 * explicitly grants it. Admins observe the entire system.
 */
function canObserve(client: AuthenticatedClient, envelope: BroadcastEnvelope): boolean {
  // Admins observe the entire system regardless of scope.
  if (client.role === "admin") return true;
  if (envelope.visibility === "public") return true;
  if (envelope.visibility === "admin") return false;
  // Tab-scoped: reachable only when the client shares one of the listed tabs.
  return envelope.tabIds.some((tabId) => client.accessibleTabIds.has(tabId));
}

export class WsServer {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, AuthenticatedClient>();
  private eventBus: EventEmitter;
  private deviceExposureResolver: DeviceExposureResolver;

  constructor(
    server: Server,
    registry: DeviceRegistry,
    eventBus: EventEmitter,
    mappings: WsEventMapping[],
    deviceExposureResolver: DeviceExposureResolver,
  ) {
    this.eventBus = eventBus;
    this.deviceExposureResolver = deviceExposureResolver;
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

    // Data-driven broadcast registration. Each mapping derives its own
    // server-side visibility; an absent resolver means the event is unscoped
    // and therefore admin-only (fail-closed).
    for (const { eventName, messageType, visibility } of mappings) {
      eventBus.on(eventName, (data: unknown) => {
        const envelope = visibility ? visibility(data) : ADMIN_ONLY;
        this.broadcast({ type: messageType, data }, envelope);
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

    // Send initial snapshot, scoped to the devices this client may observe.
    // Uses the SAME rule as the live device broadcast (device exposing tabs
    // intersected with the client's accessible tabs, admins see all) so the
    // snapshot and the live stream are consistent by construction.
    const devices = registry.getAll();
    const snapshot: Record<string, Device> = {};
    if (client.role === "admin") {
      for (const d of devices) {
        snapshot[d.id] = d;
      }
    } else {
      const exposingByDevice = this.deviceExposureResolver.getExposingTabsBatch(
        devices.map((d) => d.id),
      );
      for (const d of devices) {
        const tabIds = exposingByDevice.get(d.id) ?? [];
        if (canObserve(client, { visibility: "tabs", tabIds })) {
          snapshot[d.id] = d;
        }
      }
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

  private broadcast(message: unknown, envelope: BroadcastEnvelope): void {
    const json = JSON.stringify(message);

    for (const [, client] of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (canObserve(client, envelope)) {
        client.ws.send(json);
      }
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
