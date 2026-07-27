// frontend/src/store/mqtt-provisioning-store.ts — Zustand store for MQTT provisioning state

import { create } from "zustand";
import { API_URL } from "../lib/env";

// ---- Types ----

export type SecurityLevel = "open" | "shared_password" | "per_device";

export interface MqttCredentialListItem {
  id: string;
  deviceName: string;
  username: string;
  createdAt: number;
}

export interface MqttCredential {
  id: string;
  deviceName: string;
  username: string;
  password: string;
}

export interface SecurityStatus {
  level: SecurityLevel;
  sharedCredential: { username: string; password: string } | null;
  backendConnected: boolean;
  managedProvisioningEnabled: boolean;
}

// ---- API helpers ----

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { authFetch } = await import("../lib/auth-fetch");
  const res = await authFetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ---- State interface ----

interface MqttProvisioningState {
  level: SecurityLevel;
  sharedCredential: { username: string; password: string } | null;
  credentials: MqttCredentialListItem[];
  loading: boolean;
  managedProvisioningEnabled: boolean;

  fetchStatus: () => Promise<void>;
  setLevel: (level: SecurityLevel) => Promise<void>;
  regenerateSharedPassword: () => Promise<void>;
  createCredential: (deviceName: string) => Promise<MqttCredential>;
  revokeCredential: (id: string) => Promise<void>;
  fetchCredentials: () => Promise<void>;
}

// ---- Store ----

export const useMqttProvisioningStore = create<MqttProvisioningState>((set) => ({
  // Initial state
  level: "open",
  sharedCredential: null,
  credentials: [],
  loading: false,
  managedProvisioningEnabled: false,

  // ---- Actions ----

  fetchStatus: async () => {
    set({ loading: true });
    try {
      const status = await request<SecurityStatus>("/api/mqtt/provisioning/status");
      set({
        level: status.level,
        sharedCredential: status.sharedCredential,
        managedProvisioningEnabled: status.managedProvisioningEnabled,
        loading: false,
      });
    } catch (err) {
      console.warn("[mqtt-provisioning-store] Failed to fetch status:", err);
      set({ loading: false });
    }
  },

  setLevel: async (level) => {
    set({ loading: true });
    try {
      const status = await request<SecurityStatus>("/api/mqtt/provisioning/level", {
        method: "PUT",
        body: JSON.stringify({ level }),
      });
      set({
        level: status.level,
        sharedCredential: status.sharedCredential,
        loading: false,
      });
    } catch (err) {
      console.warn("[mqtt-provisioning-store] Failed to set level:", err);
      set({ loading: false });
    }
  },

  regenerateSharedPassword: async () => {
    set({ loading: true });
    try {
      const credential = await request<{ username: string; password: string }>(
        "/api/mqtt/provisioning/shared/regenerate",
        { method: "POST" },
      );
      set({ sharedCredential: credential, loading: false });
    } catch (err) {
      console.warn("[mqtt-provisioning-store] Failed to regenerate shared password:", err);
      set({ loading: false });
    }
  },

  createCredential: async (deviceName) => {
    set({ loading: true });
    try {
      const credential = await request<MqttCredential>(
        "/api/mqtt/provisioning/credentials",
        {
          method: "POST",
          body: JSON.stringify({ deviceName }),
        },
      );
      // Refresh the credentials list after creation
      const credentials = await request<MqttCredentialListItem[]>(
        "/api/mqtt/provisioning/credentials",
      );
      set({ credentials, loading: false });
      return credential;
    } catch (err) {
      console.warn("[mqtt-provisioning-store] Failed to create credential:", err);
      set({ loading: false });
      throw err;
    }
  },

  revokeCredential: async (id) => {
    set({ loading: true });
    try {
      await request<void>(`/api/mqtt/provisioning/credentials/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      // Remove from local state
      set((prev) => ({
        credentials: prev.credentials.filter((c) => c.id !== id),
        loading: false,
      }));
    } catch (err) {
      console.warn("[mqtt-provisioning-store] Failed to revoke credential:", err);
      set({ loading: false });
    }
  },

  fetchCredentials: async () => {
    set({ loading: true });
    try {
      const credentials = await request<MqttCredentialListItem[]>(
        "/api/mqtt/provisioning/credentials",
      );
      set({ credentials, loading: false });
    } catch (err) {
      console.warn("[mqtt-provisioning-store] Failed to fetch credentials:", err);
      set({ loading: false });
    }
  },
}));
