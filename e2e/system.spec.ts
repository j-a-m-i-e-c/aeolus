// e2e/system.spec.ts — System health & diagnostics page.

import { test, expect } from "@playwright/test";
import { ensureAdmin, getAdminToken, authedApi } from "./helpers";
import { API_URL } from "./constants";

test.describe("system & health", () => {
  test("health API returns expected shape", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/health`);
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as {
      mqtt: string;
      deviceCount: number;
      ruleCount: number;
      uptime: number;
    };

    expect(body.mqtt).toMatch(/^(connected|disconnected)$/);
    expect(typeof body.deviceCount).toBe("number");
    expect(typeof body.ruleCount).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  test("system info API returns host diagnostics", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/system`);
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as {
      hostname: string;
      platform: string;
      nodeVersion: string;
      cpuCores: number;
      memory: { total: number };
      uptime: number;
    };

    expect(body.hostname).toBeTruthy();
    expect(body.platform).toBeTruthy();
    expect(body.cpuCores).toBeGreaterThan(0);
    expect(body.memory.total).toBeGreaterThan(0);
    expect(body.uptime).toBeGreaterThan(0);
  });

  test("system version API returns build info", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/system/version`);
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as {
      commit: string;
      buildDate: string;
      updateAvailable: boolean;
    };

    expect(typeof body.commit).toBe("string");
    expect(typeof body.buildDate).toBe("string");
    expect(typeof body.updateAvailable).toBe("boolean");
  });

  test("system logs API returns log entries", async ({ page }) => {
    await ensureAdmin(page);
    const token = await getAdminToken(page.request);
    const api = authedApi(page.request, token);

    const res = await api.get(`${API_URL}/api/system/logs?count=10`);
    expect(res.ok()).toBe(true);

    const logs = (await res.json()) as Array<{ level: number; msg: string }>;
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
  });

  test("dashboard renders welcome or system page", async ({ page }) => {
    await ensureAdmin(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);

    // Either the welcome screen or the system page should be visible
    const hasWelcome = await page.getByRole("heading", { name: "Welcome to Aeolus" }).isVisible().catch(() => false);
    const hasSystem = await page.getByRole("heading", { name: "System" }).isVisible().catch(() => false);
    expect(hasWelcome || hasSystem).toBe(true);
  });
});
