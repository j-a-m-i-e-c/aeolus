// e2e/helpers.ts — Shared actions for the e2e specs.

import { expect, type Page } from "@playwright/test";
import { ADMIN, API_URL } from "./constants";

/** True when the backend has no admin yet (first-run). */
export async function isFreshBackend(page: Page): Promise<boolean> {
  const res = await page.request.get(`${API_URL}/api/auth/status`);
  if (!res.ok()) return false;
  const body = (await res.json()) as { needsSetup?: boolean };
  return body.needsSetup === true;
}

/** Run the first-run setup flow: create the admin and land on the dashboard. */
export async function createAdmin(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Create Admin Account" }),
  ).toBeVisible();
  await page.locator("#setup-username").fill(ADMIN.username);
  await page.locator("#setup-password").fill(ADMIN.password);
  await page.locator("#setup-confirm-password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Log in as the admin and land on the dashboard (assumes an admin exists). */
export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Already on dashboard (session restored)
  if (page.url().includes("/dashboard")) return;

  const loginVisible = await page.getByText("Sign in to your dashboard").isVisible({ timeout: 5000 }).catch(() => false);
  if (!loginVisible) {
    await page.waitForTimeout(1000);
    return;
  }

  await page.locator("#login-username").fill(ADMIN.username);
  await page.locator("#login-password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Get to an authenticated dashboard regardless of DB state.
 */
export async function ensureAdmin(page: Page): Promise<void> {
  if (await isFreshBackend(page)) {
    await createAdmin(page);
  } else {
    await login(page);
  }
}
