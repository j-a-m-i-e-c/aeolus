// frontend/src/lib/api-client.ts — HTTP client for backend API

import { authFetch } from "./auth-fetch";
import { API_URL } from "./env";
import { createMutationId, rememberLocalMutation } from "./mutation-id";

export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: optionHeaders, ...rest } = options ?? {};
  const res = await authFetch(`${API_URL}${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(optionHeaders ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiRequestError(res.status, body.error || `Request failed: ${res.status}`);
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

export interface PrivateTopic {
  id: string;
  pattern: string;
  createdAt: number;
}

/** List the private MQTT topic filters (admin only). */
export async function fetchPrivateTopics() {
  const { topics } = await request<{ topics: PrivateTopic[] }>("/api/mqtt/private-topics");
  return topics;
}

/** Register a private MQTT topic filter (admin only). */
export async function addPrivateTopic(pattern: string) {
  const { topic } = await request<{ topic: PrivateTopic }>("/api/mqtt/private-topics", {
    method: "POST",
    body: JSON.stringify({ pattern }),
  });
  return topic;
}

/** Remove a private MQTT topic filter (admin only). */
export async function removePrivateTopic(id: string) {
  return request<{ success: boolean }>(`/api/mqtt/private-topics/${id}`, {
    method: "DELETE",
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

export async function deleteAutomation(id: string, revision: number) {
  const mutationId = createMutationId();
  return request<{ success: boolean }>(`/api/automations/${id}`, {
    method: "DELETE",
    headers: {
      "If-Match": `"${revision}"`,
      "X-Aeolus-Mutation-Id": mutationId,
    },
  });
}

// ---- Layout persistence ----

import type { LayoutPayload, LayoutWritePayload } from "../types/dashboard";

export async function fetchLayout(): Promise<LayoutPayload> {
  return request<LayoutPayload>("/api/layout");
}

export async function saveLayout(payload: LayoutWritePayload, revision: number): Promise<{ success: boolean; revision: number }> {
  const mutationId = createMutationId();
  rememberLocalMutation(mutationId);
  return request<{ success: boolean; revision: number }>("/api/layout", {
    method: "PUT",
    headers: { "If-Match": `"${revision}"`, "X-Aeolus-Mutation-Id": mutationId },
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
