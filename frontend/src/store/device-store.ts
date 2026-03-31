// frontend/src/store/device-store.ts — Zustand store for device state

import { create } from "zustand";

export interface Device {
  id: string;
  name: string;
  type: "light" | "sensor" | "switch" | "climate";
  capabilities: string[];
  state: Record<string, unknown>;
  integration: string;
  lastSeen: number;
}

export interface HealthStatus {
  mqtt: "connected" | "disconnected";
  deviceCount: number;
  ruleCount: number;
  uptime: number;
  timestamp: string;
}

export interface MqttMessage {
  topic: string;
  payload: string;
  timestamp: number;
}

export interface AutomationEvent {
  ruleId: string;
  ruleName: string;
  topic: string;
  deviceId: string;
  timestamp: number;
}

interface DeviceState {
  devices: Record<string, Device>;
  health: HealthStatus | null;
  wsConnected: boolean;
  mqttMessages: MqttMessage[];
  automationEvents: AutomationEvent[];
  deviceHistory: Record<string, number[]>; // deviceId → last N values
  setDevices: (devices: Record<string, Device>) => void;
  updateDevice: (deviceId: string, state: Record<string, unknown>) => void;
  setHealth: (health: HealthStatus) => void;
  setWsConnected: (connected: boolean) => void;
  addMqttMessage: (msg: MqttMessage) => void;
  clearMqttMessages: () => void;
  addAutomationEvent: (event: AutomationEvent) => void;
  clearAutomationEvents: () => void;
  addDeviceValue: (deviceId: string, value: number) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: {},
  health: null,
  wsConnected: false,
  mqttMessages: [],
  automationEvents: [],
  deviceHistory: {},
  setDevices: (devices) => set({ devices }),
  updateDevice: (deviceId, state) =>
    set((prev) => {
      const existing = prev.devices[deviceId];
      if (!existing) return prev;
      return {
        devices: {
          ...prev.devices,
          [deviceId]: { ...existing, state: { ...existing.state, ...state } },
        },
      };
    }),
  setHealth: (health) => set({ health }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  addMqttMessage: (msg) =>
    set((prev) => ({
      mqttMessages: [msg, ...prev.mqttMessages].slice(0, 50), // Keep last 50
    })),
  clearMqttMessages: () => set({ mqttMessages: [] }),
  addAutomationEvent: (event) =>
    set((prev) => ({
      automationEvents: [event, ...prev.automationEvents].slice(0, 50),
    })),
  clearAutomationEvents: () => set({ automationEvents: [] }),
  addDeviceValue: (deviceId, value) =>
    set((prev) => ({
      deviceHistory: {
        ...prev.deviceHistory,
        [deviceId]: [...(prev.deviceHistory[deviceId] || []), value].slice(-20),
      },
    })),
}));
