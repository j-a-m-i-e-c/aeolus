// e2e/data-store.spec.ts — Data Store page and API integration.

import { test, expect } from "@playwright/test";
import { ensureAdmin, getAdminToken, authedApi } from "./helpers";
import { API_URL } from "./constants";

test.describe("data store", () => {
  test("data store page is accessible from sidebar", async ({ page }) => {
    await ensureAdmin(page);
    await page.getByRole("link", { name: "Data" }).click();
    await expect(page).toHaveURL(/\/data-store$/);
  });

  test("data store config API returns enabled status", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/data-store/config`);
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as { enabled: boolean; maxStorageMb: number };
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.maxStorageMb).toBe("number");
  });

  test("can enable the data store and create a collection", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    // Ensure data store is enabled
    const configRes = await api.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };

    if (!config.enabled) {
      const enableRes = await api.post(`${API_URL}/api/data-store/enable`, {
        maxStorageMb: 50,
        maxRecordsPerCollection: 10000,
        maxCollections: 20,
      });
      expect(enableRes.ok()).toBe(true);
    }

    // Create a collection
    const collectionName = `e2e-test-${Date.now()}`;
    const createRes = await api.post(`${API_URL}/api/data-store/collections`, {
      name: collectionName,
      description: "E2E test collection",
    });
    expect(createRes.ok()).toBe(true);

    // Verify it appears in the list
    const listRes = await api.get(`${API_URL}/api/data-store/collections`);
    const collections = (await listRes.json()) as Array<{ name: string }>;
    expect(collections.some((c) => c.name === collectionName)).toBe(true);

    // Clean up
    await api.delete(`${API_URL}/api/data-store/collections/${collectionName}`);
  });

  test("can insert and query records", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    // Ensure enabled
    const configRes = await api.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };
    if (!config.enabled) {
      await api.post(`${API_URL}/api/data-store/enable`, {
        maxStorageMb: 50, maxRecordsPerCollection: 10000, maxCollections: 20,
      });
    }

    const collectionName = `e2e-records-${Date.now()}`;
    await api.post(`${API_URL}/api/data-store/collections`, { name: collectionName });

    // Insert a record
    const insertRes = await api.post(`${API_URL}/api/data-store/collections/${collectionName}/records`, {
      payload: { temperature: 22.5, humidity: 45 },
      tags: { location: "living-room" },
    });
    expect(insertRes.ok()).toBe(true);

    // Query records
    const queryRes = await api.get(`${API_URL}/api/data-store/collections/${collectionName}/records`);
    expect(queryRes.ok()).toBe(true);
    const queryBody = (await queryRes.json()) as { records: Array<{ payload: Record<string, unknown> }>; total: number };
    expect(queryBody.total).toBe(1);
    expect(queryBody.records[0].payload.temperature).toBe(22.5);

    // Clean up
    await api.delete(`${API_URL}/api/data-store/collections/${collectionName}`);
  });

  test("can use key-value buckets", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    // Ensure enabled
    const configRes = await api.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };
    if (!config.enabled) {
      await api.post(`${API_URL}/api/data-store/enable`, {
        maxStorageMb: 50, maxRecordsPerCollection: 10000, maxCollections: 20,
      });
    }

    const bucket = `e2e-settings-${Date.now()}`;
    const key = "theme";
    const value = { mode: "dark", accent: "blue" };

    // Set a value
    const putRes = await api.put(`${API_URL}/api/data-store/buckets/${bucket}/${key}`, { value });
    expect(putRes.ok()).toBe(true);

    // Get the value back
    const getRes = await api.get(`${API_URL}/api/data-store/buckets/${bucket}/${key}`);
    expect(getRes.ok()).toBe(true);
    const getBody = (await getRes.json()) as { key: string; value: unknown };
    expect(getBody.key).toBe(key);
    expect(getBody.value).toEqual(value);

    // Delete the key
    await api.delete(`${API_URL}/api/data-store/buckets/${bucket}/${key}`);
  });
});
