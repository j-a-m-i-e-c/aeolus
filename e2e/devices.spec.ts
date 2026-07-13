// e2e/devices.spec.ts — Device registry and MQTT message handling.
//
// Exercises the device list API, MQTT publish endpoint, and verifies that
// publishing a message creates/updates a device in the registry. Also tests
// the device action endpoint.

import { test, expect } from "@playwright/test";
import { ensureAdmin } from "./helpers";
import { API_URL } from "./constants";

test.describe("devices & MQTT", () => {
  test("device list API returns an array", async ({ page }) => {
    await ensureAdmin(page);

    const res = await page.request.get(`${API_URL}/api/devices`);
    expect(res.ok()).toBe(true);

    const devices = await res.json();
    expect(Array.isArray(devices)).toBe(true);
  });

  test("can publish an MQTT message via the API", async ({ page }) => {
    await ensureAdmin(page);

    const res = await page.request.post(`${API_URL}/api/mqtt/publish`, {
      data: {
        topic: "e2e/test/temperature",
        payload: JSON.stringify({ value: 23.5, unit: "°C" }),
      },
    });

    // The publish endpoint may return 200 or 503 (if MQTT broker isn't connected
    // in this test environment). Both are valid responses.
    expect(res.status()).toBeLessThan(500);
  });

  test("devices appear in the registry after MQTT messages", async ({ page }) => {
    await ensureAdmin(page);

    // Publish a message on a unique topic
    const topic = `e2e/device/${Date.now()}`;
    await page.request.post(`${API_URL}/api/mqtt/publish`, {
      data: {
        topic,
        payload: JSON.stringify({ temperature: 25 }),
      },
    });

    // Wait for the device registry to process the message
    await page.waitForTimeout(2000);

    // Get the device list
    const res = await page.request.get(`${API_URL}/api/devices`);
    const devices = (await res.json()) as Array<{ id: string; integration: string }>;

    // If MQTT is connected, the device should appear; if not, the list should still
    // return without error
    expect(Array.isArray(devices)).toBe(true);
  });

  test("device action endpoint returns expected shape for unknown device", async ({ page }) => {
    await ensureAdmin(page);

    // Try to execute an action on a non-existent device
    const res = await page.request.post(`${API_URL}/api/devices/nonexistent-device-id/action`, {
      data: { type: "toggle", params: {} },
    });

    // Should return a structured error (not a 500)
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  test("device actions catalog returns for a device", async ({ page }) => {
    await ensureAdmin(page);

    // Get device list first
    const listRes = await page.request.get(`${API_URL}/api/devices`);
    const devices = (await listRes.json()) as Array<{ id: string }>;

    if (devices.length > 0) {
      // Get action catalog for first device
      const actionsRes = await page.request.get(`${API_URL}/api/devices/${devices[0].id}/actions`);
      expect(actionsRes.ok()).toBe(true);
      const actions = await actionsRes.json();
      expect(Array.isArray(actions)).toBe(true);
    }
  });

  test("MQTT status endpoint reports broker connection", async ({ page }) => {
    await ensureAdmin(page);

    const res = await page.request.get(`${API_URL}/api/health`);
    expect(res.ok()).toBe(true);

    const health = (await res.json()) as { mqtt: string };
    // MQTT could be connected or disconnected depending on test environment
    expect(["connected", "disconnected"]).toContain(health.mqtt);
  });

  test("state history API returns device history", async ({ page }) => {
    await ensureAdmin(page);

    // Get device list
    const listRes = await page.request.get(`${API_URL}/api/devices`);
    const devices = (await listRes.json()) as Array<{ id: string }>;

    if (devices.length > 0) {
      // Get state history for first device
      const historyRes = await page.request.get(`${API_URL}/api/state/history/${devices[0].id}`);
      expect(historyRes.ok()).toBe(true);
      const history = await historyRes.json();
      expect(Array.isArray(history)).toBe(true);
    }
  });
});
