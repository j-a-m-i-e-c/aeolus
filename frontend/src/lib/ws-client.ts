// frontend/src/lib/ws-client.ts — WebSocket client with auto-reconnect

import { useDeviceStore } from "../store/device-store";
import { useAutomationStateStore } from "../store/automation-state-store";
import { useDataStoreStore } from "../store/data-store-store";

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3001/ws`;
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
        // Track numeric values for sparklines
        const val = msg.data.state?.value;
        if (typeof val === "number") {
          useDeviceStore.getState().addDeviceValue(msg.data.deviceId, val);
        }
      } else if (msg.type === "mqtt-message") {
        useDeviceStore.getState().addMqttMessage(msg.data);
      } else if (msg.type === "automation-fired") {
        useDeviceStore.getState().addAutomationEvent(msg.data);
      } else if (msg.type === "automation-state") {
        const { ruleId, key, value } = msg.data;
        useAutomationStateStore.getState().setRuleState(ruleId, key, value);
      } else if (msg.type === "data-store-write") {
        const { collection, record } = msg.data;
        useDataStoreStore.getState().addRealtimeRecord(collection, record);
      } else if (msg.type === "data-store-collection-deleted") {
        const { collection } = msg.data;
        useDataStoreStore.getState().removeCollection(collection);
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
