// e2e/devices.spec.ts — Device registry and MQTT message handling.

import { test, expect } from "@playwright/test";
import { ensureAdmin, getAdminToken, authedApi } from "./helpers";
import { API_URL } from "./constants";

test.describe("devices & MQTT", () => {
  test("device list API returns an array", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/devices`);
    expect(res.ok()).toBe(true);

    const devices = await res.json();
    expect(Array.isArray(devices)).toBe(true);
  });

  test("health endpoint reports MQTT status", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/health`);
    expect(res.ok()).toBe(true);

    const health = (await res.json()) as { mqtt: string };
    expect(["connected", "disconnected"]).toContain(health.mqtt);
  });

  test("device action endpoint returns error for unknown device", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.post(`${API_URL}/api/devices/nonexistent-device-id/action`, {
      type: "toggle",
      params: {},
    });

    // Should return a structured response (not a 500 crash)
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  test("can publish MQTT message via API", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.post(`${API_URL}/api/mqtt/publish`, {
      topic: "e2e/test/temperature",
      payload: JSON.stringify({ value: 23.5, unit: "°C" }),
    });

    // 200 if MQTT connected, 503 if not — both are valid
    expect(res.status()).toBeLessThan(500);
  });
});
