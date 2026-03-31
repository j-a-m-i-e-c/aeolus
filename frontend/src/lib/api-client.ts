// frontend/src/lib/api-client.ts — HTTP client for backend API

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

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
