// frontend/src/lib/api-client.ts — HTTP client for backend API

const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3001`;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
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

export async function fetchSimulatorStatus() {
  return request<{ running: boolean }>("/api/simulator");
}

export async function startSimulator() {
  return request<{ running: boolean }>("/api/simulator/start", { method: "POST" });
}

export async function stopSimulator() {
  return request<{ running: boolean }>("/api/simulator/stop", { method: "POST" });
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
