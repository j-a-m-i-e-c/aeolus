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

interface DeviceState {
  devices: Record<string, Device>;
  health: HealthStatus | null;
  wsConnected: boolean;
  setDevices: (devices: Record<string, Device>) => void;
  updateDevice: (deviceId: string, state: Record<string, unknown>) => void;
  setHealth: (health: HealthStatus) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: {},
  health: null,
  wsConnected: false,
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
}));
