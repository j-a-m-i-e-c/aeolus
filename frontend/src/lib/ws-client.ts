// frontend/src/lib/ws-client.ts — WebSocket client with auto-reconnect

import { useDeviceStore } from "../store/device-store";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001/ws";
const RECONNECT_DELAY = 3000;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket(): void {
  if (ws?.readyState === WebSocket.OPEN) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    useDeviceStore.getState().setWsConnected(true);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "snapshot") {
        useDeviceStore.getState().setDevices(msg.data);
      } else if (msg.type === "state-change") {
        useDeviceStore.getState().updateDevice(msg.data.deviceId, msg.data.state);
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    useDeviceStore.getState().setWsConnected(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_DELAY);
}

export function disconnectWebSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}
