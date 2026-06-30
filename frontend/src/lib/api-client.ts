// frontend/src/lib/api-client.ts — HTTP client for backend API

import { authFetch } from "./auth-fetch";
import { API_URL } from "./env";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
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

export async function fetchDevices() {
  return request<Record<string, unknown>[]>("/api/devices");
}

export async function fetchDevice(id: string) {
  return request<Record<string, unknown>>(`/api/devices/${id}`);
}

export async function fetchState() {
  return request<Record<string, unknown>>("/api/state");
}

export async function fetchHealth() {
  return request<Record<string, unknown>>("/api/health");
}

export async function sendAction(deviceId: string, type: string, params?: Record<string, unknown>) {
  return request<{ success: boolean }>(`/api/devices/${deviceId}/action`, {
    method: "POST",
    body: JSON.stringify({ type, params }),
  });
}

export async function publishMqtt(topic: string, payload: string) {
  return request<{ success: boolean }>("/api/mqtt/publish", {
    method: "POST",
    body: JSON.stringify({ topic, payload }),
  });
}

export interface AutomationRule {
  id: string;
  topic: string;
  name: string | null;
  hasCondition: boolean;
}

export async function fetchAutomations() {
  return request<AutomationRule[]>("/api/automations");
}

export async function deleteAutomation(id: string) {
  return request<{ success: boolean }>(`/api/automations/${id}`, {
    method: "DELETE",
  });
}

// ---- Layout persistence ----

import type { LayoutPayload } from "../types/dashboard";

export async function fetchLayout(): Promise<LayoutPayload> {
  return request<LayoutPayload>("/api/layout");
}

export async function saveLayout(payload: LayoutPayload): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/api/layout", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// ---- Connector management ----

export async function fetchAvailableConnectors() {
  return request<Record<string, unknown>[]>("/api/connectors/available");
}

export async function fetchEnabledConnectors() {
  return request<Record<string, unknown>[]>("/api/connectors");
}

export async function enableConnector(connectorType: string, config: Record<string, unknown>) {
  return request<{ success: boolean; id: string }>("/api/connectors", {
    method: "POST",
    body: JSON.stringify({ connector_type: connectorType, config }),
  });
}

export async function disableConnector(id: string) {
  return request<{ success: boolean }>(`/api/connectors/${id}`, {
    method: "DELETE",
  });
}

export async function retryConnector(id: string) {
  return request<{ success: boolean }>(`/api/connectors/${id}/retry`, {
    method: "POST",
  });
}

export async function executeConnectorSetupStep(
  id: string,
  stepId: string,
  params: Record<string, unknown>,
) {
  return request<Record<string, unknown>>(`/api/connectors/${id}/setup/${stepId}`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function fetchSetupSteps(connectorId: string) {
  return request<Record<string, unknown>[]>(`/api/connectors/${connectorId}/setup-steps`);
}

export async function patchConnectorConfig(connectorId: string, config: Record<string, unknown>) {
  return request<{ success: boolean }>(`/api/connectors/${connectorId}`, {
    method: "PATCH",
    body: JSON.stringify({ config }),
  });
}

// ---- Device state history ----

export interface HistoryEntry {
  deviceId: string;
  state: Record<string, unknown>;
  timestamp: number;
}

export async function fetchDeviceHistory(deviceId: string, limit?: number): Promise<HistoryEntry[]> {
  const params = limit ? `?limit=${limit}` : '';
  return request<HistoryEntry[]>(`/api/devices/${deviceId}/history${params}`);
}

export async function clearDeviceHistory(deviceId: string): Promise<{ success: boolean; deleted: number }> {
  return request<{ success: boolean; deleted: number }>(`/api/devices/${deviceId}/history`, {
    method: "DELETE",
  });
}

export async function clearAllDeviceHistory(): Promise<{ success: boolean; deleted: number }> {
  return request<{ success: boolean; deleted: number }>("/api/devices/history/all", {
    method: "DELETE",
  });
}
