// e2e/connectors.spec.ts — Connector management page.

import { test, expect } from "@playwright/test";
import { ensureAdmin, getAdminToken, authedApi } from "./helpers";
import { API_URL } from "./constants";

test.describe("connectors page", () => {
  test("connectors page is accessible", async ({ page }) => {
    await ensureAdmin(page);
    await page.getByRole("link", { name: "Connectors" }).click();
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
  });

  test("available connectors API lists Hue and Kasa", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/connectors/available`);
    expect(res.ok()).toBe(true);

    const connectors = (await res.json()) as Array<{ metadata: { id: string; displayName: string } }>;
    expect(connectors.some((c) => c.metadata.id === "kasa")).toBe(true);
    expect(connectors.some((c) => c.metadata.id === "hue")).toBe(true);
  });

  test("can enable and disable the Kasa connector", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    // Enable Kasa
    const enableRes = await api.post(`${API_URL}/api/connectors`, {
      connectorType: "kasa",
      config: { broadcastAddress: "192.168.1.255" },
    });
    expect(enableRes.ok()).toBe(true);
    const { id } = (await enableRes.json()) as { id: string };

    // Verify it appears in enabled list
    const listRes = await api.get(`${API_URL}/api/connectors`);
    expect(listRes.ok()).toBe(true);
    const enabled = (await listRes.json()) as Array<{ id: string; connectorType: string }>;
    expect(enabled.some((c) => c.id === id)).toBe(true);

    // Disable it
    const disableRes = await api.delete(`${API_URL}/api/connectors/${id}`);
    expect(disableRes.ok()).toBe(true);
  });
});
