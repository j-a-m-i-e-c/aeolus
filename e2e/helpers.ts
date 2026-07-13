// e2e/helpers.ts — Shared actions for the e2e specs.
//
// The suite is designed to survive BOTH a fresh backend (first-run setup) and
// an already-set-up one (login). `ensureAdmin` hides that branch so every spec
// except the dedicated first-run test can run regardless of DB state — which is
// what makes local iteration (`make e2e`) and future seeded specs pleasant.

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
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Log in as the admin and land on the dashboard (assumes an admin exists). */
export async function login(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByText("Sign in to your dashboard")).toBeVisible();
  await page.locator("#login-username").fill(ADMIN.username);
  await page.locator("#login-password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Get to an authenticated dashboard regardless of DB state: create the admin on
 * a fresh backend, otherwise log in with the same credentials.
 */
export async function ensureAdmin(page: Page): Promise<void> {
  if (await isFreshBackend(page)) {
    await createAdmin(page);
  } else {
    await login(page);
  }
}
