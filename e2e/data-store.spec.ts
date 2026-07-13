// e2e/data-store.spec.ts — Data Store page and API integration.
//
// Exercises the Data Store setup, collection CRUD, record insertion, and
// key-value bucket operations via both the API and UI navigation.

import { test, expect } from "@playwright/test";
import { ensureAdmin } from "./helpers";
import { API_URL } from "./constants";

test.describe("data store", () => {
  test("data store page is accessible from sidebar", async ({ page }) => {
    await ensureAdmin(page);
    await page.getByRole("link", { name: "Data" }).click();
    await expect(page).toHaveURL(/\/data-store$/);
  });

  test("data store config API returns enabled status", async ({ page }) => {
    await ensureAdmin(page);

    const res = await page.request.get(`${API_URL}/api/data-store/config`);
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as {
      enabled: boolean;
      maxStorageMb: number;
      maxRecordsPerCollection: number;
      maxCollections: number;
    };

    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.maxStorageMb).toBe("number");
  });

  test("can enable the data store if not already enabled", async ({ page }) => {
    await ensureAdmin(page);

    // Check current config
    const configRes = await page.request.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };

    if (!config.enabled) {
      // Enable the data store
      const enableRes = await page.request.post(`${API_URL}/api/data-store/enable`, {
        data: { maxStorageMb: 50, maxRecordsPerCollection: 10000, maxCollections: 20 },
      });
      expect(enableRes.ok()).toBe(true);
    }

    // Verify it's now enabled
    const verifyRes = await page.request.get(`${API_URL}/api/data-store/config`);
    const verifyConfig = (await verifyRes.json()) as { enabled: boolean };
    expect(verifyConfig.enabled).toBe(true);
  });

  test("can create, read, and delete a collection", async ({ page }) => {
    await ensureAdmin(page);

    // Ensure data store is enabled
    const configRes = await page.request.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };
    if (!config.enabled) {
      await page.request.post(`${API_URL}/api/data-store/enable`, {
        data: { maxStorageMb: 50, maxRecordsPerCollection: 10000, maxCollections: 20 },
      });
    }

    const collectionName = `e2e-test-${Date.now()}`;

    // Create a collection
    const createRes = await page.request.post(`${API_URL}/api/data-store/collections`, {
      data: { name: collectionName, description: "E2E test collection" },
    });
    expect(createRes.ok()).toBe(true);

    // Verify it appears in the list
    const listRes = await page.request.get(`${API_URL}/api/data-store/collections`);
    const collections = (await listRes.json()) as Array<{ name: string }>;
    expect(collections.some((c) => c.name === collectionName)).toBe(true);

    // Delete the collection
    const deleteRes = await page.request.delete(`${API_URL}/api/data-store/collections/${collectionName}`);
    expect(deleteRes.ok()).toBe(true);

    // Verify it's gone
    const verifyRes = await page.request.get(`${API_URL}/api/data-store/collections`);
    const remaining = (await verifyRes.json()) as Array<{ name: string }>;
    expect(remaining.some((c) => c.name === collectionName)).toBe(false);
  });

  test("can insert and query records in a collection", async ({ page }) => {
    await ensureAdmin(page);

    // Ensure data store is enabled
    const configRes = await page.request.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };
    if (!config.enabled) {
      await page.request.post(`${API_URL}/api/data-store/enable`, {
        data: { maxStorageMb: 50, maxRecordsPerCollection: 10000, maxCollections: 20 },
      });
    }

    const collectionName = `e2e-records-${Date.now()}`;

    // Create collection
    await page.request.post(`${API_URL}/api/data-store/collections`, {
      data: { name: collectionName },
    });

    // Insert records
    const insertRes = await page.request.post(`${API_URL}/api/data-store/collections/${collectionName}/records`, {
      data: {
        payload: { temperature: 22.5, humidity: 45 },
        tags: { location: "living-room" },
      },
    });
    expect(insertRes.ok()).toBe(true);

    // Query records
    const queryRes = await page.request.get(`${API_URL}/api/data-store/collections/${collectionName}/records`);
    expect(queryRes.ok()).toBe(true);
    const queryBody = (await queryRes.json()) as { records: Array<{ payload: Record<string, unknown> }>; total: number };
    expect(queryBody.total).toBe(1);
    expect(queryBody.records[0].payload.temperature).toBe(22.5);

    // Clean up
    await page.request.delete(`${API_URL}/api/data-store/collections/${collectionName}`);
  });

  test("can use key-value buckets", async ({ page }) => {
    await ensureAdmin(page);

    // Ensure data store is enabled
    const configRes = await page.request.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };
    if (!config.enabled) {
      await page.request.post(`${API_URL}/api/data-store/enable`, {
        data: { maxStorageMb: 50, maxRecordsPerCollection: 10000, maxCollections: 20 },
      });
    }

    const bucket = "e2e-settings";
    const key = "theme";
    const value = { mode: "dark", accent: "blue" };

    // Set a value
    const putRes = await page.request.put(`${API_URL}/api/data-store/buckets/${bucket}/${key}`, {
      data: { value },
    });
    expect(putRes.ok()).toBe(true);

    // Get the value back
    const getRes = await page.request.get(`${API_URL}/api/data-store/buckets/${bucket}/${key}`);
    expect(getRes.ok()).toBe(true);
    const getBody = (await getRes.json()) as { key: string; value: unknown };
    expect(getBody.key).toBe(key);
    expect(getBody.value).toEqual(value);

    // List buckets
    const bucketsRes = await page.request.get(`${API_URL}/api/data-store/buckets`);
    expect(bucketsRes.ok()).toBe(true);
    const buckets = (await bucketsRes.json()) as Array<{ bucket: string }>;
    expect(buckets.some((b) => b.bucket === bucket)).toBe(true);

    // Delete the key
    const deleteRes = await page.request.delete(`${API_URL}/api/data-store/buckets/${bucket}/${key}`);
    expect(deleteRes.ok()).toBe(true);
  });

  test("data store stats API reports storage usage", async ({ page }) => {
    await ensureAdmin(page);

    // Ensure data store is enabled
    const configRes = await page.request.get(`${API_URL}/api/data-store/config`);
    const config = (await configRes.json()) as { enabled: boolean };
    if (!config.enabled) {
      await page.request.post(`${API_URL}/api/data-store/enable`, {
        data: { maxStorageMb: 50, maxRecordsPerCollection: 10000, maxCollections: 20 },
      });
    }

    const statsRes = await page.request.get(`${API_URL}/api/data-store/stats`);
    expect(statsRes.ok()).toBe(true);

    const stats = (await statsRes.json()) as {
      totalRecords: number;
      totalCollections: number;
      estimatedStorageMb: number;
    };

    expect(typeof stats.totalRecords).toBe("number");
    expect(typeof stats.totalCollections).toBe("number");
    expect(typeof stats.estimatedStorageMb).toBe("number");
  });
});
